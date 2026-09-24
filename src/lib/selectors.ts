/**
 * Reglas de negocio puras (sin React, sin DOM): totales, crédito y cobertura.
 * Aisladas acá para que la capa de servicio sólo tenga que aportar los datos.
 */
import {
  aplicaCredito,
  creditoDisponibleProyectado,
  creditoResultante,
  SIN_CREDITO,
  type OperacionCredito,
} from '@/lib/credito'
import {
  alicuotaDeclarada,
  bonificacionLinea,
  descuentoCompuesto,
  ivaLinea,
  netoLinea,
} from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { esFlujoRemito } from '@/lib/pasos'
import type {
  Cliente,
  ComisionesVenta,
  FacturaItem,
  LineaPresupuesto,
  Operacion,
  Producto,
  TipoEntrega,
  TipoVenta,
  VentaItem,
} from '@/types'

export const IVA_RATE = 0.21

/**
 * Cómo se llegó a la venta. No alcanza con el tipo de venta: la tasa depende de la CADENA que la
 * originó —si hubo un presupuesto en el medio, y si esa cadena tiene una gestión comercial
 * registrada (actividades linkeadas)—.
 *
 * "Con actividades" significa: el documento que origina la venta tiene actividades en su columna
 * "🤖Actividades". En la venta CON PRESUPUESTO PREVIO son las de los presupuestos que aportaron
 * algún producto; en la DIRECTA, las tildadas en su propia etapa "Registrar Actividad" (ver
 * `actividadesDeLaVenta`).
 */
export type CombinacionVenta =
  | 'ACTIVIDADES-PRESUPUESTO-VENTA'
  | 'PRESUPUESTO-VENTA'
  | 'ACTIVIDADES-VENTA-DIRECTA'
  | 'VENTA-DIRECTA'

export const combinacionDeVenta = (
  tipoVenta: TipoVenta,
  conActividades: boolean,
): CombinacionVenta =>
  tipoVenta === 'CON PRESUPUESTO PREVIO'
    ? conActividades
      ? 'ACTIVIDADES-PRESUPUESTO-VENTA'
      : 'PRESUPUESTO-VENTA'
    : conActividades
      ? 'ACTIVIDADES-VENTA-DIRECTA'
      : 'VENTA-DIRECTA'

/**
 * Qué tasa le toca a cada combinación. Las cuatro juntas y a la vista porque son la regla entera:
 * repartidas en condicionales, cambiar una obliga a releer todas para saber qué se rompió.
 *
 * La Activa la paga UNA sola combinación: ACTIVIDADES-PRESUPUESTO-VENTA, la cadena completa —una
 * gestión registrada que produjo un presupuesto, y un presupuesto que se convirtió en venta—. Todo
 * lo demás paga la Pasiva: sin alguno de esos eslabones no hubo la gestión que la tasa alta
 * remunera.
 *
 * OJO con PRESUPUESTO-VENTA: paga Pasiva. Un presupuesto SIN actividades linkeadas ya no alcanza
 * para la Activa, que es lo que hacía antes de partir la regla en cuatro.
 */
const TASA_POR_COMBINACION: Record<CombinacionVenta, keyof ComisionesVenta> = {
  'ACTIVIDADES-PRESUPUESTO-VENTA': 'activa',
  'PRESUPUESTO-VENTA': 'pasiva',
  'ACTIVIDADES-VENTA-DIRECTA': 'pasiva',
  'VENTA-DIRECTA': 'pasiva',
}

/**
 * Tasa de comisión que rige la operación. Es una sola para toda la venta; el producto sólo decide
 * si comisiona o no.
 *
 * `conActividades` NO tiene default a propósito: define plata. Quien calcula una comisión tiene que
 * contestar si la cadena de esta venta tiene una gestión registrada, y un default lo dejaría
 * contestando "no" sin enterarse —que en la venta CON PRESUPUESTO PREVIO es la diferencia entre la
 * Activa y la Pasiva—. El dato lo resuelve `useActividadesDeLaVenta`.
 */
export const tasaComision = (
  comisiones: ComisionesVenta,
  tipoVenta: TipoVenta,
  conActividades: boolean,
): number => comisiones[TASA_POR_COMBINACION[combinacionDeVenta(tipoVenta, conActividades)]]

/**
 * Comisión de UNA línea: la tasa aplicada sobre su importe neto —precio SIN IVA y con el descuento
 * total ya aplicado—. Un producto no comisionable no aporta nada.
 */
export const comisionLinea = (neto: number, comisionable: boolean, tasa: number): number =>
  comisionable ? round2((neto * tasa) / 100) : 0

/** Umbrales de semáforo sobre el % de crédito utilizado. */
const CREDITO_ALERTA = 50
const CREDITO_CRITICO = 90
/** Por encima de este % el footer del presupuesto pasa a rojo. */
const CREDITO_FOOTER_CRITICO = 95

/** Importe de la línea, ya bonificado. Como todo monto, redondeado a dos decimales. */
export const totalLinea = (l: LineaPresupuesto): number =>
  round2(l.producto.precio * l.cantidad * (1 - l.descuento / 100))

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   RENTABILIDAD
   ══════════════════════════════════════════════════════════════════════════════════════════════

   Es la cuenta que definió el comercio (planilla "cálculo de rentab"), y es UNA sola para toda la
   app: la ficha de la carga, la columna de la tabla, lo que se graba en Monday y la rentabilidad
   general salen de las funciones de este bloque.

   ── Cómo arma el maestro el precio de venta ──

     L1, L7, L8:  Precio = Costo Final + Flete + Costo Final × Margen Lx
     L2, L3:      Precio = Precio L1 × (1 − Descuento Lx)

   El margen es un MARKUP SOBRE EL COSTO del producto; el flete se suma aparte, SIN margen encima:
   es plata que se le paga al transportista, no ganancia del comercio. Las listas L2 y L3 son L1
   con un descuento sobre el precio COMPLETO —flete incluido—, igual que cualquier otro descuento.

   ── La fórmula ──

     Resultado bruto = Precio de venta − Costo Final − Flete
     Rentabilidad %  = Resultado bruto / Costo Final × 100

   Tres reglas salen de acá, y las tres se respetan en todas las funciones:

     1. El flete se RESTA del resultado, pero NO suma al denominador: se divide por el costo del
        producto solo, no por costo + flete.
     2. Todo va SIN IVA. El IVA no es ingreso ni costo del comercio: se le cobra al cliente y se le
        paga al fisco. Por eso el precio que se mide es `precioSinIva`, nunca `precio` (que al
        Monotributista, Consumidor Final y Exento le llega con la alícuota sumada).
     3. Los descuentos —de lista, por forma de pago y manual— bajan el PRECIO; el costo y el flete
        no se mueven. El flete se paga igual se venda a L1 o a L3.

   Ejemplo de la planilla: Costo 102.162,35 · Flete 175 · Margen L1 23%
     Precio L1       = 102.162,35 + 175 + 23.497,34 = 125.834,69
     Resultado bruto = 125.834,69 − 102.162,35 − 175 = 23.497,34
     Rentabilidad    = 23.497,34 / 102.162,35      = 23,00%
   La cuenta que NO hay que hacer —y que la app hacía— es (125.834,69 / 102.162,35 − 1) = 23,17%:
   se olvida del flete y lo cuenta como ganancia.

   Con un 10% de descuento sobre ese mismo precio la rentabilidad no es (1,23 × 0,90 − 1) = 10,70%:
   el descuento se come parte del precio pero el flete sigue costando lo mismo. La cuenta con
   importes da (113.251,22 − 102.162,35 − 175) / 102.162,35 = 10,68%. */

