import { useMemo, useState } from 'react'
import { datosCobroVenta, descuentoDeFormaPago } from '@/lib/cobros'
import { netoLinea } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { documentoDeVentaItem, IVA_RATE } from '@/lib/selectors'
import {
  actualizarCantVendida,
  asociarActividades,
  crearVenta,
  getActividadesDePresupuestos,
  getActividadesDeProforma,
  registrarFacturacionVtasPend,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { AppState } from '@/state/appState'

/**
 * Qué actividades le corresponden a la venta que se está por crear.
 *
 * La gestión comercial se elige UNA sola vez, en el documento que la origina; el resto la
 * hereda en cascada:
 *   · VENTA DIRECTA (y VENTA PROFORMA armada desde una proforma DIRECTA): las tildadas acá mismo,
 *     en la etapa "Registrar Actividad" de esta operación.
 *   · VENTA CON PRESUPUESTO PREVIO: no tiene esa etapa —ya se completó al presupuestar—; hereda
 *     las de los presupuestos que aportaron algún producto vendido, leyendo la columna
 *     "🤖Actividades" de CADA UNO (`ventaItems` guarda de qué presupuesto salió cada línea en su
 *     propio `uid`, ver `documentoDeVentaItem`).
 *   · VENTA PROFORMA armada desde una proforma CON PRESUPUESTO PREVIO: tampoco elige nada nuevo;
 *     hereda las que la proforma ya trae en SU columna "🤖Actividades" (se las llevó de sus
 *     presupuestos al crearse, ver `crearProforma`). Acá NO sirve `documentoDeVentaItem`: el
 *     prefijo del `uid` es el id de la proforma, no el de un presupuesto.
 */
export async function actividadesDeLaVenta(state: AppState): Promise<string[]> {
  if (state.operacion === 'VENTA PROFORMA') {
    if (state.proformaTipoVenta === 'CON PRESUPUESTO PREVIO') {
      return state.proformaId ? getActividadesDeProforma(state.proformaId) : []
    }
    return state.actividadesDocumento.map((a) => a.id)
  }
  if (state.tipoVenta === 'CON PRESUPUESTO PREVIO') {
    const presupuestoIds = [...new Set(state.ventaItems.map((it) => documentoDeVentaItem(it.uid)))]
    return getActividadesDePresupuestos(presupuestoIds)
  }
  return state.actividadesDocumento.map((a) => a.id)
}

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
  const { cliente, operacion, tipoVenta, tipoEntrega } = state
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
    // Con decimales: no se redondea a entero (rentabilidad general del ítem de venta).
    return round2(ponderada)
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
    const neto = productos.reduce(
      (acc, p) => acc + netoLinea(p.precioUnitario, p.cantidad, p.descuento ?? 0, descFormaPago),
      0,
    )
    const importeTotalPesos = round2(neto * (1 + IVA_RATE))

    let ventaId = state.ventaId
    if (!ventaId) {
      // Se resuelve ANTES de crear la venta: entra en la MISMA mutation, junto al resto de la cabecera.
      const actividadesIds = await actividadesDeLaVenta(state)
      const creada = await crearVenta({
        clienteId: cliente.id,
        vendedorId: state.vendedor?.id ?? null,
        nombre: cliente.name,
        /* La VENTA PROFORMA HEREDA de la proforma su tipo de venta y su tipo de entrega: su
           recorrido no tiene etapas donde configurarlos, así que `state.tipoVenta` y
           `state.tipoEntrega` quedan en null y el `??` de abajo los resolvía a DIRECTA y
           SIMULTANEA —convirtiendo una proforma POSTERIOR en una venta que descuenta stock
           que no salió y no deja pendientes de entrega—. */
        tipoVenta: tipoVenta ?? state.proformaTipoVenta ?? 'DIRECTA',
        tipoEntrega: tipoEntrega ?? state.proformaTipoEntrega ?? 'SIMULTANEA',
        // El tipo de cobro sale de la forma de pago elegida, no de la condición del cliente.
        ...datosCobroVenta(state.formaPago, state.operacion),
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
        /* Comprobantes ya emitidos. Sólo los usa la entrega SIMULTÁNEA, para estampar el número
           del papel en el movimiento de stock de cada producto. */
        facturaIds: state.factura.comprobantes.map((c) => c.id).filter(Boolean),
        /* La proforma que originó la venta: se enlaza en "📈Proformas". Fuera de la VENTA
           PROFORMA es null y no se manda. */
        proformaId: state.proformaId,
        actividadesIds,
      })
      if (creada.subitemsCreados !== productos.length) {
        setErrorVenta(
          `La venta se creó pero quedó incompleta: entraron ${creada.subitemsCreados} de ${productos.length} productos. Revisala en Monday.`,
        )
        return null
      }
      ventaId = creada.id
      dispatch({ type: 'setVentaId', value: ventaId })
      /* Las actividades elegidas EN ESTA operación (no las heredadas) quedan asociadas a la venta
         recién creada, y con eso dejan de ofrecerse en la próxima operación: una gestión rinde UN
         documento. Las heredadas (CON PRESUPUESTO PREVIO, o proforma CON PRESUPUESTO PREVIO) ya
         quedaron asociadas al presupuesto o a la proforma que las originó; volver a asociarlas acá
         les pisaría esa relación. Sin `await` y con el fallo tragado: la venta ya está creada y
         correcta, y no puede quedar esperando por una relación. */
      void asociarActividades(
        state.actividadesDocumento.map((a) => a.id),
        { ventaId },
      ).then((sinAsociar) => {
        if (sinAsociar.length > 0) {
          console.warn('[actividades] sin asociar a la venta: ' + sinAsociar.join(', '))
        }
      })
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
    /* El recibo ya no se vincula acá: nace DESPUÉS de la venta (es un efecto secundario suyo) y
       arranca apuntándola, así que no hace falta cerrar el vínculo en un segundo paso. */
    return ventaId
  }

  return { crear, creando, setCreando, errorVenta, setErrorVenta }
}
