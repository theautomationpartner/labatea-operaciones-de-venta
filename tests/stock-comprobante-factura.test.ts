/**
 * El movimiento de stock de una venta SIMULTÁNEA lleva el número del comprobante con el que salió
 * la mercadería, en "Nro Comprobante" (text_mm5nmtat) — la MISMA columna donde el remito estampa
 * su número de hoja.
 *
 * Tres cosas se fijan acá, y ninguna la mira el typecheck:
 *
 *   1. Que se lea SÓLO con entrega SIMULTÁNEA. Es la única en la que la mercadería sale junto con
 *      la factura; en las otras no hay comprobante que nombrar, y gastar la consulta sería pedirle
 *      a Monday un dato que no se va a usar.
 *   2. Que el valor sea "N° Factura - N° Comprobante", leído del ítem de facturación ya emitido.
 *   3. Que un número que TODAVÍA no está no frene nada. Las dos columnas las completa la emisión
 *      electrónica DESPUÉS de crear el ítem de facturación —hoy están vacías en las 33 facturas
 *      del tablero—, así que el caso normal al cerrar la venta es que no haya número. Ahí el
 *      movimiento se crea igual, sin la columna: descontar el stock importa más que anotar de qué
 *      papel salió.
 *
 * Se corre con esbuild + node (`npm run test:stock-comprobante`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { crearVenta, type LineaVenta } from '@/services/monday/venta'
import { COL } from '@/services/monday/columns'
import type { TipoEntrega } from '@/types'

const FACTURA_ID = '12976634794'
const NRO_FACTURA = '0001-00001234'
const NRO_COMPROBANTE = '1234'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const lineas = (): LineaVenta[] =>
  [1, 2].map((n) => ({
    nombre: `PRODUCTO ${n}`,
    cantidad: n,
    precioUnitario: 1000,
    descuento: 0,
    rentabilidad: 30,
    iva: 21,
    stockId: `9000${n}`,
    /* Hace falta para el PENDIENTE de entrega: sin producto no hay nada que quede por entregar,
       y `crearPendientesEntrega` corta antes de crear nada. */
    productoId: `8000${n}`,
  })) as unknown as LineaVenta[]

interface Corrida {
  movimientos: Record<string, unknown>[]
  /** Columnas de cada "Pend de Entrega Vta" creado (sólo en la venta POSTERIOR). */
  pendientes: Record<string, unknown>[]
  leyoLaFactura: boolean
}

async function correr(tipoEntrega: TipoEntrega, factura: Record<string, string>): Promise<Corrida> {
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
    if (query.includes(COL.facturacion.nroFactura)) {
      data.items = [
        {
          id: FACTURA_ID,
          column_values: Object.entries(factura).map(([id, text]) => ({ id, text })),
        },
      ]
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
    facturaIds: [FACTURA_ID],
  } as never)

  const tanda = llamadas.find(
    (l) =>
      l.query.includes('create_subitem') &&
      Object.values(l.variables).some((v) => typeof v === 'string' && v.startsWith('9000')),
  )
  /* Los pendientes se crean en una cadena DIFERIDA (`void ... .then(...)`), que no se puede
     `await`ear desde acá: se le da una vuelta al bucle de eventos para que corra. */
  await new Promise((r) => setTimeout(r, 50))
  const alta = llamadas.find((l) => l.query.includes('create_item(board_id: 18421035527'))
  const columnas = (l: Llamada | undefined, prefijo: string) =>
    l
      ? Object.entries(l.variables)
          /* Sin `new RegExp` con template: ahí el `\d` lo consume el propio template literal y el
             patrón queda buscando la letra "d". */
          .filter(([k]) => k.startsWith(prefijo) && /^[0-9]+$/.test(k.slice(prefijo.length)))
          .map(([, v]) => JSON.parse(v as string) as Record<string, unknown>)
      : []
  return {
    movimientos: columnas(tanda, 'scv'),
    pendientes: columnas(alta, 'pcv'),
    leyoLaFactura: llamadas.some((l) => l.query.includes(COL.facturacion.nroFactura)),
  }
}

const COLUMNA = COL.stockMovSub.comprobante
assert.equal(COLUMNA, 'text_mm5nmtat', 'Nro Comprobante del subelemento de stock')
assert.equal(COL.facturacion.nroFactura, 'text_mm3k5zh4', 'N Factura del board de Facturacion')
assert.equal(COL.facturacion.nroComprobante, 'numeric_mm3kg6ph', 'y N Comprobante')

