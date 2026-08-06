/**
 * Piso de la cantidad de una línea YA CONFIRMADA en el remito.
 *
 * En la emisión ANTERIOR la línea sale de lo pendiente de una venta: entregar cero unidades no es
 * una entrega, así que la cantidad no puede bajar de 1 (para sacarla está la papelera). En la
 * POSTERIOR, donde la mercadería viene del catálogo, sí puede llegar a 0.
 */
import assert from 'node:assert/strict'
import { initialState, reducer, type AppState } from '@/state/appState'
import type { RemitoItem, TipoEmisionRemito } from '@/types'

const UID = 'venta-1-0'

const item = (cantidad: number): RemitoItem =>
  ({
    uid: UID,
    codigo: '150',
    nombre: 'CLORO GRANULADO x 1 KG.',
    cantidad,
    um: 'UN',
    // Tope: lo que quedaba pendiente de entregar en la venta de origen.
    max: 5,
  }) as unknown as RemitoItem

/** Estado con el remito ya armado: tipo de emisión elegido y una línea confirmada. */
const conLinea = (tipoEmision: TipoEmisionRemito, cantidad: number): AppState => ({
  ...initialState,
  operacion: 'REMITO',
  paso: 'remito-productos',
  remito: { ...initialState.remito, tipoEmision, items: [item(cantidad)] },
})

const cantidadTras = (estado: AppState, cantidad: number): number =>
  reducer(estado, { type: 'setRemitoItemCantidad', uid: UID, cantidad }).remito.items[0].cantidad

// ---------- ANTERIOR: el piso es 1 ----------
const anterior = conLinea('ANTERIOR', 1)
assert.equal(cantidadTras(anterior, 0), 1, 'la cantidad no puede quedar en 0')
assert.equal(cantidadTras(anterior, -3), 1, 'un valor negativo tampoco baja de 1')
// El resto del rango sigue igual: se puede subir, y hasta pasarse de lo pendiente (la tabla lo marca).
assert.equal(cantidadTras(anterior, 3), 3, 'subir la cantidad sigue funcionando')
assert.equal(cantidadTras(anterior, 9), 9, 'pasarse del pendiente se permite (se avisa en rojo)')
// La única forma de dejar el remito sin esa línea es quitarla.
const quitada = reducer(anterior, { type: 'removeRemitoItem', uid: UID })
assert.equal(quitada.remito.items.length, 0, 'la papelera sigue sacando la línea')

// ---------- POSTERIOR: el 0 se mantiene ----------
const posterior = conLinea('POSTERIOR', 1)
assert.equal(cantidadTras(posterior, 0), 0, 'en POSTERIOR la cantidad sí puede ir a 0')
assert.equal(cantidadTras(posterior, -3), 0, 'pero nunca queda negativa')

// ---------- El cambio de cantidad invalida el borrador, como antes ----------
const conBorrador: AppState = { ...anterior, remito: { ...anterior.remito, remitoId: 'r-1' } }
assert.equal(
  reducer(conBorrador, { type: 'setRemitoItemCantidad', uid: UID, cantidad: 2 }).remito.remitoId,
  null,
  'tocar la cantidad tiene que invalidar el remito ya generado',
)

console.log('OK · piso de cantidad del remito ANTERIOR')
