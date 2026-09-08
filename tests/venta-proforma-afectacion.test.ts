/**
 * La venta que nace de una PROFORMA afecta lo que le corresponde según el tipo de entrega DE LA
 * PROFORMA: SIMULTÁNEA descuenta stock en el acto; POSTERIOR deja pendientes de entrega.
 *
 * Las dos ramas dependen de datos que la línea tiene que TRAER desde el subelemento de la proforma:
 * el movimiento de stock filtra por `stockId` y el pendiente por `productoId`. Si falta uno, la
 * rama no falla: filtra su lista, le queda vacía y retorna sin hacer nada. En silencio, con la
 * venta creada y en verde.
 *
 * Eso fue exactamente lo que pasó: el listador de proformas escribía el ítem de stock al crearlas
 * y NO lo volvía a leer, así que ninguna venta sobre proforma movió stock nunca. La venta
 * 12990170482 (de una proforma POSTERIOR) no dejó ni pendientes ni movimiento.
 *
 * Se corre con esbuild + node (`npm run test:venta-proforma-afecta`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { crearVenta, type LineaVenta } from '@/services/monday/venta'
import { BOARDS, COL } from '@/services/monday/columns'
import type { TipoEntrega } from '@/types'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

/** Línea tal como llega desde una proforma: con su producto Y su ítem de stock. */
const deProforma = (n: number): LineaVenta =>
  ({
    nombre: `PRODUCTO ${n}`,
    cantidad: n,
    precioUnitario: 1000,
    descuento: 0,
    rentabilidad: 30,
    iva: 21,
    productoId: `1259954880${n}`,
    stockId: `1264243165${n}`,
  }) as unknown as LineaVenta

interface Efectos {
  /** Subelementos creados en "Stock y Movimientos" (egresos). */
  movimientos: Record<string, unknown>[]
  /** Ítems creados en "Pends de Entrega Venta". */
  pendientes: Record<string, unknown>[]
}

async function afectacion(tipoEntrega: TipoEntrega, lineas: LineaVenta[]): Promise<Efectos> {
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
    for (const a of l.query.matchAll(/(\w+): create_item\(/g)) data[a[1]] = { id: '1' }
    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch

  await crearVenta({
    clienteId: '12524661079',
    vendedorId: null,
    nombre: '7001 - La Batea S.A TEST',
    tipoVenta: 'CON PRESUPUESTO PREVIO',
    tipoEntrega,
    tipoPago: 'SIMULTANEO',
    rentabilidad: 30,
    lineas,
  } as never)

  /* Los pendientes son `create_item` en SU board; los movimientos, `create_subitem` colgados de un
     ítem de stock. Se dan una vuelta al bucle porque los pendientes salen en una cadena diferida. */
  await new Promise((r) => setTimeout(r, 60))
  const cols = (l: Llamada | undefined, prefijo: string) =>
    l
      ? Object.entries(l.variables)
          .filter(([k]) => k.startsWith(prefijo) && /^[0-9]+$/.test(k.slice(prefijo.length)))
          .map(([, v]) => JSON.parse(v as string) as Record<string, unknown>)
      : []
  return {
    movimientos: cols(
      llamadas.find(
        (l) =>
          l.query.includes('create_subitem') &&
          Object.values(l.variables).some((v) => typeof v === 'string' && v.startsWith('12642')),
      ),
      'scv',
    ),
    pendientes: cols(
      llamadas.find((l) => l.query.includes(`create_item(board_id: ${BOARDS.pendientesEntrega}`)),
      'pcv',
    ),
  }
}

const LINEAS = [deProforma(1), deProforma(2)]

/* ---------- SIMULTÁNEA: descuenta stock, no deja pendientes ---------- */
const simultanea = await afectacion('SIMULTANEA', LINEAS)
assert.equal(simultanea.movimientos.length, 2, 'un egreso de stock por producto')
for (const cv of simultanea.movimientos) {
  assert.ok(cv[COL.stockMovSub.egreso], 'con la cantidad que sale')
}
assert.equal(simultanea.pendientes.length, 0, 'y nada pendiente: la mercadería ya salió')

/* ---------- POSTERIOR: deja pendientes, no toca stock ---------- */
const posterior = await afectacion('POSTERIOR', LINEAS)
assert.equal(posterior.pendientes.length, 2, 'un pendiente de entrega por producto')
for (const cv of posterior.pendientes) {
  assert.ok(cv[COL.pendienteEntregaItem.cantidad], 'con la cantidad a entregar')
  /* El pendiente queda enlazado a SU ítem de stock. Sin esto, el remito que después lo entregue no
     puede descontar: esa cadena también depende del `stockId`. */
  assert.ok(
    cv[COL.pendienteEntregaItem.stockMovimiento],
    'y enlazado a su ítem de stock, que es lo que el remito va a necesitar',
  )
}
assert.equal(posterior.movimientos.length, 0, 'y sin egreso: todavía no salió nada')

/* ---------- Sin `stockId` la rama de stock se saltea ENTERA ----------
   Es el modo de falla que hay que poder distinguir: no hay error, no hay movimiento, y la venta
   queda creada como si todo hubiera salido bien. */
const sinStock = await afectacion(
  'SIMULTANEA',
  LINEAS.map((l) => ({ ...l, stockId: undefined })),
)
assert.equal(sinStock.movimientos.length, 0, 'sin ítem de stock no hay nada que descontar')

console.log('OK · la venta sobre proforma descuenta stock (SIMULTANEA) o deja pendientes (POSTERIOR)')
