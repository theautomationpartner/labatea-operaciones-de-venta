/**
 * Cálculo en vivo de la etapa "Productos a remitar" (remito de venta ANTERIOR):
 * cuánto le queda pendiente de entregar a cada línea después de este remito, y en qué estado
 * queda la línea de la venta.
 *
 * Se corre con esbuild + node (`npm run test:remito-resultante`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  ESTADO_RESULTANTE_COMPLETO,
  ESTADO_RESULTANTE_PARCIAL,
  estadoResultante,
  pendienteResultante,
} from '@/lib/selectors'

// ---------- Cant. Pend. de entregar Resultante = pendiente − cantidad a entregar ----------
assert.equal(pendienteResultante(10, 4), 6, 'de 10 pendientes se entregan 4 → quedan 6')
assert.equal(pendienteResultante(10, 10), 0, 'se entrega todo lo pendiente → 0')
assert.equal(pendienteResultante(10, 0), 10, 'sin cantidad cargada el pendiente no se mueve')
assert.equal(pendienteResultante(7.5, 2.25), 5.25, 'con decimales, redondeado a dos')
// Cargar de más da negativo: la fila ya lo marca como error en la cantidad, no se disimula.
assert.equal(pendienteResultante(10, 12), -2, 'cargar más de lo pendiente da negativo')

// ---------- Estado Resultante ----------
assert.equal(estadoResultante(0), ESTADO_RESULTANTE_COMPLETO, 'resultante 0 → 100% Entregada')
assert.equal(ESTADO_RESULTANTE_COMPLETO, '100% Entregada', 'el texto es el pedido')
for (const r of [1, 6, 0.5, 999]) {
  assert.equal(estadoResultante(r), ESTADO_RESULTANTE_PARCIAL, `resultante ${r} → parcial`)
}
assert.equal(ESTADO_RESULTANTE_PARCIAL, 'Parcialmente Entregada', 'el texto es el pedido')
// Un resultante negativo no es un estado válido: no se rotula.
assert.equal(estadoResultante(-2), null, 'sin estado para una carga que excede lo pendiente')

// ---------- Las dos piezas juntas, como las usa la tabla ----------
const linea = (pendiente: number, aEntregar: number) => {
  const resultante = pendienteResultante(pendiente, aEntregar)
  return { resultante, estado: estadoResultante(resultante) }
}
assert.deepEqual(linea(20, 20), { resultante: 0, estado: '100% Entregada' })
assert.deepEqual(linea(20, 5), { resultante: 15, estado: 'Parcialmente Entregada' })
assert.deepEqual(linea(20, 0), { resultante: 20, estado: 'Parcialmente Entregada' })

console.log('OK · pendiente y estado resultantes de la línea a remitar')