/** Flete por unidad del producto, SIN IVA. Sin dato cargado (o con un valor inválido) es 0. */
export const fleteDe = (p: { flete?: number }): number =>
  typeof p.flete === 'number' && Number.isFinite(p.flete) && p.flete > 0 ? p.flete : 0

/** Un % de descuento acotado a [0, 100]. Un valor inválido no descuenta nada. */
const pctDescuento = (pct: number): number =>
  Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) : 0

/**
 * RENTABILIDAD de una venta, en %, a dos decimales:
 *
 *   rentabilidad = (precio S/IVA − Costo Final − Flete) / Costo Final × 100
 *
 * `precioVentaSinIva` es el precio que EFECTIVAMENTE se cobra, sin IVA y con todos los descuentos
 * ya aplicados: el descuento no entra como parámetro. Al bajar el precio la rentabilidad cae sola,
 * y por debajo de Costo + Flete da negativa —el producto se vende a pérdida—. Regalado (precio 0)
 * pierde el costo Y el flete: −100% menos lo que pesa el flete sobre el costo.
 *
 * Sin costo cargado no hay contra qué medir: devuelve 0, no se inventa una rentabilidad.
 */
export function rentabilidadDe(
  precioVentaSinIva: number,
  costoSinIva: number,
  fleteSinIva = 0,
): number {
  if (!Number.isFinite(precioVentaSinIva) || !Number.isFinite(costoSinIva)) return 0
  if (costoSinIva <= 0) return 0
  const precio = Math.max(precioVentaSinIva, 0)
  const flete = fleteDe({ flete: fleteSinIva })
  return round2(((precio - costoSinIva - flete) / costoSinIva) * 100)
}

/**
 * Rentabilidad con un descuento aplicado sobre el precio. El descuento baja el PRECIO; el costo y
 * el flete no se mueven (regla 3). `descuentoPct` es el descuento TOTAL: si hay más de uno, ya
 * compuesto en cascada (`descuentoCompuesto`), porque sumar los porcentajes daría de más.
 */
export const rentabilidadConDescuento = (
  precioSinIva: number,
  costoSinIva: number,
  fleteSinIva: number,
  descuentoPct: number,
): number =>
  rentabilidadDe(precioSinIva * (1 - pctDescuento(descuentoPct) / 100), costoSinIva, fleteSinIva)

/**
 * Costo SIN IVA y SIN flete de un producto: el "🤖Costo Final" del maestro.
 *
 * Si el maestro no lo trajo, se despeja del precio de lista y su "Margen", con la misma fórmula
 * con la que el maestro arma el precio, dada vuelta:
 *
 *   precio = costo + flete + costo × margen   ⇒   costo = (precio − flete) / (1 + margen)
 *
 * Es un respaldo: es exacto para L1, L7 y L8, cuyo precio sale de ese margen. En L2 y L3 el precio
 * sale de L1 con un descuento, así que despejar con su "Margen" es una aproximación. En la práctica
 * el maestro siempre trae el Costo Final; el respaldo existe para no mostrar 0% cuando falta.
 */
export function costoDe(p: {
  precioCosto?: number
  precioSinIva?: number
  precio: number
  rentabilidad: number
  flete?: number
}): number {
  if (p.precioCosto && p.precioCosto > 0) return p.precioCosto
  const precio = p.precioSinIva ?? p.precio
  const markup = 1 + p.rentabilidad / 100
  return markup > 0 ? round2(Math.max(precio - fleteDe(p), 0) / markup) : 0
}

/** Precio de lista SIN IVA de un producto. Sin el dato cargado se cae al precio a secas. */
export const precioNetoDe = (p: { precioSinIva?: number; precio: number }): number =>
  p.precioSinIva ?? p.precio

/** Lo que las funciones de rentabilidad necesitan saber de un producto. */
type ProductoRentable = {
  precioCosto?: number
  precioSinIva?: number
  precio: number
  rentabilidad: number
  flete?: number
}

/**
 * Rentabilidad de UN producto a su precio de lista SIN IVA, con un descuento total opcional.
 *
 * Con `descuentoPct = 0` es la rentabilidad BASE: la que muestra la ficha de la carga y la que
 * queda registrada en el remito. Se CALCULA —no se lee el "Margen" del maestro— para que la ficha,
 * la "Rentabilidad Final" y la columna de la tabla salgan de la misma cuenta: sin descuentos, las
 * tres dicen exactamente lo mismo. En L1 da el Margen L1 tal cual (23% en el ejemplo); en L2/L3,
 * la rentabilidad real de esa lista; en L7/L8, que no publican su margen, deja de mostrar 0%.
 */
export const rentabilidadProductoDe = (p: ProductoRentable, descuentoPct = 0): number =>
  rentabilidadConDescuento(precioNetoDe(p), costoDe(p), fleteDe(p), descuentoPct)

/**
 * El precio unitario vigente deja al producto EN PÉRDIDA: no alcanza a cubrir Costo + Flete. Mide
 * el precio de lista SIN IVA TAL COMO quedó —con el override del administrador ya aplicado, que es
 * de donde sale la pérdida—, sin descuentos de por medio.
 *
 * El flete cuenta: un precio que cubre el costo pero no el flete también pierde plata.
 *
 * Sin costo conocido devuelve `false`: `rentabilidadDe` no inventa una rentabilidad cuando no hay
 * contra qué medir, y una pérdida que no se puede probar no se afirma.
 */
export const precioDaPerdida = (p: ProductoRentable): boolean => rentabilidadProductoDe(p) < 0

/**
 * El producto ACEPTA la rentabilidad forzada cuando el interruptor está encendido. Son DOS motivos
 * independientes, y alcanza con uno:
 *
 *   1. El maestro lo habilita ("🤖Rentabilidad Forzada" = "Con Rentab Forzada").
 *   2. Su precio unitario quedó por debajo de Costo + Flete. Es el caso que la funcionalidad
 *      resuelve: al pisar el precio a mano la rentabilidad se va a negativo, y forzarla lo corrige.
 *
 * Es la ÚNICA fuente de esta regla: la usan el reducer —que marca la línea— y la previsualización
 * de la carga, así que lo que se muestra antes de agregar no puede diferir de lo que se aplica.
 */
export const aceptaRentabForzada = (
  p: ProductoRentable & { conRentabForzada?: boolean },
): boolean => p.conRentabForzada === true || precioDaPerdida(p)

/* ── Rentabilidad forzada ────────────────────────────────────────────────────────────────────

   El comercio quiere asegurarse un % de rentabilidad en ciertos productos aunque el precio de
   venta no lo alcance, y la diferencia la cubre el PROVEEDOR con una nota de crédito. El precio
   que paga el cliente NO se toca. La pregunta que se contesta es:

     "¿Cuánto nos tendría que haber costado este producto para ganar exactamente el % forzado?"

   Ese costo es el NUEVO PRECIO DE COSTO, y lo que falta para llegar a él desde el costo real es la
   NOTA DE CRÉDITO X COMISIÓN que el proveedor le reconoce al comercio.

   Se despeja de la misma fórmula de la rentabilidad, con el precio fijo y el costo como incógnita:

     % = (Precio − Nuevo Costo − Flete) / Nuevo Costo
       ⇒  Nuevo Costo = (Precio − Flete) / (1 + %)

     Nota de Crédito (por unidad) = Costo Final − Nuevo Costo

   donde Precio es el precio que efectivamente se cobra: SIN IVA y con los descuentos aplicados.
   Es un markup sobre el costo, igual que la rentabilidad: por eso se DIVIDE por (1 + %) y no se
   multiplica por (1 − %), que sería ganar el % sobre el precio de venta.

   Ejemplo: Costo 102.162,35 · Flete 175 · Precio (pisado por el administrador) 110.000 · 23%
     Nuevo Costo     = (110.000 − 175) / 1,23             = 89.288,62
     Nota de Crédito = 102.162,35 − 89.288,62             = 12.873,73 por unidad
     Control         = (110.000 − 89.288,62 − 175) / 89.288,62 = 23,00%

   Si el producto YA rinde el % forzado o más, el costo necesario sale igual o MAYOR al real y la
   nota de crédito daría cero o negativa: el proveedor no le cobra al comercio por ganar de más. En
   ese caso no hay nada que compensar —no se genera nota de crédito— y la línea muestra su
   rentabilidad real, que ya supera el % pedido. */

