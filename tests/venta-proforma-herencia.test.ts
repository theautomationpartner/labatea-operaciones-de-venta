/**
 * La venta que nace de una PROFORMA hereda de ella su tipo de ENTREGA y su tipo de VENTA, y queda
 * enlazada a la proforma que la originó.
 *
 * El recorrido de la VENTA PROFORMA no tiene etapas donde configurar entrega ni tipo de venta: la
 * proforma ya los trae decididos. Sin heredarlos, el cierre resolvía `?? 'SIMULTANEA'` y
 * `?? 'DIRECTA'` sobre un estado en null, y una proforma POSTERIOR producía una venta SIMULTÁNEA.
 * Eso no es cosmético: de la entrega dependen el movimiento de stock —la simultánea descuenta en el
 * acto— y los pendientes de entrega —la posterior los crea—. La venta descontaba stock que no había
 * salido y no dejaba nada pendiente de entregar.
 *
 * Pasó de verdad: la proforma 12990159226 ("Posterior", "C/ Presup Previo") generó la venta
 * 12990170482, que quedó "Simultánea" y "Directa", y sin enlace a su proforma.
 *
 * Se corre con esbuild + node (`npm run test:venta-proforma`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { crearVenta, type LineaVenta } from '@/services/monday/venta'
import { COL, VENTA_ENTREGA_INDEX, VENTA_TIPO_INDEX } from '@/services/monday/columns'
import type { TipoEntrega, TipoVenta } from '@/types'

const PROFORMA_ID = '12990159226'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

/** Columnas de la CABECERA de la venta que salieron hacia Monday. */
async function cabeceraDeLaVenta(
  tipoEntrega: TipoEntrega,
  tipoVenta: TipoVenta,
  proformaId: string | null,
): Promise<Record<string, unknown>> {
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
    nombre: '7001 - La Batea S.A TEST',
    tipoVenta,
    tipoEntrega,
    tipoPago: 'SIMULTANEO',
    rentabilidad: 30,
    proformaId,
    lineas: [
      { nombre: 'PRODUCTO 1', cantidad: 2, precioUnitario: 1000, descuento: 0, rentabilidad: 30, iva: 21 },
    ] as unknown as LineaVenta[],
  } as never)

  const alta = llamadas.find((l) => l.query.includes('create_item'))
  assert.ok(alta, 'no se creó la cabecera de la venta')
  return JSON.parse(alta!.variables.cv as string) as Record<string, unknown>
}

assert.equal(COL.venta.proforma, 'board_relation_mm5spfc3', '"📈Proformas" del board de Ventas')

/* ---------- 1) Proforma POSTERIOR con presupuesto previo ----------
   Es el caso exacto que falló. Los dos status van por ÍNDICE, no por etiqueta. */
const posterior = await cabeceraDeLaVenta('POSTERIOR', 'CON PRESUPUESTO PREVIO', PROFORMA_ID)
assert.deepEqual(
  posterior[COL.venta.tipoEntrega],
  { index: VENTA_ENTREGA_INDEX.posterior },
  'la venta queda POSTERIOR, como la proforma',
)
assert.deepEqual(
  posterior[COL.venta.tipoVenta],
  { index: VENTA_TIPO_INDEX.conPresupuestoPrevio },
  'y con presupuesto previo, como la proforma',
)
assert.notEqual(
  VENTA_ENTREGA_INDEX.posterior,
  VENTA_ENTREGA_INDEX.simultanea,
  'los dos índices son distintos: si no, este test no probaría nada',
)

/* ---------- 2) El enlace a la proforma ----------
   El id viaja como NÚMERO dentro de `item_ids`: como string la relación no engancha. */
assert.deepEqual(
  posterior[COL.venta.proforma],
  { item_ids: [Number(PROFORMA_ID)] },
  'la venta queda enlazada a la proforma que la originó',
)

/* ---------- 3) Sin proforma no se manda la relación ----------
   Una relación con `item_ids: []` no dice "sin proforma": dice "se intentó enlazar y no se pudo". */
const sinProforma = await cabeceraDeLaVenta('SIMULTANEA', 'DIRECTA', null)
assert.ok(!(COL.venta.proforma in sinProforma), 'fuera de la VENTA PROFORMA la relación no se manda')
assert.deepEqual(
  sinProforma[COL.venta.tipoEntrega],
  { index: VENTA_ENTREGA_INDEX.simultanea },
  'y el resto de los recorridos sigue mandando lo suyo',
)

console.log('OK · la venta hereda entrega y tipo de la proforma, y queda enlazada a ella')
