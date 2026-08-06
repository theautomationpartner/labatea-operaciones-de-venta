/**
 * Composición del descuento de UNA línea de producto. Única fuente de verdad: la usan la tabla
 * de productos, los resúmenes (presupuesto y venta), la comisión y lo que se escribe en Monday,
 * así que la fila, el total del documento y el board siempre dicen lo mismo.
 *
 * Los dos descuentos NO se suman: se aplican EN CASCADA. Primero baja el precio de lista el
 * descuento por forma de pago (pronto pago) y el descuento manual del vendedor se calcula sobre
 * ese precio ya rebajado, nunca sobre el de lista. Así el % manual siempre significa lo mismo
 * —un porcentaje de lo que realmente se cobra— y la suma de los dos no puede pasarse del precio.
 *
 *   1. Monto forma de pago = precio de lista × %forma de pago
 *   2. Precio intermedio   = precio de lista − monto forma de pago
 *   3. Monto manual        = precio intermedio × %manual
 *   4. DESCUENTO TOTAL     = monto forma de pago + monto manual
 *
 * Todo lo de acá es POR UNIDAD: el descuento no escala con la cantidad. Lo que sí escala es el
 * neto de la línea (`netoLinea`), que multiplica por la cantidad el precio ya descontado.
 */
import { round2 } from '@/lib/format'

/** Alícuota de IVA por defecto cuando el producto no trae la suya, en puntos porcentuales. */
export const IVA_DEFECTO = 21

/** Un porcentaje utilizable: número finito acotado al rango 0–100. */
const pctValido = (n: number): number => (Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0)

export interface DescuentoUnitario {
  /** $ por unidad que descuenta la forma de pago, sobre el precio de LISTA. */
  formaPago: number
  /** $ por unidad que descuenta el % manual, sobre el precio YA rebajado por la forma de pago. */
  manual: number
  /** $ por unidad de descuento: forma de pago + manual. No escala con la cantidad. */
  total: number
  /** Precio unitario final, el que efectivamente se cobra: precio de lista − total. */
  precioFinal: number
  /** El mismo descuento leído en %: 1 − (1 − %forma de pago) × (1 − %manual). */
  pct: number
}

/**
 * % de descuento resultante de componer los dos en cascada. Es el que hay que usar para medir
 * la rentabilidad efectiva de la línea: sumar los dos porcentajes daría de más.
 */
export function descuentoCompuesto(descManual: number, descFormaPago = 0): number {
  const fp = pctValido(descFormaPago) / 100
  const manual = pctValido(descManual) / 100
  return (1 - (1 - fp) * (1 - manual)) * 100
}

/** Desglose del descuento de una unidad del producto, con cada monto ya redondeado a dos decimales. */
export function descuentoUnitario(
  precio: number,
  descManual: number,
  descFormaPago = 0,
): DescuentoUnitario {
  const lista = Number.isFinite(precio) ? precio : 0
  const formaPago = round2((lista * pctValido(descFormaPago)) / 100)
  // El descuento manual muerde el precio YA rebajado por la forma de pago, no el de lista.
  const intermedio = round2(lista - formaPago)
  const manual = round2((intermedio * pctValido(descManual)) / 100)
  const total = round2(formaPago + manual)
  return {
    formaPago,
    manual,
    total,
    precioFinal: round2(lista - total),
    pct: descuentoCompuesto(descManual, descFormaPago),
  }
}

/**
 * Neto de la línea, SIN IVA: (precio de lista − descuento total por unidad) × cantidad. Es el
 * único valor de la línea que depende de la cantidad.
 */
export const netoLinea = (
  precio: number,
  cantidad: number,
  descManual: number,
  descFormaPago = 0,
): number => round2(descuentoUnitario(precio, descManual, descFormaPago).precioFinal * cantidad)

/**
 * Bonificación total de la línea, en $: descuento total POR UNIDAD × cantidad. Es el "Descuento
 * Total" de la tabla de productos llevado a la línea entera —los dos descuentos, el de la forma
 * de pago y el manual, ya compuestos—, que es lo que se declara como importe bonificado.
 */
export const bonificacionLinea = (
  precio: number,
  cantidad: number,
  descManual: number,
  descFormaPago = 0,
): number =>
  round2(
    descuentoUnitario(precio, descManual, descFormaPago).total *
      (Number.isFinite(cantidad) ? cantidad : 0),
  )

/** IVA en $ de la línea: se calcula SIEMPRE sobre su neto ya descontado, nunca sobre el de lista. */
export const ivaLinea = (neto: number, tasaIva = IVA_DEFECTO): number =>
  round2((neto * (tasaIva ?? IVA_DEFECTO)) / 100)
