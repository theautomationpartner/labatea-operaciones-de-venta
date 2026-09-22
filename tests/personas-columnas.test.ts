/**
 * El padrón del SERVIDOR y el de la APP tienen que leer las mismas columnas y armar el mismo
 * cliente.
 *
 * Por qué existe este test: `api/` es autocontenido —`scripts/verificar-funciones.mjs` lo compila
 * con `tsconfig.api.json` para reproducir lo que hace Vercel, y un import que cruce a `src/` le
 * mueve el árbol de salida—, así que los ids de columna viven en DOS lugares: `api/_padron.ts` y
 * `src/services/monday/columns.ts`. Ese es el precio de la decisión, y este test es la forma de
 * pagarlo: la divergencia rompe acá, no en producción.
 *
 * El daño que evita no es abstracto. Si el cron leyera `limite` de una columna que ya no es esa, el
 * padrón se llenaría de clientes con límite 0 y crédito disponible 0, y toda venta a cuenta
 * corriente quedaría frenada sin que nada pareciera roto: el cron seguiría diciendo OK.
 *
 * Se corre con `npm run test:personas-columnas`; vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  CATEGORIA_CLIENTE_INDEX as CAT_API,
  CLIENTE_ACTIVO_INDEX as ACTIVO_API,
  COL_CLIENTE,
  COL_CTA_CTE,
  SITUACION_CLIENTE_INDEX as SIT_API,
  CATEGORIA_PROVEEDOR_INDEX as PROV_API,
  categoriasDe,
  esOperable,
  mapPersonaCache,
  type ItemMonday,
} from '../api/_padron'
import {
  CATEGORIA_CLIENTE_INDEX,
  CLIENTE_ACTIVO_INDEX,
  COL,
  SITUACION_CLIENTE_INDEX,
} from '@/services/monday/columns'
import { buscarClientes } from '@/services/monday/presupuestar'
import type { Cliente } from '@/types'

/* ---------- 1) Los ids de columna son los mismos ---------- */

assert.deepEqual(
  { ...COL_CLIENTE },
  { ...COL.cliente },
  'los ids de columna del cliente del servidor (api/_padron.ts) se fueron de los de la app ' +
    '(src/services/monday/columns.ts)',
)

assert.deepEqual(
  { ...COL_CTA_CTE },
  { ...COL.ctaCte },
  'los ids de columna de la cta cte del servidor se fueron de los de la app',
)

/* ---------- 2) Y los índices de etiqueta también ---------- */

assert.equal(ACTIVO_API, CLIENTE_ACTIVO_INDEX, 'el índice de "Activo" difiere entre servidor y app')
assert.equal(
  CAT_API,
  CATEGORIA_CLIENTE_INDEX,
  'el índice de la categoría "Clientes" difiere entre servidor y app',
)
assert.deepEqual(
  { ...SIT_API },
  { ...SITUACION_CLIENTE_INDEX },
  'los índices de situación del cliente difieren entre servidor y app',
)

/* ---------- 3) Los dos mapeadores arman el MISMO cliente ---------- */

/**
 * Un ítem con datos en todas las columnas que importan, incluida una cta cte con mirrors de VARIOS
 * movimientos: es el caso donde los dos lados pueden discrepar de verdad, porque el
 * `display_value` llega como lista ("541112.91, 635183.15") y hay que sumarlo, no leerlo como un
 * número suelto.
 */
const ITEM: ItemMonday = {
  id: '12736724196',
  name: '7000 - The Automation Partner S.A',
  updated_at: '2026-09-21T19:24:08Z',
  column_values: [
    { id: COL_CLIENTE.categoria, text: 'Clientes', values: [{ id: '1' }] },
    { id: COL_CLIENTE.codigo, text: '7000' },
    { id: COL_CLIENTE.cuit, text: '30-70906788-1' },
    { id: COL_CLIENTE.dirFiscal, text: 'Av. Siempre Viva 742' },
    { id: COL_CLIENTE.tipoPersona, text: 'Persona Jurídica' },
    { id: COL_CLIENTE.condFiscal, text: 'Responsable Inscripto' },
    { id: COL_CLIENTE.listaPrecio, text: 'L8' },
    { id: COL_CLIENTE.agenteRet, text: 'IIBB' },
    { id: COL_CLIENTE.situacion, text: 'Liberado Con Credito', index: 0 },
    { id: COL_CLIENTE.estado, text: 'Activo', index: 1 },
    { id: COL_CLIENTE.condPago, text: 'CUENTA CORRIENTE' },
    { id: COL_CLIENTE.aceptaCheques, text: 'SI' },
    { id: COL_CLIENTE.limite, text: '1000000' },
    {
      id: COL_CLIENTE.ctaCte,
      text: null,
      linked_items: [
        {
          id: '12736724196',
          name: 'The Automation Partner S.A',
          column_values: [
            // Mirror de varios movimientos: llega como lista y se SUMA. Total: 1945475.42
            {
              id: COL_CTA_CTE.totalVentas,
              text: null,
              display_value: '541112.91, 635183.15, 169179.36, 600000',
            },
            // Total: 1280000
            {
              id: COL_CTA_CTE.totalCobros,
              text: null,
              display_value: '200000, 180000, 600000, 100000, 100000, 100000',
            },
            { id: COL_CTA_CTE.remitosPendFacturar, text: '286621.81' },
            // Mirror de UN valor: va sin sumar, o duplicaría la línea de crédito.
            { id: COL_CTA_CTE.limite, text: null, display_value: '3500000' },
          ],
        },
      ],
    },
    { id: COL_CLIENTE.contactos, text: '' },
  ],
}

