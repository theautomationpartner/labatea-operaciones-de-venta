import type { Operacion, Paso, TipoEmisionRemito, TipoEntrega, TipoVenta } from '@/types'

export const PASOS_PRESUPUESTO = [
  'Seleccionar cliente',
  'Seleccionar productos',
  'Emisión y envío',
] as const

export const PASOS_VENTA = [
  'Seleccionar cliente',
  'Cargar productos',
  'Cierre de Venta',
  'Emitir factura',
] as const

/** Venta con entrega ANTERIOR: la mercadería ya salió por remito, falta facturarla. */
export const PASOS_REMITO = [
  'Seleccionar cliente',
  'Seleccionar remito',
  'Cierre de Venta',
  'Emitir factura',
] as const

/** Operación REMITO. El paso 2 cambia de nombre según de dónde salen los productos. */
export const PASOS_REMITO_POSTERIOR = [
  'Seleccionar cliente',
  'Productos a remitar',
  'Especificación del envío',
  'Emitir remito',
] as const

export const PASOS_REMITO_ANTERIOR = [
  'Seleccionar cliente',
  'Seleccionar venta',
  'Especificación del envío',
  'Emitir remito',
] as const

/**
 * La entrega ANTERIOR parte de un remito ya emitido, no del catálogo ni del presupuesto:
 * la mercadería salió antes de la factura, así que lo que se carga son sus pendientes de
 * facturar. Vale para los dos tipos de venta, directa o con presupuesto previo.
 */
export const esFlujoRemito = (tipoEntrega: TipoEntrega | null): boolean =>
  tipoEntrega === 'ANTERIOR'

/**
 * Los pasos que muestra el encabezado. El tipo de venta ya no cambia el recorrido —lo define
 * la entrega—, pero sigue en la firma para que sea la misma que la de `pasoDeProductos`.
 */
export function pasosDe(
  operacion: Operacion | null,
  _tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
  tipoEmision: TipoEmisionRemito | null = null,
): readonly string[] {
  if (operacion === 'REMITO') {
    return tipoEmision === 'ANTERIOR' ? PASOS_REMITO_ANTERIOR : PASOS_REMITO_POSTERIOR
  }
  if (operacion !== 'CARGAR VENTA') return PASOS_PRESUPUESTO
  return esFlujoRemito(tipoEntrega) ? PASOS_REMITO : PASOS_VENTA
}

/** Paso 2 de cada flujo: de dónde salen los productos de la operación. */
export function pasoDeProductos(
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
): Paso {
  if (operacion === 'REMITO') return 'remito-productos'
  if (operacion !== 'CARGAR VENTA') return 'productos'
  // La entrega ANTERIOR manda sobre el tipo de venta: siempre se factura desde el remito.
  if (esFlujoRemito(tipoEntrega)) return 'remito'
  return tipoVenta === 'CON PRESUPUESTO PREVIO' ? 'venta' : 'productos'
}

/** Las tres entregas valen para cualquier tipo de venta. */
export const ENTREGAS: readonly TipoEntrega[] = ['POSTERIOR', 'ANTERIOR', 'SIMULTANEA']

/** El remito se emite antes o después de facturar. */
export const EMISIONES_REMITO: readonly TipoEmisionRemito[] = ['POSTERIOR', 'ANTERIOR']

export const OPERACIONES: readonly Operacion[] = ['PRESUPUESTAR', 'CARGAR VENTA', 'REMITO']
