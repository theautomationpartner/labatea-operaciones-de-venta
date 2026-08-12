/**
 * Vínculo factura → venta: una vez creada la venta (18421035510), cada comprobante ya emitido en
 * Facturación (18422405731) queda colgado de ella por "📈Ventas" (board_relation_mm5bve7q).
 *
 * Es un paso propio y no parte de la creación del comprobante: las facturas se emiten ANTES de que
 * la venta exista, así que al crearlas no hay id de venta que asignarles.
 *
 * Se corre contra el servicio real con `fetch` interceptado: lo que se verifica es exactamente el
 * payload que sale hacia Monday.
 *
 *   npm run test:factura-venta-vinculo
 */
import assert from 'node:assert/strict'
import { vincularVentaAComprobantes } from '@/services/monday/facturacion'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const llamadas: Llamada[] = []

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query, variables } = JSON.parse(init.body) as Llamada
  llamadas.push({ query, variables })
  const alias = [...query.matchAll(/(v\d+): change_multiple_column_values/g)].map((m) => m[1])
  return {
    ok: true,
    json: async () => ({ data: Object.fromEntries(alias.map((a) => [a, { id: '1' }])) }),
  }
}) as unknown as typeof fetch

/* División de mercadería: la venta emitió TRES comprobantes (el común y dos consignados). Los tres
   se enlazan a la MISMA venta, en una sola solicitud. */
await vincularVentaAComprobantes('4242', ['5001', '5002', '5003'])

assert.equal(llamadas.length, 1, 'los comprobantes van en una sola solicitud, con alias')
const { query, variables } = llamadas[0]
assert.equal(
  query.match(/change_multiple_column_values/g)?.length,
  3,
  'un update por comprobante emitido',
)
assert.equal(variables.board, 18422405731, 'se escribe sobre el board de Facturación')
assert.deepEqual(
  JSON.parse(variables.cv as string),
  { board_relation_mm5bve7q: { item_ids: [4242] } },
  'la columna "📈Ventas" del comprobante apunta al ítem de la venta',
)
// El valor es el mismo para los tres, así que viaja una sola vez y cada alias sólo lleva su ítem.
assert.equal(variables.item0, '5001')
assert.equal(variables.item1, '5002')
assert.equal(variables.item2, '5003')

/* Sin nada que enlazar no se manda ninguna solicitud: ni sin comprobantes, ni con una venta que
   no es un id válido, ni con ids de comprobante basura. */
for (const [venta, ids, caso] of [
  ['4242', [], 'sin comprobantes emitidos'],
  ['', ['5001'], 'sin id de venta'],
  ['mock-venta-1', ['5001'], 'con un id de venta simulado'],
  ['4242', ['', 'x'], 'con ids de comprobante inválidos'],
] as const) {
  llamadas.length = 0
  await vincularVentaAComprobantes(venta, [...ids])
  assert.equal(llamadas.length, 0, `${caso}: no se escribe nada`)
}

console.log('OK · las facturas emitidas quedan enlazadas a su venta')
