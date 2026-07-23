/**
 * Serverless Function (Vercel) — proxy de los archivos de Monday (bucket S3).
 *
 * La `public_url` de un asset apunta a S3, que no manda cabeceras CORS: el navegador no puede
 * leer los bytes directo. Esta función los trae del lado servidor y los devuelve por el mismo
 * origen, para que el visor de PDF los pueda mostrar embebidos.
 *
 * Uso: `/api/monday-file?u=<url S3 url-encodeada>`. Equivale al proxy de Vite `/monday-files`.
 *
 * Seguridad: sólo se aceptan URLs del host de archivos de Monday; así no puede usarse como
 * proxy abierto hacia hosts arbitrarios (SSRF).
 */
export const config = { runtime: 'edge' }

const FILES_HOST = 'https://files-monday-com.s3.amazonaws.com'

export default async function handler(req: Request): Promise<Response> {
  const u = new URL(req.url).searchParams.get('u')
  if (!u || !u.startsWith(FILES_HOST)) {
    return new Response('Bad Request', { status: 400 })
  }

  const upstream = await fetch(u)
  if (!upstream.ok || !upstream.body) {
    return new Response('Upstream Error', { status: upstream.status || 502 })
  }

  const headers = new Headers()
  const ct = upstream.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  headers.set('cache-control', 'private, max-age=60')

  return new Response(upstream.body, { status: 200, headers })
}
