import { useMemo } from 'react'
import { descuentoDeFormaPago } from '@/lib/cobros'
import { alicuotaDeclarada, descuentoUnitario, ivaLinea } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { lineasDeVenta, rentabilidadGeneralDeLineas } from '@/lib/lineasVenta'
import { useApp } from '@/state/hooks'

/**
 * Los números de la factura proforma de la venta CONTADO: las líneas, sus importes y los totales. Es
 * lo que muestra la card, lo que lleva el PDF y lo que se registra en Monday (`crearProforma`): los
 * tres salen de acá para que no puedan diferir.
 */
export function useProformaVenta() {
  const state = useApp()
  const { operacion, tipoVenta, tipoEntrega, formaPago, descuentosPago } = state

  /* Descuento por forma de pago (pronto pago): se compone con el descuento manual de cada línea,
     igual que en la tabla de "Seleccionar productos" del paso anterior, y entra en la rentabilidad
     de cada línea que se graba en la proforma. */
  const descFormaPago = descuentoDeFormaPago(formaPago, descuentosPago)

  const productos = useMemo(
    () =>
      lineasDeVenta({
        operacion,
        tipoVenta,
        tipoEntrega,
        lineas: state.lineas,
        ventaItems: state.ventaItems,
        facturaItems: state.facturaItems,
        descFormaPago,
      }),
    [operacion, tipoVenta, tipoEntrega, state.lineas, state.ventaItems, state.facturaItems, descFormaPago],
  )

  /* Filas de la factura proforma con los MISMOS valores que va a escribir `crearProforma`:
       · Importe Bonif. por unidad = los dos descuentos compuestos EN CASCADA (`descuentoUnitario`),
         no sumados. Sumarlos daba de más —4% + 6% = 10% contra el 9,64% real—.
       · IVA de la línea = su neto ya bonificado por la alícuota DECLARADA del producto, no un 21%
         plano: con un producto al 10,5% el total no cerraba contra el emitido. */
  const filas = useMemo(
    () =>
      productos.map((l) => {
        const bonifUnit = descuentoUnitario(l.precioUnitario, l.descuento, descFormaPago).total
        const totalLinea = round2((l.precioUnitario - bonifUnit) * l.cantidad)
        return { ...l, bonifUnit, totalLinea, ivaLinea: ivaLinea(totalLinea, alicuotaDeclarada(l.iva)) }
      }),
    [productos, descFormaPago],
  )

  /* Totales: el bruto es Σ (precio × cantidad); el neto (gravado), la suma de los "Total" de cada
     línea; el descuento, su diferencia; y el IVA, la suma del de cada línea. */
  const totales = useMemo(() => {
    const neto = round2(filas.reduce((acc, f) => acc + f.totalLinea, 0))
    const bruto = round2(filas.reduce((acc, f) => acc + f.precioUnitario * f.cantidad, 0))
    const iva = round2(filas.reduce((acc, f) => acc + f.ivaLinea, 0))
    return { bruto, neto, descuento: round2(bruto - neto), iva, total: round2(neto + iva) }
  }, [filas])

  /* Rentabilidad general: la de cada línea ponderada por su costo, con la misma función que la
     venta. Con decimales. */
  const rentabilidadGeneral = useMemo(
    () => rentabilidadGeneralDeLineas(productos, descFormaPago),
    [productos, descFormaPago],
  )

  return { productos, filas, ...totales, rentabilidadGeneral, descFormaPago }
}
