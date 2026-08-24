/**
 * Vendedores y usuario logueado. Las dos cosas salen del MISMO lugar: el tablero privado de la
 * lista blanca.
 *
 * Antes el selector se armaba con los usuarios del equipo "Vendedores" de la cuenta de Monday. Eso
 * tenía un problema de fondo: eran dos listas distintas —quién puede vender y quién puede entrar—
 * y nada las obligaba a coincidir. Se podía ofrecer como vendedor a alguien que la app rechazaba,
 * y al revés. Ahora hay una sola fuente: si está habilitado en el tablero, aparece en el selector;
 * si no, no existe para la app.
 *
 * El tablero es privado: sólo lo lee el token del servidor. Por eso en producción esto no consulta
 * a Monday sino a `/api/vendedores`, que arma la consulta del lado del servidor y devuelve nada más
 * que los nombres y los ids habilitados. El id del tablero nunca viaja al navegador.
 *
 * En desarrollo no hay funciones serverless, así que se lee el tablero directo con el token
 * personal de `.env.local` —que es el del dueño, y puede—. Es el único lugar donde el id del
 * tablero aparece en el cliente, dentro de una rama que el build de producción elimina.
 */
import { VENDEDORES } from '@/data/mock'
import type { UsuarioActual, Vendedor } from '@/types'
import { cabecerasPropias, mondayApi, mondayHabilitado, verificarRespuesta } from './sdk'

/** Paleta de colores para el avatar del vendedor, asignada por posición. */
const COLORES_VENDEDOR = [
  'var(--avatar-orange)',
  'var(--red)',
  'var(--green)',
  '#575ce5',
  'var(--primary-blue)',
  'var(--purple)',
] as const

/** Iniciales del nombre: la primera letra de las dos primeras palabras, en mayúscula. */
const iniciales = (nombre: string): string =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

/** Lo que devuelve `/api/vendedores`: la lista habilitada y quién la está pidiendo. */
interface RespuestaEquipo {
  vendedores: { id: string; nombre: string }[]
  usuario: { id: string; nombre: string; isAdmin: boolean; equipos: string[] } | null
}

/**
 * Un solo pedido para las dos consultas.
 *
 * La app pide vendedores y usuario al montar, casi en el mismo instante. Sin esto serían dos viajes
 * por exactamente la misma información.
 */
let enCurso: Promise<RespuestaEquipo> | null = null

function equipo(): Promise<RespuestaEquipo> {
  enCurso ??= pedirEquipo().catch((e) => {
    // Un fallo no se cachea: el próximo intento vuelve a preguntar.
    enCurso = null
    throw e
  })
  return enCurso
}

async function pedirEquipo(): Promise<RespuestaEquipo> {
  if (!mondayHabilitado()) {
    return { vendedores: VENDEDORES.map((v) => ({ id: v.id, nombre: v.name })), usuario: null }
  }
  return import.meta.env.DEV ? leerEnDesarrollo() : leerDelServidor()
}

/** Producción: el servidor lee el tablero privado y devuelve sólo lo habilitado. */
async function leerDelServidor(): Promise<RespuestaEquipo> {
  const res = await fetch('/api/vendedores', {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: '{}',
  })
  /* Misma lectura del rechazo que el resto de los pedidos: un 401 o un 403 acá tienen que
     levantar la ventana y tapar la app igual que en cualquier otra consulta. */
  await verificarRespuesta(res, 'Vendedores')
  return (await res.json()) as RespuestaEquipo
}

/**
 * Desarrollo: se lee el tablero directo, con el token personal.
 *
 * Va en una rama `import.meta.env.DEV`, que el build de producción resuelve a `false` y elimina
 * entera: ni el id del tablero ni esta consulta llegan al bundle que se despliega.
 */
async function leerEnDesarrollo(): Promise<RespuestaEquipo> {
  const BOARD = '18427866249'
  const COL_USUARIO = 'text_mm6hqsmt'
  const COL_ESTADO = 'status'
  const ACTIVO = 'activo'

  const data = await mondayApi<{
    boards?: { items_page?: { items?: FilaTablero[] } }[]
    me?: { id: string; name: string; is_admin?: boolean | null; teams?: { name: string }[] } | null
  }>(
    `query ($board: ID!, $cols: [String!]) {
      boards(ids: [$board]) {
        items_page(limit: 300) {
          items {
            name
            column_values(ids: $cols) { id text }
          }
        }
      }
      me { id name is_admin teams { name } }
    }`,
    { board: BOARD, cols: [COL_USUARIO, COL_ESTADO] },
  )

  const items = data.boards?.[0]?.items_page?.items ?? []
  const vendedores = items
    .filter((i) => (valorDe(i, COL_ESTADO) ?? '').trim().toLowerCase() === ACTIVO)
    .map((i) => ({ id: (valorDe(i, COL_USUARIO) ?? '').trim(), nombre: i.name }))
    .filter((v) => v.id !== '')

  const me = data.me
  return {
    vendedores,
    usuario: me
      ? {
          id: String(me.id),
          nombre: me.name,
          isAdmin: Boolean(me.is_admin),
          equipos: (me.teams ?? []).map((t) => (t.name ?? '').trim()).filter(Boolean),
        }
      : null,
  }
}

interface FilaTablero {
  name: string
  column_values?: { id: string; text: string | null }[]
}

const valorDe = (fila: FilaTablero, columna: string): string | null =>
  fila.column_values?.find((c) => c.id === columna)?.text ?? null

/**
 * Los vendedores habilitados, para el selector.
 *
 * Sin token en desarrollo devuelve el mock; ante un error, lista vacía (la UI lo refleja y la
 * operación no queda trabada por no poder leer un catálogo).
 */
export async function getVendedores(): Promise<Vendedor[]> {
  const { vendedores } = await equipo()
  return vendedores.map((v, i) => ({
    id: v.id,
    name: v.nombre,
    ini: iniciales(v.nombre),
    color: COLORES_VENDEDOR[i % COLORES_VENDEDOR.length],
  }))
}

/**
 * El usuario que abrió la app, con sus equipos: son los que definen el rol (ver `lib/permisos`).
 *
 * En producción sale del session token YA VERIFICADO del lado del servidor. Antes salía de la query
 * `me`, que viajaba por el proxy —el que inyecta el token del SERVIDOR—, así que contestaba quién
 * era el dueño de ese token y no quién había abierto la app: con una sola cuenta de servicio, todos
 * los usuarios heredaban su identidad y su rol.
 */
export async function getUsuarioActual(): Promise<UsuarioActual | null> {
  const { usuario } = await equipo()
  if (!usuario) return null
  return {
    id: usuario.id,
    name: usuario.nombre,
    isAdmin: usuario.isAdmin,
    equipos: usuario.equipos,
  }
}
