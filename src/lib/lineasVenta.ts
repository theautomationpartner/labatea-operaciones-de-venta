/**
 * Normaliza los productos de la venta, vengan del flujo que vengan.
 *
 * Los tres caminos guardan sus líneas con formas distintas: el catálogo (venta DIRECTA con
 * entrega posterior o simultánea) usa `LineaPresupuesto`, el presupuesto previo usa
 * `VentaItem` y la entrega ANTERIOR usa `FacturaItem`. La escritura en el board necesita una
 * sola forma, y es esta.
 */
import { esFlujoRemito } from '@/lib/pasos'
import { rentabilidadEfectiva } from '@/lib/selectors'
import type { LineaVenta } from '@/services/monday'
import type { FacturaItem, LineaPresupuesto, TipoEntrega, TipoVenta, VentaItem } from '@/types'

interface OrigenLineas {
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  /** Venta DIRECTA: lo cargado desde el catálogo de productos. */
  lineas: LineaPresupuesto[]
  /** Venta CON PRESUPUESTO PREVIO: lo tomado de los presupuestos vigentes. */
  ventaItems: VentaItem[]
  /** Entrega ANTERIOR (cualquier tipo de venta): lo tomado de los remitos a facturar. */
  facturaItems: FacturaItem[]
}

/** Las líneas de la venta en curso, vengan del remito, del presupuesto o del catálogo. */
export function lineasDeVenta({
  tipoVenta,
  tipoEntrega,
  lineas,
  ventaItems,
  facturaItems,
}: OrigenLineas): LineaVenta[] {
  // La entrega ANTERIOR manda sobre el tipo de venta: lo que se factura sale del remito.
  if (esFlujoRemito(tipoEntrega)) {
    return facturaItems.map((it) => ({
      // El remito sí guarda el producto conectado: el subelemento de la venta lo arrastra.
      productoId: it.productoId,
      nombre: it.nombre,
      cantidad: it.aFacturar,
      precioUnitario: it.precio,
      // El remito ya salió: lo que se factura no lleva descuento por línea.
      descuento: 0,
      rentabilidad: it.rent,
      codigo: it.codigo,
      tipoMercaderia: it.tipo,
      proveedorId: it.proveedorId,
      proveedorNombre: it.proveedorNombre,
      iva: it.iva,
    }))
  }

  if (tipoVenta === 'CON PRESUPUESTO PREVIO') {
    return ventaItems.map((it) => ({
      productoId: it.productoId,
      nombre: it.nombre,
      cantidad: it.aVender,
      precioUnitario: it.precio,
      descuento: it.desc ?? 0,
      rentabilidad: rentabilidadEfectiva(it.rent, it.desc ?? 0),
      codigo: it.codigo,
      tipoMercaderia: it.tipo,
      proveedorId: it.proveedorId,
      proveedorNombre: it.proveedorNombre,
      iva: it.iva,
    }))
  }

  return lineas.map((l) => ({
    productoId: l.producto.id,
    nombre: l.producto.nombre,
    cantidad: l.cantidad,
    precioUnitario: l.producto.precio,
    descuento: l.descuento,
    rentabilidad: rentabilidadEfectiva(l.producto.rentabilidad, l.descuento),
    codigo: l.producto.codigo,
    tipoMercaderia: l.producto.tipo,
    proveedorId: l.producto.provId,
    proveedorNombre: l.producto.provNombre,
    iva: l.producto.iva,
  }))
}
