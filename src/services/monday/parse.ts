/**
 * Lectura de los `column_values` que devuelve la API de Monday. Las mismas reglas valen para
 * todos los tableros, así que viven acá y no en la capa de servicio de cada etapa.
 */

export interface CV {
  id: string
  text: string | null
  /** Las columnas fórmula devuelven su valor calculado acá, no en `text`. */
  display_value?: string | null
  /** Índice de la etiqueta en una columna status. Es más estable que su texto. */
  index?: number | null
  /* `parent_item` sólo viene cuando la consulta lo pide: es el ítem padre de un SUBELEMENTO
     conectado (p. ej., del subelemento de venta al que apunta un pendiente de entrega se llega
     así a la venta). Por eso `column_values` también es opcional acá. */
  linked_items?: {
    id: string
    name: string
    column_values?: CV[]
    parent_item?: { id: string; name: string } | null
  }[]
  /** Sólo los IDs de los ítems conectados, cuando no hace falta traerlos enteros. */
  linked_item_ids?: string[]
}

export interface MondayItem {
  id: string
  name: string
  column_values: CV[]
}

/* `column_values` es opcional porque un ítem CONECTADO puede haberse pedido sin columnas (sólo
   `id`/`name`/`parent_item`). En ese caso el mapa sale vacío, que es exactamente lo que
   corresponde: no se pidió ninguna columna, así que no hay ninguna que leer. */
export const byId = (item: { column_values?: CV[] }): Record<string, CV> =>
  Object.fromEntries((item.column_values ?? []).map((c) => [c.id, c]))

/** Valor de una columna: usa display_value (fórmulas) o text (numéricas/comunes). */
export const valor = (cv?: CV): string => cv?.display_value ?? cv?.text ?? ''

/** Número a partir del texto de Monday (que puede venir formateado). */
export const num = (t?: string | null): number => {
  const n = Number(String(t ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Número de una columna, tomando display_value o text según corresponda. */
export const numCol = (cv?: CV): number => num(valor(cv))

/**
 * Suma los valores de una columna mirror que refleja VARIOS ítems: su `display_value` viene
 * como lista separada por comas ("977, 3161621"). Hay que sumarlos, no pasarlos por `num()`
 * de una: éste borra las comas y los concatena en un número gigante (977 + 3161621 → 9773161621).
 */
export const sumaMirror = (cv?: CV): number =>
  String(cv?.display_value ?? cv?.text ?? '')
    .split(',')
    .reduce((acc, parte) => acc + num(parte), 0)
