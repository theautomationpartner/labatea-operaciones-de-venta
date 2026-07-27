/**
 * Test aislado del modal de registro de deuda (cierre de "CARGAR VENTA").
 *
 * No hay runner de DOM en el proyecto, así que se renderiza con `react-dom/server`, que ya es
 * dependencia: alcanza para verificar qué queda montado en el markup. Los efectos NO corren en
 * el render de servidor, así que el disparo automático no pega contra Monday.
 *
 * Verifica los dos puntos del cambio:
 *   1. Los botones de confirmación "Registrar deuda" y "Cancelar" ya no existen.
 *   2. El modal se dispara con el cierre en "NO" (condición `requiereRegistroDeuda`), y el
 *      resumen de la cuenta con el saldo resultante sigue intacto.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@/state/AppProvider'
import { RegistrarDeudaModal } from '@/features/factura/RegistrarDeudaModal'
import { requiereRegistroDeuda } from '@/lib/cobros'
import type { Cliente, CobroState } from '@/types'

const cliente = {
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
  codigo: 'C-1',
  ctaCteId: '99',
  saldoCtaCte: 400,
  lineaUtilizada: 400,
  remitosPendFacturar: 0,
  disponible: 600,
  addr: '',
  activity: 'Activo',
  situation: 'Liberado con crédito',
} as Cliente

const cobroNo = {
  registrar: false,
  fecha: '01/01/2026',
  movimientos: [],
  confirmado: false,
  cobroId: null,
  deudaId: null,
  saldoAnterior: null,
} as CobroState

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const markup = renderToStaticMarkup(
  createElement(
    AppProvider,
    null,
    createElement(RegistrarDeudaModal, {
      cliente,
      total: 250,
      concepto: 'Cliente Test · 01/01/2026',
      onRegistrada: () => {},
      onCancelar: () => {},
    }),
  ),
)

console.log('Caso 1 · La botonera de confirmación ya no existe en el DOM:')
ok('no está el botón "Registrar deuda y finalizar"', !/Registrar deuda/i.test(markup))
ok('no está el botón "Cancelar"', !/>\s*Cancelar\s*</i.test(markup))
ok('no queda ningún bloque de acciones montado', !markup.includes('modal-actions'))

console.log('Caso 2 · El registro arranca solo, sin paso intermedio:')
ok('el modal nace en estado "registrando"', markup.includes('modal-progreso'))
ok('y lo dice con aria-live para que se lea', markup.includes('aria-live="polite"'))

console.log('Caso 3 · El resumen de la cuenta queda intacto:')
ok('la card de datos sigue montada', markup.includes('modal-datos'))
ok('muestra el N° de cuenta', markup.includes('N° de cuenta'))
ok('muestra la deuda a registrar', markup.includes('Deuda a registrar'))
ok('muestra el saldo pendiente actual', markup.includes('Saldo pendiente actual'))
ok('muestra el SALDO RESULTANTE', markup.includes('Saldo resultante'))
// saldo 400 + deuda 250 = 650, dentro del límite de 1000.
ok('el saldo resultante es saldo + deuda', markup.includes('650'))

console.log('Caso 4 · Con el cierre en "NO" la finalización dispara el modal:')
ok('requiereRegistroDeuda = true', requiereRegistroDeuda(cliente, cobroNo) === true)
ok(
  'con "SI" (cobro simultáneo) no se dispara',
  requiereRegistroDeuda(cliente, { ...cobroNo, registrar: true }) === false,
)

console.log(`\nOK · ${asserts} asserts pasaron.`)
