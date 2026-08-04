/**
 * Reglas del cobro de una factura: descuentos por forma de pago, balance de cada
 * movimiento y trackeo de lo cobrado contra el total de la venta.
 */
import { parseDate } from '@/lib/dates'
import { money, round2 } from '@/lib/format'
import type {
  Cliente,
  CobroState,
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
  'Retencion IIBB',
  'Retencion GAN',
  'Tarjeta de débito',
  'Tarjeta de crédito',
]

/** Descuento por pronto pago de cada forma de pago, en puntos porcentuales. */
export type DescuentosPago = Record<FormaPago, number>

/**
 * Valores de arranque, hasta que llega la configuración real: los descuentos los define el
 * tablero "⚙️Configuracion - Sistema" (ítems de tipo "Medios de Pago"), no la app.
 */
export const DESCUENTO_PAGO_DEFAULT: DescuentosPago = {
  Efectivo: 6,
  Transferencia: 6,
  Cheque: 6,
  // Las retenciones no llevan descuento por pronto pago: son un pago por retención impositiva.
  'Retencion IIBB': 0,
  'Retencion GAN': 0,
  'Tarjeta de débito': 5,
  'Tarjeta de crédito': 3,
}

/** Color de la paleta monday que identifica cada forma de pago. */
export const COLOR_PAGO: Record<FormaPago, string> = {
  Efectivo: 'var(--red)',
  Cheque: 'var(--green)',
  Transferencia: 'var(--primary-blue)',
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

/** Un cheque tiene que vencer después de la emisión de la factura. */
export function chequeInvalido(m: MovimientoPago, fechaFactura: string): boolean {
  if (m.formaPago !== 'Cheque') return false
  const venc = parseDate(m.chequeVencimiento)
  const factura = parseDate(fechaFactura)
  if (!venc || !factura) return true
  return venc.getTime() <= factura.getTime()
}

/** Tipo de pago del CLIENTE: se deriva de su condición de pago y no se puede cambiar. */
export const tipoPagoEfectivo = (c: Cliente): TipoPago =>
  c.condicionPago === 'CONTADO' ? 'SIMULTANEO' : 'POSTERIOR'

/** El cliente es de contado: el cobro va sí o sí junto con la factura. */
export const pagoSimultaneo = (c: Cliente): boolean => tipoPagoEfectivo(c) === 'SIMULTANEO'

/**
 * Tipo de pago de LA OPERACIÓN, que es el que se registra. Al del cliente le suma lo elegido
 * en el cierre: la cuenta corriente puede cobrarse en el acto, y ese "SI" convierte la venta
 * en SIMULTANEO —se cobra ahora y no queda deuda que diferir—.
 *
 *   contado                        → SIMULTANEO (siempre)
 *   CUENTA CORRIENTE + cierre "SI" → SIMULTANEO
 *   CUENTA CORRIENTE + cierre "NO" → POSTERIOR
 *   plazos de proveedor            → POSTERIOR (no ofrecen cobro en el acto)
 *
 * Es el valor que viaja a "✋Tipo de Cobro" de la venta y el que decide, en un solo lugar, qué
 * camino corre el cierre: recibo ahora o deuda en la cuenta corriente después.
 */
export const tipoPagoOperacion = (c: Cliente, cobro: CobroState): TipoPago =>
  pagoSimultaneo(c) || (c.condicionPago === 'CUENTA CORRIENTE' && cobro.registrar)
    ? 'SIMULTANEO'
    : 'POSTERIOR'

/** La operación se cobra en el acto: recibo con sus movimientos y exigencia del 100%. */
export const cobroSimultaneoOperacion = (c: Cliente, cobro: CobroState): boolean =>
  tipoPagoOperacion(c, cobro) === 'SIMULTANEO'

/**
 * Se muestra el "Impacto en cuenta corriente" del cierre. Sólo tiene sentido cuando la venta
 * va a dejar deuda: cliente de CUENTA CORRIENTE que además eligió NO cobrar en el acto. Con
 * "SI" el cobro cancela la venta en el momento y no hay saldo proyectado que mostrar.
 */
export const mostrarImpactoCtaCte = (c: Cliente, cobro: CobroState): boolean =>
  c.condicionPago === 'CUENTA CORRIENTE' && !cobro.registrar

/**
 * Datos de cobro que viajan al payload de la venta. Es el único constructor del tipo de pago
 * que se escribe en el board: la vista no lo arma a mano ni lo deduce de otro flag.
 */
export const datosCobroVenta = (c: Cliente, cobro: CobroState): { tipoPago: TipoPago } => ({
  tipoPago: tipoPagoOperacion(c, cobro),
})

/**
 * La venta tiene que dejar deuda en la cuenta corriente y todavía no se registró. Es la
 * condición —y la única— que frena el cierre de la operación para pedir el registro:
 *
 *   · condición de pago del cliente = CUENTA CORRIENTE, y
 *   · tipo de pago DE LA OPERACIÓN = POSTERIOR (en el cierre se eligió "NO").
 *
 * Cualquier otra combinación cierra derecho, sin modal: contado, los plazos de proveedor y —el
 * caso que importa acá— la cuenta corriente cobrada en el acto, que ya se saldó con su recibo
 * y no debe pasar por ningún paso de cobro diferido. La deuda ya escrita también se saltea: se
 * mira `deudaId` para no duplicar el movimiento.
 */
export const requiereRegistroDeuda = (c: Cliente, cobro: CobroState): boolean =>
  c.condicionPago === 'CUENTA CORRIENTE' &&
  tipoPagoOperacion(c, cobro) === 'POSTERIOR' &&
  !cobro.deudaId

/**
 * Simultáneo: el formulario está siempre activo (se cobra ahora).
 * Posterior: sólo se activa si el vendedor eligió registrar un pago (SI).
 */
export const cobroActivo = (c: Cliente, cobro: CobroState): boolean =>
  pagoSimultaneo(c) || cobro.registrar

/** Importe en pesos para los mensajes de bloqueo. Mismo formato que el resto de la app. */
const moneda = (v: number): string => money(v)

/**
 * El cobro simultáneo exige el 100%: lo que entra a caja más los descuentos otorgados tiene
 * que ser exactamente el total a cobrar. No alcanza con mirar lo cobrado, porque cada forma
 * de pago descuenta distinto y la venta se cancela igual.
 * Se compara con la misma precisión con la que se escribe en Monday: dos decimales.
 */
export const cobroCompleto = (resumen: ResumenCobro): boolean =>
  round2(resumen.cancelado) === round2(resumen.totalACobrar)

/** Motivo por el que el cobro no cierra, o null si está bien cargado. */
export function bloqueoCobro(
  cliente: Cliente,
  cobro: CobroState,
  fechaFactura: string,
  resumen?: ResumenCobro,
): string | null {
  /* Que falte cargar el cobro no se avisa acá: lo dice la nota que acompaña al tipo de pago,
     y el avance ya queda bloqueado porque el registro nunca se confirmó. */
  if (!cobroActivo(cliente, cobro) || cobro.movimientos.length === 0) return null
  if (cobro.movimientos.some((m) => chequeInvalido(m, fechaFactura))) {
    return `Los cheques deben vencer después de la emisión de la factura (${fechaFactura}).`
  }
  /* Simultáneo es todo o nada: cobrar de menos deja la venta sin cerrar y cobrar de más no
     corresponde a esta venta. En los dos casos se bloquea el registro. Vale igual para la
     cuenta corriente cobrada en el acto: si se cobra ahora, se cobra entero. */
  if (cobroSimultaneoOperacion(cliente, cobro) && resumen && !cobroCompleto(resumen)) {
    // Lo que falta se mide contra lo cancelado (caja + descuentos), no contra la caja sola.
    const falta = resumen.totalACobrar - resumen.cancelado
    return falta > 0
      ? 'El cobro simultáneo exige el 100% cobrado del total de la venta.'
      : `Lo cobrado más los descuentos supera el total de la venta en ${moneda(-falta)}: ajustá los movimientos.`
  }
  return null
}

/** El cobro se puede confirmar: hay movimientos cargados y ninguno tiene problemas. */
export const cobroConfirmable = (
  cliente: Cliente,
  cobro: CobroState,
  fechaFactura: string,
  resumen?: ResumenCobro,
): boolean =>
  cobroActivo(cliente, cobro) &&
  cobro.movimientos.length > 0 &&
  bloqueoCobro(cliente, cobro, fechaFactura, resumen) === null

/** El cobro quedó registrado: sólo tras confirmarlo a mano. */
export const cobroRegistrado = (
  cliente: Cliente,
  cobro: CobroState,
  fechaFactura: string,
  resumen?: ResumenCobro,
): boolean => cobro.confirmado && cobroConfirmable(cliente, cobro, fechaFactura, resumen)

/**
 * La etapa de cierre quedó cumplida. En posterior se asume cumplida de entrada: lo que la
 * cierra de verdad (la deuda) se escribe recién al finalizar la operación.
 */
export const cierreCompleto = (
  cliente: Cliente,
  cobro: CobroState,
  fechaFactura: string,
  resumen?: ResumenCobro,
): boolean =>
  cobroSimultaneoOperacion(cliente, cobro)
    ? cobroRegistrado(cliente, cobro, fechaFactura, resumen)
    : true

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
