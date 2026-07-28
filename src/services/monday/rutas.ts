/**
 * Rutas de entrega ("🛣️Rutas de Transporte", 18421708745).
 *
 * Se listan en el Cierre de Venta para asignar la ruta cuando entrega La Batea. La consulta se
 * cachea a nivel de módulo: entrar y salir de la etapa NO vuelve a pegarle a la API, se reutiliza
 * la misma promesa. Si la consulta falla, la caché se limpia para poder reintentar.
 */
import { BOARDS } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/** Una ruta de entrega: sólo su id y su nombre, que es lo que se muestra y se linkea. */
export interface RutaEntrega {
  id: string
  name: string
}

/** Rutas de respaldo en modo local (sin token), para que el prototipo siga corriendo. */
const RUTAS_MOCK: RutaEntrega[] = [
  { id: 'ruta-1', name: 'Azul-Olav-Boliv' },
  { id: 'ruta-2', name: 'Balcarse-Mar del plata' },
  { id: 'ruta-3', name: 'Tandil-Gardey' },
  { id: 'ruta-4', name: 'Ayacucho' },
]

/** Promesa cacheada de la lista de rutas. Se comparte entre montajes de la etapa. */
let rutasCache: Promise<RutaEntrega[]> | null = null

/**
 * Lista las rutas de entrega del board. Cachea la promesa: llamadas repetidas (por reentrar a la
 * etapa) reutilizan el mismo fetch en vez de saturar la API. Un fallo limpia la caché para reintentar.
 */
export function getRutasEntrega(): Promise<RutaEntrega[]> {
  if (!mondayHabilitado()) return Promise.resolve(RUTAS_MOCK)
  if (!rutasCache) {
    rutasCache = mondayApi<{ boards: { items_page: { items: { id: string; name: string }[] } }[] }>(
      `query { boards(ids: [${BOARDS.rutasEntrega}]) { items_page(limit: 200) { items { id name } } } }`,
    )
      .then((d) => (d.boards[0]?.items_page?.items ?? []).map((i) => ({ id: i.id, name: i.name })))
      .catch((e) => {
        rutasCache = null
        throw e
      })
  }
  return rutasCache
}
