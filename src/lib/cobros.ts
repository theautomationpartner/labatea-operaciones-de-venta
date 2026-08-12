/**
 * Reglas del cobro de una factura: descuentos por forma de pago, balance de cada
 * movimiento y trackeo de lo cobrado contra el total de la venta.
 */
import { parseDate } from '@/lib/dates'
import { round2 } from '@/lib/format'
import type {
  Cliente,
  CondicionPago,
  FormaPago,
  FormaPagoVenta,
  MovimientoPago,
  TipoPago,
  TipoTarjetaCobro,
} from '@/types'

/**
 * Formas de pago de la VENTA, en el orden en que se ofrecen. Débito y crédito son opciones
 * independientes: no hay un paso intermedio que pregunte el tipo de tarjeta.
 */
export const FORMAS_PAGO_VENTA: readonly FormaPagoVenta[] = [
  'CONTADO',
  'CUENTA CORRIENTE',
  'TARJETA DE DEBITO',
  'TARJETA DE CREDITO',
]

/**
 * Formas de pago que puede elegir el cliente según su condición de pago pactada:
 *   · CUENTA CORRIENTE → todas (contado, cuenta corriente y las dos tarjetas).
 *   · cualquier otra (CONTADO, proveedores) → sólo CONTADO.
 * Un cliente que no opera a cuenta corriente no puede diferir el pago.
 */
export const formasPagoDeCliente = (
  condicion: CondicionPago | null | undefined,
): readonly FormaPagoVenta[] => (condicion === 'CUENTA CORRIENTE' ? FORMAS_PAGO_VENTA : ['CONTADO'])

/** Las dos tarjetas comparten el ramal de cobro (formulario de tarjeta). */
export const esPagoConTarjeta = (forma: FormaPagoVenta | null): boolean =>
  forma === 'TARJETA DE DEBITO' || forma === 'TARJETA DE CREDITO'

/** Tipo de tarjeta que le corresponde a la forma de pago elegida. */
export const tipoTarjetaDe = (forma: FormaPagoVenta | null): TipoTarjetaCobro =>
  forma === 'TARJETA DE CREDITO' ? 'CREDITO' : 'DEBITO'

/**
 * Descuento por pronto pago que aplica una forma de pago de la VENTA. Los porcentajes viven en
 * `descuentosPago` (config del sistema), keyados por medio de cobro; acá se traduce cada forma
 * de venta a su medio: CONTADO paga como Efectivo, las tarjetas a su respectivo medio, y la
 * CUENTA CORRIENTE no lleva bonificación (no es pronto pago). Sin forma elegida, 0%.
 */
export const descuentoDeFormaPago = (
  forma: FormaPagoVenta | null,
  descuentos: DescuentosPago,
): number => {
  switch (forma) {
    case 'CONTADO':
      return descuentos.Efectivo
    case 'TARJETA DE DEBITO':
      return descuentos['Tarjeta de débito']
    case 'TARJETA DE CREDITO':
      return descuentos['Tarjeta de crédito']
    default:
      return 0
  }
}

export const FORMAS_PAGO: readonly FormaPago[] = [
  'Efectivo',
  'Cheque',
  'Transferencia',
  'Retencion IVA',
  'Retencion IIBB',
  'Retencion GAN',
  'Tarjeta de débito',
  'Tarjeta de crédito',
]

/**
 * Medios de cobro que son CONTADO. Los tres comparten SIEMPRE el mismo descuento por pronto pago:
 * es una sola condición comercial, no tres. `getDescuentosPago` resuelve un único valor para el
 * grupo y se lo asigna a los tres, así no pueden divergir aunque el tablero los cargue por
 * separado. El orden importa: es la prioridad con la que se busca el valor del grupo.
 */
export const MEDIOS_CONTADO: readonly FormaPago[] = ['Efectivo', 'Transferencia', 'Cheque']

/**
 * El medio de cobro es una RETENCIÓN impositiva. No se enumeran las retenciones una por una: se
 * reconocen porque el nombre EMPIEZA con "Retencion" (con o sin tilde, sin distinguir mayúsculas),
 * así agregar "Retencion IVA", "Retencion SUSS" o la que venga al catálogo alcanza para que hereden
 * su ramal de carga —importe + comprobante adjunto obligatorio— sin tocar esta lógica.
 */
export const esRetencion = (forma: string | null | undefined): boolean =>
  /^retenci[oó]n\b/i.test((forma ?? '').trim())

