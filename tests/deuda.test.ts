/**
 * Test aislado del cierre de venta: qué tipo de cobro se registra y cuándo se pide la deuda.
 * No depende de React ni de la red: ejercita las funciones puras de `@/lib/cobros`.
 * Se corre con esbuild + node (`npm run test:deuda`); vive fuera de `src/`.
 *
 * UNA sola fuente de verdad (`tipoPagoOperacion`) y UN solo dato de entrada: la FORMA DE PAGO
 * elegida en la selección de productos.
 *   · CONTADO / TARJETA DE DEBITO / DE CREDITO → SIMULTANEO
 *   · CUENTA CORRIENTE                         → POSTERIOR (y su deuda al finalizar)
 *
 * La tarjeta se cobra EN EL ACTO: sus cupones cancelan la venta, así que no deja Venta Pend de
 * Cobro. Lo único que se difiere es la acreditación bancaria, que no es asunto de la venta.
 *
 * La condición de pago del CLIENTE no participa: sólo decide qué formas se le ofrecen.
 */
import assert from 'node:assert/strict'
import type { FormaPagoVenta } from '@/types'
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

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

console.log('Caso 1 · SIMULTANEO es CONTADO y las dos tarjetas (se cobran en el acto):')
const SIMULTANEAS: readonly FormaPagoVenta[] = ['CONTADO', 'TARJETA DE DEBITO', 'TARJETA DE CREDITO']
for (const forma of SIMULTANEAS) {
  ok(`${forma} → 'SIMULTANEO'`, tipoPagoOperacion(forma) === 'SIMULTANEO')
  ok(`${forma}: corre el flujo del cobro inmediato`, cobroSimultaneoOperacion(forma))
  assert.deepEqual(datosCobroVenta(forma), { tipoPago: 'SIMULTANEO' })
  ok(`${forma}: el payload de la venta viaja como SIMULTANEO`, true)
  /* Lo importante del cambio: la tarjeta NO deja Venta Pend de Cobro. El cupón cancela la venta;
     que el banco acredite después es otro problema, no una deuda del cliente. */
  ok(`${forma}: NO deja Venta Pend de Cobro`, requiereRegistroDeuda(forma) === false)
}

console.log('Caso 2 · POSTERIOR es SÓLO la cuenta corriente:')
assert.deepEqual(
  [...FORMAS_PAGO_POSTERIOR],
  ['CUENTA CORRIENTE'],
  'el catálogo de formas posteriores es exactamente el pedido',
)
for (const forma of FORMAS_PAGO_POSTERIOR) {
  ok(`${forma} → 'POSTERIOR'`, tipoPagoOperacion(forma) === 'POSTERIOR')
  assert.deepEqual(datosCobroVenta(forma), { tipoPago: 'POSTERIOR' })
  ok(`${forma}: el payload viaja como POSTERIOR`, true)
  ok(`${forma}: se pide el registro de la deuda`, requiereRegistroDeuda(forma) === true)
}
// Simultáneas + posteriores son TODAS las formas de pago: no queda ninguna sin clasificar.
assert.equal(
  SIMULTANEAS.length + FORMAS_PAGO_POSTERIOR.length,
  FORMAS_PAGO_VENTA.length,
  'toda forma de pago cae en SIMULTANEO o POSTERIOR',
)
// Y ninguna forma está en los dos grupos a la vez.
for (const forma of SIMULTANEAS) {
  ok(`${forma} no figura entre las posteriores`, !FORMAS_PAGO_POSTERIOR.includes(forma))
}

/* La deuda depende de UN solo dato: la forma de pago. No mira el estado del cobro —antes recibía
   el `CobroState` entero para no duplicar la escritura mirando un `deudaId` que nunca se guardaba,
   así que la condición era inerte y aparentaba una protección inexistente—. */
console.log('Caso 3 · La deuda: sólo en POSTERIOR:')
for (const forma of SIMULTANEAS) {
  ok(`${forma} no genera deuda`, requiereRegistroDeuda(forma) === false)
}
ok('CUENTA CORRIENTE la genera', requiereRegistroDeuda('CUENTA CORRIENTE') === true)
ok('sin forma de pago no se pide deuda de una venta inexistente', requiereRegistroDeuda(null) === true)

console.log('Caso 4 · La condición del cliente NO clasifica el cobro (era el bug):')
ok(
  'CUENTA CORRIENTE es POSTERIOR por la FORMA DE PAGO, no por la condición del cliente',
  tipoPagoOperacion('CUENTA CORRIENTE') === 'POSTERIOR',
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
