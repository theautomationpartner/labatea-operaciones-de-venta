/**
 * La lista blanca (Capa 2) decide contra el tablero privado, no contra lo que diga el cliente.
 *
 * Lo que se fija acá:
 *  · sólo el estado "Activo" habilita; cualquier otro —o no estar en el tablero— es 403;
 *  · el fallo es CERRADO: si la API de Monday no contesta, nadie entra. Una lista blanca que se
 *    abre cuando falla la consulta no es una lista blanca;
 *  · un fallo NO se cachea, así que la app vuelve sola en cuanto Monday responde;
 *  · la caché ahorra cuota de verdad (la segunda llamada no vuelve a pegar) y distingue por cuenta.
 *
 * Se corre con esbuild + node (`npm run test:whitelist`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { ErrorAuth } from '../api/_guard'
import { exigirListaBlanca, limpiarCacheListaBlanca, listarHabilitados } from '../api/_whitelist'

process.env.MONDAY_API_TOKEN = 'token-de-prueba'
process.env.WHITELIST_BOARD_ID = '18427866249'

const APP = '11968092'
const sesion = {
  userId: '107870718',
  accountId: '35883216',
  isGuest: false,
  isAdmin: false,
  appId: APP,
}

/** Lo que pidió cada llamada, para poder afirmar sobre la query y contar los viajes a la API. */
let pedidos: { variables: Record<string, unknown> }[] = []

/**
 * Deja a `fetch` respondiendo con estas filas. Cada una es `estado` y, opcionalmente, las apps
 * habilitadas; sin apps declaradas se usa la de esta sesión, que es el caso normal.
 */
function responderCon(...estados: (string | null)[]): void {
  responderConApps(estados.map((estado) => ({ estado, apps: APP })))
}

function responderConApps(filas: { estado: string | null; apps: string | null }[]): void {
  pedidos = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    pedidos.push(JSON.parse(init.body) as { variables: Record<string, unknown> })
    return {
      ok: true,
      json: async () => ({
        data: {
          items_page_by_column_values: {
            items: filas.map((fila, i) => ({
              id: String(i),
              column_values: [
                { id: 'status', text: fila.estado },
                { id: 'dropdown_mm6jamkm', text: fila.apps },
              ],
            })),
          },
        },
      }),
    }
  }) as unknown as typeof fetch
}

/** Corre la validación y devuelve 'ok' o el status del rechazo. */
async function intentar(quien = sesion): Promise<number | 'ok'> {
  try {
    await exigirListaBlanca(quien)
    return 'ok'
  } catch (e) {
    assert.ok(e instanceof ErrorAuth, `esperaba ErrorAuth y vino ${String(e)}`)
    return e.status
  }
}

// --- El estado del tablero es el que manda --------------------------------------------------------
limpiarCacheListaBlanca()
responderCon('Activo')
assert.equal(await intentar(), 'ok', 'usuario activo')

limpiarCacheListaBlanca()
responderCon('Revocado')
assert.equal(await intentar(), 403, 'usuario revocado')

limpiarCacheListaBlanca()
responderCon()
assert.equal(await intentar(), 403, 'usuario que no está en el tablero')

limpiarCacheListaBlanca()
responderCon(null)
assert.equal(await intentar(), 403, 'fila sin estado cargado')

limpiarCacheListaBlanca()
responderCon('  activo  ')
assert.equal(await intentar(), 'ok', 'la etiqueta se compara sin distinguir mayúsculas ni espacios')

/* Una fila vieja revocada no anula una habilitación vigente: alcanza con tener UNA activa. */
limpiarCacheListaBlanca()
responderCon('Revocado', 'Activo')
assert.equal(await intentar(), 'ok', 'duplicado con una fila activa')

// --- La consulta va al tablero y la columna que corresponde ---------------------------------------
limpiarCacheListaBlanca()
responderCon('Activo')
await intentar()
/* La consulta pide las DOS columnas que deciden: el estado y las apps habilitadas. */
assert.deepEqual(pedidos[0].variables, {
  board: '18427866249',
  columna: 'text_mm6hqsmt',
  usuario: '107870718',
  estado: ['status', 'dropdown_mm6jamkm'],
})

// --- Caché ----------------------------------------------------------------------------------------
limpiarCacheListaBlanca()
responderCon('Activo')
await intentar()
await intentar()
assert.equal(pedidos.length, 1, 'la segunda llamada sale de la caché')

/* La caché es por cuenta + usuario: otra cuenta no hereda el permiso. */
await intentar({ ...sesion, accountId: '999' })
assert.equal(pedidos.length, 2, 'otra cuenta vuelve a consultar')

// --- Falla cerrada, y sin cachear el fallo ---------------------------------------------------------
limpiarCacheListaBlanca()
pedidos = []
globalThis.fetch = (async () => {
  throw new Error('ECONNRESET')
}) as unknown as typeof fetch
assert.equal(await intentar(), 403, 'API caída: no entra nadie')

responderCon('Activo')
assert.equal(await intentar(), 'ok', 'el fallo no quedó cacheado: al volver Monday, la app vuelve')

limpiarCacheListaBlanca()
globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
assert.equal(await intentar(), 403, 'la API respondió 500')

