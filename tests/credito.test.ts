/**
 * Test aislado de la lógica de crédito (Presupuesto vs. Venta). No depende de React ni de la red:
 * ejercita las funciones puras de `@/lib/credito`. Se corre con esbuild + node (ver el script de
 * abajo); no forma parte del build de la app (vive fuera de `src/`).
 *
 * Valida los 3 casos pedidos:
 *   1. La fórmula del crédito disponible nunca queda negativa (clamp en 0).
 *   2. VENTA: se frena al excederse el crédito.
 *   3. PRESUPUESTO: el exceso avisa pero NO frena (se puede guardar).
 */
import assert from 'node:assert/strict'
import type { Cliente } from '@/types'
import {
  creditoDisponibleProyectado,
  creditoResultante,
  excedeCredito,
  frenaPorCredito,
} from '@/lib/credito'

/** Cliente mínimo para el cálculo de crédito (sólo importan límite, saldo, remitos y estado). */
function clienteBase(over: Partial<Cliente> = {}): Cliente {
  return {
    id: '1',
    name: 'Cliente Test',
    cuit: '',
    ptype: '',
    status: '',
    list: 'L1',
    ret: '',
    agenteRetencion: false,
    condicionPago: 'CUENTA CORRIENTE',
    limit: 1000,
    codigo: '',
    saldoCtaCte: 600,
    lineaUtilizada: 700,
    remitosPendFacturar: 100, // usado = 600 + 100 = 700 → disponible actual = 300
    disponible: 300,
    addr: '',
    activity: 'Activo',
    situation: 'Liberado con crédito',
    ...over,
  } as Cliente
}

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const c = clienteBase() // límite 1000, usado 700, disponible actual 300

console.log('Caso 1 · La fórmula del crédito disponible nunca queda negativa (clamp en 0):')
ok('disponible actual (importe 0) = 300', creditoDisponibleProyectado(c, 0) === 300)
ok('con importe 250 → 50', creditoDisponibleProyectado(c, 250) === 50)
ok('con importe 300 (justo) → 0', creditoDisponibleProyectado(c, 300) === 0)
ok('con importe 500 (excede) → 0, NUNCA negativo', creditoDisponibleProyectado(c, 500) === 0)
ok('el resultante SÍ puede ser negativo (señal de exceso)', creditoResultante(c, 500) === -200)

console.log('Caso 2 · VENTA (bloqueante): se frena al excederse el crédito:')
ok('importe 300 (justo, resultante 0) NO frena', frenaPorCredito(c, 300, true) === false)
ok('importe 301 (excede) frena', frenaPorCredito(c, 301, true) === true)
ok('excedeCredito coincide con el freno', excedeCredito(c, 301) === true)

console.log('Caso 3 · PRESUPUESTO (no bloqueante): el exceso avisa pero NO frena:')
ok('importe 500 (excede) NO frena en presupuesto', frenaPorCredito(c, 500, false) === false)
ok('importe 5000 (excede fuerte) NO frena en presupuesto', frenaPorCredito(c, 5000, false) === false)
ok('igual sigue detectando el exceso para poder avisar', excedeCredito(c, 500) === true)

console.log(`\nOK · ${asserts} asserts pasaron.`)