const delServidor = mapPersonaCache(ITEM)

/* El mapeador de la app (`mapCliente`) no está exportado: se lo alcanza por `buscarClientes`,
   interceptando el `fetch` para devolverle este mismo ítem como si viniera de Monday. Es la única
   forma de comparar los DOS caminos reales en vez de una copia del de acá. */
globalThis.fetch = (async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: { q0: [{ items_page: { cursor: null, items: [ITEM] } }] },
  }),
})) as unknown as typeof fetch

const { personas } = await buscarClientes('7000')
assert.equal(personas.length, 1, 'la app tendría que haber mapeado el ítem de prueba')
const deLaApp: Cliente = personas[0]

/* `categorias` se compara aparte: es el ÚNICO campo que el registro del padrón tiene de más. El
   mapeador de la app no lo produce —no lo necesita, porque lo que llega por una búsqueda directa
   ya se sabe que es un cliente— así que compararlo acá haría fallar la paridad por un campo que
   se agregó a propósito. Todo lo demás tiene que coincidir exactamente. */
const { categorias, ...delServidorComoCliente } = delServidor

assert.deepEqual(
  { ...delServidorComoCliente },
  { ...deLaApp },
  'el cliente que arma el cron no es el mismo que arma la app sobre el MISMO ítem de Monday',
)
assert.deepEqual(categorias, ['cliente'], 'y el registro del padrón dice qué es esa persona')

/* Y los números del crédito son los que se esperan, para que el test falle con un mensaje útil
   si alguno de los dos lados cambia la fórmula (y no sólo "son distintos"). */
assert.equal(delServidor.saldoCtaCte, 1945475.42 - 1280000, 'saldo = ventas − cobros')
assert.equal(delServidor.limit, 3500000, 'el límite sale de la mirror de la cuenta, sin sumarse')
assert.equal(
  delServidor.disponible,
  3500000 - (1945475.42 - 1280000 + 286621.81),
  'disponible = límite − (saldo + remitos pendientes de facturar)',
)

/* ---------- 4) Quién entra al padrón: por índice de etiqueta, no por texto ---------- */

/** El mismo ítem con otra categoría. Las etiquetas reales del board van con su id. */
const conCategoria = (texto: string, ...ids: string[]): ItemMonday => ({
  ...ITEM,
  column_values: ITEM.column_values.map((c) =>
    c.id === COL_CLIENTE.categoria ? { ...c, text: texto, values: ids.map((id) => ({ id })) } : c,
  ),
})

assert.ok(esOperable(ITEM), 'un cliente activo es operable')
assert.deepEqual(categoriasDe(ITEM), ['cliente'])

const inactivo: ItemMonday = {
  ...ITEM,
  column_values: ITEM.column_values.map((c) =>
    c.id === COL_CLIENTE.estado ? { ...c, text: 'Inactivo', index: 2 } : c,
  ),
}
assert.ok(!esOperable(inactivo), 'una persona INACTIVA no entra, sea cliente o proveedor')

/* Los proveedores AHORA entran: el padrón dejó de ser sólo de clientes. */
const proveedor = conCategoria('Proveedores', '2')
assert.ok(esOperable(proveedor), 'un proveedor activo entra al padrón')
assert.deepEqual(categoriasDe(proveedor), ['proveedor'], 'y queda marcado como proveedor')

/* La categoría es MULTI-VALOR y el solapamiento es real: hay una persona que es las dos cosas.
   Tiene que quedar en las DOS listas, no en la primera que matchee. */
const ambas = conCategoria('Clientes, Proveedores', '1', '2')
assert.ok(esOperable(ambas))
assert.deepEqual(
  categoriasDe(ambas),
  ['cliente', 'proveedor'],
  'quien es cliente Y proveedor tiene que quedar en las dos listas: guardar una sola lo dejaría ' +
    'afuera de la otra y nadie se enteraría hasta no encontrarlo',
)

/* Las otras cuatro etiquetas REALES del board (3 Transporte, 6 Comisionistas, 8 Terceros,
   9 Vendedores) no entran. Sin esta comprobación, ampliar la regla a [1, 2] podría convertirse
   mañana en "entran todos" sin que nada lo frene. */
for (const [nombre, id] of [
  ['Transporte', '3'],
  ['Comisionistas', '6'],
  ['Terceros', '8'],
  ['Vendedores', '9'],
] as const) {
  const otra = conCategoria(nombre, id)
  assert.ok(!esOperable(otra), `${nombre} no entra al padrón`)
  assert.deepEqual(categoriasDe(otra), [], `y no tiene ninguna categoría del padrón`)
}

/* Sin categoría cargada tampoco entra: el vacío no puede significar "es cliente". */
assert.ok(!esOperable(conCategoria('')), 'sin categoría no se asume ninguna')

/* Renombrar la etiqueta en el board no puede vaciar el padrón: se compara por id, no por texto. */
const renombrada: ItemMonday = {
  ...ITEM,
  column_values: ITEM.column_values.map((c) =>
    c.id === COL_CLIENTE.categoria ? { ...c, text: 'Clientes Mayoristas', values: [{ id: '1' }] } : c,
  ),
}
assert.ok(esOperable(renombrada), 'la etiqueta renombrada sigue siendo la misma categoría')

/* El índice de proveedor también es un espejo: si el board reordena las etiquetas, esto se entera. */
assert.equal(PROV_API, 2, 'el índice de la categoría "Proveedores" es el 2 del board real')

console.log('personas/columnas: OK · servidor y app leen y arman lo mismo, y sólo entran clientes y proveedores')