/** Lo que deja calculado la rentabilidad forzada sobre UNA unidad de producto. */
export interface RentabForzadaCalculada {
  /** Costo con el que el producto rinde exactamente el % forzado: (Precio − Flete) / (1 + %). */
  nuevoCosto: number
  /** Nota de Crédito x Comisión POR UNIDAD: Costo Final − Nuevo Costo. Siempre mayor a cero. */
  notaCredito: number
  /** La rentabilidad resultante: exactamente el % forzado. */
  rentabilidad: number
}

/**
 * Rentabilidad forzada de un producto al `pct` pedido, sobre su precio de lista SIN IVA con el
 * `descuentoPct` total aplicado.
 *
 * Devuelve `null` —no hay nada que forzar— cuando:
 *   · no hay costo conocido contra el cual calcular la nota de crédito, o
 *   · el producto ya rinde `pct` o más (la nota de crédito saldría cero o negativa).
 */
export function rentabForzadaDe(
  p: ProductoRentable,
  pct: number,
  descuentoPct = 0,
): RentabForzadaCalculada | null {
  const costo = costoDe(p)
  if (!(costo > 0) || !Number.isFinite(pct) || pct < 0) return null
  const precio = precioNetoDe(p) * (1 - pctDescuento(descuentoPct) / 100)
  const nuevoCosto = round2((precio - fleteDe(p)) / (1 + pct / 100))
  const notaCredito = round2(costo - nuevoCosto)
  if (!(notaCredito > 0)) return null
  return { nuevoCosto, notaCredito, rentabilidad: pct }
}

/* ── Rentabilidad de una línea de la selección de productos ──────────────────────────────── */

/** Descuento TOTAL de la línea: el manual y el de forma de pago, compuestos en cascada. */
export const descuentoTotalLinea = (l: LineaPresupuesto, descFormaPago = 0): number =>
  descuentoCompuesto(l.descuento, descFormaPago)

/** Rentabilidad BASE del producto de la línea: sin ningún descuento, sobre su precio de lista. */
export const rentabilidadBaseLinea = (l: LineaPresupuesto): number =>
  rentabilidadProductoDe(l.producto)

/**
 * Rentabilidad forzada EFECTIVA de la línea, o `null` si no corre.
 *
 * La línea guarda sólo el % pedido (`rentabForzadaAplicada`, que el reducer marca cuando el
 * interruptor está encendido y el producto la acepta). El Nuevo Costo y la Nota de Crédito NO se
 * guardan: se derivan acá, con el descuento vigente, cada vez que se leen. Guardados, quedaban
 * viejos en cuanto el vendedor cambiaba el descuento o la forma de pago después de forzar.
 */
export const rentabForzadaLinea = (
  l: LineaPresupuesto,
  descFormaPago = 0,
): RentabForzadaCalculada | null =>
  l.rentabForzadaAplicada == null
    ? null
    : rentabForzadaDe(l.producto, l.rentabForzadaAplicada, descuentoTotalLinea(l, descFormaPago))

/** Nota de Crédito x Comisión POR UNIDAD de la línea; `undefined` si no hay rentabilidad forzada. */
export const notaCreditoLinea = (l: LineaPresupuesto, descFormaPago = 0): number | undefined =>
  rentabForzadaLinea(l, descFormaPago)?.notaCredito

/**
 * TOTAL Nota de Crédito x Comisión de la operación: la nota de crédito por unidad de cada línea
 * forzada, MULTIPLICADA POR SU CANTIDAD. Es lo que el proveedor le reconoce al comercio por toda
 * la mercadería de la operación, no por una unidad de cada producto.
 */
export const notaCreditoTotal = (lineas: LineaPresupuesto[], descFormaPago = 0): number =>
  round2(
    lineas.reduce((acc, l) => acc + (notaCreditoLinea(l, descFormaPago) ?? 0) * l.cantidad, 0),
  )

/**
 * Rentabilidad FINAL de la línea: la ganancia sobre el precio que efectivamente se cobra, o sea con
 * los DOS descuentos ya aplicados (el manual y el de forma de pago, compuestos en cascada).
 *
 * Con la rentabilidad forzada corriendo es exactamente el % forzado: el costo se recalculó para dar
 * ese número. Si la línea tiene el % forzado marcado pero ya lo supera, se muestra la real.
 *
 * Es el número que ve el vendedor en "Rentabilidad Final" ANTES de agregar el producto, el de la
 * columna de la tabla DESPUÉS de agregarlo, el que se graba en la línea en Monday y el que aporta
 * la línea a la rentabilidad general.
 */
export const rentabilidadFinalLinea = (l: LineaPresupuesto, descFormaPago = 0): number =>
  rentabForzadaLinea(l, descFormaPago)?.rentabilidad ??
  rentabilidadProductoDe(l.producto, descuentoTotalLinea(l, descFormaPago))

/**
 * Costo POR UNIDAD con el que se mide la línea: el Nuevo Costo si la rentabilidad forzada corre
 * —la nota de crédito del proveedor baja lo que el producto le cuesta al comercio—, y el Costo
 * Final del maestro si no. Es el peso de la línea en la rentabilidad general.
 */
export const costoEfectivoLinea = (l: LineaPresupuesto, descFormaPago = 0): number =>
  rentabForzadaLinea(l, descFormaPago)?.nuevoCosto ?? costoDe(l.producto)

/* ── Rentabilidad de líneas que vienen de un documento ya emitido ────────────────────────────

   La venta CON PRESUPUESTO PREVIO, la VENTA PROFORMA y la entrega ANTERIOR no parten del
   catálogo: parten de subelementos ya grabados, que traen su precio y un "Rentab %" registrado.
   El Costo Final y el Flete se leen del producto del maestro conectado a cada subelemento
   (`costo` / `flete` del ítem), así que se puede hacer la misma cuenta que en la venta DIRECTA. */

/**
 * Rentabilidad de una línea tomada de un PRESUPUESTO. El precio del presupuesto es SIEMPRE el de
 * lista SIN IVA (el presupuesto no liquida IVA), así que con el costo y el flete del maestro se
 * hace la cuenta con importes, con el descuento total que tenga la línea en la venta.
 *
 * Respaldo sin costo: se toma la rentabilidad registrada en el subelemento —la que quedó con el
 * descuento del presupuesto— y se la lleva al descuento nuevo sin conocer el flete:
 *   (1 + rent) × (1 − desc nuevo) / (1 − desc del presupuesto) − 1
 */
export function rentabilidadItemPresupuesto(
  it: { precio: number; rent: number; descuento?: number; costo?: number; flete?: number },
  descuentoTotalPct: number,
): number {
  if (it.costo && it.costo > 0) {
    return rentabilidadConDescuento(it.precio, it.costo, it.flete ?? 0, descuentoTotalPct)
  }
  const registrado = 1 - pctDescuento(it.descuento ?? 0) / 100
  if (!(registrado > 0)) return round2(it.rent)
  return round2(
    (((1 + it.rent / 100) * (1 - pctDescuento(descuentoTotalPct) / 100)) / registrado - 1) * 100,
  )
}

