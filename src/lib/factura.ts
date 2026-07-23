/**
 * Reglas de la factura: qué líneas la componen según el flujo de venta, sus totales
 * y los datos que se derivan del cliente.
 */
import { round2 } from '@/lib/format'
import { esFlujoRemito } from '@/lib/pasos'
import { IVA_RATE } from '@/lib/selectors'
import type {
  Cliente,
  CondicionIVA,
  FacturaItem,
  LetraComprobante,
  LineaPresupuesto,
  MonedaFactura,
  TipoEntrega,
  TipoVenta,
  VentaItem,
} from '@/types'

export const MONEDAS: readonly MonedaFactura[] = ['Pesos (ARS)', 'Dólares (USD)']
export const PUNTOS_VENTA: readonly string[] = ['0001', '0002', '0003']
export const CONDICIONES_IVA: readonly CondicionIVA[] = [
  'Responsable Inscripto',
  'Monotributo',
  'Consumidor Final',
]
export const LETRAS: readonly LetraComprobante[] = ['A', 'B', 'C']

/** Línea de la factura, común a los tres flujos de venta. */
export interface LineaFactura {
  codigo: string
  nombre: string
  cantidad: number
  precio: number
  descuento: number
}

interface FuenteLineas {
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  lineas: LineaPresupuesto[]
  ventaItems: VentaItem[]
  facturaItems: FacturaItem[]
}

/** De dónde salen los productos depende de cómo se armó la venta. */
export function lineasDeVenta(f: FuenteLineas): LineaFactura[] {
  // La entrega ANTERIOR manda sobre el tipo de venta: se factura lo remitido.
  if (esFlujoRemito(f.tipoEntrega)) {
    return f.facturaItems.map((it) => ({
      codigo: it.codigo,
      nombre: it.nombre,
      cantidad: it.aFacturar,
      precio: it.precio,
      descuento: 0,
    }))
  }
  if (f.tipoVenta === 'CON PRESUPUESTO PREVIO') {
    return f.ventaItems.map((it) => ({
      codigo: it.codigo,
      nombre: it.nombre,
      cantidad: it.aVender,
      precio: it.precio,
      // El descuento es el que quedó en la línea de la venta (editable en el paso 2).
      descuento: it.desc,
    }))
  }
  return f.lineas.map((l) => ({
    codigo: l.producto.codigo,
    nombre: l.producto.nombre,
    cantidad: l.cantidad,
    precio: l.producto.precio,
    descuento: l.descuento,
  }))
}

export const totalLineaFactura = (l: LineaFactura): number =>
  round2(l.precio * l.cantidad * (1 - l.descuento / 100))

export interface TotalesFactura {
  subtotal: number
  iva: number
  total: number
}

export function totalesFactura(lineas: LineaFactura[]): TotalesFactura {
  const subtotal = round2(lineas.reduce((acc, l) => acc + totalLineaFactura(l), 0))
  const iva = round2(subtotal * IVA_RATE)
  return { subtotal, iva, total: round2(subtotal + iva) }
}

/** La condición frente al IVA del receptor sale de la del cliente. */
export function ivaPorDefecto(c: Cliente): CondicionIVA {
  if (c.status === 'Responsable Inscripto') return 'Responsable Inscripto'
  if (c.status === 'Monotributo') return 'Monotributo'
  return 'Consumidor Final'
}

/** Sólo entre responsables inscriptos se emite factura A. */
export const letraPorDefecto = (c: Cliente): LetraComprobante =>
  ivaPorDefecto(c) === 'Responsable Inscripto' ? 'A' : 'B'

/**
 * Letra del comprobante que se emite al cliente: **A** para los responsables —inscripto o
 * monotributista— y **B** para el consumidor final y el exento.
 *
 * Se resuelve sobre el texto de la condición fiscal del board y no sobre `ivaPorDefecto`,
 * que colapsa monotributo y consumidor final en categorías distintas de las que rigen acá.
 */
export const letraComprobante = (condicionFiscal: string): LetraComprobante =>
  /inscript|monotribut/i.test(condicionFiscal ?? '') ? 'A' : 'B'

/** Punto de venta con el que nacen los comprobantes hasta que se definan los reales. */
export const PUNTO_VENTA_DEFAULT = '0000'

/**
 * La factura vence a plazo. Sólo pasa con la cuenta corriente: en cualquier otra condición se
 * cobra al emitirse, así que no hay días de vencimiento ni fecha que mostrar.
 */
export const facturaVenceAPlazo = (c: Cliente): boolean =>
  c.condicionPago === 'CUENTA CORRIENTE'
