/**
 * Cotización del dólar, del tablero "Cotizaciones" (18422367325). Se usa para convertir a pesos el
 * precio de los productos que están en dólares antes de cargarlos.
 */
import { hoyIso } from '@/lib/dates'
import { BOARDS, COL } from './columns'
import { byId, numCol, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Cotización de respaldo en modo local (sin token), para que el prototipo siga corriendo. */
const COTIZACION_MOCK = 1000

/**
 * Tasa de cambio del dólar de HOY: el ítem del board de Cotizaciones cuya columna de fecha
 * (date_mm5qc046) coincide exactamente con la fecha del día. Se lee `numeric_mm5at943`. Se pide
 * al iniciar la app y se guarda en el estado global para usarla en toda la operación.
 *
 * Devuelve `null` si no hay cotización cargada para hoy (la interfaz lo refleja); en modo local
 * (sin token) devuelve la de respaldo para no bloquear el prototipo.
 */
export async function getTasaCambioHoy(): Promise<number | null> {
  if (!mondayHabilitado()) return COTIZACION_MOCK
  const hoy = hoyIso()
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.cotizaciones}]) {
        items_page(
          limit: 100,
          query_params: { order_by: [{ column_id: "__creation_log__", direction: desc }] }
        ) {
          items { id column_values(ids: ["${COL.cotizacion.fecha}","${COL.cotizacion.dolar}"]) { id text } }
        }
      }
    }`,
  )
  // La columna date devuelve el texto en yyyy-MM-dd: se compara con la fecha de hoy en ese formato.
  for (const item of data.boards[0]?.items_page?.items ?? []) {
    const c = byId(item)
    if ((c[COL.cotizacion.fecha]?.text ?? '').trim() === hoy) {
      const tasa = numCol(c[COL.cotizacion.dolar])
      return tasa > 0 ? tasa : null
    }
  }
  return null
}

/**
 * Cotización del dólar del momento: el ÚLTIMO ítem creado del board. Se pide con `items_page(limit: 1)`
 * ordenado de forma descendente por fecha de creación (`__creation_log__`), para no bajar el board
 * entero, y se lee `numeric_mm5at943`. Devuelve la de respaldo si no hay dato o viene 0.
 */
export async function getCotizacionDolar(): Promise<number> {
  if (!mondayHabilitado()) return COTIZACION_MOCK
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.cotizaciones}]) {
        items_page(
          limit: 1,
          query_params: { order_by: [{ column_id: "__creation_log__", direction: desc }] }
        ) {
          items { id column_values(ids: ["${COL.cotizacion.dolar}"]) { id text } }
        }
      }
    }`,
  )
  const item = data.boards[0]?.items_page?.items?.[0]
  const cotizacion = item ? numCol(byId(item)[COL.cotizacion.dolar]) : 0
  return cotizacion > 0 ? cotizacion : COTIZACION_MOCK
}