/**
 * Rentabilidad de una línea REMITIDA que se factura (entrega ANTERIOR) con un descuento por forma
 * de pago encima.
 *
 * El precio del remito puede venir CON IVA (al Monotributista se le remite al precio final), así
 * que no se usa. Se parte de la rentabilidad registrada al remitir —base, sin descuento, medida
 * sin IVA—, y con el costo y el flete se reconstruye el precio SIN IVA que la produjo:
 *
 *   rent = (P − C − F) / C   ⇒   P = C × (1 + rent) + F
 *
 * Ese precio se descuenta y se vuelve a medir. Sin costo conocido, el respaldo es la misma cuenta
 * sin flete: (1 + rent) × (1 − desc) − 1.
 */
export function rentabilidadItemRemito(
  it: { rent: number; costo?: number; flete?: number },
  descuentoPct: number,
): number {
  const d = pctDescuento(descuentoPct)
  if (d === 0) return round2(it.rent)
  if (it.costo && it.costo > 0) {
    const precioSinIva = it.costo * (1 + it.rent / 100) + fleteDe(it)
    return rentabilidadConDescuento(precioSinIva, it.costo, fleteDe(it), d)
  }
  return round2(((1 + it.rent / 100) * (1 - d / 100) - 1) * 100)
}

/* ── Rentabilidad GENERAL ────────────────────────────────────────────────────────────────────

   Como la rentabilidad de cada línea es Resultado / Costo, la de la operación entera es:

     Rentabilidad general = Σ Resultado bruto de cada línea / Σ Costo de cada línea

   que es EXACTAMENTE el promedio de la rentabilidad de cada línea PONDERADO POR SU COSTO (costo por
   unidad × cantidad). Así la general sale del mismo % que se ve en cada línea.

   NO se pondera por el importe de venta —como se hacía antes—: eso le da más peso a las líneas que
   más ganan (su precio es más alto respecto del costo) y deforma la general. Ejemplo:
     A: costo 100,  rent 50% → resultado 50,  venta 150
     B: costo 1000, rent 10% → resultado 100, venta 1100
     Correcto:  150 / 1100                        = 13,64%
     Por venta: (50% × 150 + 10% × 1100) / 1250  = 14,80%
   Ponderar por costo, además, deja el IVA afuera sin esfuerzo: el costo nunca lo lleva. */

/** Lo que aporta una línea a la rentabilidad general: su % y su costo TOTAL (unidad × cantidad). */
export interface AporteRentabilidad {
  rentabilidad: number
  costo: number
}

/**
 * Costo total de una línea para ponderar la general. Con el costo por unidad conocido es costo ×
 * cantidad; sin él se despeja del importe neto y de la rentabilidad de la línea —si rinde `r` sobre
 * un importe `N`, el costo es N / (1 + r)—, que ignora el flete pero es el mejor dato disponible.
 */
export function costoParaPonderar(
  costoUnitario: number | undefined,
  cantidad: number,
  neto: number,
  rentabilidad: number,
): number {
  if (costoUnitario && costoUnitario > 0) return costoUnitario * cantidad
  const markup = 1 + rentabilidad / 100
  return markup > 0 && neto > 0 ? neto / markup : 0
}

/**
 * Rentabilidad GENERAL de una operación, en %, a dos decimales: el promedio de la rentabilidad de
 * cada línea ponderado por su costo. Las líneas sin costo (peso 0) no aportan: no hay contra qué
 * medirlas. Sin ninguna línea medible devuelve 0.
 */
export function rentabilidadGeneral(aportes: AporteRentabilidad[]): number {
  const costoTotal = aportes.reduce((acc, a) => acc + (a.costo > 0 ? a.costo : 0), 0)
  if (!(costoTotal > 0)) return 0
  const ponderada = aportes.reduce(
    (acc, a) => acc + (a.costo > 0 ? a.rentabilidad * a.costo : 0),
    0,
  )
  return round2(ponderada / costoTotal)
}

/** Aporte de una línea de la selección de productos: su rentabilidad FINAL y su costo efectivo. */
export const aporteLinea = (l: LineaPresupuesto, descFormaPago = 0): AporteRentabilidad => ({
  rentabilidad: rentabilidadFinalLinea(l, descFormaPago),
  costo: costoEfectivoLinea(l, descFormaPago) * l.cantidad,
})

export const subtotalLinea = (l: LineaPresupuesto): number =>
  round2(l.producto.precio * l.cantidad)

export interface ResumenPresupuesto {
  /**
   * Suma de la columna **Subtotal** de la tabla: cantidad × precio, SIN descuentos. Es el
   * bruto del documento; sólo coincide con el total cuando ninguna línea lleva bonificación.
   */
  subtotal: number
  /** Lo bonificado sobre el bruto: subtotal − neto. */
  descuento: number
  /** Suma de la columna **Total** de la tabla: lo que queda después de bonificar. */
  neto: number
  /**
   * IVA del documento: la suma del IVA de cada línea, liquidado con la alícuota DECLARADA de su
   * producto (no con una tasa única). En el presupuesto siempre es 0: no lo liquida.
   */
  iva: number
  /** Importe final del documento: neto + IVA. */
  total: number
  /** Rentabilidad GENERAL: la de cada línea ponderada por su costo (ver `rentabilidadGeneral`). */
  rentabilidad: number
}

/**
 * Totales de una lista de productos, con los mismos números que muestra la tabla: el subtotal
 * es la suma de la columna Subtotal (bruto) y el neto, la de la columna Total (bonificado).
 *
 * `conIva` distingue los dos usos: la VENTA liquida el IVA, y el PRESUPUESTO no lo liquida en
 * absoluto —sus precios son los de lista, sin la alícuota del producto—.
 *
 * Cuando lo liquida, lo hace LÍNEA POR LÍNEA con la alícuota declarada de cada producto, que es
 * exactamente la que va a declarar el comprobante (ver `alicuotaDeclarada`). Antes se aplicaba un
 * 21% plano sobre el neto del documento: una venta DIRECTA con un producto al 10,5% terminaba con
 * un total —el que se le exige cobrar al cliente, el que se escribe en "🤖Importe Total $" y el que
 * viaja al recibo— más alto que la suma de sus propias facturas.
 */
export function resumenPresupuesto(
  lineas: LineaPresupuesto[],
  conIva = true,
  descFormaPago = 0,
): ResumenPresupuesto {
  /* El descuento por forma de pago (pronto pago) se compone EN CASCADA con el manual de cada
     línea —el manual muerde el precio ya rebajado—, con las mismas fórmulas que la tabla: así el
     total del documento es exactamente la suma de la columna Subtotal. */
  const totalCon = (l: LineaPresupuesto) =>
    netoLinea(l.producto.precio, l.cantidad, l.descuento, descFormaPago)
  // Los dos suman líneas ya redondeadas: es lo mismo que se ve producto por producto.
  const subtotal = round2(lineas.reduce((acc, l) => acc + subtotalLinea(l), 0))
  const neto = round2(lineas.reduce((acc, l) => acc + totalCon(l), 0))
  /* Cada línea aporta su rentabilidad FINAL —la misma de la columna de la tabla, con el % forzado
     cuando corre— y pesa por su COSTO (Σ resultado / Σ costo). A dos decimales, no a entero: una
     general de 36,17% es un valor real y redondearla la deja diciendo 36%. */
  const rentabilidad = rentabilidadGeneral(lineas.map((l) => aporteLinea(l, descFormaPago)))
  /* El IVA se suma por línea, con la alícuota que esa línea va a declarar en el comprobante: es lo
     único que garantiza que el total del documento y el total facturado sean el mismo número. */
  const iva = conIva
    ? round2(
        lineas.reduce(
          (acc, l) => acc + ivaLinea(totalCon(l), alicuotaDeclarada(l.producto.iva)),
          0,
        ),
      )
    : 0
  return {
    subtotal,
    descuento: round2(subtotal - neto),
    neto,
    iva,
    total: round2(neto + iva),
    rentabilidad,
  }
}

