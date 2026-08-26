/**
 * Proyección del stock al devolver mercadería: replica las tres fórmulas del tablero
 * "🧮Stock y Movimientos" sin pisar ninguno de los valores leídos.
 */
import assert from 'node:assert/strict'
import { stockConIngreso } from '@/lib/selectors'
import type { Producto } from '@/types'

/* El ejemplo del requerimiento: ingreso 5000, egreso 22 (físico 4978), sin pendiente de entrega
   y 22 por recibir (disponible 5000). El cliente devuelve 7. */
const p = {
  ingresos: 5000,
  egresos: 22,
  pendEntregaVta: 0,
  pendRecepcionCompra: 22,
  fisico: 4978,
  comercial: 4978,
  disponible: 5000,
} as Producto

assert.deepEqual(stockConIngreso(p, 7), {
  ingresos: 5007,
  fisico: 4985,
  comercial: 4985,
  disponible: 5007,
})

// Sin cantidad, la proyección es exactamente el estado actual del tablero.
assert.deepEqual(stockConIngreso(p, 0), {
  ingresos: 5000,
  fisico: 4978,
  comercial: 4978,
  disponible: 5000,
})

// Lo comprometido por ventas resta al comercial y arrastra al disponible.
const conPendiente = { ...p, pendEntregaVta: 100 } as Producto
assert.deepEqual(stockConIngreso(conPendiente, 7), {
  ingresos: 5007,
  fisico: 4985,
  comercial: 4885,
  disponible: 4907,
})

console.log('OK · proyección del stock al devolver')
