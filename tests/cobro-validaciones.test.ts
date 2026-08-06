/**
 * Validaciones del REGISTRAR COBRO:
 *   · MÓDULO 1 — retenciones: catálogo, detección por prefijo y comprobante obligatorio.
 *   · MÓDULO 2 — cheque: el vencimiento no puede ser posterior al día de hoy.
 *   · CUIT del emisor del cheque: tres tramos (XX-XXXXXXXX-X), sólo dígitos y exactos.
 *   · TARJETA: máscara de 16 dígitos, valor por cuota y la regla de DIFERENCIA en cero.
 *   · CRM: el cliente que no acepta cheques no puede pagar con cheque en una venta de contado.
 * Sin runner de DOM: se auditan las reglas puras, que son las que gobiernan el "+ Agregar".
 */
import assert from 'node:assert/strict'
import {
  CUIT_TRAMOS,
  CUOTAS_CREDITO,
  DESCUENTO_PAGO_DEFAULT,
  FORMAS_PAGO,
  MSG_CHEQUE_VENCIMIENTO,
  MSG_CLIENTE_SIN_CHEQUE,
  MSG_NRO_TARJETA,
  SIN_DESCUENTOS_PAGO,
  balancePagos,
  bloqueoCobro,
  chequeBloqueado,
  chequeInvalido,
  cuitCompleto,
  diferenciaCobro,
  diferenciaEnCero,
  esRetencion,
  formaPagoTarjeta,
  formatearNroTarjeta,
  nroTarjetaCompleto,
  partesCuit,
  resumenCobro,
  retencionSinComprobante,
  soloDigitos,
  tramoCuitIncompleto,
  valorPorCuota,
  vencimientoChequeInvalido,
} from '@/lib/cobros'
import { formatDate } from '@/lib/dates'
import { totalVentaOperacion } from '@/lib/selectors'
import type { Cliente, CobroState, LineaPresupuesto, MovimientoPago } from '@/types'

const diaRelativo = (dias: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return formatDate(d)
}
const HOY = diaRelativo(0)
const AYER = diaRelativo(-1)
const MANANA = diaRelativo(1)

// ---------- MÓDULO 1: catálogo y detección de retenciones ----------
assert.ok(FORMAS_PAGO.includes('Retencion IVA'), '"Retencion IVA" está en el selector de medios')
assert.equal(DESCUENTO_PAGO_DEFAULT['Retencion IVA'], 0, 'una retención no lleva pronto pago')

for (const forma of ['Retencion IVA', 'Retencion IIBB', 'Retencion GAN']) {
  assert.ok(esRetencion(forma), `${forma} entra por el ramal de retenciones`)
}
// La detección es por PREFIJO: una retención que todavía no existe en el catálogo también entra.
assert.ok(esRetencion('Retencion SUSS'), 'una retención nueva hereda el ramal sin tocar la lógica')
assert.ok(esRetencion('retención ganancias'), 'sin distinguir mayúsculas ni tilde')
for (const forma of ['Efectivo', 'Cheque', 'Transferencia', 'Tarjeta de crédito', '']) {
  assert.ok(!esRetencion(forma), `${forma || '(vacío)'} NO es una retención`)
}
// "Retencion" tiene que ser la primera palabra, no aparecer en cualquier lado del nombre.
assert.ok(!esRetencion('Pago con Retencion IVA'), 'el nombre debe EMPEZAR con "Retencion"')

// ---------- MÓDULO 1: el comprobante es obligatorio ----------
const retencion = (comprobanteNombre?: string): Pick<MovimientoPago, 'formaPago' | 'comprobanteNombre'> => ({
  formaPago: 'Retencion IVA',
  comprobanteNombre,
})
assert.ok(retencionSinComprobante(retencion()), 'sin archivo no se puede agregar')
assert.ok(retencionSinComprobante(retencion('   ')), 'un nombre en blanco no es un comprobante')
assert.ok(!retencionSinComprobante(retencion('retencion.pdf')), 'con archivo cargado, habilitado')
assert.ok(
  !retencionSinComprobante({ formaPago: 'Efectivo' }),
  'el efectivo no pide comprobante',
)

