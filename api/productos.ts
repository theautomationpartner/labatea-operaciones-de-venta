/**
 * `POST /api/productos` — el catálogo cacheado, para que la app pueda buscar productos en local.
 *
 * Lo que devuelve sale de la base (la llena el Cron Job, ver `api/cron/productos.ts`), no de
 * Monday: este endpoint no consulta el maestro ni una vez. Es todo el punto del caché — encontrar
 * la mercadería deja de costar una consulta por intento.
 *
 * ── El delta ──
 * El navegador manda la `version` que ya tiene y recibe sólo lo que cambió desde entonces. El
 * catálogo entero son 102 KB comprimidos; el delta, en régimen, son dos arreglos vacíos. Sin esto,
 * cada recarga de la app se bajaría los 102 KB de nuevo para enterarse de que no cambió nada.
 *
 * ── Lo que NO viaja: el stock ──
 * Las cantidades no están en el caché a propósito (ver `api/_productos.ts`). De cada producto viaja
 * el `stockId`, y la app le pide el stock a Monday recién cuando el usuario ELIGE el producto.
 *
 * Detrás de las tres capas de siempre (`endpointDatos`: firma del session token + lista blanca +
 * segundo factor). El catálogo lleva los costos y los ocho precios de lista de toda la mercadería:
 * no es un folleto público.
 */
import type { ServerResponse } from 'node:http'
import { endpointDatos, type Pedido } from './_http.js'
import { leerDelta, leerEstado } from './_productosDb.js'

interface Cuerpo {
  /** La versión que el navegador ya tiene. Sin ella se devuelve el catálogo completo. */
  desde?: string
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointDatos<Cuerpo>(req, res, async ({ cuerpo }) => {
    /* Sólo se acepta una fecha válida. Un `desde` basura no puede hacer que la consulta devuelva
       vacío y el navegador concluya que el catálogo no tiene productos: ante la duda, todo. */
    const desde = fechaValida(cuerpo?.desde)
    const [delta, estado] = await Promise.all([leerDelta(desde), leerEstado()])

    return {
      version: delta.version,
      /* `completo` le dice al navegador si lo que recibe REEMPLAZA su catálogo o se le suma. Sin
         este dato, un delta vacío sería indistinguible de un catálogo vacío. */
      completo: desde === null,
      productos: delta.productos,
      bajas: delta.bajas,
      /* Cuándo se sincronizó por última vez y si la última corrida falló. La app lo usa para poder
         decir "el catálogo está viejo" en vez de mostrar resultados incompletos como si fueran
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
