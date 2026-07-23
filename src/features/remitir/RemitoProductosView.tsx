import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { VENTAS_ENTREGA } from '@/data/mock'
import { PendientesSelector, type PendienteFila } from '@/features/shared/PendientesSelector'
import { AVANCE_COLOR, AVANCE_LABEL_ENTREGA, avanceLinea, remitoItemUid } from '@/lib/selectors'
import { pasosDe } from '@/lib/pasos'
import { type SeleccionRemito } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import type { EstadoEntrega, VentaEntregaProducto } from '@/types'
import { CargaProductoRemito } from './CargaProductoRemito'
import { ResumenVentasEntrega } from './ResumenVentasEntrega'
import { TablaRemito } from './TablaRemito'

/** Sólo se remite lo que falta entregar: ventas pendientes o entregadas en parte. */
const REMITIBLES: readonly EstadoEntrega[] = ['Pend. de Entregar', 'Parcialmente entregada']

/**
 * Paso 2 de REMITO. POSTERIOR arma la mercadería desde el catálogo; ANTERIOR lista todos
 * los productos pendientes de entregar de las ventas facturadas del cliente. Tabla común.
 */
export function RemitoProductosView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, remito } = useApp()
  const dispatch = useDispatch()
  const esAnterior = remito.tipoEmision === 'ANTERIOR'
  // Venta elegida como filtro de la lista de productos (toggle desde las cards).
  const [filtroOrigen, setFiltroOrigen] = useState<string | null>(null)
  // Aviso al intentar avanzar sin productos en el remito.
  const [sinProductos, setSinProductos] = useState(false)

  // El remito compromete mercadería a facturar: mismo bloqueo que el resto de la operación.
  const bloqueo = useBloqueoCredito(0)
  const yaEnRemito = useMemo(() => new Set(remito.items.map((it) => it.uid)), [remito.items])

  // Aplanado de todas las ventas del cliente con entrega pendiente, con lookup uid → línea.
  const { pendientes, prodPorUid } = useMemo(() => {
    const filas: PendienteFila[] = []
    const porUid = new Map<string, VentaEntregaProducto>()
    if (!cliente) return { pendientes: filas, prodPorUid: porUid }
    for (const v of VENTAS_ENTREGA) {
      if (v.clienteId !== cliente.id || !REMITIBLES.includes(v.estado)) continue
      v.productos.forEach((prod, i) => {
        const uid = remitoItemUid(v.id, i)
        const estado = avanceLinea(prod.entregada, prod.pendiente)
        porUid.set(uid, prod)
        filas.push({
          uid,
          codigo: prod.codigo,
          nombre: prod.nombre,
          origen: v.id,
          referencia: prod.vendida,
          resuelta: prod.entregada,
          pend: prod.pendiente,
          estadoColor: AVANCE_COLOR[estado],
          estadoLabel: AVANCE_LABEL_ENTREGA[estado],
          ya: yaEnRemito.has(uid),
        })
      })
    }
    return { pendientes: filas, prodPorUid: porUid }
  }, [cliente, yaEnRemito])

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
        /* Resumen de ventas a la izquierda; todos sus productos pendientes, a la derecha. */
        <div className="pend-grid">
          <ResumenVentasEntrega
            clienteId={cliente.id}
            seleccionado={filtroOrigen}
            onSelect={(id) => setFiltroOrigen((prev) => (prev === id ? null : id))}
          />
          <PendientesSelector
            titulo="Todos los productos pendientes de entregar"
            hint="Seleccioná los productos, ajustá la cantidad a remitar (no puede superar lo pendiente) y confirmalos para armar el remito."
            vacio="Este cliente no tiene ventas con entrega pendiente."
            colReferencia="Vendida"
            colResuelta="Entregada"
            colPend="Pend. de entregar"
            colAccion="A remitar"
            filas={pendientes}
            filtroOrigen={filtroOrigen}
            onConfirmar={confirmar}
          />
        </div>
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
