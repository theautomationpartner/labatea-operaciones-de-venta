/**
 * Test aislado de la UI del cierre de venta: visibilidad del impacto en cuenta corriente,
 * su maquetación, y el modal de registro de deuda.
 *
 * No hay runner de DOM en el proyecto, así que se renderiza con `react-dom/server`, que ya es
 * dependencia: alcanza para verificar qué queda montado y con qué clases. Los efectos NO
 * corren en el render de servidor, así que el disparo automático no pega contra Monday.
 *
 * Verifica los tres puntos del cambio:
 *   1. "Impacto en cuenta corriente" se oculta al elegir "SI" y se muestra sólo con
 *      CUENTA CORRIENTE + "NO".
 *   2. El campo "Deuda" se renderiza en verde (rótulo y valor).
 *   3. El modal de finalización dice "Registrando deuda..." e informa el monto exacto.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@/state/AppProvider'
import { ImpactoCtaCte } from '@/features/cobro/ImpactoCtaCte'
import { RegistrarDeudaModal } from '@/features/factura/RegistrarDeudaModal'
import { mostrarImpactoCtaCte, type ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente, CobroState, CondicionPago } from '@/types'

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
    codigo: 'CTA-042',
    ctaCteId: '99',
    saldoCtaCte: 400,
    lineaUtilizada: 400,
    remitosPendFacturar: 0,
    disponible: 600,
    addr: '',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  } as Cliente
}

const cobroBase = (registrar: boolean): CobroState =>
  ({
    registrar,
    fecha: '01/01/2026',
    movimientos: [],
    confirmado: false,
    cobroId: null,
    deudaId: null,
    saldoAnterior: null,
  }) as CobroState

/** Venta de $250 sin nada cobrado: es el caso del cobro posterior. */
const resumen = {
  totalACobrar: 250,
  totalCobrado: 0,
  descuentoTotal: 0,
  cancelado: 0,
} as ResumenCobro

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const ctaCte = clienteBase('CUENTA CORRIENTE')
const contado = clienteBase('CONTADO')

console.log('Caso 1 · Visibilidad del "Impacto en cuenta corriente":')
ok('CUENTA CORRIENTE + "NO" → se muestra', mostrarImpactoCtaCte(ctaCte, cobroBase(false)) === true)
ok('CUENTA CORRIENTE + "SI" → se OCULTA', mostrarImpactoCtaCte(ctaCte, cobroBase(true)) === false)
ok('cliente de contado → no se muestra', mostrarImpactoCtaCte(contado, cobroBase(false)) === false)
ok(
  'otras condiciones de pago tampoco lo muestran',
  mostrarImpactoCtaCte(clienteBase('PROVEED 45 DIAS'), cobroBase(false)) === false,
)

const impacto = renderToStaticMarkup(
  createElement(ImpactoCtaCte, { cliente: ctaCte, resumen }),
)

console.log('Caso 2 · Las 4 métricas del resumen de cuenta:')
ok('1. N° de cuenta', impacto.includes('N° de cuenta') && impacto.includes('CTA-042'))
ok('2. Saldo actual', impacto.includes('Saldo actual') && impacto.includes(money(400)))
ok('3. Deuda', impacto.includes('>Deuda<') && impacto.includes(money(250)))
// saldo 400 + deuda 250 = 650, dentro del límite de 1000.
ok('4. Saldo resultante', impacto.includes('SALDO RESULTANTE') && impacto.includes(money(650)))
ok('ya no se muestran límite ni monto cancelado', !impacto.includes('Monto cancelado'))

console.log('Caso 3 · La "Deuda" va en verde:')
ok(
  'el rótulo lleva la clase verde',
  impacto.includes('cobro-cab-lbl cobro-cab-lbl--verde">Deuda<'),
)
ok('el valor lleva la clase verde', impacto.includes('cobro-imp-num cobro-imp-num--verde'))
ok('no quedó ninguna acción montada dentro de la card', !impacto.includes('cobro-card-acts'))

const modal = renderToStaticMarkup(
  createElement(
    AppProvider,
    null,
    createElement(RegistrarDeudaModal, {
      cliente: ctaCte,
      total: 250,
      concepto: 'Cliente Test · 01/01/2026',
      onRegistrada: () => {},
      onCancelar: () => {},
    }),
  ),
)

console.log('Caso 4 · El modal de finalización:')
ok('el título es "Registrando deuda..."', modal.includes('Registrando deuda...'))
ok('el cuerpo informa el monto exacto de la deuda', modal.includes(money(250)))
ok('y a qué cuenta se asienta', modal.includes('Cliente Test'))
ok('no hay botonera de confirmación', !/>\s*(Cancelar|Registrar deuda|Reintentar)\s*</i.test(modal))

console.log(`\nOK · ${asserts} asserts pasaron.`)
