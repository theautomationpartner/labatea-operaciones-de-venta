/**
 * La VERSIÓN de un caché no puede perder precisión, o la fila más nueva no llega nunca.
 *
 * El bug, medido contra la base real: `personas_cache.actualizado_en` de un cliente valía
 * `2026-09-23 10:56:29.463732+00`. La versión se leía como `Date` de JavaScript —que sólo llega al
 * milisegundo— y volvía como `10:56:29.463`. Como las filas se acotan con
 * `actualizado_en <= version`, **esa fila quedaba afuera de su propia versión** por 732
 * microsegundos.
 *
 * Y no es un caso de laboratorio: la fila con el `actualizado_en` más alto es, por definición, la
 * última que se modificó —justo el cliente que alguien acaba de tocar en Monday y sale a buscar—.
 * Tampoco se recuperaba sola: ninguna corrida posterior mueve `actualizado_en` si los datos no
 * cambian, así que ese cliente no aparecía en el buscador NUNCA. Y en pantalla se veía igual que
 * "ese cliente no existe".
 *
 * Por eso este test corre contra un Postgres de verdad (PGlite): el redondeo ocurre en el driver,
 * no en nuestro código, así que con datos simulados no se reproduciría.
 *
 *   npm run test:version-cache
 */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { VERSION_CACHE } from '../api/_db'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const db = new PGlite()
await db.exec(`create table cache (
  item_id text primary key,
  actualizado_en timestamptz not null
)`)

/* Los microsegundos son los de la fila real que no aparecía. */
const MICRO = '2026-09-23 10:56:29.463732+00'
await db.exec(`insert into cache values
  ('vieja-1', '2026-09-23 09:00:00.000000+00'),
  ('vieja-2', '2026-09-23 09:30:00.111111+00'),
  ('la-mas-nueva', '${MICRO}')`)

const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[]

console.log('Caso 1 · Leer la versión como fecha PIERDE microsegundos:')

const comoFecha = (await q<{ v: Date }>('select max(actualizado_en) as v from cache'))[0].v
ok('el driver la entrega como Date', comoFecha instanceof Date)
ok(
  'y al volver a texto se pierden los microsegundos',
  comoFecha.toISOString() === '2026-09-23T10:56:29.463Z',
)

const conFecha = await q<{ item_id: string }>(
  'select item_id from cache where actualizado_en <= $1::timestamptz',
  [comoFecha.toISOString()],
)
ok(
  'y la fila que PRODUJO el máximo queda afuera de su propia versión',
  !conFecha.some((r) => r.item_id === 'la-mas-nueva'),
)

console.log('\nCaso 2 · Con VERSION_CACHE, la precisión se conserva:')

const version = (await q<{ v: string | null }>(`select ${VERSION_CACHE} as v from cache`))[0].v
ok('la versión viene como texto, no como fecha', typeof version === 'string')
ok('con los microsegundos completos', (version ?? '').includes('463732'))
/* Con el huso explícito, para que no dependa de la zona horaria del servidor. */
ok('y con el huso explícito', /[+-]\d{2}:?\d{2}$/.test(version ?? ''))

const conTexto = await q<{ item_id: string }>(
  'select item_id from cache where actualizado_en <= $1::timestamptz',
  [version],
)
ok('ahora sí entran las tres filas', conTexto.length === 3)
ok(
  'incluida la más nueva, que es la que el usuario busca',
  conTexto.some((r) => r.item_id === 'la-mas-nueva'),
)

console.log('\nCaso 3 · Y sirve como cursor: el delta siguiente no la repite ni la pierde:')

const delta = await q<{ item_id: string }>(
  'select item_id from cache where actualizado_en > $1::timestamptz',
  [version],
)
ok('pedir el delta desde esa versión no devuelve nada', delta.length === 0)

await db.exec(`insert into cache values ('nueva', '2026-09-23 11:00:00.999999+00')`)
const delta2 = await q<{ item_id: string }>(
  'select item_id from cache where actualizado_en > $1::timestamptz',
  [version],
)
ok('y una fila posterior sí viaja en el delta', delta2.length === 1 && delta2[0].item_id === 'nueva')

/* La versión nueva tiene que incluirla, o volveríamos al mismo agujero. */
const version2 = (await q<{ v: string | null }>(`select ${VERSION_CACHE} as v from cache`))[0].v
const conVersion2 = await q<{ item_id: string }>(
  'select item_id from cache where actualizado_en <= $1::timestamptz',
  [version2],
)
ok('y la versión nueva la incluye', conVersion2.some((r) => r.item_id === 'nueva'))

console.log(`\n${asserts} verificaciones OK · la fila más nueva llega al navegador`)
