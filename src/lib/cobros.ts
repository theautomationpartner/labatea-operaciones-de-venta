/**
 * Reglas del cobro de una factura: descuentos por forma de pago, balance de cada
 * movimiento y trackeo de lo cobrado contra el total de la venta.
 */
import { parseDate } from '@/lib/dates'
import { money, round2 } from '@/lib/format'
import type { Cliente, CobroState, FormaPago, MovimientoPago, TipoPago } from '@/types'

export const FORMAS_PAGO: readonly FormaPago[] = [
  'Efectivo',
  'Cheque',
  'Transferencia',
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
  Efectivo: 5,
  Transferencia: 3,
  Cheque: 0,
  'Tarjeta de débito': 0,
  'Tarjeta de crédito': 0,
}

/** Color de la paleta monday que identifica cada forma de pago. */
export const COLOR_PAGO: Record<FormaPago, string> = {
  Efectivo: 'var(--red)',
  Cheque: 'var(--green)',
  Transferencia: 'var(--primary-blue)',
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

export const esAgenteRetencion = (c: Cliente): boolean => c.agenteRetencion

/**
 * Las retenciones se calculan en otra app. Hasta que esa integración exista, un agente
 * de retención no puede emitir la proforma desde acá.
 */
export const MENSAJE_RETENCION =
  'El cliente es agente de retención: cargá las retenciones calculadas para poder emitir la factura proforma.'

/** Tipo de pago: se deriva de la condición de pago del cliente y no se puede cambiar. */
export const tipoPagoEfectivo = (c: Cliente): TipoPago =>
  c.condicionPago === 'CONTADO' ? 'SIMULTANEO' : 'POSTERIOR'

/** Pago simultáneo: se cobra junto con la factura (clientes de contado). */
export const pagoSimultaneo = (c: Cliente): boolean => tipoPagoEfectivo(c) === 'SIMULTANEO'

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
     corresponde a esta venta. En los dos casos se bloquea el registro. */
  if (pagoSimultaneo(cliente) && resumen && !cobroCompleto(resumen)) {
    // Lo que falta se mide contra lo cancelado (caja + descuentos), no contra la caja sola.
    const falta = resumen.totalACobrar - resumen.cancelado
    return falta > 0
      ? `El cobro simultáneo exige el 100%: faltan cubrir ${moneda(falta)} de ${moneda(resumen.totalACobrar)}. Van ${moneda(resumen.totalCobrado)} cobrados más ${moneda(resumen.descuentoTotal)} de descuentos.`
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
 * Se puede pasar a emitir la factura.
 *
 * SIMULTÁNEO exige el recibo ya registrado: sin la plata cobrada no se factura.
 * POSTERIOR se da por cerrado apenas se entra: no hay nada que cargar, la deuda se crea sola
 * al continuar (cuenta corriente + factura pendiente de cobro).
 */
export function puedeEmitirFactura(
  cliente: Cliente,
  cobro: CobroState,
  fechaFactura: string,
  resumen?: ResumenCobro,
): boolean {
  if (esAgenteRetencion(cliente)) return false
  if (bloqueoCobro(cliente, cobro, fechaFactura, resumen) !== null) return false
  if (!pagoSimultaneo(cliente)) return true
  return cobro.confirmado
}

/**
 * La etapa de cierre quedó cumplida. En posterior se asume cumplida de entrada: lo que la
 * cierra de verdad (la deuda) se escribe al pasar a la emisión de la factura.
 */
export const cierreCompleto = (
  cliente: Cliente,
  cobro: CobroState,
  fechaFactura: string,
  resumen?: ResumenCobro,
): boolean =>
  pagoSimultaneo(cliente)
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
