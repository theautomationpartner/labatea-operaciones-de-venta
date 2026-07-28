import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { PendientesSelector, type PendienteFila } from '@/features/shared/PendientesSelector'
import { AVANCE_COLOR, AVANCE_LABEL_ENTREGA, avanceLinea, remitoItemUid } from '@/lib/selectors'
import { pasosDe } from '@/lib/pasos'
import { getVentasEntregaPendiente } from '@/services/monday'
import { type SeleccionRemito } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import type { VentaEntregaPendiente, VentaEntregaProducto } from '@/types'
import { CargaProductoRemito } from './CargaProductoRemito'
import { TablaRemito } from './TablaRemito'

/** Motivo por el que un producto no se puede remitar (ya se entregó por completo). */
const MOTIVO_NO_SELECCIONABLE = 'El producto ya está 100% entregado en la venta.'

/**
 * Color del estado de entrega del producto, tomado del board. Si la venta no lo trae cargado
 * se cae al avance de la línea (entregado vs. pendiente).
 */
function colorEstado(estado: string | undefined, avance: ReturnType<typeof avanceLinea>): string {
  if (!estado) return AVANCE_COLOR[avance]
  if (/100%/.test(estado)) return AVANCE_COLOR.completo
  if (/parcial/i.test(estado)) return AVANCE_COLOR.parcial
  return AVANCE_COLOR.pendiente
}

/**
 * Paso 2 de REMITO. POSTERIOR arma la mercadería desde el catálogo; ANTERIOR trae del board de
 * Ventas las ventas del cliente con entrega posterior pendiente y lista todos sus productos por
 * entregar. Tabla común.
 */
export function RemitoProductosView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, remito } = useApp()
  const dispatch = useDispatch()
  const esAnterior = remito.tipoEmision === 'ANTERIOR'
  // Aviso al intentar avanzar sin productos en el remito.
  const [sinProductos, setSinProductos] = useState(false)

  // Ventas del cliente con entrega pendiente, leídas del tablero al entrar al paso ANTERIOR.
  const [ventas, setVentas] = useState<VentaEntregaPendiente[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!cliente || !esAnterior) {
      setVentas([])
      return
    }
    let vivo = true
    setCargando(true)
    setError(false)
    getVentasEntregaPendiente(cliente.id)
      .then((vs) => {
        if (vivo) setVentas(vs)
      })
      .catch(() => {
        if (!vivo) return
        setVentas([])
        setError(true)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, esAnterior])

  // El remito compromete mercadería a facturar: mismo bloqueo que el resto de la operación.
  const bloqueo = useBloqueoCredito(0)
  const yaEnRemito = useMemo(() => new Set(remito.items.map((it) => it.uid)), [remito.items])

  // Aplanado de todas las ventas del cliente con entrega pendiente, con lookup uid → línea.
  const { pendientes, prodPorUid } = useMemo(() => {
    const filas: PendienteFila[] = []
    const porUid = new Map<string, VentaEntregaProducto>()
    for (const v of ventas) {
      v.productos.forEach((prod, i) => {
        const uid = remitoItemUid(v.id, i)
        const estado = avanceLinea(prod.entregada, prod.pendiente)
        porUid.set(uid, prod)
        filas.push({
          uid,
          codigo: prod.codigo,
          nombre: prod.nombre,
          origen: v.id,
          origenLabel: v.nro,
          referencia: prod.vendida,
          resuelta: prod.entregada,
          pend: prod.pendiente,
          // Unidad de medida (columna espejo del pendiente): se muestra en el listado.
          um: prod.um,
          // Ruta de entrega asignada al pendiente: se muestra al remitar (venta ANTERIOR).
          ruta: prod.ruta,
          estadoColor: colorEstado(prod.estadoEntrega, estado),
          // El board ya dice el estado de entrega de la línea; si no, se deriva del avance.
          estadoLabel: prod.estadoEntrega || AVANCE_LABEL_ENTREGA[estado],
          // Los productos 100% entregados se listan, pero no se pueden remitar.
          seleccionable: prod.seleccionable !== false,
          motivoBloqueo: MOTIVO_NO_SELECCIONABLE,
          ya: yaEnRemito.has(uid),
        })
      })
    }
    return { pendientes: filas, prodPorUid: porUid }
  }, [ventas, yaEnRemito])

  if (!cliente) return null

  const confirmar = (sel: { uid: string; cantidad: number }[]) => {
    const seleccion: SeleccionRemito[] = []
    for (const s of sel) {
      const prod = prodPorUid.get(s.uid)
      if (prod) seleccion.push({ uid: s.uid, prod, cantidad: s.cantidad })
    }
    dispatch({ type: 'agregarRemitoSeleccion', seleccion })
  }

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={1}
      />

      {/* La bajada cambia según de dónde sale la mercadería. */}
      <PasoTitulo
        numero={2}
        titulo="Cargar productos del remito"
        descripcion={
          esAnterior
            ? 'Elegí los productos pendientes de entregar de las ventas facturadas y ajustá la cantidad a remitar.'
            : 'Buscá y cargá desde el catálogo los productos que salen en este remito.'
        }
      />

      {esAnterior ? (
        /* Sin panel lateral: la tabla de pendientes ocupa el 100% del ancho, con su buscador y
           su botonera arriba. */
        <PendientesSelector
          titulo="Todos los productos pendientes de entregar"
          hint="Seleccioná los productos, ajustá la cantidad a remitar (no puede superar lo pendiente) y confirmalos para armar el remito."
          vacio={
            cargando
              ? 'Buscando los productos pendientes de entregar del cliente…'
              : error
                ? 'No se pudieron traer los productos pendientes. Reintentá en unos segundos.'
                : 'Este cliente no tiene productos pendientes de entregar.'
          }
          colReferencia="Vendida"
          colResuelta="Entregada"
          colPend="Pend. de entregar"
          colAccion="A remitar"
          mostrarUm
          mostrarRuta
          filas={pendientes}
          filtroOrigen={null}
          onConfirmar={confirmar}
        />
      ) : (
        <>
          {/* POSTERIOR: se remite ahora y se factura después. */}
          <p className="remito-aviso">
            <i className="fas fa-triangle-exclamation" /> Esta venta quedará{' '}
            <strong>pendiente de facturar</strong>: se remite la mercadería y la factura se emite
            más adelante.
          </p>
          <CargaProductoRemito />
        </>
      )}

      <TablaRemito
        items={remito.items}
        onCantidad={(uid, cantidad) => dispatch({ type: 'setRemitoItemCantidad', uid, cantidad })}
        onRemove={(uid) => dispatch({ type: 'removeRemitoItem', uid })}
        // POSTERIOR: la venta se factura después, así que se muestran precios e importe pendiente.
        mostrarImporte={!esAnterior}
      />

      <footer className="page-footer">
        <button
          type="button"
          className="btn-outline"
          onClick={() => dispatch({ type: 'goto', paso: 'cliente' })}
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        {/* El botón queda activo: si falta algo, la ventana explica qué, en vez de bloquear. */}
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            if (remito.items.length === 0) {
              setSinProductos(true)
              return
            }
            if (bloqueo.frenar()) return
            dispatch({ type: 'goto', paso: 'remito-envio' })
          }}
        >
          Continuar a especificación del envío <i className="fas fa-chevron-right" />
        </button>
      </footer>

      {sinProductos && (
        <AvisoModal titulo="No hay productos seleccionados" onClose={() => setSinProductos(false)}>
          Tenés que agregar al menos un producto para armar el remito y continuar.
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
