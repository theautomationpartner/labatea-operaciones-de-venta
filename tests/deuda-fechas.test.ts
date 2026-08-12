/**
 * Deuda del cobro POSTERIOR en "💰Fact Vtas Pends de Cobro" (18421035508): además de la venta, el
 * cliente y el importe, declara la emisión y el vencimiento de la factura que la dejó.
 *
 * Se corre contra el servicio real con `fetch` interceptado: lo que se verifica es exactamente el
 * payload que sale hacia Monday.
 *
 *   npm run test:deuda-fechas
 */
import assert from 'node:assert/strict'
import { registrarDeudaPosterior } from '@/services/monday/cobrar'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const llamadas: Llamada[] = []

/* Dos requests: la lectura del "🤖ID VTA" del ítem ya creado y la creación de la deuda. El ID se
   devuelve al primer intento, así que no entra el reintento con espera. */
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query, variables } = JSON.parse(init.body) as Llamada
  llamadas.push({ query, variables })
  const data = query.includes('create_item')
    ? { create_item: { id: '777' } }
    : { items: [{ column_values: [{ id: 'pulse', text: 'VTA-070' }] }] }
  return { ok: true, json: async () => ({ data }) }
}) as unknown as typeof fetch

await registrarDeudaPosterior({
  ventaId: '4242',
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  total: 300000,
  fechaEmision: '11/08/2026',
  // Cuenta corriente a 30 días: es el mismo vencimiento que declara el comprobante.
  vencimiento: '10/09/2026',
})

const creacion = llamadas.find((l) => l.query.includes('create_item'))
assert.ok(creacion, 'se creó la deuda')
const cv = JSON.parse(creacion.variables.cv as string) as Record<string, unknown>

assert.deepEqual(cv['date_mm648d33'], { date: '2026-08-11' }, '"🤖Fecha Emision" en ISO')
assert.deepEqual(cv['date_mm647vwr'], { date: '2026-09-10' }, '"🤖Fecha Vto" en ISO')
// Lo que ya se escribía sigue igual.
assert.equal(creacion.variables.name, 'VTA-070 - AGRO LUCIA S.A.')
assert.deepEqual(cv['board_relation_mm4d3nn0'], { item_ids: [4242] }, 'la venta que dejó la deuda')
assert.deepEqual(cv['board_relation_mm5zaxck'], { item_ids: [111] }, 'quién queda debiendo')
assert.equal(cv['numeric_mkwbck5d'], '300000')
assert.deepEqual(cv['color_mkwb727e'], { index: 2 }, 'nace pendiente de cobro al 100%')

/* Sin fechas (o con una fecha inválida) las columnas se OMITEN: no se manda una date vacía. */
llamadas.length = 0
await registrarDeudaPosterior({
  ventaId: '4242',
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  total: 300000,
})
const sinFechas = JSON.parse(
  llamadas.find((l) => l.query.includes('create_item'))!.variables.cv as string,
) as Record<string, unknown>
assert.ok(!('date_mm648d33' in sinFechas), 'sin emisión la columna no viaja')
assert.ok(!('date_mm647vwr' in sinFechas), 'sin vencimiento la columna no viaja')

console.log('OK · fechas de la deuda pendiente de cobro')
