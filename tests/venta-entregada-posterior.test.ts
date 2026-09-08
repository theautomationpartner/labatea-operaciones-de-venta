/**
 * "🤖Cant Entregada Posterior" (numeric_mm54v0jd) nace en CERO en cada línea de una venta con
 * entrega POSTERIOR.
 *
 * Es la columna que van sumando los remitos a medida que la mercadería sale. Dejarla vacía al
 * crear la venta no es lo mismo que dejarla en cero: en blanco parece que el dato falta, no que
 * todavía no se entregó nada, y cualquier fórmula o mirror que la lea arranca sin un número.
 *
 * Se afirma sobre el PAYLOAD que sale hacia Monday —interceptando el `fetch`, que es la única
 * salida de `mondayApi`— porque es lo único que prueba qué se escribió: la columna se arma dentro
 * de un `Record<string, unknown>` que el typecheck no mira, y un cero que se deja de mandar no
 * rompe absolutamente nada visible.
 *
 * Se corre con esbuild + node (`npm run test:venta-entregada`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { crearVenta, type LineaVenta } from '@/services/monday/venta'
import { COL } from '@/services/monday/columns'
import type { TipoEntrega } from '@/types'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const CANTIDADES = [3, 7]
const lineas = (): LineaVenta[] =>
  CANTIDADES.map((cantidad, i) => ({
    nombre: `PRODUCTO ${i + 1}`,
    cantidad,
    precioUnitario: 1000,
    descuento: 0,
    rentabilidad: 30,
    iva: 21,
  })) as unknown as LineaVenta[]

/** Columnas de los subelementos de la VENTA que salieron en una corrida. */
async function columnasDeLaVenta(tipoEntrega: TipoEntrega): Promise<Record<string, unknown>[]> {
  const llamadas: Llamada[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as Llamada
    llamadas.push({ query, variables })
    const data: Record<string, unknown> = {}
    if (query.includes('settings_str')) {
      const vacio = [{ columns: [{ settings_str: '{"labels":{"0":"Venta Simultanea"}}' }] }]
      data.boards = vacio
      data.item = vacio
      data.sub = vacio
    }
    if (query.includes('create_item')) data.create_item = { id: '999' }
    if (query.includes(COL.venta.idVta) && query.includes('items(ids:')) {
      data.items = [{ column_values: [{ id: COL.venta.idVta, text: 'VTA-999' }] }]
    }
    for (const alias of query.matchAll(/(\w+): create_subitem/g)) data[alias[1]] = { id: '1' }
    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch

  await crearVenta({
    clienteId: '1',
    vendedorId: null,
    nombre: 'Cliente',
    tipoVenta: 'DIRECTA',
    tipoEntrega,
    tipoPago: 'SIMULTANEO',
    rentabilidad: 30,
    lineas: lineas(),
  } as never)

  /* Los subelementos de la VENTA son los que llevan la cantidad vendida; los del STOCK cuelgan de
     otro board y se reconocen porque su padre es un `stockId`. Acá no hay ninguno —las líneas no
     traen `stockId`—, así que alcanza con tomar la tanda de subelementos. */
  const tanda = llamadas.find((l) => l.query.includes('create_subitem'))
  assert.ok(tanda, 'la venta no creó subelementos')
  return Object.entries(tanda!.variables)
    .filter(([k]) => /^cv\d+$/.test(k))
    .map(([, v]) => JSON.parse(v as string) as Record<string, unknown>)
}

const COLUMNA = COL.ventaSub.cantEntregadaPosterior
assert.equal(COLUMNA, 'numeric_mm54v0jd', '"🤖Cant Entregada Posterior" del board de subelementos')

/* ---------- POSTERIOR: cada línea nace con CERO entregado ---------- */
const posterior = await columnasDeLaVenta('POSTERIOR')
assert.equal(posterior.length, CANTIDADES.length, 'un subelemento por línea')
for (const cv of posterior) {
  assert.ok(COLUMNA in cv, 'la columna se manda: vacía no es lo mismo que en cero')
  assert.equal(cv[COLUMNA], '0', 'y nace en cero, no con lo vendido')
}

/* ---------- Las otras dos entregas NO la tocan ----------
   Cada tipo de entrega asienta lo suyo en SU columna. Escribir un cero en las tres convertiría a
   "Cant Entregada Posterior" en una columna que siempre tiene valor, y dejaría de distinguir a la
   venta que espera remitos de la que ya entregó todo. */
for (const tipo of ['SIMULTANEA', 'ANTERIOR'] as const) {
  for (const cv of await columnasDeLaVenta(tipo)) {
    assert.ok(!(COLUMNA in cv), `la entrega ${tipo} no escribe la cantidad entregada POSTERIOR`)
  }
}

/* Y cada una sí llena la suya, con lo vendido: es el contraste que le da sentido al cero de arriba. */
const simultanea = await columnasDeLaVenta('SIMULTANEA')
assert.equal(
  simultanea[0][COL.ventaSub.cantEntregadaSimult],
  String(CANTIDADES[0]),
  'la entrega SIMULTÁNEA asienta lo vendido como entregado en el acto',
)
const anterior = await columnasDeLaVenta('ANTERIOR')
assert.equal(
  anterior[0][COL.ventaSub.cantEntregadaAnterior],
  String(CANTIDADES[0]),
  'y la ANTERIOR, como entregado antes de facturar',
)

console.log('OK · la venta con entrega POSTERIOR nace con "Cant Entregada Posterior" en cero')