// ---------- CRM: el cliente que no acepta cheques ----------
const conCheques = (aceptaCheques: boolean) => ({ aceptaCheques }) as Cliente
// Las DOS condiciones juntas: el CRM dice que no, y la venta se armó como CONTADO.
assert.ok(chequeBloqueado(conCheques(false), 'CONTADO'), 'NO + CONTADO bloquea el cheque')
assert.ok(!chequeBloqueado(conCheques(true), 'CONTADO'), 'SI lo deja elegir libremente')
assert.ok(
  !chequeBloqueado(conCheques(false), 'CUENTA CORRIENTE'),
  'con otra forma de pago el cheque sigue disponible aunque el CRM diga NO',
)
assert.ok(!chequeBloqueado(conCheques(false), null), 'sin forma de pago elegida no bloquea')
assert.ok(!chequeBloqueado(null, 'CONTADO'), 'sin cliente cargado no bloquea')
assert.equal(MSG_CLIENTE_SIN_CHEQUE, 'cliente no acepta cheque', 'el aviso es el pedido')

// ---------- MÓDULO 2: vencimiento del cheque ----------
assert.ok(!vencimientoChequeInvalido(HOY), 'vencer HOY es válido (la regla es <=)')
assert.ok(!vencimientoChequeInvalido(AYER), 'un vencimiento pasado es válido')
assert.ok(vencimientoChequeInvalido(MANANA), 'un vencimiento futuro incumple la regla')
assert.ok(vencimientoChequeInvalido(''), 'sin fecha cargada no se puede agregar')
assert.ok(vencimientoChequeInvalido(undefined), 'sin fecha cargada no se puede agregar')

const cheque = (chequeVencimiento: string): Pick<MovimientoPago, 'formaPago' | 'chequeVencimiento'> => ({
  formaPago: 'Cheque',
  chequeVencimiento,
})
assert.ok(chequeInvalido(cheque(MANANA)), 'el cheque a futuro queda marcado')
assert.ok(!chequeInvalido(cheque(HOY)), 'el cheque de hoy pasa')
assert.ok(
  !chequeInvalido({ formaPago: 'Efectivo', chequeVencimiento: MANANA }),
  'la regla sólo mira los cheques',
)

// ---------- CUIT del emisor del cheque: XX-XXXXXXXX-X ----------
assert.deepEqual(
  CUIT_TRAMOS.map((t) => t.digitos),
  [2, 8, 1],
  'el template del CUIT son tres tramos de 2, 8 y 1 dígitos',
)

// Lo que no es número no entra, y el tope recorta: la tecla se descarta, no se avisa.
assert.equal(soloDigitos('ab12cd', 2), '12', 'las letras no entran')
assert.equal(soloDigitos('20-3', 2), '20', 'los guiones tampoco: los pone el template')
assert.equal(soloDigitos('123', 2), '12', 'no deja pasar más dígitos que el tope del tramo')
assert.equal(soloDigitos('123456789012', 8), '12345678', 'el DNI se corta en 8')
assert.equal(soloDigitos('9x', 1), '9', 'el verificador acepta un solo número')
assert.equal(soloDigitos('', 2), '', 'vacío sigue vacío')

// El valor guardado siempre se parte en tres tramos, aun a medio cargar.
assert.deepEqual(partesCuit('20-12345678-9'), ['20', '12345678', '9'], 'CUIT completo')
assert.deepEqual(partesCuit('20-1234-'), ['20', '1234', ''], 'CUIT a medio cargar')
assert.deepEqual(partesCuit(''), ['', '', ''], 'sin cargar')
assert.deepEqual(partesCuit(undefined), ['', '', ''], 'sin cargar')

