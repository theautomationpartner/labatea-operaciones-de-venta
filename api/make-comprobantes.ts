/**
 * Serverless Function (Vercel) — proxy del escenario de Make que lee los comprobantes.
 *
 * El navegador pega contra `/api/make-comprobantes` y esta función reenvía al webhook, cuya
 * dirección sale de `MAKE_WEBHOOK_COMPROBANTES` (variable de entorno del servidor, SIN prefijo
 * VITE_). Así la URL del hook nunca viaja al bundle: si estuviera en el cliente —aunque fuera
 * inyectada por entorno— se leería con las herramientas del navegador, y con ella cualquiera
 * dispararía el escenario y consumiría las operaciones de la cuenta de Make.
 *
 * El cuerpo se reenvía TAL CUAL, con su `Content-Type` original: ahí viaja el `boundary` del
 * multipart, y sin él Make no puede separar el archivo del resto de los campos.
 *
 * Equivale al proxy de Vite (`/make-comprobantes`) que sólo existe en desarrollo.
 *
 * ── Por qué la firma es (req, res) y no (Request) → Response ──
 * Esta función corre en el runtime de NODE, no en el edge, y ahí Vercel invoca al `export default`
 * con los objetos de `node:http` —el `req` es un `IncomingMessage`, no un `Request` del estándar
 * web—. Escrita con la firma web, la primera línea que tocaba `req.headers.get(...)` reventaba con
 * un TypeError y Vercel devolvía `FUNCTION_INVOCATION_FAILED` antes de llegar a Make.
 *
 * Los proxies de Monday sí usan la firma web porque declaran `runtime: 'edge'`, donde ESA es la
 * correcta. Acá el edge no sirve: corta la respuesta mucho antes de lo que tarda el módulo de IA en
 * leer un documento, y por eso esta función se quedó en Node con su `maxDuration`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { autorizarPedido, respuestaDeError } from './_guard.js'
import { deviceTokenDe } from './_http.js'

/*
 * 60 s es el techo del plan Hobby. En Pro se puede subir hasta 300 s, más cerca del tope que espera
 * el cliente (ver `TIMEOUT_MS` en `src/services/make/sdk.ts`).
 */
export const config = { maxDuration: 60 }

/** El cuerpo puede venir ya leído por el runtime, según el `Content-Type` que haya reconocido. */
type Pedido = IncomingMessage & { body?: unknown }

/**
 * Escenarios de Make a los que este proxy sabe llegar, cada uno con la variable de entorno que guarda
 * su webhook. El cliente elige cuál con `?escenario=`; sin parámetro es la lectura de comprobantes,
 * que es lo que hacía esta función desde el principio.
 *
 * Es una lista CERRADA a propósito: el nombre que manda el navegador sólo sirve para elegir una de
 * estas entradas, nunca para armar el destino. Se comparte la función —en vez de una por escenario—
 * porque el guardián, el reenvío del multipart y el tope de duración son los mismos, y cada función
 * nueva cuenta contra el cupo del plan de Vercel.
 */
const ESCENARIOS: Record<string, { variable: string; servicio: string }> = {
  comprobantes: { variable: 'MAKE_WEBHOOK_COMPROBANTES', servicio: 'El servicio de lectura' },
  'envio-presupuesto': {
    variable: 'MAKE_WEBHOOK_URL',
    servicio: 'El servicio de envío de presupuestos',
  },
}

/** El escenario que pide la URL (`?escenario=`), o `null` si no es uno de la lista. */
function escenarioDe(req: IncomingMessage): (typeof ESCENARIOS)[string] | null {
  const nombre = new URL(req.url ?? '/', 'http://localhost').searchParams.get('escenario')
  return Object.prototype.hasOwnProperty.call(ESCENARIOS, nombre ?? 'comprobantes')
    ? ESCENARIOS[nombre ?? 'comprobantes']
    : null
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    return responder(res, 405, { error: 'Method Not Allowed' })
  }

  /* Mismo guardián que los proxies de Monday (Capa 2). Acá no hay un token de escritura en
     juego, pero sí las operaciones de la cuenta de Make: disparar el escenario cuesta plata y
     tiene cupo, así que la puerta se abre para los mismos que el resto de la app. */
  try {
    await autorizarPedido(req.headers.authorization, deviceTokenDe(req))
  } catch (e) {
    const { status, cuerpo } = respuestaDeError(e)
    return responder(res, status, cuerpo)
  }

  const escenario = escenarioDe(req)
  if (!escenario) {
    return responder(res, 404, { error: 'Escenario desconocido.' })
  }
  const webhook = process.env[escenario.variable]?.trim()
  if (!webhook) {
    return responder(res, 500, { error: `${escenario.servicio} no está configurado.` })
  }

  const contentType = req.headers['content-type']
  /* Multipart para la lectura de comprobantes (el archivo va binario) y JSON para el envío del
     presupuesto (Make lo parsea solo en su estructura; ver `src/services/make/envioPresupuesto.ts`).
     Los dos se reenvían tal cual, con su `Content-Type`. */
  if (!contentType?.startsWith('multipart/form-data') && !contentType?.startsWith('application/json')) {
    return responder(res, 400, { error: 'El documento tiene que viajar como multipart o JSON.' })
  }

  const body = await leerCuerpo(req)

  let upstream: Response
  try {
    upstream = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
  } catch {
    /* No se pudo llegar a Make. Se responde 502 —y no 500— porque el sdk trata los 5xx como fallo
       transitorio y reintenta, que es exactamente lo que corresponde acá. El detalle del error no se
       reenvía: diría el hostname del hook, que es justo lo que esta función existe para no mostrar. */
    return responder(res, 502, { error: `No se pudo contactar ${escenario.servicio.toLowerCase()}.` })
  }

  /* La respuesta del escenario se devuelve intacta —cuerpo y status—: el cliente ya sabe leerla,
     incluidos los errores que Make declara con un 200 y el 410 del escenario apagado. */
  const texto = await upstream.text()
  res.statusCode = upstream.status
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
  res.end(texto)
}

/**
 * El cuerpo crudo del pedido.
 *
 * El runtime parsea solo lo que reconoce (JSON, formularios simples) y deja el multipart sin tocar,
 * así que casi siempre hay que leer el stream. Se contempla igual el caso de que ya venga leído:
 * consumir un stream vacío devolvería un cuerpo de cero bytes y Make recibiría un multipart sin
 * partes, que es más difícil de diagnosticar que un error.
 *
 * Devuelve un `ArrayBuffer`: es el único tipo de cuerpo binario que el `fetch` del estándar
 * declara sin ambigüedad. Con `Uint8Array` el runtime también anda, pero el tipado de `BodyInit`
 * no lo reconoce y el typecheck del directorio `api/` queda en rojo.
 */
async function leerCuerpo(req: Pedido): Promise<ArrayBuffer> {
  if (Buffer.isBuffer(req.body)) return bytes(req.body)
  if (typeof req.body === 'string') return bytes(Buffer.from(req.body))
  /* Un JSON el runtime ya lo parseó a objeto y el stream quedó consumido: se vuelve a serializar. */
  if (req.body && typeof req.body === 'object') return bytes(Buffer.from(JSON.stringify(req.body)))

  const partes: Buffer[] = []
  for await (const trozo of req) partes.push(Buffer.from(trozo))
  return bytes(Buffer.concat(partes))
}

/** La ventana exacta del Buffer, sin arrastrar el resto del pool que Node reutiliza por debajo. */
function bytes(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(data))
}
