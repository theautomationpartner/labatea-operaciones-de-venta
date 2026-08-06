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
 */
export function fragmentoSubitem(linea: LineaPresupuesto, indice: number): FragmentoSubitem {
  const p = linea.producto
  const alias = `s${indice}`
  const precio = round2(p.precio)
  // Importe bonificado por unidad: lo que se descuenta (precio × desc%/100), en la moneda del producto.
  const importeBonif = round2(p.precio * (linea.descuento / 100))
  // Precio bonificado por unidad: precio − importe bonif. (= precio × (1 − desc%/100)). En la moneda
  // del producto: para los dolarizados es el precio final en dólares. Sin descuento, = precio unit.
  const precioBonif = round2(p.precio * (1 - linea.descuento / 100))
  // Total de la línea, ya bonificado: (precio − bonif) × cantidad, en la moneda del producto.
  const total = round2(p.precio * (1 - linea.descuento / 100) * linea.cantidad)
  const usd = esDolar(p.moneda)
  // ¿Se aplicó algún descuento (importe bonificado)? De ello depende qué se escribe en "Importe Bonif".
  const tieneDescuento = importeBonif > 0
  const columnas: Record<string, unknown> = {
    [COL.presupuestoSub.cantidad]: String(linea.cantidad),
    // Rentabilidad del producto CON DECIMALES (no se redondea a entero).
    [COL.presupuestoSub.rentabilidad]: String(round2(p.rentabilidad)),
    [COL.presupuestoSub.descuento]: String(linea.descuento),
    /* "Desc $ x Prod" (numeric_mm5x3wee): monto del descuento por producto por unidad, en la moneda
       del producto. Es el importe bonificado "puro": SIN descuento vale 0 (a diferencia de "Importe
       Bonif.", que sin descuento guarda el precio). El presupuesto no tiene descuento por forma de pago. */
    [COL.presupuestoSub.descProdMonto]: String(importeBonif),
    /* "Importe Bonif." (numeric_mm5rddvm): CON descuento, el monto bonificado; SIN descuento, el
       precio unitario ORIGINAL (sin bonificar), por regla de negocio del board. */
    [COL.presupuestoSub.importeBonif]: String(tieneDescuento ? importeBonif : precio),
    // Precio Bonif: precio unitario ya bonificado, en la moneda del producto.
    [COL.presupuestoSub.precioBonif]: String(precioBonif),
    // Precio y total se registran en la columna de la moneda del producto ($ pesos / $u dólares).
    [usd ? COL.presupuestoSub.precioUnitUsd : COL.presupuestoSub.precioUnit]: String(precio),
    [usd ? COL.presupuestoSub.totalUsd : COL.presupuestoSub.totalPesos]: String(total),
    // Producto recién presupuestado: todavía no se vendió nada, "0% Vendido" (por índice).
    [COL.presupuestoSub.estadoUso]: { index: PRESUP_SUB_ESTADO_USO_INDEX.sinVender },
  }
  /* Sin descuento: el "Precio Unit $" (numeric_mkw85hdw) también lleva el precio unitario original,
     además de la columna de la moneda del producto. */
  if (!tieneDescuento) columnas[COL.presupuestoSub.precioUnit] = String(precio)
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
