/**
 * El código de cliente y el CUIT se buscan EXACTO; la razón social, por subcadena.
 *
 * Con `contains_text` en las tres columnas, buscar el código "7001" devolvía DOS clientes: el 7001
 * y el 2385, cuyo CUIT (30619677001) termina en 7001. Ofrecer dos cuando se escribió un
 * identificador no es una molestia: el buscador auto-carga al cliente cuando hay una sola
 * coincidencia, así que la de más convierte una selección automática en una lista donde se puede
 * elegir al que no era —y de ahí sale una venta facturada a otro—.
 *
 * Nada más lo mira: el operador vive dentro de un string de GraphQL, así que cambiarlo no rompe el
 * typecheck ni ningún otro test, y el resultado sólo se ve consultando el tablero real. Por eso
 * este test intercepta el `fetch` y afirma sobre la QUERY que sale.
 *
 * Se corre con esbuild + node (`npm run test:busqueda-cliente`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { buscarClientes } from '@/services/monday/presupuestar'
import { COL } from '@/services/monday/columns'

let query = ''
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  query = (JSON.parse(init.body) as { query: string }).query
  return { ok: true, json: async () => ({ data: {} }) }
}) as unknown as typeof fetch

/**
 * La regla de UNA columna dentro de la query: sus valores y con qué operador se comparan.
 * Se parsea a mano y no con una expresión regular: la query es un template de GraphQL con llaves
 * y corchetes por todos lados, y un patrón que los cubra se vuelve ilegible mucho antes que este
 * puñado de `indexOf`.
 */
function regla(columna: string): { valores: string[]; operador: string } {
  const inicio = query.indexOf(`{column_id: "${columna}", compare_value: [`)
  assert.ok(inicio >= 0, `la query no consulta la columna ${columna}`)
  const desde = query.indexOf('[', inicio)
  const hasta = query.indexOf(']', desde)
  const crudos = query.slice(desde + 1, hasta)
  const resto = query.slice(hasta)
  const marca = 'operator: '
  const op = resto.slice(resto.indexOf(marca) + marca.length)
  return {
    valores: crudos
      .split(',')
      .map((v) => v.trim().replace(/^"|"$/g, ''))
      .filter(Boolean),
    operador: op.slice(0, op.indexOf('}')).trim(),
  }
}

/* ---------- 1) Un término numérico: código Y CUIT, los dos EXACTOS ---------- */
await buscarClientes('7001')

const codigo = regla(COL.cliente.codigo)
const cuit = regla(COL.cliente.cuit)
assert.equal(codigo.operador, 'any_of', 'el código de cliente se compara exacto')
assert.equal(cuit.operador, 'any_of', 'y el CUIT también')
assert.ok(
  !query.includes('contains_text'),
  'una búsqueda numérica no puede usar subcadena en ninguna columna: es lo que traía al 2385 ' +
    'cuando se buscaba el 7001',
)
assert.deepEqual(codigo.valores, ['7001'], 'el código, tal como se escribió')

/* ---------- 2) El CUIT se pregunta en SUS DOS FORMATOS ----------
   En el tablero conviven "30-70906788-1" y "30709067881". Con la comparación exacta, preguntar por
   uno solo pierde a todos los que estén cargados en el otro. */
await buscarClientes('30-70906788-1')
const conGuiones = regla(COL.cliente.cuit).valores
assert.ok(conGuiones.includes('30709067881'), 'los dígitos pelados')
assert.ok(conGuiones.includes('30-70906788-1'), 'y el formato con guiones')

await buscarClientes('30709067881')
const sinGuiones = regla(COL.cliente.cuit).valores
assert.ok(sinGuiones.includes('30709067881'), 'escrito sin guiones, los dígitos')
assert.ok(
  sinGuiones.includes('30-70906788-1'),
  'y IGUAL el formato con guiones: da lo mismo cómo lo tipeó el vendedor',
)

/* Un número que no llega a once dígitos es un código, no un CUIT: no se le inventa el formato. */
await buscarClientes('7001')
assert.ok(
  !regla(COL.cliente.cuit).valores.some((v) => v.includes('-')),
  'a un código corto no se le arma un CUIT con guiones',
)

/* ---------- 3) La razón social SÍ se busca por subcadena ----------
   Es la contracara: escribir un pedazo del nombre es la forma normal de llegar a un cliente. */
await buscarClientes('BATEA')
const nombre = regla('name')
assert.equal(nombre.operador, 'contains_text', 'el nombre se busca por pedazos')
assert.deepEqual(nombre.valores, ['BATEA'])
/* Y no FILTRA por las columnas de identificador: un nombre no es un código ni un CUIT. Se mira que
   no haya una REGLA sobre ellas —la query igual las nombra, porque el código y el CUIT son campos
   que el cliente devuelve—. */
for (const col of [COL.cliente.codigo, COL.cliente.cuit]) {
  assert.ok(
    !query.includes(`{column_id: "${col}", compare_value: [`),
    'la búsqueda por nombre no filtra por identificador',
  )
}

console.log('OK · código y CUIT exactos (CUIT en sus dos formatos), razón social por subcadena')
