/**
 * Test aislado del cierre de venta: qué tipo de cobro se registra y cuándo se pide la deuda.
 * No depende de React ni de la red: ejercita las funciones puras de `@/lib/cobros`.
 * Se corre con esbuild + node (`npm run test:deuda`); vive fuera de `src/`.
 *
 * UNA sola fuente de verdad (`tipoPagoOperacion`) y UN solo dato de entrada: la FORMA DE PAGO
 * elegida en la selección de productos.
 *   · CONTADO                                           → SIMULTANEO
 *   · CUENTA CORRIENTE / TARJETA DE DEBITO / DE CREDITO → POSTERIOR (y su deuda al finalizar)
 *
 * La condición de pago del CLIENTE no participa: sólo decide qué formas se le ofrecen.
 */
import assert from 'node:assert/strict'
import type { CobroState, FormaPagoVenta } from '@/types'
import {
  FORMAS_PAGO_POSTERIOR,
  FORMAS_PAGO_VENTA,
  cobroSimultaneoOperacion,
  datosCobroVenta,
  formasPagoDeCliente,
  mostrarImpactoCtaCte,
  requiereRegistroDeuda,
  tipoPagoOperacion,
} from '@/lib/cobros'

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

const cobro = cobroBase()

console.log('Caso 1 · SIMULTANEO es CONTADO, y sólo CONTADO:')
ok("CONTADO → 'SIMULTANEO'", tipoPagoOperacion('CONTADO') === 'SIMULTANEO')
ok('el flujo que corre es el del cobro inmediato', cobroSimultaneoOperacion('CONTADO'))
assert.deepEqual(datosCobroVenta('CONTADO'), { tipoPago: 'SIMULTANEO' })
ok("el payload de la venta contiene { tipoPago: 'SIMULTANEO' }", true)
// Ninguna otra forma de pago clasifica como simultánea.
for (const forma of FORMAS_PAGO_VENTA.filter((f) => f !== 'CONTADO')) {
  ok(`${forma} NO es simultáneo`, !cobroSimultaneoOperacion(forma))
}

console.log('Caso 2 · POSTERIOR son las otras tres formas de pago:')
assert.deepEqual(
  [...FORMAS_PAGO_POSTERIOR].sort(),
  ['CUENTA CORRIENTE', 'TARJETA DE CREDITO', 'TARJETA DE DEBITO'],
  'el catálogo de formas posteriores es exactamente el pedido',
)
for (const forma of FORMAS_PAGO_POSTERIOR) {
  ok(`${forma} → 'POSTERIOR'`, tipoPagoOperacion(forma) === 'POSTERIOR')
  assert.deepEqual(datosCobroVenta(forma), { tipoPago: 'POSTERIOR' })
  ok(`${forma}: el payload viaja como POSTERIOR`, true)
  ok(`${forma}: se pide el registro de la deuda`, requiereRegistroDeuda(forma, cobro) === true)
}
// Las tres posteriores más CONTADO son TODAS las formas de pago: no queda ninguna sin clasificar.
assert.equal(
  FORMAS_PAGO_POSTERIOR.length + 1,
  FORMAS_PAGO_VENTA.length,
  'toda forma de pago cae en SIMULTANEO o POSTERIOR',
)

console.log('Caso 3 · La deuda: sólo en POSTERIOR y sólo una vez:')
ok('CONTADO no genera deuda', requiereRegistroDeuda('CONTADO', cobro) === false)
ok(
  'con deudaId ya escrito no se vuelve a pedir',
  requiereRegistroDeuda('CUENTA CORRIENTE', cobroBase({ deudaId: '123', confirmado: true })) ===
    false,
)

console.log('Caso 4 · El "SI/NO" del cierre ya NO cambia la clasificación (era el bug):')
const cobroSi = cobroBase({ registrar: true })
ok(
  'CUENTA CORRIENTE sigue siendo POSTERIOR aunque se registre un cobro en el acto',
  tipoPagoOperacion('CUENTA CORRIENTE') === 'POSTERIOR',
)
ok(
  'y su deuda se sigue pidiendo igual',
  requiereRegistroDeuda('CUENTA CORRIENTE', cobroSi) === true,
)

console.log('Caso 5 · Sin forma de pago elegida no se puede afirmar que se cobró:')
ok('null → POSTERIOR', tipoPagoOperacion(null) === 'POSTERIOR')
ok('null no es simultáneo', !cobroSimultaneoOperacion(null))

console.log('Caso 6 · El impacto en cuenta corriente es de la cuenta corriente:')
ok('CUENTA CORRIENTE lo muestra', mostrarImpactoCtaCte('CUENTA CORRIENTE') === true)
for (const forma of ['CONTADO', 'TARJETA DE DEBITO', 'TARJETA DE CREDITO'] as FormaPagoVenta[]) {
  ok(`${forma} no lo muestra`, mostrarImpactoCtaCte(forma) === false)
}

console.log('Caso 7 · El CRM sólo filtra QUÉ formas se ofrecen, no cómo se clasifican:')
assert.deepEqual(
  formasPagoDeCliente('CUENTA CORRIENTE'),
  FORMAS_PAGO_VENTA,
  'al cliente de cuenta corriente se le ofrecen las cuatro',
)
for (const cond of ['CONTADO', 'PROVEED 45 DIAS', 'PROVEED 90 DIAS', null] as const) {
  assert.deepEqual(formasPagoDeCliente(cond), ['CONTADO'], `${cond}: sólo se le ofrece CONTADO`)
}
/* Consecuencia directa: un cliente de plazos de proveedor sólo puede elegir CONTADO, así que su
   venta queda SIMULTANEA. Antes se clasificaba POSTERIOR mirando su condición de pago. */
ok(
  'plazos de proveedor: su única forma posible (CONTADO) es SIMULTANEA',
  tipoPagoOperacion(formasPagoDeCliente('PROVEED 45 DIAS')[0]) === 'SIMULTANEO',
)

console.log(`\nOK · ${asserts} asserts pasaron.`)
