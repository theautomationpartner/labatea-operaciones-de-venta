/**
 * Acceso a la API de Monday por HTTP directo al endpoint GraphQL (https://api.monday.com/v2),
 * autenticado con un token de API. No usa el MCP: eso era sólo para validar durante el desarrollo.
 *
 * En desarrollo se pega contra `/monday-api`, un proxy de Vite hacia api.monday.com (evita CORS).
 * En producción va directo al endpoint. El token sale de `.env.local` (VITE_MONDAY_TOKEN).
 */
const TOKEN = (import.meta.env.VITE_MONDAY_TOKEN as string | undefined)?.trim() || undefined

const ENDPOINT = import.meta.env.DEV ? '/monday-api' : 'https://api.monday.com/v2'
const API_VERSION = '2024-10'

/** Hay acceso real a Monday si hay un token configurado; si no, los servicios usan mock. */
export const mondayHabilitado = (): boolean => Boolean(TOKEN)

/** Host del bucket donde Monday guarda los archivos de las columnas file. */
const FILES_HOST = 'https://files-monday-com.s3.amazonaws.com'

/**
 * La `public_url` de un asset apunta a S3, que no manda cabeceras CORS: leerla desde el
 * navegador falla. En desarrollo se reescribe al proxy de Vite (`/monday-files`) para poder
 * traer los bytes; en producción se devuelve tal cual.
 */
export function urlArchivo(url: string): string {
  if (!import.meta.env.DEV || !url.startsWith(FILES_HOST)) return url
  return `/monday-files${url.slice(FILES_HOST.length)}`
}

interface ApiError {
  message: string
}

/** Ejecuta una query/mutation GraphQL contra la API de Monday y devuelve `data`; lanza si falla. */
export async function mondayApi<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN ?? '',
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  })
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T; errors?: ApiError[] }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' · '))
  if (!json.data) throw new Error('Monday no devolvió datos.')
  return json.data
}
