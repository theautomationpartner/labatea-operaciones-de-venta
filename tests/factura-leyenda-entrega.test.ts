/**
 * El comprobante de una venta con entrega SIMULTÁNEA deja dicho en sus Observaciones que la
 * mercadería salió con él.
 *
 * Lo delicado es DÓNDE: "Observaciones" (text_mm345tzb) es la misma columna donde el vendedor
 * escribe sus propias indicaciones —"entregar por el portón trasero"—, que alguien va a leer del
 * otro lado. Por eso la leyenda se antepone en vez de pisarlas: las dos cosas viven ahí y ninguna
 * es prescindible.
 *
 * Y sólo con entrega SIMULTÁNEA: es la única en la que la frase es verdadera. En la POSTERIOR la
 * mercadería no salió todavía y en la ANTERIOR salió antes, por remito.
 *
 * Se corre con esbuild + node (`npm run test:factura-leyenda`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  crearComprobantes,
  LEYENDA_ENTREGA_SIMULTANEA,
  observacionesComprobante,
} from '@/services/monday/facturacion'
import { BOARDS, COL } from '@/services/monday/columns'
import type { Cliente, TipoEntrega } from '@/types'

const ESCRITAS = 'Entregar por el porton trasero'

/* ---------- La regla, sola ---------- */
assert.equal(LEYENDA_ENTREGA_SIMULTANEA, 'Mercaderia 100% Entregada')
assert.equal(
  observacionesComprobante(ESCRITAS, 'SIMULTANEA'),
  `${LEYENDA_ENTREGA_SIMULTANEA}\n${ESCRITAS}`,
  'la leyenda va primero y lo que escribió el vendedor debajo',
)
assert.equal(
  observacionesComprobante('', 'SIMULTANEA'),
  LEYENDA_ENTREGA_SIMULTANEA,
  'sin observaciones queda sólo la leyenda, sin un salto de línea colgando',
)
assert.equal(
  observacionesComprobante('   ', 'SIMULTANEA'),
  LEYENDA_ENTREGA_SIMULTANEA,
  'y unos espacios no cuentan como observación',
)
for (const t of ['POSTERIOR', 'ANTERIOR', null, undefined] as const) {
  assert.equal(
    observacionesComprobante(ESCRITAS, t),
    ESCRITAS,
    `con entrega ${t} no se agrega nada: la frase sería falsa`,
  )
}

/* ---------- Y lo que efectivamente sale hacia Monday ---------- */
interface Llamada {
  query: string
  variables: Record<string, unknown>
}

async function comprobantes(tipoEntrega: TipoEntrega, observaciones: string) {
  const llamadas: Llamada[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const l = JSON.parse(init.body) as Llamada
    llamadas.push(l)
    const data: Record<string, unknown> = {}
    if (l.query.includes('settings_str')) data.boards = [{ columns: [{ settings_str: '{}' }] }]
    for (const a of l.query.matchAll(/(\w+): create_item/g)) data[a[1]] = { id: '77' }
    for (const a of l.query.matchAll(/(\w+): create_subitem/g)) data[a[1]] = { id: '1' }
    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch

  await crearComprobantes(
    [
      {
        clave: 'COMUN',
        tipo: 'COM',
        proveedorId: null,
        proveedorNombre: null,
        titulo: 'Factura A',
        lineas: [
          { nombre: 'PRODUCTO 1', cantidad: 2, precioUnitario: 1000, descuento: 0, rentabilidad: 30, iva: 21 },
        ],
        bruto: 2000,
        descuento: 0,
        neto: 2000,
        iva: 420,
        total: 2420,
      },
    ] as never,
    {
      cliente: { id: '1', name: 'CLIENTE', cuit: '30-70906788-1', condicionPago: 'CONTADO' } as Cliente,
      moneda: 'PESOS',
      tipoCambio: 0,
      letra: 'A',
      ivaReceptor: 'RI',
      fechaEmision: '07/09/2026',
      diasVencimiento: 30,
      observaciones,
      tipoEntrega,
    } as never,
  )

  const alta = llamadas.find((l) => l.query.includes(`create_item(board_id: ${BOARDS.facturacion}`))
    ?? llamadas.find((l) => l.query.includes('create_item'))
  assert.ok(alta, 'no se creó ningún comprobante')
  const cv = Object.entries(alta!.variables).find(([k]) => k.startsWith('cv'))
  assert.ok(cv, 'el comprobante salió sin columnas')
  return JSON.parse(cv![1] as string) as Record<string, unknown>
}

const COLUMNA = COL.facturacion.observaciones
assert.equal(COLUMNA, 'text_mm345tzb', '"Observaciones" del board de Facturación')

const simultanea = await comprobantes('SIMULTANEA', ESCRITAS)
assert.equal(
  simultanea[COLUMNA],
  `${LEYENDA_ENTREGA_SIMULTANEA}\n${ESCRITAS}`,
  'el comprobante lleva la leyenda y conserva lo que escribió el vendedor',
)

const posterior = await comprobantes('POSTERIOR', ESCRITAS)
assert.equal(posterior[COLUMNA], ESCRITAS, 'con entrega POSTERIOR sólo van las observaciones')

console.log('OK · el comprobante de entrega SIMULTANEA lleva la leyenda sin pisar las observaciones')