/** Una retención sólo se puede cargar con su comprobante adjunto. */
export const retencionSinComprobante = (
  m: Pick<MovimientoPago, 'formaPago' | 'comprobanteNombre'>,
): boolean => esRetencion(m.formaPago) && !m.comprobanteNombre?.trim()

/** Descuento por pronto pago de cada forma de pago, en puntos porcentuales. */
export type DescuentosPago = Record<FormaPago, number>

/**
 * Tabla de descuentos en CERO. El registro del cobro no aplica descuentos por medio de pago: el
 * descuento por forma de pago ya viene aplicado en el total de la venta (`descuentoDeFormaPago`),
 * así que volver a descontarlo por movimiento lo contaría dos veces. Lo que se cobra es el importe
 * cargado, y por eso "Total Cobrado" puede igualar exactamente el total de la venta.
 */
export const SIN_DESCUENTOS_PAGO: DescuentosPago = {
  Efectivo: 0,
  Cheque: 0,
  Transferencia: 0,
  'Retencion IVA': 0,
  'Retencion IIBB': 0,
  'Retencion GAN': 0,
  'Tarjeta de débito': 0,
  'Tarjeta de crédito': 0,
}

/**
 * Estado de arranque: TODO en cero, hasta que `getDescuentosPago` traiga la configuración real.
 *
 * A propósito no lleva porcentajes: los descuentos por pronto pago los define el tablero
 * "⚙️Configuracion - Sistema" (ítems de tipo "Medios de Cobro") y son su única fuente. Tener acá
 * una tabla de valores "por las dudas" crea una segunda verdad que coincide con el tablero sólo
 * por casualidad, y el día que difieran la app bonifica por un número que nadie configuró.
 *
 * Cero es el valor seguro: mientras la consulta viaja no se promete un descuento que quizá no
 * exista. Sin token, el modo local usa `DESCUENTOS_PAGO_MOCK`, que es explícitamente un mock.
 */
export const DESCUENTO_PAGO_DEFAULT: DescuentosPago = { ...SIN_DESCUENTOS_PAGO }

/** Color de la paleta monday que identifica cada forma de pago. */
export const COLOR_PAGO: Record<FormaPago, string> = {
  Efectivo: 'var(--red)',
  Cheque: 'var(--green)',
  Transferencia: 'var(--primary-blue)',
  'Retencion IVA': '#f0b429',
  'Retencion IIBB': '#e2a500',
  'Retencion GAN': '#d97706',
  'Tarjeta de débito': '#4eccc6',
  'Tarjeta de crédito': '#a25ddc',
}

export interface BalancePago {
  movimiento: MovimientoPago
  descuentoPct: number
  /** Descuento por la forma de pago: resta del importe recibido. */
  descuento: number
  /** Lo que se imputa a la venta: lo entregado menos el descuento. */
  montoCobrado: number
}

/** Aplica a cada movimiento el descuento que el tablero define para su forma de pago. */
export function balancePagos(
  movimientos: MovimientoPago[],
  descuentos: DescuentosPago,
): BalancePago[] {
  return movimientos.map((m) => {
    const descuentoPct = descuentos[m.formaPago] ?? 0
    const descuento = (m.importe * descuentoPct) / 100
    return { movimiento: m, descuentoPct, descuento, montoCobrado: m.importe - descuento }
  })
}

export interface ResumenCobro {
  totalACobrar: number
  /** Lo que entra a caja: la suma de los montos cobrados, ya con el descuento aplicado. */
  totalCobrado: number
  /** Lo que el cliente imputa a la venta, antes del descuento de cada forma de pago. */
  recibido: number
  descuentoTotal: number
  /**
   * Deuda que la venta deja saldada: lo que entra a caja más los descuentos otorgados.
   * Cada forma de pago descuenta distinto, así que lo cobrado por sí solo nunca llega al
   * total; la diferencia la cubre el descuento, que también cancela.
   */
  cancelado: number
  /** Lo que le sigue quedando pendiente al cliente de esta venta. */
  pendiente: number
  cobradoPct: number
  pendientePct: number
}

export function resumenCobro(balances: BalancePago[], totalVenta: number): ResumenCobro {
  const recibido = balances.reduce((a, b) => a + b.movimiento.importe, 0)
  const descuentoTotal = balances.reduce((a, b) => a + b.descuento, 0)
  const totalCobrado = recibido - descuentoTotal
  // Lo cobrado más los descuentos: es contra esto que se mide la cobertura de la venta.
  const cancelado = totalCobrado + descuentoTotal
  const cobradoPct = totalVenta > 0 ? Math.min((cancelado / totalVenta) * 100, 100) : 0

  return {
    totalACobrar: totalVenta,
    totalCobrado,
    recibido,
    descuentoTotal,
    cancelado,
    pendiente: Math.max(totalVenta - cancelado, 0),
    cobradoPct,
    pendientePct: 100 - cobradoPct,
  }
}