assert.ok(cuitCompleto('20-12345678-9'), 'los tres tramos con su cantidad exacta')
assert.ok(!cuitCompleto('2-12345678-9'), 'el primer tramo por debajo de 2 no alcanza')
assert.ok(!cuitCompleto('20-1234567-9'), 'un DNI de 7 dígitos no alcanza')
assert.ok(!cuitCompleto('20-12345678-'), 'sin verificador no alcanza')
assert.ok(!cuitCompleto(''), 'sin CUIT no se puede agregar el cheque')

// El mensaje señala el tramo que quedó corto, no un error genérico.
assert.equal(tramoCuitIncompleto('20-12345678-9'), -1, 'completo: ningún tramo en falta')
assert.equal(tramoCuitIncompleto('2-12345678-9'), 0, 'señala el primer tramo')
assert.equal(tramoCuitIncompleto('20-1234-9'), 1, 'señala el DNI')
assert.equal(tramoCuitIncompleto('20-12345678-'), 2, 'señala el verificador')
assert.equal(
  CUIT_TRAMOS[1].error,
  'El DNI del CUIT debe tener 8 números',
  'el mensaje dice qué input está por debajo de lo requerido',
)

// ---------- Cobro con tarjeta: máscara, 16 dígitos, cuotas y diferencia ----------
assert.equal(formaPagoTarjeta('DEBITO'), 'Tarjeta de débito', 'el débito registra su propio medio')
assert.equal(formaPagoTarjeta('CREDITO'), 'Tarjeta de crédito', 'y el crédito el suyo')
assert.deepEqual([...CUOTAS_CREDITO], [3, 6, 12], 'las cuotas del crédito son fijas')

// Máscara: agrupa de a 4, sólo números y nunca más de 16 dígitos.
assert.deepEqual(
  formatearNroTarjeta('4509953566233704'),
  { texto: '4509 9535 6623 3704', digitos: '4509953566233704' },
  'el número se agrupa de a 4 para mostrar y se guarda sin espacios',
)
assert.equal(formatearNroTarjeta('4509').texto, '4509', 'sin espacio de más al completar un grupo')
assert.equal(formatearNroTarjeta('45099').texto, '4509 9', 'el espacio entra solo al seguir')
assert.equal(
  formatearNroTarjeta('4509-9535 abc 6623').digitos,
  '450995356623',
  'lo que no es número se descarta',
)
assert.equal(
  formatearNroTarjeta('45099535662337041234').digitos.length,
  16,
  'no se pasa de 16 dígitos',
)

assert.ok(nroTarjetaCompleto('4509953566233704'), '16 dígitos habilita el agregado')
assert.ok(!nroTarjetaCompleto('450995356623370'), '15 dígitos NO alcanzan')
assert.ok(!nroTarjetaCompleto(''), 'sin número tampoco')
assert.equal(
  MSG_NRO_TARJETA,
  'Número de tarjeta inválido. Debe contener 16 dígitos',
  'el mensaje del número de tarjeta es el pedido',
)

// Valor x cuota: se recalcula con el importe del movimiento.
assert.equal(valorPorCuota(120000, 3), 40000, 'importe / cuotas')
assert.equal(valorPorCuota(100000, 6), 16666.67, 'redondeado a dos decimales')
assert.equal(valorPorCuota(120000, 0), null, 'sin cuotas (débito) no hay valor por cuota')
assert.equal(valorPorCuota(120000, undefined), null, 'sin cuotas cargadas tampoco')

// Diferencia: sólo el CERO exacto habilita avanzar de etapa.
const resumenDe = (total: number, cobrado: number) =>
  resumenCobro(balancePagos([{ importe: cobrado } as MovimientoPago], SIN_DESCUENTOS_PAGO), total)
assert.equal(diferenciaCobro(resumenDe(100000, 100000)), 0, 'cobrado justo → diferencia 0')
assert.ok(diferenciaEnCero(resumenDe(100000, 100000)), 'con la diferencia en 0 se puede avanzar')
assert.ok(!diferenciaEnCero(resumenDe(100000, 99999)), 'falta cobrar → bloqueado')
assert.ok(!diferenciaEnCero(resumenDe(100000, 100001)), 'cobro excedente → bloqueado')
// Ni siquiera los centavos pasan: la tarjeta exige el cero exacto (el contado sí los tolera).
assert.ok(!diferenciaEnCero(resumenDe(181396.91, 181396)), 'una diferencia de centavos bloquea')

