/**
 * Carrito de subelementos del presupuesto.
 *
 * Cada producto que entra a la lista trae consigo el fragmento de mutation que lo va a crear
 * como subitem; si se lo quita, su fragmento se va con él. Al confirmar, todos los fragmentos
 * se ensamblan con alias GraphQL (`s0:`, `s1:`, …) en UNA sola solicitud, en lugar de una
 * llamada por producto.
 *
 * La lista de líneas es la fuente de verdad del carrito: los fragmentos se derivan de ella,
 * así no pueden quedar desincronizados con lo que ve el usuario.
 */
import { descuentoUnitario } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import type { LineaPresupuesto } from '@/types'
import { COL, PRESUP_SUB_ESTADO_USO_INDEX } from './columns'

/** Porción de la mutation bulk que le corresponde a una línea del carrito. */
export interface FragmentoSubitem {
  /** Alias con el que vuelve su resultado en la respuesta (`s0`, `s1`, …). */
  alias: string
  /** Declaraciones de variables propias ("$n0: String!, $cv0: JSON!"). */
  declaraciones: string[]
  /** El campo `create_subitem` con sus alias y variables. */
  campo: string
  variables: Record<string, unknown>
}

/**
 * Fragmento de una línea. Los importes se escriben en la moneda del producto (presupuesto
 * bimonetario): un producto en dólares llena las columnas `$u` (Precio Unit $u, TOTAL $u) y uno en
 * pesos, las columnas `$` (Precio Unit $, TOTAL $). El Importe Bonif. y el resto de las columnas son
 * comunes. El producto se linkea sólo si trae id de Monday (en modo local no hay ids reales).
 *
 * El presupuesto tiene UN solo descuento: el manual que el vendedor carga por línea. No aplica el
 * de forma de pago —su check sólo pide la leyenda en el PDF—, así que no hay ninguna cascada que
 * componer y el "Descuento TOTAL" es ese monto por unidad, en pesos:
 *
 *   Precio Unit − Descuento TOTAL   = Precio Unit C/Desc Total
 *   Precio Unit C/Desc Total × Cant = Subtotal
 *
 * Sin descuentos, el "Descuento TOTAL" vale 0 —no el precio unitario— y el precio con descuento
 * total coincide con el de lista.
 */