/** Totales de una sola moneda dentro del presupuesto bimonetario. */
export interface TotalMoneda {
  /** Bruto: Σ (precio × cantidad), sin descuentos. */
  subtotal: number
  /** Lo bonificado sobre el bruto: subtotal − neto. */
  descuento: number
  /** Neto tras bonificar (el presupuesto no liquida IVA). */
  neto: number
}

export interface ResumenBimoneda {
  /** Productos presupuestados en pesos. */
  ars: TotalMoneda
  /** Productos presupuestados en dólares (en su moneda original, SIN convertir). */
  usd: TotalMoneda
  /** Neto total llevado a pesos: ARS + USD × tasa. Sólo para medir el impacto en el crédito. */
  netoProyectado: number
  /** Rentabilidad GENERAL: la de cada línea ponderada por su costo en pesos-equivalente. */
  rentabilidad: number
  /** Hay al menos un producto en dólares en el presupuesto. */
  hayDolares: boolean
}

/** Los tres totales de una moneda, extraídos de un `ResumenPresupuesto`. */
const totalMoneda = (r: ResumenPresupuesto): TotalMoneda => ({
  subtotal: r.subtotal,
  descuento: r.descuento,
  neto: r.neto,
})

/**
 * Totales BIMONETARIOS del presupuesto. Los productos en dólares se presupuestan en su moneda
 * (no se convierten): se separan de los de pesos y cada grupo tiene su propio subtotal/descuento/
 * neto. El neto en dólares se lleva a pesos con la tasa del día SÓLO para `netoProyectado`, que es
 * lo que se resta del crédito disponible del cliente. La rentabilidad general pondera cada línea por
 * su COSTO llevado a pesos-equivalente, para que el indicador tenga una sola escala.
 *
 * `descFormaPago` es el descuento por pronto pago de la operación (0 si no aplica): se compone EN
 * CASCADA con el descuento manual de cada línea, las mismas fórmulas que usa la tabla de productos,
 * así los totales de las dos monedas dicen exactamente lo mismo que las filas.
 */
export function resumenPresupuestoBimoneda(
  lineas: LineaPresupuesto[],
  tasa: number,
  descFormaPago = 0,
): ResumenBimoneda {
  const t = tasa > 0 ? tasa : 0
  const arsLineas = lineas.filter((l) => !esDolar(l.producto.moneda))
  const usdLineas = lineas.filter((l) => esDolar(l.producto.moneda))
  const ars = resumenPresupuesto(arsLineas, false, descFormaPago)
  const usd = resumenPresupuesto(usdLineas, false, descFormaPago)
  /* Cada línea aporta su rentabilidad FINAL —con los dos descuentos ya aplicados, y con el % forzado
     cuando corre—, igual que la rentabilidad de una sola moneda, y pesa por su COSTO en pesos: el
     de las líneas en dólares se convierte con la tasa del día. El % no cambia con la moneda (es un
     cociente), pero el peso sí: sin convertir, un costo de 100 dólares pesaría como 100 pesos. */
  const rentabilidad = rentabilidadGeneral(
    lineas.map((l) => {
      const aporte = aporteLinea(l, descFormaPago)
      return esDolar(l.producto.moneda) ? { ...aporte, costo: aporte.costo * t } : aporte
    }),
  )
  return {
    ars: totalMoneda(ars),
    usd: totalMoneda(usd),
    netoProyectado: round2(ars.neto + usd.neto * t),
    rentabilidad,
    hayDolares: usdLineas.length > 0,
  }
}

/**
 * Comisión total de una venta armada desde el catálogo (DIRECTA): la tasa que rige la operación
 * aplicada sobre el neto de cada línea COMISIONABLE. El neto ya viene sin IVA y con el descuento
 * total aplicado (manual + forma de pago, en cascada), que es la base que corresponde.
 */
export function comisionLineas(
  lineas: LineaPresupuesto[],
  comisiones: ComisionesVenta,
  tipoVenta: TipoVenta,
  descFormaPago = 0,
  /** La cadena de la venta tiene actividades linkeadas (ver `tasaComision`). */
  conActividades = false,
): number {
  const tasa = tasaComision(comisiones, tipoVenta, conActividades)
  return round2(
    lineas.reduce(
      (acc, l) =>
        acc +
        comisionLinea(
          netoLinea(l.producto.precio, l.cantidad, l.descuento, descFormaPago),
          l.producto.comisionable === true,
          tasa,
        ),
      0,
    ),
  )
}

export interface CreditoCliente {
  disponible: number
  usadoPct: number
  disponiblePct: number
  /** Color del semáforo, en variables CSS. */
  color: string
  /** Clase de texto asociada al semáforo. */
  clase: 'v-green' | 'v-orange' | 'v-red'
  bloqueado: boolean
}

/**
 * Estado de crédito del cliente. El disponible lo calcula el board ("🤖Crédito Disponible");
 * el uso es lo que falta para llegar al límite, no un cálculo propio.
 */
export function creditoCliente(c: Cliente): CreditoCliente {
  const disponible = c.disponible
  const usado = c.limit - disponible
  const usadoPct = c.limit > 0 ? Math.round((usado / c.limit) * 100) : 0
  const disponiblePct = c.limit > 0 ? Math.round((disponible / c.limit) * 100) : 100

  let color = 'var(--green)'
  let clase: CreditoCliente['clase'] = 'v-green'
  if (usadoPct >= CREDITO_CRITICO) {
    color = 'var(--red)'
    clase = 'v-red'
  } else if (usadoPct >= CREDITO_ALERTA) {
    color = 'var(--yellow)'
    clase = 'v-orange'
  }

  return { disponible, usadoPct, disponiblePct, color, clase, bloqueado: c.situation === 'Bloqueado' }
}

export interface ImpactoCredito {
  /** Crédito que le quedaría al cliente si se confirma la operación, clampado en 0. */
  disponible: number
  /**
   * Lo mismo, SIN clampear: puede dar negativo, y es la señal de exceso que las cards pintan en
   * rojo. Con el crédito que no rige queda el disponible actual, porque la operación no mueve la
   * línea: proyectar una baja que no va a ocurrir es decirle al vendedor que consumió crédito.
   */
  resultante: number
  usadoPct: number
  critico: boolean
  /** El límite rige esta operación. Con `false` los campos de arriba quedan neutros. */
  aplica: boolean
}

/**
 * Proyecta el crédito sumando el importe de la operación en curso: el disponible del board
 * baja y el uso crece a medida que se cargan productos.
 *
 * Si el crédito no rige para esta operación —forma de pago que no es CUENTA CORRIENTE, entrega
 * ANTERIOR (ya consumió al salir el remito) o cliente liberado sin crédito— no se proyecta nada:
 * no hay línea que consumir, así que la operación nunca "usa" ni "excede".
 */
