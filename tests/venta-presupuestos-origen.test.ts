/**
 * La venta CON PRESUPUESTO PREVIO queda enlazada a TODOS los presupuestos que le aportaron líneas,
 * en "🧾Presupuestos" (board_relation_mm52yrq5).
 *
 * Son VARIOS a propósito: una venta se arma tomando productos de más de un presupuesto —tres de
 * uno, dos de otro, dos de un tercero— y la relación tiene que nombrarlos a los tres. Por eso el
 * id viaja POR LÍNEA y la lista se junta al crear la venta, en vez de guardarse como una selección
 * única: no hay "el presupuesto de la venta", hay los que aportaron.
 *
 * Se corre con esbuild + node (`npm run test:venta-presupuestos`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { crearVenta, type LineaVenta } from '@/services/monday/venta'
import { COL } from '@/services/monday/columns'
import type { TipoVenta } from '@/types'

const A = '12100000001'
const B = '12100000002'
const C = '12100000003'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const linea = (nombre: string, presupuestoId?: string): LineaVenta =>
  ({
    nombre,
    cantidad: 1,
    precioUnitario: 1000,
    descuento: 0,
    rentabilidad: 30,
    iva: 21,
    presupuestoId,
  }) as unknown as LineaVenta

/** Columnas de la CABECERA que salieron hacia Monday. */
async function cabecera(lineas: LineaVenta[], tipoVenta: TipoVenta = 'CON PRESUPUESTO PREVIO') {
  const llamadas: Llamada[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const l = JSON.parse(init.body) as Llamada
    llamadas.push(l)
    const data: Record<string, unknown> = {}
    if (l.query.includes('settings_str')) {
      const vacio = [{ columns: [{ settings_str: '{"labels":{"0":"Venta Simultanea"}}' }] }]
      data.boards = vacio
      data.item = vacio
      data.sub = vacio
    }
    if (l.query.includes('create_item')) data.create_item = { id: '999' }
    if (l.query.includes(COL.venta.idVta) && l.query.includes('items(ids:')) {
      data.items = [{ column_values: [{ id: COL.venta.idVta, text: 'VTA-999' }] }]
    }
    for (const a of l.query.matchAll(/(\w+): create_subitem/g)) data[a[1]] = { id: '1' }
    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch

  await crearVenta({
    clienteId: '12524661079',
    vendedorId: null,
    nombre: 'Cliente',
    tipoVenta,
    tipoEntrega: 'SIMULTANEA',
    tipoPago: 'SIMULTANEO',
    rentabilidad: 30,
    lineas,
  } as never)

  const alta = llamadas.find((l) => l.query.includes('create_item'))
  assert.ok(alta, 'no se creó la cabecera de la venta')
  return JSON.parse(alta!.variables.cv as string) as Record<string, unknown>
}

assert.equal(COL.venta.presupuestos, 'board_relation_mm52yrq5', '"🧾Presupuestos" del board de Ventas')

/* ---------- El caso del enunciado: 3 productos de A, 2 de B, 2 de C ---------- */
const mezcla = await cabecera([
  linea('A1', A), linea('A2', A), linea('A3', A),
  linea('B1', B), linea('B2', B),
  linea('C1', C), linea('C2', C),
])
assert.deepEqual(
  mezcla[COL.venta.presupuestos],
  { item_ids: [Number(A), Number(B), Number(C)] },
  'los tres presupuestos quedan enlazados, cada uno UNA vez',
)

/* Los ids van como NÚMEROS: un `item_ids` de strings no engancha nada, y el error es mudo
   —la venta se crea igual, con la relación vacía—. */
const ids = (mezcla[COL.venta.presupuestos] as { item_ids: unknown[] }).item_ids
assert.ok(
  ids.every((n) => typeof n === 'number'),
  'los ids viajan como número, no como texto',
)

/* ---------- Un solo presupuesto: un solo enlace ---------- */
const uno = await cabecera([linea('A1', A), linea('A2', A)])
assert.deepEqual(uno[COL.venta.presupuestos], { item_ids: [Number(A)] }, 'sin repetir')

/* ---------- Líneas SIN presupuesto: la relación no se manda ----------
   Es la venta DIRECTA, que nace del catálogo. Una relación con `item_ids: []` no dice "sin
   presupuesto": dice "se intentó enlazar y no se pudo". */
const directa = await cabecera([linea('P1'), linea('P2')], 'DIRECTA')
assert.ok(
  !(COL.venta.presupuestos in directa),
  'la venta DIRECTA no manda la relación de presupuestos',
)

/* Y una mezcla con alguna línea suelta enlaza sólo las que tienen origen. */
const parcial = await cabecera([linea('A1', A), linea('suelta'), linea('B1', B)])
assert.deepEqual(
  parcial[COL.venta.presupuestos],
  { item_ids: [Number(A), Number(B)] },
  'una línea sin presupuesto no ensucia la lista ni la rompe',
)

console.log('OK · la venta enlaza a todos los presupuestos que le aportaron líneas, sin repetir')