/* ---------- 1) SIMULTÁNEA con la factura ya numerada ---------- */
const conNumero = await correr('SIMULTANEA', {
  [COL.facturacion.nroFactura]: NRO_FACTURA,
  [COL.facturacion.nroComprobante]: NRO_COMPROBANTE,
})
assert.ok(conNumero.leyoLaFactura, 'la venta simultánea lee el número del comprobante')
assert.equal(conNumero.movimientos.length, 2, 'un movimiento de stock por producto')
for (const cv of conNumero.movimientos) {
  assert.equal(
    cv[COLUMNA],
    `${NRO_FACTURA} - ${NRO_COMPROBANTE}`,
    'cada movimiento dice con qué comprobante salió la mercadería',
  )
}

/* ---------- 2) Sin número todavía: se crea igual, sin la columna ----------
   Es el caso NORMAL hoy: la emisión electrónica completa esas columnas después. */
const sinNumero = await correr('SIMULTANEA', {
  [COL.facturacion.nroFactura]: '',
  [COL.facturacion.nroComprobante]: '',
})
assert.equal(sinNumero.movimientos.length, 2, 'el stock se descuenta igual')
for (const cv of sinNumero.movimientos) {
  assert.ok(!(COLUMNA in cv), 'sin número no se manda la columna: en blanco dice la verdad')
}

/* A medio emitir —hay factura pero no comprobante— entra lo que hay, sin el guion colgando. */
const aMedias = await correr('SIMULTANEA', {
  [COL.facturacion.nroFactura]: NRO_FACTURA,
  [COL.facturacion.nroComprobante]: '',
})
assert.equal(aMedias.movimientos[0][COLUMNA], NRO_FACTURA, 'no queda un guion a medio armar')

/* ---------- 3) Las otras entregas NI SIQUIERA consultan ----------
   Con entrega ANTERIOR o POSTERIOR la mercadería no sale con la factura. La POSTERIOR además no
   crea movimiento de stock: la salida la registra el remito, con SU número de hoja. */
const anterior = await correr('ANTERIOR', {
  [COL.facturacion.nroFactura]: NRO_FACTURA,
  [COL.facturacion.nroComprobante]: NRO_COMPROBANTE,
})
assert.ok(!anterior.leyoLaFactura, 'la entrega ANTERIOR no gasta la consulta del comprobante')
assert.equal(anterior.movimientos.length, 0, 'ni crea el movimiento de stock de la venta')
assert.equal(anterior.pendientes.length, 0, 'ni pendientes: lo suyo ya se entregó')

/* ---------- 4) POSTERIOR: el MISMO número, pero al PENDIENTE ----------
   Acá la mercadería no salió: va a salir por remito semanas después, y el pendiente tiene que
   decir contra qué comprobante. El VALOR es el mismo que en la simultánea; lo único que cambia
   según el tipo de entrega es en qué columna cae. */
const CO_PEND = COL.pendienteEntregaItem.nroFactura
assert.equal(CO_PEND, 'text_mm6wsabe', 'Nro Factura del board de Pends de Entrega Venta')

const posterior = await correr('POSTERIOR', {
  [COL.facturacion.nroFactura]: NRO_FACTURA,
  [COL.facturacion.nroComprobante]: NRO_COMPROBANTE,
})
assert.equal(posterior.movimientos.length, 0, 'la POSTERIOR no descuenta stock: eso lo hace el remito')
assert.equal(posterior.pendientes.length, 2, 'un pendiente de entrega por producto')
for (const cv of posterior.pendientes) {
  assert.equal(
    cv[CO_PEND],
    `${NRO_FACTURA} - ${NRO_COMPROBANTE}`,
    'el pendiente lleva el mismo texto que el movimiento de stock de la simultanea',
  )
}
/* Y es EXACTAMENTE el mismo texto que recibe el otro destino: si algún día se compusieran
   distinto, el remito y el movimiento de stock nombrarían el mismo papel de dos formas. */
assert.equal(
  posterior.pendientes[0][CO_PEND],
  conNumero.movimientos[0][COLUMNA],
  'los dos destinos escriben el mismo valor',
)

/* Sin número todavía —el caso normal hoy— el pendiente se crea igual y la columna queda vacía. */
const posteriorSinNro = await correr('POSTERIOR', {
  [COL.facturacion.nroFactura]: '',
  [COL.facturacion.nroComprobante]: '',
})
assert.equal(posteriorSinNro.pendientes.length, 2, 'los pendientes se crean igual')
for (const cv of posteriorSinNro.pendientes) {
  assert.ok(!(CO_PEND in cv), 'sin numero no se manda la columna')
}

console.log(
  'OK · el numero de la factura baja al movimiento de stock (SIMULTANEA) y al pendiente (POSTERIOR)',
)
