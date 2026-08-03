import { useMemo, useState } from 'react'
import { datosCobroVenta, descuentoDeFormaPago } from '@/lib/cobros'
import { round2 } from '@/lib/format'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { IVA_RATE } from '@/lib/selectors'
import {
  actualizarCantVendida,
  crearVenta,
  registrarFacturacionVtasPend,
  vincularVentaAlCobro,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Creación de la venta en "📈Ventas" a partir del estado de la app. Es la MISMA lógica que corría
 * en el cierre (CobroView): se extrae acá para que también la puedan disparar los pasos que van
 * directo a la proforma (agente de retención con entrega distinta de POSTERIOR).
 *
 * `crear()` es idempotente: si la venta ya existe (state.ventaId) no la recrea. Devuelve el id de la
 * venta, o null si falló o quedó incompleta (en cuyo caso deja el error en `errorVenta`).
 */
export function useCrearVenta() {
  const state = useApp()
  const dispatch = useDispatch()
  const { cliente, operacion, tipoVenta, tipoEntrega, cobro } = state
  const [creando, setCreando] = useState(false)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)

  /* Rentabilidad general ponderada por el importe bonificado de cada línea, igual que el cierre. */
  const rentabilidadVenta = useMemo(() => {
    const productos = lineasDeVenta({
      operacion,
      tipoVenta,
      tipoEntrega,
      lineas: state.lineas,
      ventaItems: state.ventaItems,
      facturaItems: state.facturaItems,
    })
    const base = productos.reduce(
      (acc, p) => acc + p.precioUnitario * p.cantidad * (1 - p.descuento / 100),
      0,
    )
    if (base <= 0) return 0
    const ponderada = productos.reduce(
      (acc, p) =>
        acc + p.rentabilidad * ((p.precioUnitario * p.cantidad * (1 - p.descuento / 100)) / base),
      0,
    )
    return Math.round(ponderada)
  }, [state.lineas, state.ventaItems, state.facturaItems, operacion, tipoVenta, tipoEntrega])

  const crear = async (): Promise<string | null> => {
    if (!cliente) return null
    // El responsable/ruta sólo se pregunta en la entrega POSTERIOR.
    const esEntregaPosterior = tipoEntrega === 'POSTERIOR'
    const productos = lineasDeVenta({
      operacion,
      tipoVenta,
      tipoEntrega,
      lineas: state.lineas,
      ventaItems: state.ventaItems,
      facturaItems: state.facturaItems,
    })

    /* Total en pesos (con IVA): neto bonificado × (1 + IVA). El neto incluye el descuento por forma
       de pago (igual que los subelementos y la métrica TOTAL del resumen), no sólo el manual. */
    const descFormaPago = descuentoDeFormaPago(state.formaPago, state.descuentosPago)
    const neto = productos.reduce((acc, p) => {
      const descTotal = Math.min((p.descuento ?? 0) + descFormaPago, 100)
      return acc + p.precioUnitario * p.cantidad * (1 - descTotal / 100)
    }, 0)
    const importeTotalPesos = round2(neto * (1 + IVA_RATE))

    let ventaId = state.ventaId
    if (!ventaId) {
      const creada = await crearVenta({
        clienteId: cliente.id,
        nombre: cliente.name,
        tipoVenta: tipoVenta ?? 'DIRECTA',
        tipoEntrega: tipoEntrega ?? 'SIMULTANEA',
        ...datosCobroVenta(cliente, cobro),
        rentabilidad: rentabilidadVenta,
        descFormaPago,
        tasaCambio: state.tasaCambio,
        importeTotalPesos,
        responsableEntrega: esEntregaPosterior
          ? state.entregaVenta.responsable ?? undefined
          : undefined,
        rutaId:
          esEntregaPosterior && state.entregaVenta.rutaConfirmada
            ? state.entregaVenta.rutaId ?? undefined
            : undefined,
        lineas: productos,
      })
      if (creada.subitemsCreados !== productos.length) {
        setErrorVenta(
          `La venta se creó pero quedó incompleta: entraron ${creada.subitemsCreados} de ${productos.length} productos. Revisala en Monday.`,
        )
        return null
      }
      ventaId = creada.id
      dispatch({ type: 'setVentaId', value: ventaId })
    }

    // CON PRESUPUESTO PREVIO: se asienta la cantidad vendida en los subelementos del presupuesto.
    if (tipoVenta === 'CON PRESUPUESTO PREVIO') {
      await actualizarCantVendida(
        state.ventaItems
          .filter((it) => it.subitemId)
          .map((it) => ({ subitemId: it.subitemId as string, cantVendida: (it.vend ?? 0) + it.aVender })),
      )
    }
    // ENTREGA ANTERIOR: conciliación best-effort en "Vtas Pends de Facturar".
    if (state.facturaItems.length > 0) {
      try {
        await registrarFacturacionVtasPend(
          state.facturaItems.map((it) => ({
            subitemId: it.subitemId,
            ventaPendId: it.ventaPendId,
            aFacturar: it.aFacturar,
            precio: it.precio,
          })),
          ventaId,
        )
      } catch {
        /* La conciliación de "Vtas Pends de Facturar" es best-effort. */
      }
    }
    // El recibo simultáneo nace antes que la venta: se cierra el vínculo si existe.
    if (cobro.cobroId) await vincularVentaAlCobro(cobro.cobroId, ventaId)

    return ventaId
  }

  return { crear, creando, setCreando, errorVenta, setErrorVenta }
}
