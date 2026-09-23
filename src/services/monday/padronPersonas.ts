/**
 * El padrón de clientes en el navegador: se baja una vez, se revalida por delta y lo consume el
 * buscador para resolver la búsqueda en local.
 *
 * El servidor lo mantiene con un Vercel Cron Job (`api/cron/personas.ts`) y lo entrega por
 * `/api/personas`. Acá no se le pregunta nada a Monday: ese es el punto del caché.
 *
 * ── Sólo clientes ──
 * El padrón del servidor guarda clientes Y proveedores —otra app consume esos últimos—, pero esta
 * app pide `categoria: 'cliente'` y no se baja los 1225 proveedores que no le sirven. Y no es sólo
 * ahorro de bytes: un proveedor no puede aparecer NUNCA en el paso de cliente, porque elegirlo
 * sería facturarle a quien nos vende. Filtrando en el servidor, ni siquiera llega al navegador
 * donde alguien podría mostrarlo por error.
 *
 * ── Cómo se revalida ──
 * Se guarda la `version` que devolvió el servidor y en cada revalidación se la manda de vuelta; lo
 * que llega es sólo lo que cambió desde entonces —altas y modificaciones en `personas`, bajas en
 * `bajas`—. En régimen eso son dos arreglos vacíos. Sin el delta, cada recarga se bajaría los 81 KB
 * del padrón entero para enterarse de que no cambió nada.
 *
 * ── Dónde vive ──
 * En memoria mientras la pestaña está viva, y espejado en `sessionStorage` para que recargar no
 * cueste la bajada completa. En `sessionStorage` y no en `localStorage` a propósito: es la cartera
 * de clientes con sus límites y saldos, y no tiene por qué sobrevivir a la sesión en el disco de
 * la máquina.
 */
import { CLIENTES } from '@/data/mock'
import { indexarPadron, type EntradaPadron } from '@/lib/busquedaClientes'
import type { Cliente } from '@/types'
import { cabecerasPropias, mondayHabilitado, verificarRespuesta } from './sdk'

/* La versión de la clave sube con cada cambio de forma de lo guardado: así, el espejo que quedó de
   la versión anterior no se lee como si fuera del formato nuevo. v2 = el registro trae `categorias`
   y viene del endpoint de personas. */
const CLAVE_SESION = 'padron-clientes-v2'

/** Cada cuánto se vuelve a preguntar por novedades. El cron corre cada 5 minutos; esto lo sigue. */
const REVALIDAR_CADA_MS = 5 * 60_000

interface RespuestaPadron {
  version: string | null
  completo: boolean
  personas: Cliente[]
  bajas: string[]
  sincronizado: string | null
  error: string | null
}

export interface Padron {
  /** Ya normalizado para buscar. Es lo que consume `buscarEnPadron`. */
  entradas: EntradaPadron[]
  /** Cuándo corrió por última vez —con éxito— la sincronización del servidor. */
  sincronizado: string | null
  /** El servidor no pudo actualizar el padrón. La vista lo dice; no lo esconde. */
  error: string | null
}

/** Estado del módulo. Uno solo por pestaña: el padrón es el mismo para toda la app. */
let porId = new Map<string, Cliente>()
let version: string | null = null
let sincronizado: string | null = null
let errorServidor: string | null = null
let indice: EntradaPadron[] | null = null
let ultimaRevalidacion = 0
let enCurso: Promise<Padron> | null = null

/** El índice se rearma sólo cuando el padrón cambió; en cada tecla se reusa el de antes. */
function padronActual(): Padron {
  indice ??= indexarPadron([...porId.values()])
  return { entradas: indice, sincronizado, error: errorServidor }
}

function invalidarIndice(): void {
  indice = null
}

/**
 * El padrón listo para buscar.
 *
 * La primera llamada lo baja; las siguientes devuelven lo que ya está y revalidan por detrás si
 * pasó el intervalo. Nunca hace esperar dos veces por lo mismo: las llamadas concurrentes comparten
 * la promesa en curso.
 */
export function getPadron(): Promise<Padron> {
  if (porId.size > 0) {
    if (Date.now() - ultimaRevalidacion > REVALIDAR_CADA_MS) void revalidar()
    return Promise.resolve(padronActual())
  }
  enCurso ??= cargar().finally(() => {
    enCurso = null
  })
  return enCurso
}

/**
 * Fuerza una revalidación y espera el resultado. Lo usa la vista al entrar al paso de cliente: es
 * el momento en que el frescor importa y en que la espera no molesta.
 */
export async function revalidar(): Promise<Padron> {
  try {
    await pedir(version)
  } catch (e) {
    /* Un fallo al revalidar NO vacía lo que ya está: es mejor buscar sobre un padrón de hace cinco
       minutos que quedarse sin buscador. Queda anotado para que la vista lo pueda decir. */
    console.warn('[padrón] no se pudo revalidar:', (e as Error).message)
  }
  return padronActual()
}

