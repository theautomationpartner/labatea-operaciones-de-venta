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
  DESCUENTO_PAGO_DEFAULT,
  FORMAS_PAGO,
  MSG_CHEQUE_FECHA_PAGO,
  MSG_CHEQUE_VENCIDO,
  MSG_CHEQUE_CLIENTE_NO,
  MSG_CUIT_SIN_VALIDAR,
  SIN_DESCUENTOS_PAGO,
  balancePagos,
  chequeDelClienteVedado,
  validarCuitEmisor,
  chequeInvalido,
  cuitCompleto,
  cuitEsDelCliente,
  diferenciaCobro,
  diferenciaEnCero,
  esRetencion,
  formaPagoTarjeta,
  partesCuit,
  resumenCobro,
  retencionSinComprobante,
  soloDigitos,
  tramoCuitIncompleto,
  chequeVencido,
  fechaPagoChequeInvalida,
  vencimientoCheque,
  DIAS_VIGENCIA_CHEQUE,
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

/* El catálogo de retenciones se resuelve por PREFIJO, no enumerando: sumar una al selector alcanza
   para que herede todo el ramal (comprobante obligatorio, nro de comprobante, año y su subitem).
   Se verifica sobre las cuatro reales y sobre una inventada, que es el caso de la que venga. */
for (const forma of [
  'Retencion IVA',
  'Retencion IIBB',
  'Retencion GAN',
  'Retencion CCSS',
  'Retencion QUE_VENGA',
]) {
  assert.ok(esRetencion(forma), `${forma} entra al ramal de retenciones`)
  assert.ok(
    retencionSinComprobante({ formaPago: forma } as MovimientoPago),
    `${forma} exige el comprobante adjunto`,
  )
}
// Y la nueva está OFRECIDA en el selector, que es lo único que no sale del prefijo.
assert.ok(FORMAS_PAGO.includes('Retencion CCSS'), 'Retencion CCSS se ofrece como medio de cobro')

/* ---------- CRM: el cheque PROPIO del cliente que no acepta cheques ----------
   La veda ya no es del medio de cobro entero: es de ESE cheque. Se dispara sólo cuando el CUIT del
   emisor es el del cliente de la operación y su "Recibimos CHEQUE" (color_mm5yb27h) dice NO; el
   cheque de un tercero se cobra igual, y por eso el mensaje pide otro CUIT. */
const CUIT_CLIENTE = '20-45037195-6'
const cli = (cuit: string, aceptaCheques: boolean) => ({ cuit, aceptaCheques }) as Cliente

assert.ok(
  chequeDelClienteVedado(cli(CUIT_CLIENTE, false), CUIT_CLIENTE),
  'mismo CUIT + "NO" en el CRM: el cheque no se puede registrar',
)
assert.ok(
  !chequeDelClienteVedado(cli(CUIT_CLIENTE, true), CUIT_CLIENTE),
  'mismo CUIT pero "SI" en el CRM: se registra sin problema',
)
assert.ok(
  !chequeDelClienteVedado(cli(CUIT_CLIENTE, false), '30-71234567-4'),
  'el cheque de un TERCERO se acepta aunque al cliente no le recibamos los suyos',
)
assert.ok(
  !chequeDelClienteVedado(cli(CUIT_CLIENTE, false), '20-45037195'),
  'con el CUIT a medio cargar todavía no se opina: la regla espera los 11 dígitos',
)
assert.ok(!chequeDelClienteVedado(null, CUIT_CLIENTE), 'sin cliente cargado no veda nada')
assert.ok(
  !chequeDelClienteVedado(cli('', false), CUIT_CLIENTE),
  'un cliente sin CUIT en el CRM no puede "coincidir" con ningún emisor',
)

// La comparación es por DÍGITOS: el CRM guarda el CUIT como texto y el formato varía.
assert.ok(cuitEsDelCliente(cli('20450371956', true), CUIT_CLIENTE), 'sin guiones es el mismo CUIT')
assert.ok(cuitEsDelCliente(cli(' 20-45037195-6 ', true), CUIT_CLIENTE), 'los espacios no cuentan')
assert.ok(!cuitEsDelCliente(cli('20-45037195-7', true), CUIT_CLIENTE), 'un dígito distinto ya no')