/** Error debajo del CUIT del emisor cuando el cheque es del cliente y el CRM no se los recibe. */
export const MSG_CHEQUE_CLIENTE_NO =
  'No se reciben cheques del cliente seleccionado. Ingrese otro CUIT.'

/** Los 11 dígitos de un CUIT, sin guiones ni espacios: es la forma en que se comparan dos CUIT. */
const digitosCuit = (cuit: string | undefined): string => (cuit ?? '').replace(/\D/g, '')

/**
 * El CUIT cargado es el del cliente de la operación. Se compara por DÍGITOS: el CRM guarda el CUIT
 * como texto libre y puede traerlo con guiones, sin ellos o con espacios de más, y ninguna de esas
 * diferencias de tipeo cambia de quién es el cheque.
 */
export const cuitEsDelCliente = (
  cliente: Pick<Cliente, 'cuit'> | null | undefined,
  cuitEmisor: string | undefined,
): boolean => {
  const delCliente = digitosCuit(cliente?.cuit)
  const delCheque = digitosCuit(cuitEmisor)
  return delCliente.length > 0 && delCliente === delCheque
}

/**
 * El cheque NO se puede registrar: es un cheque PROPIO del cliente (mismo CUIT de emisor) y su CRM
 * marca "Recibimos CHEQUE" = NO. Un cheque de un TERCERO —cualquier otro CUIT— se acepta igual, y
 * por eso el mensaje pide otro CUIT en lugar de vedar el medio de cobro entero.
 *
 * Sólo se pronuncia con el CUIT completo: una coincidencia parcial no significa nada.
 */
export const chequeDelClienteVedado = (
  cliente: Pick<Cliente, 'cuit' | 'aceptaCheques'> | null | undefined,
  cuitEmisor: string | undefined,
): boolean =>
  cuitCompleto(cuitEmisor) && cuitEsDelCliente(cliente, cuitEmisor) && cliente?.aceptaCheques === false

/**
 * En qué punto está el CUIT del emisor respecto de la validación contra el CRM. La valida el
 * vendedor a mano, con el botón "Validar" que está a la derecha del campo: NO se dispara sola al
 * terminar de escribir, así que un CUIT cargado y nunca validado sigue en 'pendiente'.
 *
 *   · 'pendiente'  → todavía no se validó (o se editó el CUIT después de validarlo).
 *   · 'validado'   → el cheque se puede cargar. El CUIT queda fijo: ya no se edita.
 *   · 'rechazado'  → es el cheque del propio cliente y no se los recibimos. No se puede agregar.
 */
export type EstadoCuitEmisor = 'pendiente' | 'validado' | 'rechazado'

/**
 * Resultado de apretar "Validar". Un CUIT incompleto no se puede validar y queda como estaba: el
 * campo ya avisa por su cuenta qué tramo le falta.
 *
 * Que dé 'validado' NO quiere decir que el CUIT exista en el CRM: quiere decir que nada impide
 * cobrar con ese cheque. Es el caso del cheque de un TERCERO, que no se contrasta contra nada.
 */
export const validarCuitEmisor = (
  cliente: Pick<Cliente, 'cuit' | 'aceptaCheques'> | null | undefined,
  cuitEmisor: string | undefined,
): EstadoCuitEmisor => {
  if (!cuitCompleto(cuitEmisor)) return 'pendiente'
  return chequeDelClienteVedado(cliente, cuitEmisor) ? 'rechazado' : 'validado'
}

/** Aviso al intentar agregar un cheque cuyo CUIT de emisor todavía no se validó. */
export const MSG_CUIT_SIN_VALIDAR = 'Validá el CUIT del emisor antes de agregar el cheque'

/** Mensaje único de la regla de vencimiento del cheque: lo comparten el formulario y el bloqueo. */
export const MSG_CHEQUE_VENCIMIENTO = 'La fecha de vencimiento debe ser como máximo la fecha de hoy'

/**
 * Regla de negocio del cheque: el vencimiento NO puede ser posterior al día de hoy (venc <= hoy),
 * así que sólo se aceptan cheques ya vencidos o que vencen en el día. Se compara por DÍA —hoy a la
 * medianoche—, no por hora, para que un cheque con fecha de hoy sea siempre válido.
 *
 * Reemplaza a la regla anterior (vencer DESPUÉS de la emisión de la factura), que era incompatible:
 * la factura se emite hoy, con lo que ninguna fecha podía cumplir las dos a la vez.
 */
