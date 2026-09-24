/**
 * Normaliza los productos de la venta, vengan del flujo que vengan.
 *
 * Los tres caminos guardan sus líneas con formas distintas: el catálogo (venta DIRECTA con
 * entrega posterior o simultánea) usa `LineaPresupuesto`, el presupuesto previo usa
 * `VentaItem` y la entrega ANTERIOR usa `FacturaItem`. La escritura en el board necesita una
 * sola forma, y es esta.
 */
import { netoLinea } from '@/lib/descuentos'
import { esFlujoRemito } from '@/lib/pasos'
import {
  costoEfectivoLinea,
  costoParaPonderar,
  fleteDe,
  notaCreditoLinea,
  rentabilidadFinalLinea,
  rentabilidadGeneral,
  rentabilidadItemRemito,
  rentabilidadVentaItem,
} from '@/lib/selectors'
import type { LineaVenta } from '@/services/monday'
import type {
  FacturaItem,
  LineaPresupuesto,
  Operacion,
  TipoEntrega,
  TipoVenta,
  VentaItem,
} from '@/types'

interface OrigenLineas {
  /** La operación en curso: la VENTA PROFORMA arma sus líneas desde `ventaItems`, como el presupuesto. */
  operacion: Operacion | null
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  /** Venta DIRECTA: lo cargado desde el catálogo de productos. */
  lineas: LineaPresupuesto[]
  /** Venta CON PRESUPUESTO PREVIO y VENTA PROFORMA: lo tomado de presupuestos/proformas. */
  ventaItems: VentaItem[]
  /** Entrega ANTERIOR (cualquier tipo de venta): lo tomado de los remitos a facturar. */
  facturaItems: FacturaItem[]
  /**
   * Descuento por forma de pago de la operación, en %. Entra en la rentabilidad de cada línea: sin
   * él, lo que se grababa en Monday era la rentabilidad con el descuento manual solo, un número
   * distinto del que el vendedor vio en la tabla. Las líneas de una PROFORMA traen el suyo.
   */
  descFormaPago?: number
}

/** Las líneas de la venta en curso, vengan del remito, del presupuesto/proforma o del catálogo. */
export function lineasDeVenta({
  operacion,
  tipoVenta,
  tipoEntrega,
  descFormaPago = 0,
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
      /* La rentabilidad registrada al remitir, con el descuento por forma de pago de ESTA venta
         aplicado encima: la misma que muestra la tabla y el resumen de la factura. */
      rentabilidad: rentabilidadItemRemito(it, descFormaPago),
      costoUnitario: it.costo,
      flete: it.flete,
      /* Entrega ANTERIOR: la condición de comisión sale del subelemento de "Vtas Pends de Facturar"
         (espejo "Comision" del Maestro), resuelta al seleccionar el producto. Así la comisión que se
         registra coincide con la que vio el vendedor en el resumen. */
      comisionable: it.comisionable ?? false,
      codigo: it.codigo,
      um: it.um,
      tipoMercaderia: it.tipo,
      proveedorId: it.proveedorId,
      proveedorNombre: it.proveedorNombre,
      iva: it.iva,
    }))
  }

  // CON PRESUPUESTO PREVIO y VENTA PROFORMA comparten origen: los productos ya están en `ventaItems`.
  if (tipoVenta === 'CON PRESUPUESTO PREVIO' || operacion === 'VENTA PROFORMA') {
    return ventaItems.map((it) => ({
      productoId: it.productoId,
      nombre: it.nombre,
      cantidad: it.aVender,
      precioUnitario: it.precio,
      descuento: it.desc ?? 0,
      // VENTA sobre PROFORMA: el descuento por forma de pago se toma del subelemento de la proforma
      // (no se recalcula). En CON PRESUPUESTO PREVIO viene indefinido (el presupuesto no lo tiene).
      descFormaPago: it.descFormaPago,
      /* Presupuesto: recalculada con importes y los descuentos de esta venta. Proforma: la
         registrada, porque sus descuentos no se tocan (ver `rentabilidadVentaItem`). */
      rentabilidad: rentabilidadVentaItem(it, descFormaPago),
      costoUnitario: it.costo,
      flete: it.flete,
      // Comisión: mirror "🤖Comision" del subelemento del presupuesto (SI/NO).
      comisionable: it.comisionable === true,
      // U.M.: mirror "🤖Unidad de Venta" del subelemento del presupuesto.
      um: it.um,
      codigo: it.codigo,
      tipoMercaderia: it.tipo,
      proveedorId: it.proveedorId,
      proveedorNombre: it.proveedorNombre,
      iva: it.iva,
      // El ítem de stock viene del subelemento del presupuesto (heredado del maestro).
      stockId: it.stockId,
      /* De qué presupuesto salió esta línea: la venta se enlaza a TODOS los que aportaron, y esa
         lista se junta de acá porque una venta puede mezclar productos de varios. */
      presupuestoId: it.presupuestoId,
    }))
  }

  return lineas.map((l) => ({
    productoId: l.producto.id,
    nombre: l.producto.nombre,
    cantidad: l.cantidad,
    precioUnitario: l.producto.precio,
    // Precio original en USD (sólo si el producto estaba en dólares): auditoría de la venta.
    precioUsd: l.producto.precioUsd,
    descuento: l.descuento,
    /* Rentabilidad FINAL, la MISMA de la columna de la tabla: con los dos descuentos compuestos
       (manual y forma de pago) y el flete restado, o el % forzado cuando la rentabilidad forzada
       corre. */
    rentabilidad: rentabilidadFinalLinea(l, descFormaPago),
    // Costo por unidad con el que se mide (el nuevo, si se forzó): pondera la rentabilidad general.
    costoUnitario: costoEfectivoLinea(l, descFormaPago),
    // Flete por unidad del producto (ya en pesos si estaba en dólares).
    flete: fleteDe(l.producto),
    // Comisión: "✋️Comision" del Maestro (SI/NO), que la línea trae del catálogo.
    comisionable: l.producto.comisionable === true,
    codigo: l.producto.codigo,
    um: l.producto.um,
    tipoMercaderia: l.producto.tipo,
    proveedorId: l.producto.provId,
    proveedorNombre: l.producto.provNombre,
    iva: l.producto.iva,
    // El ítem de stock viene directo del maestro (venta DIRECTA).
    stockId: l.producto.stockId,
    // Nota de Crédito x Comisión POR UNIDAD (rentabilidad forzada), si corre para la línea.
    notaCreditoComision: notaCreditoLinea(l, descFormaPago),
  }))
}

/**
 * Rentabilidad GENERAL de la venta a partir de sus líneas normalizadas: la de cada línea ponderada
 * por su costo (ver `rentabilidadGeneral` en `lib/selectors`). Es lo que se graba en la cabecera
 * del documento, y sale de la MISMA rentabilidad por línea que se graba en cada subelemento.
 *
 * Una línea sin costo conocido se pondera por el costo que se despeja de su importe neto y su
 * rentabilidad (`costoParaPonderar`).
 */
export function rentabilidadGeneralDeLineas(lineas: LineaVenta[], descFormaPago = 0): number {
  return rentabilidadGeneral(
    lineas.map((l) => {
      const neto = netoLinea(
        l.precioUnitario,
        l.cantidad,
        l.descuento ?? 0,
        l.descFormaPago ?? descFormaPago,
      )
      return {
        rentabilidad: l.rentabilidad,
        costo: costoParaPonderar(l.costoUnitario, l.cantidad, neto, l.rentabilidad),
      }
    }),
  )
}