limpiarCacheListaBlanca()
globalThis.fetch = (async () => ({
  ok: true,
  json: async () => ({ errors: [{ message: 'Not authorized' }] }),
})) as unknown as typeof fetch
assert.equal(await intentar(), 403, 'el token del servidor perdió acceso al tablero')

// --- Sin configurar, cerrado ------------------------------------------------------------------------
limpiarCacheListaBlanca()
responderCon('Activo')
const board = process.env.WHITELIST_BOARD_ID
delete process.env.WHITELIST_BOARD_ID
assert.equal(await intentar(), 403, 'sin WHITELIST_BOARD_ID')
assert.equal(pedidos.length, 0, 'ni siquiera se consulta')
process.env.WHITELIST_BOARD_ID = board

console.log('lista-blanca: OK')

// ── El selector de vendedores sale del MISMO tablero ─────────────────────────────────────────────
/* La lista de quién puede vender y la de quién puede entrar tienen que ser la misma. Antes eran
   dos —el selector salía del equipo "Vendedores" de la cuenta— y nada obligaba a que coincidieran:
   se podía ofrecer como vendedor a alguien que la app rechazaba, y al revés. */

/** Deja a `fetch` devolviendo estas filas del tablero. */
function tableroCon(
  ...filas: { nombre: string; userId: string | null; estado: string | null; apps?: string | null }[]
) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      data: {
        boards: [
          {
            items_page: {
              items: filas.map((f) => ({
                name: f.nombre,
                column_values: [
                  { id: 'text_mm6hqsmt', text: f.userId },
                  { id: 'status', text: f.estado },
                  // Sin apps declaradas se asume la de esta sesión: es el caso normal.
                  { id: 'dropdown_mm6jamkm', text: f.apps ?? APP },
                ],
              })),
            },
          },
        ],
      },
    }),
  })) as unknown as typeof fetch
}

tableroCon(
  { nombre: 'The Automation Partner', userId: '107870718', estado: 'Activo' },
  { nombre: 'Alguien de baja', userId: '222', estado: 'Inactivo' },
  { nombre: 'Fila sin User ID', userId: null, estado: 'Activo' },
  { nombre: 'Fila sin estado', userId: '333', estado: null },
)

const habilitados = await listarHabilitados(sesion)
assert.deepEqual(
  habilitados,
  [{ id: '107870718', nombre: 'The Automation Partner' }],
  'sólo los Activo, y sólo los que tienen User ID cargado',
)

// Una fila activa sin User ID no sirve: no habilita a nadie ni se le puede asentar una venta.
tableroCon({ nombre: 'Sin id', userId: '   ', estado: 'Activo' })
assert.deepEqual(await listarHabilitados(sesion), [], 'una fila sin User ID se descarta')

// Falla cerrada, igual que la validación de acceso.
globalThis.fetch = (async () => {
  throw new Error('ECONNRESET')
}) as unknown as typeof fetch
assert.equal(
  await intentar().catch(() => 403),
  403,
  'si el tablero no se puede leer, no entra nadie',
)
let statusListado: number | 'ok' = 'ok'
try {
  await listarHabilitados(sesion)
} catch (e) {
  assert.ok(e instanceof ErrorAuth)
  statusListado = e.status
}
assert.equal(statusListado, 403, 'y tampoco se inventa una lista de vendedores')

// ── El permiso es POR APP y tiene que ser explícito ─────────────────────────────────────────────
/* Estar activo ya no alcanza. Con dos apps compartiendo esta base, un alta en una abriría la
   puerta de la otra si el vacío significara "todas": el permiso se declara o no existe. */
limpiarCacheListaBlanca()
responderConApps([{ estado: 'Activo', apps: APP }])
assert.equal(await intentar(), 'ok', 'activo y con esta app declarada')

limpiarCacheListaBlanca()
responderConApps([{ estado: 'Activo', apps: null }])
assert.equal(await intentar(), 403, 'activo pero sin ninguna app declarada: no entra')

limpiarCacheListaBlanca()
responderConApps([{ estado: 'Activo', apps: '99999999' }])
assert.equal(await intentar(), 403, 'activo pero habilitado en OTRA app')

limpiarCacheListaBlanca()
responderConApps([{ estado: 'Activo', apps: `99999999, ${APP}` }])
assert.equal(await intentar(), 'ok', 'varias apps en la misma celda')

limpiarCacheListaBlanca()
responderConApps([{ estado: 'Inactivo', apps: APP }])
assert.equal(await intentar(), 403, 'la app declarada no salva a un usuario inactivo')

/* Un id que EMPIEZA igual no es el mismo: la celda se compara etiqueta por etiqueta y no por
   "contiene", que dejaría entrar a `119680921` con el permiso de `11968092`. */
limpiarCacheListaBlanca()
responderConApps([{ estado: 'Activo', apps: `${APP}9` }])
assert.equal(await intentar(), 403, 'un id que empieza igual no habilita')

// El selector de vendedores ofrece sólo a los habilitados EN ESTA app.
tableroCon(
  { nombre: 'De esta app', userId: '1', estado: 'Activo', apps: APP },
  { nombre: 'De la otra', userId: '2', estado: 'Activo', apps: '99999999' },
)
assert.deepEqual(
  await listarHabilitados(sesion),
  [{ id: '1', nombre: 'De esta app' }],
  'el selector no puede ofrecer a alguien que en esta app no existe',
)

console.log('lista-blanca (permiso por app): OK')