export function vencimientoChequeInvalido(vencimiento: string | undefined): boolean {
  const venc = parseDate(vencimiento ?? '')
  if (!venc) return true
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return venc.getTime() > hoy.getTime()
}

/**
 * CUIT del emisor del cheque, cargado en tres tramos con el formato XX-XXXXXXXX-X. Cada tramo
 * exige EXACTAMENTE su cantidad de dígitos: menos que eso es un CUIT incompleto y no se puede
 * agregar el movimiento. El mensaje identifica cuál de los tres quedó corto.
 */
export const CUIT_TRAMOS = [
  {
    clave: 'prefijo',
    digitos: 2,
    aria: 'Primeros dos números del CUIT',
    error: 'El primer tramo del CUIT debe tener 2 números',
  },
  {
    clave: 'documento',
    digitos: 8,
    aria: 'DNI del CUIT, ocho números',
    error: 'El DNI del CUIT debe tener 8 números',
  },
  {
    clave: 'verificador',
    digitos: 1,
    aria: 'Último número del CUIT',
    error: 'El último tramo del CUIT debe tener 1 número',
  },
] as const

/**
 * Deja sólo los dígitos de lo tipeado y recorta al tope del tramo. Es lo que hace que el campo NO
 * acepte letras ni un dígito de más: lo que no cumple, simplemente no entra (sin mensaje de error).
 */
export const soloDigitos = (entrada: string, maximo: number): string =>
  (entrada ?? '').replace(/\D/g, '').slice(0, maximo)

/** Los tres tramos del CUIT. Los guiones son fijos, así que siempre devuelve tres strings. */
export const partesCuit = (cuit: string | undefined): [string, string, string] => {
  const [a = '', b = '', c = ''] = (cuit ?? '').split('-')
  return [a, b, c]
}

/** Índice del primer tramo del CUIT que quedó por debajo de sus dígitos, o -1 si está completo. */
export const tramoCuitIncompleto = (cuit: string | undefined): number =>
  partesCuit(cuit).findIndex((p, i) => p.length !== CUIT_TRAMOS[i].digitos)

/** El CUIT tiene los tres tramos completos: 2 + 8 + 1 dígitos. */
export const cuitCompleto = (cuit: string | undefined): boolean => tramoCuitIncompleto(cuit) === -1

/* ===== Cobro con tarjeta ===== */

/** Medio de cobro que le corresponde a cada tipo de tarjeta. */
export const formaPagoTarjeta = (tipo: TipoTarjetaCobro): FormaPago =>
  tipo === 'CREDITO' ? 'Tarjeta de crédito' : 'Tarjeta de débito'

/** Un pago con tarjeta de débito se puede partir en una o dos tarjetas. */
export const PAGOS_DEBITO = ['1', '2'] as const

/** El cheque tiene una fecha de vencimiento que incumple la regla (o no la tiene cargada). */
export function chequeInvalido(m: Pick<MovimientoPago, 'formaPago' | 'chequeVencimiento'>): boolean {
  if (m.formaPago !== 'Cheque') return false
  return vencimientoChequeInvalido(m.chequeVencimiento)
}

/* ===== Tipo de cobro de la operación ===== */

/**
 * Formas de pago que dejan el cobro PARA DESPUÉS. Sólo la cuenta corriente: se cobra en otro momento
 * y deja la venta pendiente. Las tarjetas se cobran en el acto (cupones que cancelan la venta), así
 * que NO entran acá.
 */
export const FORMAS_PAGO_POSTERIOR: readonly FormaPagoVenta[] = ['CUENTA CORRIENTE']

/**
 * Tipo de cobro de LA OPERACIÓN. Sale de UN SOLO dato: la forma de pago que el vendedor eligió en
 * la selección de productos.
 *
 *   CONTADO / TARJETA DE DEBITO / DE CREDITO  → SIMULTANEO
 *   CUENTA CORRIENTE                          → POSTERIOR
 *
 * Las tarjetas se cobran EN EL ACTO (se acreditan tras la venta), así que son SIMULTANEO y NO dejan
 * una Venta Pend de Cobro: el recibo detalla sus cupones y cancela la venta. Sólo la cuenta corriente
 * queda para después.
 *
 * NO se deriva de la condición de pago del cliente. Esa condición decide únicamente QUÉ formas de
 * pago se le ofrecen (`formasPagoDeCliente`); no cómo se clasifica la venta que terminó eligiendo.
 * Mezclar las dos cosas —y dejar que el "SI/NO" del cierre pisara la clasificación— es lo que
 * venía marcando mal el tipo de cobro.
 *
 * Sin forma de pago elegida se asume POSTERIOR: no se puede afirmar que la venta ya se cobró.
 */