export function fragmentoSubitem(
  linea: LineaPresupuesto,
  indice: number,
): FragmentoSubitem {
  const p = linea.producto
  const alias = `s${indice}`
  const precio = round2(p.precio)
  /* Descuento de la línea por unidad: el MANUAL del vendedor sobre el precio de lista, en la
     moneda del producto. El presupuesto no aplica descuento por forma de pago —su check sólo pide
     la leyenda en el PDF—, así que no hay cascada que componer. */
  const dto = descuentoUnitario(p.precio, linea.descuento)
  // Total de la línea, ya bonificado: precio final × cantidad, en la moneda del producto.
  const total = round2(dto.precioFinal * linea.cantidad)
  const usd = esDolar(p.moneda)
  // ¿La línea lleva descuento?
  const tieneDescuento = dto.total > 0
  const columnas: Record<string, unknown> = {
    [COL.presupuestoSub.cantidad]: String(linea.cantidad),
    // Rentabilidad del producto CON DECIMALES (no se redondea a entero).
    [COL.presupuestoSub.rentabilidad]: String(round2(p.rentabilidad)),
    [COL.presupuestoSub.descuento]: String(linea.descuento),
    /* "Desc $ x Prod" (numeric_mm5x3wee): monto del descuento por unidad, en la moneda del
       producto. */
    [COL.presupuestoSub.descProdMonto]: String(dto.manual),
    /* "Descuento TOTAL" (numeric_mm5w6h1x): el descuento por unidad EN PESOS. Sin descuento va en
       0 —NO el precio unitario—, que es lo que la columna significa.
       Las columnas "Desc % x Forma de Pago" (numeric_mm6e2zs9) y "Desc $ x Forma de Pago"
       (numeric_mm6ehr78) NO se escriben: el presupuesto no aplica ese descuento. */
    [COL.presupuestoSub.descTotal]: String(dto.total),
    // "Precio Unit C/Desc Total" (numeric_mm5rddvm): precio de lista − Descuento TOTAL.
    [COL.presupuestoSub.precioConDescTotal]: String(dto.precioFinal),
    // Precio y total se registran en la columna de la moneda del producto ($ pesos / $u dólares).
    [usd ? COL.presupuestoSub.precioUnitUsd : COL.presupuestoSub.precioUnit]: String(precio),
    [usd ? COL.presupuestoSub.totalUsd : COL.presupuestoSub.totalPesos]: String(total),
    // Producto recién presupuestado: todavía no se vendió nada, "0% Vendido" (por índice).
    [COL.presupuestoSub.estadoUso]: { index: PRESUP_SUB_ESTADO_USO_INDEX.sinVender },
  }
  /* Sin descuento: el "Precio Unit $" (numeric_mkw85hdw) también lleva el precio unitario original,
     además de la columna de la moneda del producto. */
  if (!tieneDescuento) columnas[COL.presupuestoSub.precioUnit] = String(precio)
  /* Rentabilidad forzada: cuando está aplicada, la línea trae la "Nota de Crédito x Comisión" (Costo
     Original − Nuevo Precio de Costo) y su costo pasa a ser el NUEVO (= Costo Original − ese monto);
     sin forzar, el costo es el original del maestro. El costo va a la columna de su moneda. */
  const montoNC = linea.montoDifNotaDeCreditoComision
  const forzada = montoNC != null
  const costoEfectivo =
    forzada && p.precioCosto != null ? round2(p.precioCosto - montoNC) : p.precioCosto
  if (costoEfectivo != null) {
    columnas[usd ? COL.presupuestoSub.costoUsd : COL.presupuestoSub.costoPesos] =
      String(round2(costoEfectivo))
  }
  if (montoNC != null) {
    columnas[COL.presupuestoSub.notaCreditoComision] = String(round2(montoNC))
  }
  if (p.id) columnas[COL.presupuestoSub.producto] = { item_ids: [Number(p.id)] }
  // Se arrastra el ítem de stock del maestro para que viaje del presupuesto a la venta.
  if (p.stockId) columnas[COL.presupuestoSub.stock] = { item_ids: [Number(p.stockId)] }
  // Alícuota de IVA del producto (del Maestro): se guarda en el subelemento aunque el presupuesto
  // no la liquide, para tenerla disponible al llevar la línea a la venta.
  if (p.iva != null) columnas[COL.presupuestoSub.iva] = String(p.iva)

  return {
    alias,
    declaraciones: [`$n${indice}: String!`, `$cv${indice}: JSON!`],
    campo: `${alias}: create_subitem(parent_item_id: $parentId, item_name: $n${indice}, column_values: $cv${indice}) {
      id
      column_values(ids: ["${COL.presupuestoSub.pulseId}"]) { text }
    }`,
    variables: { [`n${indice}`]: p.nombre, [`cv${indice}`]: JSON.stringify(columnas) },
  }
}

export interface SolicitudBulk {
  query: string
  variables: Record<string, unknown>
  /** Alias incluidos, en orden: sirven para leer la respuesta. */
  alias: string[]
}

/**
 * Ensambla los fragmentos del carrito en una única mutation. Devuelve `null` si no hay líneas.
 * `desde` desplaza los índices para que los alias sigan siendo únicos entre tandas.
 */
export function construirBulkSubitems(
  lineas: LineaPresupuesto[],
  desde = 0,
): SolicitudBulk | null {
  if (lineas.length === 0) return null
  const fragmentos = lineas.map((l, i) => fragmentoSubitem(l, desde + i))
  const declaraciones = ['$parentId: ID!', ...fragmentos.flatMap((f) => f.declaraciones)]
  const variables = Object.assign({}, ...fragmentos.map((f) => f.variables)) as Record<
    string,
    unknown
  >

  return {
    query: `mutation (${declaraciones.join(', ')}) {\n  ${fragmentos.map((f) => f.campo).join('\n  ')}\n}`,
    variables,
    alias: fragmentos.map((f) => f.alias),
  }
}
