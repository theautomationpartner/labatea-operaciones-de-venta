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
 * Fragmento de una línea. El subtotal es fórmula en el board: se calcula solo, no se manda.
 * El producto se linkea sólo si trae id de Monday (en modo local no hay ids reales).
 */
export function fragmentoSubitem(linea: LineaPresupuesto, indice: number): FragmentoSubitem {
  const p = linea.producto
  const alias = `s${indice}`
  const columnas: Record<string, unknown> = {
    [COL.presupuestoSub.cantidad]: String(linea.cantidad),
    [COL.presupuestoSub.rentabilidad]: String(Math.round(p.rentabilidad)),
    // El precio va con sus dos decimales: es el mismo con el que se calculó el subtotal.
    [COL.presupuestoSub.precioUnit]: String(round2(p.precio)),
    [COL.presupuestoSub.descuento]: String(linea.descuento),
    // P. Unit con Desc = precio unitario con el descuento ya aplicado (numeric_mm5rddvm).
    [COL.presupuestoSub.precioConDesc]: String(round2(p.precio * (1 - linea.descuento / 100))),
    // Producto recién presupuestado: todavía no se vendió nada, "0% Vendido" (por índice).
    [COL.presupuestoSub.estadoUso]: { index: PRESUP_SUB_ESTADO_USO_INDEX.sinVender },
  }
  if (p.id) columnas[COL.presupuestoSub.producto] = { item_ids: [Number(p.id)] }
  // Se arrastra el ítem de stock del maestro para que viaje del presupuesto a la venta.
  if (p.stockId) columnas[COL.presupuestoSub.stock] = { item_ids: [Number(p.stockId)] }

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
