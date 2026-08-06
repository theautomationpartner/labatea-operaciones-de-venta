/**
 * Reglas de negocio puras (sin React, sin DOM): totales, crédito y cobertura.
 * Aisladas acá para que la capa de servicio sólo tenga que aportar los datos.
 */
import { aplicaCredito, creditoDisponibleProyectado, creditoResultante } from '@/lib/credito'
import { bonificacionLinea, descuentoCompuesto, ivaLinea, netoLinea } from '@/lib/descuentos'
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
 * Tasa de comisión que rige la operación, según su tipo de venta: la "Activa" para la venta CON
 * PRESUPUESTO PREVIO y la "Pasiva" para la DIRECTA. Es una sola para toda la venta; el producto
 * sólo decide si comisiona o no.
 */
export const tasaComision = (comisiones: ComisionesVenta, tipoVenta: TipoVenta): number =>
  tipoVenta === 'CON PRESUPUESTO PREVIO' ? comisiones.activa : comisiones.pasiva

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

/**
 * Rentabilidad que queda tras bonificar. El margen de lista se mide sobre el precio de lista;
 * al bajar el precio, el costo pesa más y el margen cae:
 *
 *   costo = precio × (1 − rent/100)   ·   precio bonificado = precio × (1 − desc/100)
 *   rent efectiva = 1 − costo / precio bonificado
 *
 * Un producto regalado (100%) se lleva el costo entero: −100%.
 */
export function rentabilidadEfectiva(rentabilidadLista: number, descuento: number): number {
  if (!descuento) return rentabilidadLista
  if (descuento >= 100) return -100
  const costo = 1 - rentabilidadLista / 100
  return (1 - costo / (1 - descuento / 100)) * 100
}

/** La rentabilidad de la línea, ya con su descuento aplicado. */
export const rentabilidadLinea = (l: LineaPresupuesto): number =>
  rentabilidadEfectiva(l.producto.rentabilidad, l.descuento)

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
  /** IVA sobre el neto. En el presupuesto siempre es 0: el presupuesto no lo liquida. */
  iva: number
  /** Importe final del documento: neto + IVA. */
  total: number
  /** Rentabilidad ponderada por importe de cada línea. */
  rentabilidad: number
}

/**
 * Totales de una lista de productos, con los mismos números que muestra la tabla: el subtotal
 * es la suma de la columna Subtotal (bruto) y el neto, la de la columna Total (bonificado).
 *
 * `conIva` distingue los dos usos: la VENTA liquida el 21% sobre el neto, y el PRESUPUESTO no
 * lo liquida en absoluto —sus precios son los de lista, sin la alícuota del producto—.
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
  const rentCon = (l: LineaPresupuesto) =>
    rentabilidadEfectiva(l.producto.rentabilidad, descuentoCompuesto(l.descuento, descFormaPago))
  // Los dos suman líneas ya redondeadas: es lo mismo que se ve producto por producto.
  const subtotal = round2(lineas.reduce((acc, l) => acc + subtotalLinea(l), 0))
  const neto = round2(lineas.reduce((acc, l) => acc + totalCon(l), 0))
  /* Cada línea pesa por su importe ya bonificado, y aporta su rentabilidad efectiva. Se redondea a
     DOS DECIMALES, no a entero: una rentabilidad general de 36,17% es un valor real y perderlo
     redondeando la deja diciendo 36%. */
  const rentabilidad =
    neto > 0
      ? round2(lineas.reduce((acc, l) => acc + rentCon(l) * (totalCon(l) / neto), 0))
      : 0
  const iva = conIva ? round2(neto * IVA_RATE) : 0
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
  /** Rentabilidad ponderada por el importe de cada línea en pesos-equivalente. */
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
 * lo que se resta del crédito disponible del cliente. La rentabilidad se pondera por el importe de
 * cada línea en pesos-equivalente para que el indicador tenga una sola escala.
 */
export function resumenPresupuestoBimoneda(
  lineas: LineaPresupuesto[],
  tasa: number,
): ResumenBimoneda {
  const t = tasa > 0 ? tasa : 0
  const arsLineas = lineas.filter((l) => !esDolar(l.producto.moneda))
  const usdLineas = lineas.filter((l) => esDolar(l.producto.moneda))
  const ars = resumenPresupuesto(arsLineas, false)
  const usd = resumenPresupuesto(usdLineas, false)
  // Cada línea pesa por su importe en pesos: las de dólares, convertidas con la tasa del día.
  const pesoLinea = (l: LineaPresupuesto) =>
    esDolar(l.producto.moneda) ? totalLinea(l) * t : totalLinea(l)
  const base = lineas.reduce((acc, l) => acc + pesoLinea(l), 0)
  // A dos decimales, igual que el resto: la rentabilidad general no es un entero.
  const rentabilidad =
    base > 0
      ? round2(lineas.reduce((acc, l) => acc + rentabilidadLinea(l) * (pesoLinea(l) / base), 0))
      : 0
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
): number {
  const tasa = tasaComision(comisiones, tipoVenta)
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
  /** Crédito que le quedaría al cliente si se confirma la operación. */
  disponible: number
  usadoPct: number
  critico: boolean
  /** El límite rige esta operación. Con `false` los tres campos de arriba quedan neutros. */
  aplica: boolean
}