assert.equal(
  MSG_CHEQUE_CLIENTE_NO,
  'No se reciben cheques del cliente seleccionado. Ingrese otro CUIT.',
  'el mensaje debajo del CUIT es el pedido',
)

/* ---------- El botón "Validar": los tres estados del CUIT del emisor ----------
   La validación NO se dispara sola al terminar de escribir: la corre el vendedor apretando el
   botón. Eso es lo que distingue 'pendiente' (cargado pero nunca contrastado) de los otros dos. */
assert.equal(
  validarCuitEmisor(cli(CUIT_CLIENTE, true), CUIT_CLIENTE),
  'validado',
  'el cheque del cliente al que SÍ le recibimos cheques queda validado',
)
assert.equal(
  validarCuitEmisor(cli(CUIT_CLIENTE, false), CUIT_CLIENTE),
  'rechazado',
  'el cheque del cliente al que NO le recibimos cheques queda rechazado',
)
assert.equal(
  validarCuitEmisor(cli(CUIT_CLIENTE, false), '30-71234567-4'),
  'validado',
  'el cheque de un tercero se valida sin contrastar nada: no hay regla que lo impida',
)
assert.equal(
  validarCuitEmisor(null, CUIT_CLIENTE),
  'validado',
  'sin cliente cargado no hay contra qué rechazar',
)
/* Un CUIT a medio cargar NO se puede validar: apretar el botón lo deja como estaba. El campo ya
   avisa por su cuenta qué tramo le falta, así que no hace falta un segundo mensaje. */
assert.equal(
  validarCuitEmisor(cli(CUIT_CLIENTE, false), '20-45037195'),
  'pendiente',
  'el CUIT incompleto no se valida ni se rechaza: sigue pendiente',
)
assert.equal(validarCuitEmisor(cli(CUIT_CLIENTE, false), ''), 'pendiente', 'y vacío tampoco')

assert.equal(
  MSG_CUIT_SIN_VALIDAR,
  'Validá el CUIT del emisor antes de agregar el cheque',
  'el recordatorio de validar es el que ve el vendedor al intentar agregar sin haber validado',
)

/* ---------- MÓDULO 2: las DOS fechas del cheque ----------
   El vendedor carga UNA sola —la de PAGO— y el vencimiento sale de ella sumando los días de
   vigencia. Que sea derivado es lo que hace que las dos reglas no sean independientes, y eso es
   justo lo que se fija acá: mientras el cálculo sea "pago + 30", una fecha de pago válida NUNCA
   puede dar un cheque vencido. */
assert.equal(DIAS_VIGENCIA_CHEQUE, 30, 'un cheque vale 30 días desde su fecha de pago')
assert.equal(
  vencimientoCheque(HOY),
  diaRelativo(DIAS_VIGENCIA_CHEQUE),
  'el vencimiento es la fecha de pago más los días de vigencia',
)
assert.equal(vencimientoCheque(''), '', 'sin fecha de pago no hay vencimiento que mostrar')
assert.equal(vencimientoCheque(undefined), '', 'ni con el campo sin tocar')

/* La fecha de pago: SOLO hoy. Es una igualdad estricta, no un piso: el cheque cuenta como pago de
   contado porque el banco lo paga el mismo día en que se registra el cobro, y eso no lo cumple ni
   el diferido ni el atrasado. Las dos direcciones se fijan por separado porque son dos errores
   distintos de cometer: aceptar el de ayer sería una regla `>=` mal escrita, y aceptar el de
   mañana —que es el caso REAL, el cheque a 30 días que el cliente ofrece— sería no haber
   cambiado nada. */
assert.ok(!fechaPagoChequeInvalida(HOY), 'pagadero HOY es lo único válido')
assert.ok(fechaPagoChequeInvalida(MANANA), 'un cheque diferido no es plata de hoy: no entra')
assert.ok(fechaPagoChequeInvalida(diaRelativo(30)), 'ni el típico a 30 días')
assert.ok(fechaPagoChequeInvalida(AYER), 'y uno de ayer tampoco: estuvo disponible y no se presentó')
/* Sin fecha NO es "inválida": es un campo sin cargar, que el formulario reclama por otro lado. Que
   estas dos cosas sean distintas es lo que deja mostrar dos mensajes distintos. */