export function impactoCredito(
  cliente: Cliente | null,
  importe: number,
  op: OperacionCredito,
): ImpactoCredito {
  const disponibleActual = cliente?.disponible ?? 0
  if (!aplicaCredito(cliente, op)) {
    return {
      disponible: disponibleActual,
      resultante: disponibleActual,
      usadoPct: 0,
      critico: false,
      aplica: false,
    }
  }
  const limite = cliente?.limit ?? 0
  const usado = (cliente ? cliente.limit - cliente.disponible : 0) + importe
  const usadoPct = limite > 0 ? Math.min((usado / limite) * 100, 100) : 0
  return {
    // El disponible proyectado sale de la fórmula centralizada, ya clampada en 0.
    disponible: creditoDisponibleProyectado(cliente, importe),
    resultante: cliente
      ? creditoResultante(cliente, importe)
      : round2(disponibleActual - importe),
    usadoPct,
    critico: usadoPct >= CREDITO_FOOTER_CRITICO,
    aplica: true,
  }
}

/**
 * La línea de venta viene de una PROFORMA. Sus subelementos son los únicos que traen grabado el
 * descuento por forma de pago de la línea (`descFormaPago`); los de un presupuesto no lo tienen,
 * porque el presupuesto no lo aplica.
 */
const esItemDeProforma = (it: VentaItem): boolean => it.descFormaPago != null

/**
 * Rentabilidad de una línea de la venta CON PRESUPUESTO PREVIO o de la VENTA PROFORMA. Usa el
 * descuento por forma de pago de la operación (`descFormaPago`) cuando la línea no trae el suyo.
 *
 *   · PROFORMA: la proforma es de sólo lectura —ni el precio ni los descuentos se tocan—, así que su
 *     rentabilidad es la que quedó registrada al emitirla, tal cual.
 *   · PRESUPUESTO: el descuento se puede editar en la venta y el pronto pago es el de esta venta,
 *     así que se recalcula con importes (`rentabilidadItemPresupuesto`).
 *
 * Es la ÚNICA fuente de la rentabilidad de estas líneas: la usan la tabla, el resumen y lo que se
 * graba en Monday.
 */
export function rentabilidadVentaItem(it: VentaItem, descFormaPago = 0): number {
  if (esItemDeProforma(it)) return round2(it.rent)
  return rentabilidadItemPresupuesto(it, descuentoCompuesto(it.desc ?? 0, descFormaPago))
}

/** Aporte de una línea de venta a la rentabilidad general: su % y su costo total. */
function aporteVentaItem(it: VentaItem, descFormaPago: number, neto: number): AporteRentabilidad {
  const rentabilidad = rentabilidadVentaItem(it, descFormaPago)
  return { rentabilidad, costo: costoParaPonderar(it.costo, it.aVender, neto, rentabilidad) }
}

export interface ResumenVenta {
  /** Suma de la columna Subtotal de la tabla: cantidad × precio, sin descuentos. */
  subtotal: number
  /** Lo bonificado sobre el bruto: subtotal − total. Es la suma de los importes bonificados de
   *  todas las líneas (la columna "Importe Bonif." llevada a total). Se resta del subtotal. */
  descuento: number
  /** Suma de la columna Total: el neto que se factura tras bonificar (SIN IVA). */
  total: number
  /** IVA total: se calcula sobre el neto de cada línea con su propia alícuota, y se suma al neto
   *  para llegar al importe total con impuestos. */
  iva: number
  /** Comisión total: suma de las comisiones de los productos comisionables (dinámica). */
  comision: number
  rentabilidad: number
  /** Crédito disponible del cliente antes de esta venta. */
  disponible: number
  /** Uso de la cuenta corriente incluyendo esta venta: mismo criterio que PRESUPUESTAR. */
  usadoPct: number
  /** Al rojo, igual que en el footer del presupuesto. */
  critico: boolean
  /** Crédito que queda tras la venta, medido sobre el TOTAL CON IVA (puede ser negativo). */
  resultante: number
  limite: number
}

export function resumenVenta(
  items: VentaItem[],
  cliente: Cliente | null,
  tipoVenta: TipoVenta,
  descFormaPago = 0,
  /** Tasas del tablero de configuración. Sin ellas la comisión da 0, no un número inventado. */
  comisiones: ComisionesVenta = { activa: 0, pasiva: 0 },
  /**
   * Operación en curso, para decidir si el crédito rige. Por defecto NO rige: quien sólo quiere
   * los totales (ver `totalVentaOperacion`) no tiene que fabricar un contexto de crédito, y un
   * llamador que se olvide de pasarlo no dispara bloqueos que nadie decidió.
   */
  credito: OperacionCredito = SIN_CREDITO,
  /** La cadena de la venta tiene actividades linkeadas: decide Activa vs Pasiva (`tasaComision`). */
  conActividades = false,
): ResumenVenta {
  /* El descuento por forma de pago (pronto pago) se compone EN CASCADA con el de cada línea: baja
     el neto y la rentabilidad igual que en la venta DIRECTA. La VENTA sobre PROFORMA trae su propio
     descuento por forma de pago por línea (it.descFormaPago); el resto usa el de la operación. */
  const descFpDe = (it: VentaItem) => it.descFormaPago ?? descFormaPago
  // Cada línea entra ya bonificada, y aporta la rentabilidad que le queda tras el descuento.
  const importeItem = (it: VentaItem) =>
    netoLinea(it.precio, it.aVender, it.desc ?? 0, descFpDe(it))
  // El bruto es el de la columna Subtotal: cantidad × precio, antes de bonificar.
  const subtotal = round2(items.reduce((acc, it) => acc + round2(it.precio * it.aVender), 0))
  const total = round2(items.reduce((acc, it) => acc + importeItem(it), 0))
  /* IVA de cada línea sobre su NETO ya bonificado, con la alícuota propia del producto (21% por
     defecto). El total se suma al neto para el importe con impuestos. */
  const iva = round2(
    items.reduce((acc, it) => acc + ivaLinea(importeItem(it), alicuotaDeclarada(it.iva)), 0),
  )
  /* Rentabilidad general: cada línea aporta la MISMA rentabilidad que muestra la tabla
     (`rentabilidadVentaItem`) y pesa por su costo. */
  const rentabilidad = rentabilidadGeneral(
    items.map((it) => aporteVentaItem(it, descFormaPago, importeItem(it))),
  )

  /* Comisión: SÓLO los productos comisionables, con la tasa ÚNICA que rige la COMBINACIÓN de la
     venta (ver `TASA_POR_COMBINACION`). La base es el neto de la línea: sin IVA y con el descuento
     total ya aplicado. */
  const tasa = tasaComision(comisiones, tipoVenta, conActividades)
  const comision = round2(
    items.reduce(
      (acc, it) => acc + comisionLinea(importeItem(it), it.comisionable === true, tasa),
      0,
    ),
  )

  const limite = cliente?.limit ?? 0
  const disponible = cliente?.disponible ?? 0
  /* Lo que la venta consume de la línea es el TOTAL CON IVA: es el importe que se asienta en la
     cuenta corriente cuando la venta va a cuenta. Medirlo sobre el neto dejaba entrar el IVA por
     encima del límite. */
  const consumeLinea = round2(total + iva)
  const impacto = impactoCredito(cliente, consumeLinea, credito)

  return {
    subtotal,
    descuento: round2(subtotal - total),
    total,
    iva,
    comision,
    // A dos decimales: redondear a entero mostraba 36% donde la venta rinde 36,17%.
    rentabilidad,
    disponible,
    usadoPct: impacto.usadoPct,
    critico: impacto.critico,
    resultante: impacto.resultante,
    limite,
  }
}

/**
 * Topes del descuento por producto, en puntos porcentuales. Son los valores de respaldo:
 * los vigentes se leen del tablero de configuración al iniciar la app.
 */
export const DESCUENTO_MAX_DEFAULT = 5
export const DESCUENTO_MIN_DEFAULT = 1.5