export const tipoPagoOperacion = (forma: FormaPagoVenta | null): TipoPago =>
  forma === 'CONTADO' || esPagoConTarjeta(forma) ? 'SIMULTANEO' : 'POSTERIOR'

/** La operación se cobra en el acto: recibo con sus movimientos y exigencia del 100%. */
export const cobroSimultaneoOperacion = (forma: FormaPagoVenta | null): boolean =>
  tipoPagoOperacion(forma) === 'SIMULTANEO'

/**
 * Se muestra el "Impacto en cuenta corriente" del cierre. Sólo tiene sentido cuando la venta se
 * va a la cuenta del cliente: ahí hay un saldo proyectado que mostrar.
 */
export const mostrarImpactoCtaCte = (forma: FormaPagoVenta | null): boolean =>
  forma === 'CUENTA CORRIENTE'

/**
 * Datos de cobro que viajan al payload de la venta. Es el único constructor del tipo de cobro que
 * se escribe en "✋Tipo de Cobro" del board: la vista no lo arma a mano ni lo deduce de otro flag.
 */
export const datosCobroVenta = (forma: FormaPagoVenta | null): { tipoPago: TipoPago } => ({
  tipoPago: tipoPagoOperacion(forma),
})

/**
 * La venta deja deuda en "💰Fact Vtas Pends de Cobro". Es exactamente el cobro POSTERIOR, o sea la
 * forma de pago CUENTA CORRIENTE: la venta se factura pero no se cobra, así que queda pendiente.
 *
 * No mira el estado del cobro. Antes exigía además `!cobro.deudaId` para no duplicar, pero ese id
 * NUNCA se guardaba, así que la condición era inerte y aparentaba una protección que no existía.
 */
export const requiereRegistroDeuda = (forma: FormaPagoVenta | null): boolean =>
  tipoPagoOperacion(forma) === 'POSTERIOR'

/**
 * El cobro simultáneo exige el 100%: lo que entra a caja más los descuentos otorgados tiene
 * que ser exactamente el total a cobrar. No alcanza con mirar lo cobrado, porque cada forma
 * de pago descuenta distinto y la venta se cancela igual.
 * Se compara con la misma precisión con la que se escribe en Monday: dos decimales.
 */
export const cobroCompleto = (resumen: ResumenCobro): boolean =>
  round2(resumen.cancelado) === round2(resumen.totalACobrar)

/**
 * DIFERENCIA del cobro: lo que falta cobrar (>0) o lo que se cobró de más (<0). Se redondea a dos
 * decimales, que es la precisión con la que se escriben los importes: es la misma métrica que
 * muestra la cabecera.
 */
export const diferenciaCobro = (resumen: ResumenCobro): number =>
  round2(resumen.totalACobrar - resumen.cancelado)

/**
 * La diferencia quedó en CERO exacto. Es la única condición que habilita el avance de etapa en el
 * cobro con tarjeta: ni de menos (falta cobrar) ni de más (cobro excedente).
 */
export const diferenciaEnCero = (resumen: ResumenCobro): boolean => diferenciaCobro(resumen) === 0

export interface EstadoCtaCte {
  cuenta: string
  limite: number
  /** Saldo real que hoy tiene el cliente en su cuenta corriente, sin esta venta. */
  saldoPendiente: number
  cancelado: number
  /** Cómo queda la cuenta tras sumar esta venta e imputarle lo cobrado. */
  resultante: number
}

/**
 * Cómo queda la cuenta corriente del cliente después de esta venta y su cobro. El límite y el
 * saldo salen del board ("🤖Saldo Cta Cte"), no de un cálculo propio: son el punto de partida.
 *
 * Lo que descuenta de la cuenta es lo CANCELADO (caja + descuentos), no lo que entró a caja:
 * el descuento por forma de pago salda deuda igual que el dinero.
 */
export function estadoCtaCte(
  cliente: Cliente,
  totalVenta: number,
  cancelado: number,
): EstadoCtaCte {
  const saldoPendiente = cliente.saldoCtaCte
  return {
    cuenta: cliente.codigo || cliente.id,
    limite: cliente.limit,
    saldoPendiente,
    cancelado,
    resultante: saldoPendiente + totalVenta - cancelado,
  }
}