assert.ok(!fechaPagoChequeInvalida(''), 'sin fecha cargada no hay fecha mala, hay un campo vacío')
assert.ok(!fechaPagoChequeInvalida(undefined), 'ni con el campo sin tocar')

/* El vencido: sólo puede darse con una fecha de pago vieja de MÁS de los días de vigencia. Con el
   borde exacto —pago = hoy − 30— el vencimiento cae HOY, y un cheque que vence hoy todavía se
   cobra. */
assert.ok(!chequeVencido(HOY), 'un cheque pagadero hoy no está vencido')
assert.ok(!chequeVencido(AYER), 'ni uno de ayer: le quedan 29 días')
assert.ok(
  !chequeVencido(diaRelativo(-DIAS_VIGENCIA_CHEQUE)),
  'ni el del borde exacto, que vence HOY',
)
assert.ok(
  chequeVencido(diaRelativo(-DIAS_VIGENCIA_CHEQUE - 1)),
  'un día más viejo y el vencimiento ya pasó: el cheque está VENCIDO',
)
assert.ok(!chequeVencido(''), 'sin fecha de pago no hay vencimiento y no hay nada vencido')

const cheque = (chequeFechaPago: string): Pick<MovimientoPago, 'formaPago' | 'chequeFechaPago'> => ({
  formaPago: 'Cheque',
  chequeFechaPago,
})
assert.ok(chequeInvalido(cheque(AYER)), 'el cheque con fecha de pago vieja queda marcado')
assert.ok(chequeInvalido(cheque(MANANA)), 'y el diferido también')
assert.ok(chequeInvalido(cheque('')), 'y sin fecha tampoco se puede cargar')
assert.ok(!chequeInvalido(cheque(HOY)), 'el único que pasa es el pagadero hoy')
assert.ok(
  !chequeInvalido({ formaPago: 'Efectivo', chequeFechaPago: AYER }),
  'la regla sólo mira los cheques',
)

/* Los dos mensajes son los que ve el vendedor debajo de cada campo, y no dicen lo mismo: uno pide
   corregir la fecha, el otro pide OTRO cheque. */
assert.equal(MSG_CHEQUE_FECHA_PAGO, 'La fecha de pago debe ser la de hoy')
assert.equal(MSG_CHEQUE_VENCIDO, 'El cheque está VENCIDO. Ingresar otro cheque.')

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

/* ---------- Cobro con tarjeta: medio y diferencia ----------
   Débito y crédito registran medios distintos, pero piden EXACTAMENTE los mismos datos: el plan de
   cuotas —cantidad y valor de cada una— era lo único que los separaba y ya no se carga. */
assert.equal(formaPagoTarjeta('DEBITO'), 'Tarjeta de débito', 'el débito registra su propio medio')
assert.equal(formaPagoTarjeta('CREDITO'), 'Tarjeta de crédito', 'y el crédito el suyo')

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

/* ---------- Lo que frena la carga de un movimiento ----------
   Cada regla se evalúa por movimiento, en el formulario, antes de dejar agregarlo. Antes había
   además un `bloqueoCobro` que las componía en un mensaje: nunca se mostró en ninguna pantalla
   —la card arma el suyo con el total— así que se eliminó junto con el resto del código muerto. */
const movimiento = (m: Partial<MovimientoPago>): MovimientoPago =>
  ({ id: '1', importe: 100, referencia: '', chequeFechaPago: '', formaPago: 'Efectivo', ...m }) as MovimientoPago

assert.equal(
  chequeInvalido(movimiento({ formaPago: 'Cheque', chequeFechaPago: AYER })),
  true,
  'un cheque con fecha de pago distinta de hoy no se puede cargar',
)
assert.equal(
  chequeInvalido(movimiento({ formaPago: 'Cheque', chequeFechaPago: HOY, cuitEmisor: '20-12345678-3' })),
  false,
  'un cheque pagadero hoy con CUIT completo se puede cargar',
)
assert.equal(
  retencionSinComprobante(movimiento({ formaPago: 'Retencion IVA' })),
  true,
  'una retención sin comprobante no se puede cargar',
)
assert.equal(
  retencionSinComprobante(movimiento({ formaPago: 'Retencion IVA', comprobanteNombre: 'ret.pdf' })),
  false,
  'con el comprobante adjunto sí',
)

console.log('OK · validaciones del cobro (retenciones, cheque con CUIT y cobro con tarjeta)')
