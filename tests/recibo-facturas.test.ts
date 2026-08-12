/**
 * Recibo del cobro SIMULTÁNEO: las facturas canceladas entran como subelementos ANTES que las
 * formas de pago, y la cabecera ya no manda las relaciones que el board eliminó.
 *
 * Se corre contra el servicio real con `fetch` interceptado: lo que se verifica es exactamente el
 * payload que sale hacia Monday.
 *
 *   npm run test:recibo-facturas
 */
import assert from 'node:assert/strict'
import { SIN_DESCUENTOS_PAGO, balancePagos } from '@/lib/cobros'
import { registrarCobro } from '@/services/monday/cobrar'
import type { MovimientoPago } from '@/types'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const llamadas: Llamada[] = []

/* Cada `create_subitem` devuelve un id por alias, para que el servicio pueda seguir. Ninguno de los
   movimientos de este test adjunta archivo, así que no hay subidas multipart. */
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query, variables } = JSON.parse(init.body) as Llamada
  llamadas.push({ query, variables })
  const alias = [...query.matchAll(/(m\d+): create_subitem/g)].map((m) => m[1])
  const data = alias.length
    ? Object.fromEntries(alias.map((a, i) => [a, { id: `${900 + i}` }]))
    : { create_item: { id: '123' } }
  return { ok: true, json: async () => ({ data }) }
}) as unknown as typeof fetch

const movimiento = (formaPago: MovimientoPago['formaPago'], importe: number): MovimientoPago =>
  ({ formaPago, importe }) as MovimientoPago

await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  vendedorId: null,
  totalVenta: 300000,
  totalCobrado: 300000,
  // División de mercadería: la venta emitió DOS comprobantes.
  facturas: [
    { facturaId: '5001', importe: 200000 },
    { facturaId: '5002', importe: 100000 },
  ],
  balances: balancePagos(
    [movimiento('Efectivo', 120000), movimiento('Transferencia', 180000)],
    SIN_DESCUENTOS_PAGO,
  ),
})

assert.equal(llamadas.length, 2, 'una mutación para el ítem y una sola tanda para los subelementos')

/* ===== Cabecera: sin las columnas que el board eliminó ===== */

const cabecera = JSON.parse(llamadas[0].variables.cv as string) as Record<string, unknown>
assert.ok(llamadas[0].query.includes('create_item'), 'la primera mutación crea el recibo')
assert.ok(
  !('board_relation_mm4kwppn' in cabecera),
  '"📈Ventas" ya no existe a nivel ítem: mandarla rebota la mutación entera',
)
assert.ok(
  !('board_relation_mm58ycfw' in cabecera),
  '"💰Fact Vtas Pends de Cobro" ya no existe a nivel ítem',
)
// Las que sí siguen en el board se mandan igual que antes.
assert.equal(cabecera['numeric_mm5xbjkm'], '300000', 'TOTAL $ Cancelado')
assert.equal(cabecera['numeric_mm5xbkj'], '300000', 'TOTAL $ Recibido')
assert.equal(cabecera['numeric_mm5xfznj'], '0', 'TOTAL $ Diferencia')
assert.deepEqual(cabecera['board_relation_mkwb7fmp'], { item_ids: [111] }, 'el cliente')

/* ===== Subelementos: primero las facturas, después las formas de pago ===== */

const sub = llamadas[1]
const cols = (n: number) => JSON.parse(sub.variables[`c${n}`] as string) as Record<string, unknown>
const nombre = (n: number) => sub.variables[`n${n}`]

assert.equal(sub.query.match(/create_subitem/g)?.length, 4, 'dos facturas + dos movimientos')

// m0 y m1: una factura cancelada por comprobante emitido, en el orden en que se emitieron.
for (const [n, facturaId, importe] of [
  [0, 5001, '200000'],
  [1, 5002, '100000'],
] as const) {
  assert.equal(nombre(n), 'Fact Cancelada', `m${n} se llama como su etiqueta de "✋Caja"`)
  assert.deepEqual(cols(n)['status'], { index: 10 }, `m${n} va por índice, no por label`)
  assert.deepEqual(
    cols(n)['board_relation_mm63pczd'],
    { item_ids: [facturaId] },
    `m${n} apunta a su ítem de Facturación`,
  )
  assert.equal(cols(n)['numeric_mm4e61yk'], importe, `m${n} cancela el total de ESA factura`)
  assert.ok(
    !('numeric_mm63j1mv' in cols(n)),
    `m${n}: "Importe Recibido" es de los movimientos, no de la factura`,
  )
}

// m2 y m3: las formas de pago. Su importe es lo RECIBIDO, en su propia columna.
assert.equal(nombre(2), 'Efectivo', 'el movimiento se sigue nombrando con su medio de cobro')
assert.deepEqual(cols(2)['status'], { label: 'Efectivo' }, 'el medio de cobro va por label')
assert.equal(cols(2)['numeric_mm63j1mv'], '120000', 'el movimiento va a "Importe Recibido"')
assert.ok(
  !('numeric_mm4e61yk' in cols(2)),
  '"Importe Cancelado" es sólo del subelemento de factura',
)
assert.ok(!('board_relation_mm63pczd' in cols(2)), 'un movimiento no cancela una factura')
assert.equal(nombre(3), 'Transferencia')
assert.deepEqual(cols(3)['status'], { label: 'Transferencia' })
assert.equal(cols(3)['numeric_mm63j1mv'], '180000')
assert.ok(!('numeric_mm4e61yk' in cols(3)))

/* Sin facturas emitidas (o sin id) el recibo sigue creándose con sólo sus movimientos. */
llamadas.length = 0
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 1000,
  totalCobrado: 1000,
  balances: balancePagos([movimiento('Efectivo', 1000)], SIN_DESCUENTOS_PAGO),
})
assert.equal(
  llamadas[1].query.match(/create_subitem/g)?.length,
  1,
  'sin facturas sólo van los movimientos',
)

console.log('OK · recibo con facturas canceladas')
