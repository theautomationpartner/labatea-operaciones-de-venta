/**
 * `POST /api/clientes` — el padrón cacheado, para que la app pueda buscar clientes en local.
 *
 * Lo que devuelve sale de la base (la llena el Cron Job, ver `api/cron/clientes.ts`), no de Monday:
 * este endpoint no consulta el tablero ni una vez. Es todo el punto del caché — la búsqueda del
 * cliente deja de costar una vuelta de paginación por cada intento de escritura.
 *
 * ── El delta ──
 * El navegador manda la `version` que ya tiene y recibe sólo lo que cambió desde entonces. El
 * padrón entero son 81 KB comprimidos; el delta, en régimen, son dos arreglos vacíos. Sin esto,
 * cada recarga de la app se bajaría los 81 KB de nuevo para enterarse de que no cambió nada.
 *
 * Detrás de las tres capas de siempre (`endpointDatos`: firma del session token + lista blanca +
 * segundo factor). El padrón es la cartera de clientes entera con sus límites de crédito y sus
 * saldos: no es un catálogo público.
 */
import type { ServerResponse } from 'node:http'
import { endpointDatos, type Pedido } from './_http.js'
import { leerDelta, leerEstado } from './_padronDb.js'

interface Cuerpo {
  /** La versión que el navegador ya tiene. Sin ella se devuelve el padrón completo. */
  desde?: string
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointDatos<Cuerpo>(req, res, async ({ cuerpo }) => {
    /* Sólo se acepta una fecha válida. Un `desde` basura no puede hacer que la consulta devuelva
       vacío y el navegador concluya que el padrón no tiene clientes: ante la duda, todo. */
    const desde = fechaValida(cuerpo?.desde)
    const [delta, estado] = await Promise.all([leerDelta(desde), leerEstado()])

    return {
      version: delta.version,
      /* `completo` le dice al navegador si lo que recibe REEMPLAZA su padrón o se le suma. Sin
         este dato, un delta vacío sería indistinguible de un padrón vacío. */
      completo: desde === null,
      clientes: delta.clientes,
      bajas: delta.bajas,
      /* Cuándo se sincronizó por última vez y si la última corrida falló. La app lo usa para poder
         decir "el padrón está viejo" en vez de mostrar resultados incompletos como si fueran
         todos los que hay. */
      sincronizado: estado.ultimo_ok,
      error: estado.error,
    }
  })
}

function fechaValida(valor: string | undefined): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return null
  return Number.isFinite(Date.parse(valor)) ? valor : null
}
