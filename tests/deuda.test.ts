/**
 * Test aislado del cierre de venta: qué tipo de pago se registra y cuándo se pide la deuda.
 * No depende de React ni de la red: ejercita las funciones puras de `@/lib/cobros`.
 * Se corre con esbuild + node (`npm run test:deuda`); vive fuera de `src/`.
 *
 * Dos reglas, una sola fuente de verdad (`tipoPagoOperacion`):
 *   · CUENTA CORRIENTE + cierre "SI" → payload `{ tipoPago: 'SIMULTANEO' }`, sin deuda diferida.
 *   · CUENTA CORRIENTE + cierre "NO" → POSTERIOR, y el modal de deuda al finalizar.
 */
import assert from 'node:assert/strict'
import type { Cliente, CobroState, CondicionPago } from '@/types'
import {
  cobroSimultaneoOperacion,
  datosCobroVenta,
  requiereRegistroDeuda,
  tipoPagoEfectivo,
  tipoPagoOperacion,
} from '@/lib/cobros'

function clienteBase(condicionPago: CondicionPago | null): Cliente {
  return {
    id: '1',
    name: 'Cliente Test',
    cuit: '',
    ptype: '',
    status: '',
    list: 'L1',
    ret: '',
    agenteRetencion: false,
    condicionPago,
    limit: 1000,
    codigo: 'C-1',
    ctaCteId: '99',
    saldoCtaCte: 0,
    lineaUtilizada: 0,
    remitosPendFacturar: 0,
    disponible: 1000,
    addr: '',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  } as Cliente
}

function cobroBase(over: Partial<CobroState> = {}): CobroState {
  return {
    registrar: false,
    fecha: '01/01/2026',
    movimientos: [],
    confirmado: false,
    cobroId: null,
    deudaId: null,
    saldoAnterior: null,
    ...over,
  } as CobroState
}

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/** Cierre con "NO": la cuenta corriente difiere la deuda (comportamiento por defecto). */
const cobro = cobroBase()
/** Cierre con "SI": el vendedor cobra en el acto. */
const cobroSi = cobroBase({ registrar: true })

console.log('Caso 1 · Cumple las dos condiciones → el modal se monta:')
const ctaCte = clienteBase('CUENTA CORRIENTE')
ok("condicionPago === 'CUENTA CORRIENTE'", ctaCte.condicionPago === 'CUENTA CORRIENTE')
ok("tipoPago === POSTERIOR (el 'NO' del pago inmediato)", tipoPagoEfectivo(ctaCte) === 'POSTERIOR')
ok('requiereRegistroDeuda = true', requiereRegistroDeuda(ctaCte, cobro) === true)

console.log('Caso 2 · Contado (pago SIMULTANEO) → cierra directo, sin modal:')
const contado = clienteBase('CONTADO')
ok('tipoPago === SIMULTANEO', tipoPagoEfectivo(contado) === 'SIMULTANEO')
ok('requiereRegistroDeuda = false', requiereRegistroDeuda(contado, cobro) === false)

console.log('Caso 3 · Posterior pero NO es cuenta corriente → sin modal (falla la condición 1):')
for (const cond of ['PROVEED 45 DIAS', 'PROVEED 90 DIAS'] as CondicionPago[]) {
  const c = clienteBase(cond)
  ok(`${cond}: el tipo de pago es POSTERIOR`, tipoPagoEfectivo(c) === 'POSTERIOR')
  ok(`${cond}: requiereRegistroDeuda = false`, requiereRegistroDeuda(c, cobro) === false)
}
ok('sin condición de pago cargada → false', requiereRegistroDeuda(clienteBase(null), cobro) === false)

console.log('Caso 4 · La deuda ya registrada no se vuelve a pedir:')
ok(
  'con deudaId escrito → false',
  requiereRegistroDeuda(ctaCte, cobroBase({ deudaId: '123', confirmado: true })) === false,
)

console.log('Caso 5 · CUENTA CORRIENTE + cierre "SI" → cobro SIMULTANEO:')
ok("condicionPago === 'CUENTA CORRIENTE'", ctaCte.condicionPago === 'CUENTA CORRIENTE')
ok('la selección del cierre es "SI"', cobroSi.registrar === true)
ok("tipoPagoOperacion = 'SIMULTANEO'", tipoPagoOperacion(ctaCte, cobroSi) === 'SIMULTANEO')
ok('el flujo que corre es el del cobro inmediato', cobroSimultaneoOperacion(ctaCte, cobroSi))
assert.deepEqual(datosCobroVenta(ctaCte, cobroSi), { tipoPago: 'SIMULTANEO' })
ok("el payload de la venta contiene { tipoPago: 'SIMULTANEO' }", true)

console.log('Caso 6 · Fail-safe: con SIMULTANEO no se pide ningún paso de cobro diferido:')
ok('requiereRegistroDeuda = false', requiereRegistroDeuda(ctaCte, cobroSi) === false)

console.log('Caso 7 · El camino POSTERIOR ("NO") queda intacto:')
assert.deepEqual(datosCobroVenta(ctaCte, cobro), { tipoPago: 'POSTERIOR' })
ok("con «NO» el payload sigue siendo { tipoPago: 'POSTERIOR' }", true)
ok('y el modal de deuda se sigue pidiendo', requiereRegistroDeuda(ctaCte, cobro) === true)
ok('contado siempre es SIMULTANEO', tipoPagoOperacion(contado, cobro) === 'SIMULTANEO')
ok(
  'los plazos de proveedor NO ofrecen cobro en el acto: siguen POSTERIOR',
  tipoPagoOperacion(clienteBase('PROVEED 45 DIAS'), cobroSi) === 'POSTERIOR',
)

console.log(`\nOK · ${asserts} asserts pasaron.`)
