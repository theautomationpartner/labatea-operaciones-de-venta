/**
 * La card de un presupuesto en la VENTA se identifica con su ID y nada más: "PRESUP-084".
 *
 * El ID sale de la columna "🤖ID Presup" (pulse_id_mkwb5sj3) y NO de recortar el nombre del ítem.
 * El nombre no tiene un formato fijo —en el board conviven "PRESUP-083 02 September 2026" y
 * "PRESUP-084 - 7001 - La Batea S.A TEST - 04/09/2026"—, así que cualquier recorte sería adivinar
 * dónde termina el ID: por longitud se corta mal el segundo, y por el primer " - " se rompe el
 * primero, que no tiene ninguno.
 *
 * El mismo valor alimenta la badge de "Origen" de la tabla de pendientes, que con el nombre
 * completo empujaba la tabla a scroll horizontal.
 *
 * Se corre con esbuild + node (`npm run test:presup-id`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { getPresupuestosVigentes } from '@/services/monday/presupuestar'
import { COL } from '@/services/monday/columns'

/** Los dos formatos de nombre que conviven en el board, con su ID real. */
const CASOS = [
  { id: '12956413370', name: 'PRESUP-083 02 September 2026', idPresup: 'PRESUP-083' },
  {
    id: '12979961109',
    name: 'PRESUP-084 - 7001 - La Batea S.A TEST - 04/09/2026',
    idPresup: 'PRESUP-084',
  },
  // Recién creado: el tablero todavía no le asignó su ID.
  { id: '13010885284', name: 'PRESUP-090 09 September 2026', idPresup: '' },
]

const CLIENTE = '12524661079'
/** Vencimiento a futuro: sin él el presupuesto no se considera vigente y no se lista. */
const VENCE = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query } = JSON.parse(init.body) as { query: string }
  const data: Record<string, unknown> = {}
  /* 1) Los ids de los presupuestos vigentes del cliente: se filtran por el cliente vinculado y
     por una fecha de vencimiento que no haya pasado. */
  if (query.includes('items_page')) {
    data.boards = [
      {
        items_page: {
          cursor: null,
          items: CASOS.map((c) => ({
            id: c.id,
            column_values: [
              { id: COL.presupuesto.cliente, linked_item_ids: [CLIENTE] },
              { id: COL.presupuesto.fechaVencimiento, text: VENCE },
            ],
          })),
        },
      },
    ]
  }
  // 2) Cada presupuesto con sus columnas y subelementos.
  if (query.includes('subitems')) {
    data.items = CASOS.map((c) => ({
      id: c.id,
      name: c.name,
      column_values: [{ id: COL.presupuesto.pulseId, text: c.idPresup }],
      subitems: [],
    }))
  }
  return { ok: true, json: async () => ({ data }) }
}) as unknown as typeof fetch

assert.equal(COL.presupuesto.pulseId, 'pulse_id_mkwb5sj3', '"🤖ID Presup" del board de Presupuestos')

const presupuestos = await getPresupuestosVigentes(CLIENTE)
assert.equal(presupuestos.length, 3, 'los tres presupuestos del cliente')

/* ---------- El ID, y sólo el ID ---------- */
assert.equal(presupuestos[0].nro, 'PRESUP-083', 'del nombre con fecha sale sólo el ID')
assert.equal(
  presupuestos[1].nro,
  'PRESUP-084',
  'y del nombre con cliente y fecha también: no se recorta el nombre, se lee la columna',
)
for (const p of presupuestos.slice(0, 2)) {
  assert.ok(!/\d{4}|September|Batea/.test(p.nro), `"${p.nro}" no puede arrastrar fecha ni cliente`)
}

/* ---------- Sin ID asignado todavía: se cae al nombre ----------
   Una card sin identificación sería peor que una con el nombre largo: el usuario no sabría cuál
   está eligiendo. */
assert.equal(
  presupuestos[2].nro,
  'PRESUP-090 09 September 2026',
  'sin ID asignado se muestra el nombre, que es lo único que queda',
)

console.log('OK · la card del presupuesto se identifica con su ID ("PRESUP-084") y nada más')