// El cobro con tarjeta NO descuenta por medio de pago: ya viene aplicado en el total de la venta.
assert.equal(SIN_DESCUENTOS_PAGO['Tarjeta de crédito'], 0, 'el crédito no descuenta por movimiento')
assert.equal(
  balancePagos([{ formaPago: 'Tarjeta de crédito', importe: 100000 } as MovimientoPago], SIN_DESCUENTOS_PAGO)[0]
    .montoCobrado,
  100000,
  'lo cobrado es el importe cargado, sin recortes',
)

// ---------- TOTAL de la venta: el importe FINAL, con el descuento por forma de pago ----------
/* Es el número que alimenta la métrica "TOTAL VENTA" del cobro y el que viaja a `numeric_mm5xbjkm`
   del recibo. Tiene que ser el precio REAL que se le cobra al cliente, no el total facturado. */
const lineaDe = (precio: number, cantidad: number, descuento = 0): LineaPresupuesto =>
  ({
    producto: { precio, iva: 21 },
    cantidad,
    descuento,
  }) as LineaPresupuesto

const datosVenta = (descFormaPago: number) => ({
  cliente: null,
  operacion: 'VENTA' as const,
  tipoVenta: 'DIRECTA' as const,
  tipoEntrega: 'SIMULTANEA' as const,
  lineas: [lineaDe(100_000, 1)],
  ventaItems: [],
  facturaItems: [],
  proformaImporte: null,
  descFormaPago,
})

const sinDescuento = totalVentaOperacion(datosVenta(0)).total
const conDescuento = totalVentaOperacion(datosVenta(6)).total
assert.equal(sinDescuento, 121_000, 'sin descuento por forma de pago: 100.000 + IVA')
assert.ok(conDescuento < sinDescuento, 'el descuento por forma de pago BAJA el total de la venta')
assert.equal(conDescuento, 113_740, '100.000 − 6% = 94.000, + IVA = 113.740')

// VENTA PROFORMA: el total es EXACTAMENTE el de la proforma, que ya lo trae aplicado.
assert.equal(
  totalVentaOperacion({
    ...datosVenta(6),
    operacion: 'VENTA PROFORMA',
    proformaImporte: 250_000,
  }).total,
  250_000,
  'la proforma manda sobre cualquier recálculo',
)

// ---------- Bloqueo del cobro: los dos módulos frenan el registro ----------
const cliente = { condicionPago: 'CONTADO' } as Cliente
const cobroCon = (movimientos: Partial<MovimientoPago>[]): CobroState =>
  ({
    registrar: true,
    movimientos: movimientos.map((m, i) => ({
      id: String(i),
      importe: 100,
      referencia: '',
      chequeVencimiento: '',
      formaPago: 'Efectivo',
      ...m,
    })),
  }) as CobroState

assert.equal(
  bloqueoCobro(cliente, cobroCon([{ formaPago: 'Cheque', chequeVencimiento: MANANA }])),
  `${MSG_CHEQUE_VENCIMIENTO}.`,
  'un cheque a futuro bloquea el cobro con el mensaje de la regla',
)
assert.equal(
  bloqueoCobro(cliente, cobroCon([{ formaPago: 'Retencion IVA' }])),
  'Las retenciones necesitan el comprobante adjunto.',
  'una retención sin comprobante bloquea el cobro',
)
assert.equal(
  bloqueoCobro(
    cliente,
    cobroCon([
      { formaPago: 'Cheque', chequeVencimiento: HOY },
      { formaPago: 'Retencion IVA', comprobanteNombre: 'ret.pdf' },
    ]),
  ),
  null,
  'movimientos bien cargados no bloquean (sin resumen no se mide el 100%)',
)

console.log('OK · validaciones del cobro (retenciones, cheque con CUIT y cobro con tarjeta)')
