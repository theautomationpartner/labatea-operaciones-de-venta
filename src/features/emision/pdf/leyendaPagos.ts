import type { DescuentosPago } from '@/lib/cobros'
import type { LeyendaPagos } from './PresupuestoPdf'

/**
 * Los % del template del presupuesto ("Formas de pago y descuentos"). Son el respaldo, no la fuente:
 * se usan sólo si la configuración del sistema no llegó a cargarse.
 */
export const LEYENDA_PAGOS_TEMPLATE: LeyendaPagos = { contado: 6, debito: 5, credito: 3 }

/**
 * Los % de la leyenda de formas de pago, desde la configuración del sistema (`descuentosPago`, la
 * misma con la que se factura cada forma de pago): contado es el de Efectivo —Efectivo,
 * Transferencia y Cheque comparten un único valor, ver `MEDIOS_CONTADO`—, y las tarjetas, los suyos.
 *
 * Si los tres vienen en 0 es que la configuración no cargó (el valor por defecto de la app es todo
 * en cero): el PDF sale con los % del template, en vez de prometerle al cliente "0% de descuento".
 */
export function leyendaPagosDe(descuentos: DescuentosPago): LeyendaPagos {
  const desdeConfig: LeyendaPagos = {
    contado: descuentos.Efectivo,
    debito: descuentos['Tarjeta de débito'],
    credito: descuentos['Tarjeta de crédito'],
  }
  if (desdeConfig.contado || desdeConfig.debito || desdeConfig.credito) return desdeConfig
  console.warn('Descuentos por forma de pago en cero: la leyenda del PDF usa los % del template.')
  return LEYENDA_PAGOS_TEMPLATE
}
