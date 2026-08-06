/**
 * Los descuentos por pronto pago tienen UNA sola fuente: el tablero "⚙️Configuracion - Sistema"
 * (ítems "Medios de Cobro"). La app no puede tener una segunda tabla de porcentajes escrita a
 * mano: el día que difiera del tablero, bonificaría por un número que nadie configuró.
 */
import assert from 'node:assert/strict'
import {
  DESCUENTO_PAGO_DEFAULT,
  FORMAS_PAGO,
  MEDIOS_CONTADO,
  descuentoDeFormaPago,
} from '@/lib/cobros'
import type { DescuentosPago } from '@/lib/cobros'

// ---------- El estado de arranque no inventa descuentos ----------
for (const forma of FORMAS_PAGO) {
  assert.equal(
    DESCUENTO_PAGO_DEFAULT[forma],
    0,
    `"${forma}" arranca con un descuento escrito en la app en vez de leerlo del tablero`,
  )
}
// Sin configuración leída, ninguna forma de venta bonifica.
for (const forma of ['CONTADO', 'CUENTA CORRIENTE', 'TARJETA DE DEBITO', 'TARJETA DE CREDITO'] as const) {
  assert.equal(
    descuentoDeFormaPago(forma, DESCUENTO_PAGO_DEFAULT),
    0,
    `"${forma}" bonifica antes de leer la configuración`,
  )
}

// ---------- Efectivo, Transferencia y Cheque son un solo grupo: CONTADO ----------
assert.deepEqual(
  [...MEDIOS_CONTADO].sort(),
  ['Cheque', 'Efectivo', 'Transferencia'],
  'cambió la composición del grupo CONTADO',
)
// La forma de venta CONTADO tiene que leer un medio del grupo, no uno de afuera.
const sonda: DescuentosPago = { ...DESCUENTO_PAGO_DEFAULT }
for (const medio of MEDIOS_CONTADO) sonda[medio] = 7
assert.equal(descuentoDeFormaPago('CONTADO', sonda), 7, 'CONTADO no lee el descuento del grupo')

// Las tarjetas son independientes: cada una con su propio medio.
const tarjetas: DescuentosPago = {
  ...DESCUENTO_PAGO_DEFAULT,
  'Tarjeta de débito': 5,
  'Tarjeta de crédito': 3,
}
assert.equal(descuentoDeFormaPago('TARJETA DE DEBITO', tarjetas), 5, 'débito no lee su medio')
assert.equal(descuentoDeFormaPago('TARJETA DE CREDITO', tarjetas), 3, 'crédito no lee su medio')
// La cuenta corriente no es pronto pago: nunca bonifica, esté lo que esté configurado.
assert.equal(
  descuentoDeFormaPago('CUENTA CORRIENTE', { ...sonda, ...tarjetas }),
  0,
  'la cuenta corriente está bonificando',
)

console.log('OK · los descuentos por pronto pago salen sólo del tablero de configuración')
