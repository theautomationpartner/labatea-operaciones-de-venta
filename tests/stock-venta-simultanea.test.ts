/**
 * Movimiento de stock de una venta con entrega SIMULTÁNEA: orden de ejecución y nombre del
 * subelemento.
 *
 * Se intercepta `fetch` (la única salida de `mondayApi`) y se registra cada llamada en orden, con
 * su query y sus variables. Así se verifica de punta a punta, sin tocar Monday:
 *   · que el subelemento de stock se cree DESPUÉS de la venta y DESPUÉS de leer su "🤖ID VTA";
 *   · que el nombre sea exactamente «ID VTA - Nombre del producto»;
 *   · que nada de esto ocurra con las otras entregas.
 */
import assert from 'node:assert/strict'
import { crearVenta, type LineaVenta } from '@/services/monday/venta'
import { BOARDS, COL } from '@/services/monday/columns'
import type { TipoEntrega } from '@/types'

const ID_VENTA = '12723572472'
const ID_VTA = 'VTA-070'
const PRODUCTOS = ['CLORO GRANULADO x 1 KG.', 'DETERGENTE POLVO S300 BALDE X 24 KG']

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const lineas = (): LineaVenta[] =>
  PRODUCTOS.map((nombre, i) => ({
    nombre,
    cantidad: i + 1,
    precioUnitario: 1000,
    descuento: 0,
    rentabilidad: 30,
    iva: 21,
    // Ítem de "🧮Stock y Movimientos" del producto: sin él no hay movimiento que crear.
    stockId: `9000${i}`,
  })) as unknown as LineaVenta[]

/** Respuesta que corresponde a cada query, según lo que pide. Registra la llamada en `orden`. */
function instalarFetch(orden: Llamada[], idVta = ID_VTA) {
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as Llamada
    orden.push({ query, variables })

    const data: Record<string, unknown> = {}
    // Metadata de columnas status (índices por label).
    if (query.includes('settings_str')) {
      const vacio = [{ columns: [{ settings_str: '{"labels":{"0":"Venta Simultanea"}}' }] }]
      data.boards = vacio
      data.item = vacio
      data.sub = vacio
    }
    // Cabecera de la venta.
    if (query.includes('create_item')) data.create_item = { id: ID_VENTA }
    // "🤖ID VTA" del ítem ya creado.
    if (query.includes(COL.venta.idVta) && query.includes('items(ids:')) {
      data.items = [{ column_values: [{ id: COL.venta.idVta, text: idVta }] }]
    }
    // Subelementos (de la venta y del stock): un id por alias pedido.
    for (const alias of query.matchAll(/(\w+): create_subitem/g)) data[alias[1]] = { id: '1' }

    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch
}

const venta = (tipoEntrega: TipoEntrega) =>
  crearVenta({
    clienteId: '1',
    vendedorId: null,
    nombre: 'Cliente',
    tipoVenta: 'DIRECTA',
    tipoEntrega,
    tipoPago: 'SIMULTANEO',
    rentabilidad: 30,
    lineas: lineas(),
  } as never)

/** Índice de la primera llamada que cumple el predicado (-1 si no hubo ninguna). */
const indice = (orden: Llamada[], pred: (l: Llamada) => boolean) => orden.findIndex(pred)

const esCreacionVenta = (l: Llamada) => l.query.includes('create_item')
const esLecturaIdVta = (l: Llamada) =>
  l.query.includes('items(ids:') && l.query.includes(COL.venta.idVta)
const esSubitemStock = (l: Llamada) =>
  l.query.includes('create_subitem') &&
  Object.values(l.variables).some((v) => typeof v === 'string' && v.startsWith('9000'))

// ---------- SIMULTÁNEA: venta → lectura del ID → subelementos de stock ----------
{
  const orden: Llamada[] = []
  instalarFetch(orden)
  await venta('SIMULTANEA')

  const iVenta = indice(orden, esCreacionVenta)
  const iId = indice(orden, esLecturaIdVta)
  const iStock = indice(orden, esSubitemStock)

  assert.ok(iVenta >= 0, 'no se creó la venta')
  assert.ok(iId >= 0, 'no se leyó el "🤖ID VTA" del ítem creado')
  assert.ok(iStock >= 0, 'no se creó el movimiento de stock')
  // El orden es lo que se está verificando: nada de esto puede ir en paralelo.
  assert.ok(iVenta < iId, 'el ID VTA se leyó antes de crear la venta')
  assert.ok(iId < iStock, 'el movimiento de stock se disparó antes de leer el ID VTA')

  // El nombre de cada subelemento: «ID VTA - Producto».
  const nombres = Object.entries(orden[iStock].variables)
    .filter(([k]) => k.startsWith('sn'))
    .map(([, v]) => v)
  assert.deepEqual(
    nombres,
    PRODUCTOS.map((p) => `${ID_VTA} - ${p}`),
    'el nombre del movimiento de stock no sigue la plantilla «ID VTA - Producto»',
  )
  // Y se crean en el board de stock, sobre el ítem de stock de cada producto.
  const padres = Object.entries(orden[iStock].variables)
    .filter(([k]) => /^s\d+$/.test(k))
    .map(([, v]) => v)
  assert.deepEqual(padres, ['90000', '90001'], 'el movimiento no cuelga del ítem de stock')
}

// ---------- Sin ID VTA disponible: el movimiento se crea igual, con el nombre del producto ----------
{
  const orden: Llamada[] = []
  instalarFetch(orden, '')
  await venta('SIMULTANEA')
  const stock = orden[indice(orden, esSubitemStock)]
  assert.ok(stock, 'sin ID VTA el movimiento de stock no debería saltearse')
  const nombres = Object.entries(stock.variables)
    .filter(([k]) => k.startsWith('sn'))
    .map(([, v]) => v)
  assert.deepEqual(nombres, PRODUCTOS, 'sin ID VTA el nombre tiene que ser el del producto solo')
  // Se reintentó la lectura antes de resignarla.
  assert.ok(orden.filter(esLecturaIdVta).length > 1, 'la lectura del ID VTA no se reintentó')
}

// ---------- Otras entregas: no se toca el stock ----------
for (const entrega of ['POSTERIOR', 'ANTERIOR'] as const) {
  const orden: Llamada[] = []
  instalarFetch(orden)
  await venta(entrega)
  assert.equal(
    indice(orden, esSubitemStock),
    -1,
    `la entrega ${entrega} no debería crear movimientos de stock`,
  )
  assert.equal(
    indice(orden, esLecturaIdVta),
    -1,
    `la entrega ${entrega} no necesita leer el ID VTA`,
  )
}

// El board de stock es el que dice la instrucción (18421752251) y sus subelementos, 18421752360.
assert.equal(BOARDS.stockMovimientos, 18421752251, 'cambió el board de stock')
assert.equal(BOARDS.stockMovimientosSub, 18421752360, 'cambió el board de movimientos de stock')

console.log('OK · movimiento de stock de la venta SIMULTÁNEA')
