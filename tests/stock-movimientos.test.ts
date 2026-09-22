/**
 * "Ingreso Total" y "Egreso Total" se piden SÓLO en la devolución.
 *
 * Las dos son MIRRORS de los subelementos de movimiento, y evaluarlas le cuesta a Monday ~700 ms
 * fijos. Medido sobre 15 ítems, mediana de 5 corridas:
 *
 *   piso de red (sin columnas) .............  597 ms
 *   las 5 de siempre (number + fórmula) ..... 1390 ms
 *   las 7, con las dos mirrors .............. 2059 ms
 *
 * Presupuesto, venta y remito de entrega no las usan: el panel de stock sólo muestra "Ingresos" en
 * modo ingreso, y `stockConIngreso` es la única función que las lee. Pedirlas ahí son 700 ms
 * regalados en la etapa más tipeada de la app.
 *
 * Este test existe porque el desperdicio sería INVISIBLE: agregarlas de vuelta no rompe nada, no
 * cambia ningún número en pantalla y nadie se entera hasta que alguien vuelva a cronometrar. Lo
 * único que pasa es que cada selección de producto tarda el doble.
 *
 *   npm run test:stock-movimientos
 */
import assert from 'node:assert/strict'
import { buscarProductos, siguientePaginaProductos } from '@/services/monday/presupuestar'
import { leerStock } from '@/services/monday/catalogoProductos'
import { COL } from '@/services/monday/columns'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/** Las cinco que se piden SIEMPRE: dos `number` y tres fórmulas. Ninguna es mirror. */
const SIEMPRE = [
  COL.stockItem.pendEntregaVta,
  COL.stockItem.pendRecepcionCompra,
  COL.stockItem.fisico,
  COL.stockItem.comercial,
  COL.stockItem.disponible,
]
/** Las dos caras, reservadas a la devolución. */
const MOVIMIENTOS = [COL.stockItem.ingresos, COL.stockItem.egresos]

/**
 * Corre `fn` interceptando `fetch` y devuelve la ÚLTIMA query que salió.
 *
 * La última y no la primera porque `buscarProductos` dispara dos pedidos la primera vez: la
 * taxonomía de los dropdowns (que se cachea por sesión) y recién después la de productos. La que
 * interesa es siempre la segunda.
 *
 * Va de a una: si dos de estas corrieran en paralelo se pisarían el `globalThis.fetch` entre ellas.
 */
async function queryDe(fn: () => Promise<unknown>): Promise<string> {
  const original = globalThis.fetch
  const queries: string[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const query = (JSON.parse(init.body) as { query: string }).query
    queries.push(query)
    /* Una sola respuesta que sirve para las cuatro formas que se piden acá. Devolver de más no
       molesta: cada llamador lee sólo la rama que le corresponde. */
    return {
      ok: true,
      json: async () => ({
        data: {
          boards: [{ columns: [], items_page: { cursor: null, items: [] } }],
          next_items_page: { cursor: null, items: [] },
          items: [],
        },
      }),
    }
  }) as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
  return queries[queries.length - 1] ?? ''
}

const casos: { nombre: string; correr: () => Promise<unknown>; movimientos: boolean }[] = [
  {
    nombre: 'buscarProductos (presupuesto / venta / remito)',
    correr: () => buscarProductos('acarox', 'L1', false),
    movimientos: false,
  },
  {
    nombre: 'buscarProductos con movimientos (devolución)',
    correr: () => buscarProductos('acarox', 'L1', false, [], true),
    movimientos: true,
  },
  {
    nombre: 'siguientePaginaProductos',
    correr: () => siguientePaginaProductos('c', 'L1', false),
    movimientos: false,
  },
  {
    nombre: 'siguientePaginaProductos con movimientos',
    correr: () => siguientePaginaProductos('c', 'L1', false, true),
    movimientos: true,
  },
  {
    nombre: 'leerStock al elegir del caché',
    correr: () => leerStock(['1']),
    movimientos: false,
  },
  {
    nombre: 'leerStock con movimientos',
    correr: () => leerStock(['1'], true),
    movimientos: true,
  },
]

/* Secuencial y no en paralelo: cada caso reemplaza el `fetch` global mientras corre. */
const queries: string[] = []
for (const caso of casos) queries.push(await queryDe(caso.correr))

console.log('Las cinco cantidades baratas van SIEMPRE:')
casos.forEach((caso, i) => {
  const faltan = SIEMPRE.filter((c) => !queries[i].includes(c))
  ok(`${caso.nombre}: están las 5`, faltan.length === 0)
})

console.log('\nLas dos mirrors van SÓLO en la devolución:')
casos.forEach((caso, i) => {
  const presentes = MOVIMIENTOS.filter((c) => queries[i].includes(c))
  if (caso.movimientos) {
    ok(`${caso.nombre}: pide Ingreso y Egreso Total`, presentes.length === 2)
  } else {
    /* Si esto rompe, alguien volvió a meter las mirrors en el camino caliente. No es un bug
       funcional: es el doble de espera en cada selección de producto. */
    ok(`${caso.nombre}: NO las pide`, presentes.length === 0)
  }
})

console.log(`\n${asserts} verificaciones OK`)