/**
 * Proyecta el crédito sumando el importe de la operación en curso: el disponible del board
 * baja y el uso crece a medida que se cargan productos.
 *
 * Si el crédito no rige (contado, o cliente liberado sin crédito) no se proyecta nada: no
 * hay línea que consumir, así que la operación nunca "usa" ni "excede".
 */
export function impactoCredito(cliente: Cliente | null, importe: number): ImpactoCredito {
  if (!aplicaCredito(cliente)) {
    return { disponible: cliente?.disponible ?? 0, usadoPct: 0, critico: false, aplica: false }
  }
  const limite = cliente?.limit ?? 0
  const usado = (cliente ? cliente.limit - cliente.disponible : 0) + importe
  const usadoPct = limite > 0 ? Math.min((usado / limite) * 100, 100) : 0
  return {
    // El disponible proyectado sale de la fórmula centralizada, ya clampada en 0.
    disponible: creditoDisponibleProyectado(cliente, importe),
    usadoPct,
    critico: usadoPct >= CREDITO_FOOTER_CRITICO,
    aplica: true,
  }
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
  /** Crédito que queda tras la venta (puede ser negativo). */
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
): ResumenVenta {
  /* El descuento por forma de pago (pronto pago) se compone EN CASCADA con el de cada línea: baja
     el neto y la rentabilidad igual que en la venta DIRECTA. La VENTA sobre PROFORMA trae su propio
     descuento por forma de pago por línea (it.descFormaPago); el resto usa el de la operación. */
  const descFpDe = (it: VentaItem) => it.descFormaPago ?? descFormaPago
  const descTotal = (it: VentaItem) => descuentoCompuesto(it.desc ?? 0, descFpDe(it))
  // Cada línea entra ya bonificada, y aporta la rentabilidad que le queda tras el descuento.
  const importeItem = (it: VentaItem) =>
    netoLinea(it.precio, it.aVender, it.desc ?? 0, descFpDe(it))
  // El bruto es el de la columna Subtotal: cantidad × precio, antes de bonificar.
  const subtotal = round2(items.reduce((acc, it) => acc + round2(it.precio * it.aVender), 0))
  const total = round2(items.reduce((acc, it) => acc + importeItem(it), 0))
  /* IVA de cada línea sobre su NETO ya bonificado, con la alícuota propia del producto (21% por
     defecto). El total se suma al neto para el importe con impuestos. */
  const iva = round2(items.reduce((acc, it) => acc + ivaLinea(importeItem(it), it.iva ?? 21), 0))
  const rentPonderada = items.reduce(
    (acc, it) => acc + rentabilidadEfectiva(it.rent, descTotal(it)) * importeItem(it),
    0,
  )

  /* Comisión: SÓLO los productos comisionables, con la tasa ÚNICA que rige el tipo de venta
     (Activa = CON PRESUPUESTO PREVIO, Pasiva = DIRECTA). La base es el neto de la línea: sin IVA
     y con el descuento total ya aplicado. */
  const tasa = tasaComision(comisiones, tipoVenta)
  const comision = round2(
    items.reduce(
      (acc, it) => acc + comisionLinea(importeItem(it), it.comisionable === true, tasa),
      0,
    ),
  )

  const limite = cliente?.limit ?? 0
  const disponible = cliente?.disponible ?? 0
  const impacto = impactoCredito(cliente, total)

  return {
    subtotal,
    descuento: round2(subtotal - total),
    total,
    iva,
    comision,
    // A dos decimales: redondear a entero mostraba 36% donde la venta rinde 36,17%.
    rentabilidad: total > 0 ? round2(rentPonderada / total) : 0,
    disponible,
    usadoPct: impacto.usadoPct,
    critico: impacto.critico,
    resultante: cliente ? creditoResultante(cliente, total) : round2(disponible - total),
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
  /** Rentabilidad general de la venta, en %: ponderada por el importe de cada línea. */
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
  const iva = round2(items.reduce((acc, it) => acc + ivaLinea(netoDe(it), it.iva ?? 21), 0))
  /* Comisión: MISMA regla que el resto de las ventas —sólo los productos comisionables, con la tasa
     única del tipo de venta, sobre el importe GRAVADO de la línea: Subtotal − Descuento Total (el
     descuento por forma de pago ya aplicado), SIN IVA—. */
  const comision = round2(
    items.reduce(
      (acc, it) => acc + comisionLinea(netoDe(it), it.comisionable === true, comisionTasa),
      0,
    ),
  )
  /* Rentabilidad general: cada línea aporta la que le queda DESPUÉS de bonificar y pesa por su
     importe ya bonificado, igual que en el presupuesto y en la venta. */
  const rentPonderada = items.reduce(
    (acc, it) => acc + rentabilidadEfectiva(it.rent, descuentoCompuesto(0, descFormaPago)) * netoDe(it),
    0,
  )

  const limite = cliente?.limit ?? 0
  const disponible = cliente?.disponible ?? 0
  const impacto = impactoCredito(cliente, neto)

  return {
    subtotal,
    descuento: descuentoAplicado,
    neto,
    iva,
    total: round2(neto + iva),
    comision,
    // A dos decimales, como el resto de las rentabilidades generales.
    rentabilidad: neto > 0 ? round2(rentPonderada / neto) : 0,
    disponible,
    usadoPct: impacto.usadoPct,
    critico: impacto.critico,
    resultante: disponible - neto,
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

/** Identidad de una línea de una venta llevada al remito (emisión ANTERIOR). */
export const remitoItemUid = (ventaId: string, indice: number): string => `${ventaId}-${indice}`