/**
 * Umbrales de la barra de cobertura, sobre el % de stock disponible consumido: hasta la
 * mitad va en verde, de ahí en más en amarillo y, al llegar al total disponible, en rojo.
 */
const COBERTURA_ALERTA = 50
const COBERTURA_CRITICA = 100

export type NivelCobertura = 'ok' | 'alerta' | 'critico'

const COBERTURA_COLOR: Record<NivelCobertura, string> = {
  ok: 'var(--green)',
  alerta: 'var(--yellow)',
  critico: 'var(--red)',
}

export interface Cobertura {
  /** % del stock disponible que consume la cantidad elegida. Puede pasarse de 100. */
  pct: number
  /** El mismo %, acotado a 100: es lo que se pinta en la barra. */
  pctBarra: number
  nivel: NivelCobertura
  color: string
  /** La cantidad elegida supera lo que hay disponible. */
  excede: boolean
}

/** Cómo quedarían las cuatro métricas del tablero de stock si la devolución se registrara. */
export interface StockProyectado {
  ingresos: number
  fisico: number
  comercial: number
  disponible: number
}

/**
 * Proyecta el stock de un producto al que ENTRAN unidades (devolución), replicando las mismas tres
 * fórmulas del tablero "🧮Stock y Movimientos" en vez de inventar unas propias:
 *
 *   Físico     = Ingreso Total − Egreso Total
 *   Comercial  = Físico − Pend de Entrega Vta
 *   Disponible = Comercial + Pend de Recibir Compra
 *
 * La devolución sólo mueve el INGRESO; el resto se arrastra por la cadena. Es una proyección: no
 * pisa ninguno de los valores leídos, que se siguen mostrando como base.
 */
export function stockConIngreso(p: Producto, cantidad: number): StockProyectado {
  const ingresos = round2(p.ingresos + cantidad)
  const fisico = round2(ingresos - p.egresos)
  const comercial = round2(fisico - p.pendEntregaVta)
  return { ingresos, fisico, comercial, disponible: round2(comercial + p.pendRecepcionCompra) }
}

/** Cuánto del stock disponible se lleva la cantidad en curso. No altera el stock. */
export function cobertura(p: Producto, cantidad: number): Cobertura {
  // Sin stock disponible cualquier cantidad ya lo excede: la barra va al tope, no a cero.
  const pct =
    p.disponible > 0 ? (cantidad / p.disponible) * 100 : cantidad > 0 ? COBERTURA_CRITICA : 0
  const nivel: NivelCobertura =
    pct >= COBERTURA_CRITICA ? 'critico' : pct >= COBERTURA_ALERTA ? 'alerta' : 'ok'
  return {
    pct,
    pctBarra: Math.min(pct, 100),
    nivel,
    color: COBERTURA_COLOR[nivel],
    excede: cantidad > p.disponible,
  }
}

/* ===== Remitos pendientes de facturar ===== */

export const facturaItemUid = (remitoId: string, indice: number): string => `${remitoId}-${indice}`

export interface ResumenFactura {
  subtotal: number
  descuento: number
  /** Lo que efectivamente se factura, SIN IVA: el importe gravado. */
  neto: number
  /** IVA total de la factura: suma del IVA de cada producto (sobre su importe a facturar). */
  iva: number
  /** TOTAL a facturar: el gravado más el IVA. Es el importe final del comprobante. */
  total: number
  /** Comisión del vendedor: sólo los productos comisionables, con la tasa del tipo de venta. */
  comision: number
  /** Rentabilidad general de la venta, en %: la de cada línea ponderada por su costo. */
  rentabilidad: number
  disponible: number
  /** Uso de la cuenta corriente incluyendo esta factura: mismo criterio que PRESUPUESTAR. */
  usadoPct: number
  critico: boolean
  resultante: number
  limite: number
}

/**
 * Totales de la entrega ANTERIOR: lo que se factura de los remitos ya emitidos.
 *
 * La mercadería salió sin descuento POR LÍNEA —el remito ya se emitió, la línea no se edita—,
 * pero el descuento por FORMA DE PAGO sí corre: es la forma de pago de esta venta, que el usuario
 * elige en este mismo paso. Se aplica con las fórmulas compartidas de `lib/descuentos`, así que
 * el precio unitario, el subtotal, el IVA y la comisión salen igual que en cualquier otro flujo.
 */
export function resumenFactura(
  items: FacturaItem[],
  cliente: Cliente | null,
  descuento: number,
  /** Tasa de comisión del tipo de venta (0 = sin comisión). Sólo los productos comisionables aportan. */
  comisionTasa = 0,
  /** Descuento por forma de pago (%) de la operación. 0 = sin descuento. */
  descFormaPago = 0,
  /** Operación en curso, para decidir si el crédito rige. Por defecto NO rige (ver `resumenVenta`). */
  credito: OperacionCredito = SIN_CREDITO,
): ResumenFactura {
  /** Neto de la línea, con el descuento por forma de pago ya aplicado y SIN IVA. */
  const netoDe = (it: FacturaItem) => netoLinea(it.precio, it.aFacturar, 0, descFormaPago)

  // Bruto: precio de lista × cantidad a facturar, sin bonificar.
  const subtotal = round2(items.reduce((acc, it) => acc + round2(it.precio * it.aFacturar), 0))
  /* Lo bonificado: el descuento por forma de pago de cada línea más, si viniera, un descuento
     global del remito (hoy los dos llamadores pasan 0). Nunca puede superar al bruto. */
  const bonifFormaPago = round2(
    items.reduce((acc, it) => acc + bonificacionLinea(it.precio, it.aFacturar, 0, descFormaPago), 0),
  )
  const descuentoAplicado =
    subtotal > 0 ? round2(Math.min(descuento + bonifFormaPago, subtotal)) : 0
  const neto = round2(subtotal - descuentoAplicado)
  /* IVA total: el de cada producto sobre su importe YA bonificado, con la alícuota propia del
     producto (21% por defecto si no vino). */
  const iva = round2(
    items.reduce((acc, it) => acc + ivaLinea(netoDe(it), alicuotaDeclarada(it.iva)), 0),
  )
  /* Comisión: MISMA regla que el resto de las ventas —sólo los productos comisionables, con la tasa
     única del tipo de venta, sobre el importe GRAVADO de la línea: Subtotal − Descuento Total (el
     descuento por forma de pago ya aplicado), SIN IVA—. */
  const comision = round2(
    items.reduce(
      (acc, it) => acc + comisionLinea(netoDe(it), it.comisionable === true, comisionTasa),
      0,
    ),
  )
  /* Rentabilidad general: cada línea aporta la que le queda DESPUÉS del descuento por forma de pago
     (`rentabilidadItemRemito`) y pesa por su costo, igual que en el presupuesto y en la venta. */
  const rentabilidad = rentabilidadGeneral(
    items.map((it) => {
      const rent = rentabilidadItemRemito(it, descFormaPago)
      return { rentabilidad: rent, costo: costoParaPonderar(it.costo, it.aFacturar, netoDe(it), rent) }
    }),
  )

  const limite = cliente?.limit ?? 0
  const disponible = cliente?.disponible ?? 0
  /* Igual que en la venta armada desde el catálogo: lo que consume la línea es el TOTAL CON IVA,
     que es lo que se asienta en la cuenta corriente. */
  const total = round2(neto + iva)
  const impacto = impactoCredito(cliente, total, credito)

  return {
    subtotal,
    descuento: descuentoAplicado,
    neto,
    iva,
    total,
    comision,
    // A dos decimales, como el resto de las rentabilidades generales.
    rentabilidad,
    disponible,
    usadoPct: impacto.usadoPct,
    critico: impacto.critico,
    /* Del impacto, no de `disponible - neto`: aquél ignoraba los remitos pendientes de facturar y
       medía sin IVA, así que decía otra cosa que el bloqueo de la misma pantalla. Y con el crédito
       que no rige —la entrega ANTERIOR es justamente ese caso— no proyecta ninguna baja. */
    resultante: impacto.resultante,
    limite,
  }
}