async function cargar(): Promise<Padron> {
  /* En desarrollo no hay funciones serverless —`/api/*` no existe— y sin token tampoco hay a quién
     preguntarle. En los dos casos el buscador trabaja sobre el mock, que es chico y alcanza para
     probar la pantalla. */
  if (import.meta.env.DEV || !mondayHabilitado()) {
    porId = new Map(CLIENTES.map((c) => [c.id, c]))
    invalidarIndice()
    return padronActual()
  }

  desdeSesion()
  try {
    await pedir(version)
  } catch (e) {
    /* Sin padrón, el live search no funciona pero el botón Buscar sí: la app queda como estaba
       antes de este caché, no rota. Por eso esto no propaga el error. */
    console.warn('[padrón] no se pudo cargar:', (e as Error).message)
    errorServidor = (e as Error).message
  }
  return padronActual()
}

/** Pide al servidor lo que falte desde `desde` y lo aplica. */
async function pedir(desde: string | null): Promise<void> {
  const res = await fetch('/api/personas', {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ desde, categoria: 'cliente' }),
  })
  /* Misma lectura del rechazo que el resto de los pedidos: un 401 o un 403 acá tienen que levantar
     la ventana de seguridad igual que en cualquier otra consulta. */
  await verificarRespuesta(res, 'Padrón de clientes')
  aplicar((await res.json()) as RespuestaPadron)
}

function aplicar(data: RespuestaPadron): void {
  /* `completo` marca si lo que llegó REEMPLAZA el padrón o se le suma. Sin ese dato, un delta
     vacío sería indistinguible de un padrón vacío y el buscador se quedaría sin nada. */
  if (data.completo) porId = new Map()
  for (const persona of data.personas) porId.set(persona.id, persona)
  /* Las bajas se aplican DESPUÉS de las altas: un cliente que se dio de baja y volvió llega en las
     dos listas, y lo que vale es que está de vuelta. El servidor lo desanota al reactivarlo, así
     que esto es un cinturón además de los tirantes. */
  for (const id of data.bajas) if (!data.personas.some((p) => p.id === id)) porId.delete(id)

  version = data.version
  sincronizado = data.sincronizado
  errorServidor = data.error
  ultimaRevalidacion = Date.now()
  invalidarIndice()
  guardarEnSesion()

  /* Que un padrón roto NO se vea como un buscador que simplemente no encuentra nada.
     Pasó: una corrida del cron murió a mitad del barrido, la tabla quedó cargada a medias, y en
     pantalla eso se veía igual que "ese cliente no existe" —sin un solo mensaje—. El servidor ya
     guardaba el motivo; nadie lo miraba. */
  if (errorServidor) {
    console.warn(
      `[padrón] el servidor no pudo actualizarlo: ${errorServidor}. Los resultados pueden estar ` +
        'incompletos; usá el botón Buscar, que consulta Monday directo.',
    )
  } else if (porId.size === 0) {
    console.warn(
      '[padrón] llegó VACÍO. El live search no va a encontrar nada hasta que el cron ' +
        '(/api/cron/personas) complete un barrido; el botón Buscar sigue funcionando.',
    )
  }
}

/**
 * Suma al padrón un cliente traído por el botón Buscar (consulta directa a Monday).
 *
 * Es gratis y evita la pregunta obvia: encontrarlo por Monday y que dos segundos después el live
 * search siga sin conocerlo. No se guarda la versión —este cliente no vino del servidor— así que
 * la próxima revalidación lo confirma o lo corrige.
 */
export function recordarClientes(clientes: readonly Cliente[]): void {
  if (clientes.length === 0) return
  for (const c of clientes) porId.set(c.id, c)
  invalidarIndice()
}

/* ── Espejo en sessionStorage ───────────────────────────────────────────────────────────────── */

function desdeSesion(): void {
  try {
    const crudo = sessionStorage.getItem(CLAVE_SESION)
    if (!crudo) return
    const guardado = JSON.parse(crudo) as { version: string | null; clientes: Cliente[] }
    if (!Array.isArray(guardado.clientes)) return
    porId = new Map(guardado.clientes.map((c) => [c.id, c]))
    version = guardado.version
    invalidarIndice()
  } catch {
    /* Un espejo ilegible —formato viejo, cuota llena, modo privado— no es un problema: se ignora y
       se baja el padrón completo, que es el camino de la primera vez. */
  }
}

function guardarEnSesion(): void {
  try {
    sessionStorage.setItem(
      CLAVE_SESION,
      JSON.stringify({ version, clientes: [...porId.values()] }),
    )
  } catch {
    /* Sin lugar en sessionStorage el padrón sigue en memoria y todo funciona: sólo se pierde el
       atajo al recargar. No hay nada que avisar. */
  }
}
