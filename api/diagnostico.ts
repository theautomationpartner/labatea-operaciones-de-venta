/**
 * TEMPORAL · diagnóstico del runtime de las funciones.
 *
 * Responde una sola pregunta que desde afuera no se puede contestar: cómo quedan los archivos de
 * `api/` una vez desplegados —¿siguen siendo `.ts` o Vercel los compila a `.js`?—, porque de eso
 * depende con qué extensión hay que escribir los imports relativos de todas las funciones.
 *
 * NO importa ningún archivo vecino a propósito: tiene que poder cargar aunque todo lo demás falle.
 *
 * Va con token porque expone nombres de archivo del servidor. Se borra apenas se use.
 */
import { readdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const TOKEN = 'b5072a811ee89a6bc4884e87'

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.searchParams.get('k') !== TOKEN) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }

  const info: Record<string, unknown> = { node: process.version, cwd: process.cwd() }

  try {
    info.dir = new URL('.', import.meta.url).pathname
  } catch (e) {
    info.dirError = primeraLinea(e)
  }

  for (const dir of ['/var/task/api', '/var/task/api/mfa', process.cwd()]) {
    try {
      info[dir] = readdirSync(dir)
    } catch (e) {
      info[dir] = 'ERROR: ' + primeraLinea(e)
    }
  }

  /* La prueba que importa: cuál de las tres formas resuelve en el runtime real. La que conteste OK
     es la que hay que escribir en TODOS los imports relativos de las funciones. */
  for (const spec of ['./_guard.ts', './_guard.js', './_guard']) {
    try {
      await import(spec)
      info['import ' + spec] = 'OK'
    } catch (e) {
      info['import ' + spec] = primeraLinea(e)
    }
  }

  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(info, null, 2))
}

function primeraLinea(e: unknown): string {
  return String((e as Error)?.message ?? e).split('\n')[0]
}