/** Lo que hace falta para saber cuánto vale la venta, sea cual sea el flujo que la armó. */
export interface DatosTotalVenta {
  cliente: Cliente | null
  operacion: Operacion | null
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  /** Venta DIRECTA armada desde el catálogo. */
  lineas: LineaPresupuesto[]
  /** CON PRESUPUESTO PREVIO y VENTA PROFORMA. */
  ventaItems: VentaItem[]
  /** Entrega ANTERIOR: se factura lo remitido. */
  facturaItems: FacturaItem[]
  /** VENTA PROFORMA: el TOTAL de la proforma elegida, que manda sobre cualquier recálculo. */
  proformaImporte: number | null
  /** Descuento por forma de pago (pronto pago), en puntos porcentuales. */
  descFormaPago: number
}

/**
 * NETO y TOTAL de la venta: el importe FINAL, con el descuento por forma de pago ya aplicado. Es
 * el precio real que se le cobra al cliente, y la única fuente de la métrica "TOTAL VENTA" del
 * cobro, del importe que se adeuda y del total que viaja al recibo.
 *
 * OJO con no confundirlo con el total FACTURADO (`totalesComprobantes`): los comprobantes no llevan
 * el descuento por forma de pago en sus líneas, así que ese número es más alto. Lo que se cobra
 * —y lo que tiene que cerrar la diferencia del recibo— es este.
 *
 * Cada flujo lo calcula distinto, con las mismas fórmulas que su propio resumen:
 *   · entrega ANTERIOR  → lo remitido, con el descuento por forma de pago de esta venta
 *   · VENTA PROFORMA    → EXACTAMENTE el total de la proforma, que ya lo trae aplicado
 *   · CON PRESUPUESTO   → resumen de la venta con el descuento
 *   · DIRECTA           → resumen del catálogo con el descuento
 */
export function totalVentaOperacion(d: DatosTotalVenta): { neto: number; total: number } {
  /* La entrega ANTERIOR manda sobre el tipo de venta: se factura lo remitido. El remito ya salió,
     así que no hay descuento por línea, pero sí el de la forma de pago que se elige en ese paso. */
  if (esFlujoRemito(d.tipoEntrega)) {
    /* El IVA sale del mismo resumen que muestra el paso —con la alícuota propia de cada producto,
       no con una tasa única—, así "TOTAL A FACTURAR" y "TOTAL VENTA" no pueden divergir. */
    const r = resumenFactura(d.facturaItems, d.cliente, 0, 0, d.descFormaPago)
    return { neto: r.neto, total: r.total }
  }
  /* VENTA PROFORMA: el total es EXACTAMENTE el de la proforma elegida (numeric_mm5sw8n2), no un
     recálculo. La proforma ya trae aplicado su descuento por forma de pago; recalcular con el de
     la operación (0, porque este flujo no tiene paso de forma de pago) lo inflaba. El neto —base
     del crédito— es la suma de los totales de línea guardados en la proforma (SIN IVA). */
  if (d.operacion === 'VENTA PROFORMA' && d.proformaImporte != null) {
    const neto = round2(d.ventaItems.reduce((acc, it) => acc + (it.totalLinea ?? 0), 0))
    return { neto, total: d.proformaImporte }
  }
  // CON PRESUPUESTO PREVIO (y VENTA PROFORMA sin importe cargado) arman la venta en `ventaItems`.
  if (d.tipoVenta === 'CON PRESUPUESTO PREVIO' || d.operacion === 'VENTA PROFORMA') {
    const r = resumenVenta(
      d.ventaItems,
      d.cliente,
      d.tipoVenta ?? 'CON PRESUPUESTO PREVIO',
      d.descFormaPago,
    )
    return { neto: r.total, total: round2(r.total + r.iva) }
  }
  // Venta DIRECTA armada desde el catálogo: mismo cálculo que el ResumenBox de la venta.
  const r = resumenPresupuesto(d.lineas, true, d.descFormaPago)
  return { neto: r.neto, total: r.total }
}

/** Estado de avance de una línea de presupuesto ya emitido. */
export type AvanceLinea = 'completo' | 'parcial' | 'pendiente'

export function avanceLinea(vend: number, pend: number): AvanceLinea {
  if (pend === 0) return 'completo'
  return vend > 0 ? 'parcial' : 'pendiente'
}

export const AVANCE_COLOR: Record<AvanceLinea, string> = {
  completo: 'var(--green)',
  parcial: 'var(--orange)',
  pendiente: 'var(--red)',
}

export const AVANCE_LABEL: Record<AvanceLinea, string> = {
  completo: 'Vendido completo',
  parcial: 'Vendido parcialmente',
  pendiente: 'Pendiente',
}

/** Mismo avance, leído en clave de facturación. */
export const AVANCE_LABEL_FACTURA: Record<AvanceLinea, string> = {
  completo: 'Facturado completo',
  parcial: 'Facturado parcialmente',
  pendiente: 'Sin facturar',
}

/** Mismo avance, leído en clave de entrega (remito de emisión ANTERIOR). */
export const AVANCE_LABEL_ENTREGA: Record<AvanceLinea, string> = {
  completo: 'Entregado completo',
  parcial: 'Entregado parcial',
  pendiente: 'Sin entregar',
}

/**
 * Unidades que le QUEDARÍAN pendientes de entregar a la línea si se remita esta cantidad:
 * pendiente original − cantidad a entregar. Se recalcula en vivo con cada cambio de cantidad.
 */
export const pendienteResultante = (pendiente: number, aEntregar: number): number =>
  round2(pendiente - aEntregar)

export const ESTADO_RESULTANTE_COMPLETO = '100% Entregada'
export const ESTADO_RESULTANTE_PARCIAL = 'Parcialmente Entregada'

/**
 * Cómo queda la línea de la venta tras este remito, leído del pendiente resultante:
 * en 0 se entregó todo, y con saldo a favor queda entregada parcialmente.
 *
 * Un resultante NEGATIVO no es un estado: significa que se cargó más de lo pendiente, y eso la
 * fila ya lo marca como error en la cantidad. Devuelve null para no rotular un dato inválido.
 */
export const estadoResultante = (resultante: number): string | null => {
  if (resultante === 0) return ESTADO_RESULTANTE_COMPLETO
  return resultante > 0 ? ESTADO_RESULTANTE_PARCIAL : null
}

/** Identidad de una línea del presupuesto llevada a la venta. */
export const ventaItemUid = (presupuestoId: string, indice: number): string =>
  `${presupuestoId}-${indice}`

/**
 * La inversa de `ventaItemUid`: de qué documento salió la línea (el id antes del último guión).
 *
 * Sirve para la venta CON PRESUPUESTO PREVIO: de acá sale qué presupuestos aportaron algún
 * producto, para heredar SUS actividades (ver `getActividadesDePresupuestos`). En la VENTA
 * PROFORMA el prefijo es el id de la PROFORMA, no el de un presupuesto —ahí no se usa este
 * helper: la proforma ya trae sus actividades heredadas en su propia columna.
 */
export const documentoDeVentaItem = (uid: string): string => uid.slice(0, uid.lastIndexOf('-'))

/** Identidad de una línea de una venta llevada al remito (emisión ANTERIOR). */
export const remitoItemUid = (ventaId: string, indice: number): string => `${ventaId}-${indice}`
