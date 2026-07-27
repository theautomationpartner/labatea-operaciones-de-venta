import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { PRODUCTOS } from '@/data/mock'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import { PendientesSelector, type PendienteFila } from '@/features/shared/PendientesSelector'
import { PASOS_REMITO } from '@/lib/pasos'
import {
  AVANCE_COLOR,
  AVANCE_LABEL_FACTURA,
  avanceLinea,
  facturaItemUid,
  resumenFactura,
} from '@/lib/selectors'
import { getRemitosPendientesFacturar, type RemitoPendiente } from '@/services/monday'
import { type SeleccionFactura } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import type { RemitoProducto } from '@/types'
import { ResumenFacturaBand } from './ResumenFacturaBand'
import { ResumenRemitos } from './ResumenRemitos'

/** Motivo que se muestra cuando el board no habilita la línea para facturar. */
const MOTIVO_NO_SELECCIONABLE =
  'El estado de facturación del producto en el remito no habilita facturarlo.'

/**
 * Color del estado de facturación del producto, tomado del board. Si el remito no lo trae
 * cargado se cae al avance de la línea (entregado vs. facturado).
 */
function colorEstado(estado: string | undefined, avance: ReturnType<typeof avanceLinea>): string {
  if (!estado) return AVANCE_COLOR[avance]
  if (/completa/i.test(estado)) return AVANCE_COLOR.completo
  if (/parcial/i.test(estado)) return AVANCE_COLOR.parcial
  return AVANCE_COLOR.pendiente
}

/**
 * Paso 2 de CARGAR VENTA con entrega ANTERIOR, cualquiera sea el tipo de venta: la mercadería
 * ya salió por remito, así que se traen del board los remitos del cliente que todavía tienen
 * algo que facturar y se listan todos sus productos con lo entregado, lo facturado y lo que
 * queda pendiente. De ahí se llevan a la factura con la cantidad elegida.
 */
export function RemitoView() {
  const { cliente, facturaItems } = useApp()
  const dispatch = useDispatch()
  // Remito elegido como filtro de la lista de productos (toggle desde las cards).
  const [filtroOrigen, setFiltroOrigen] = useState<string | null>(null)
  // Aviso al intentar avanzar sin productos a facturar.
  const [sinProductos, setSinProductos] = useState(false)

  // Remitos pendientes de facturar del cliente, leídos del tablero al entrar al paso.
  const [remitos, setRemitos] = useState<RemitoPendiente[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!cliente) {
      setRemitos([])
      return
    }
    let vivo = true
    setCargando(true)
    setError(false)
    getRemitosPendientesFacturar(cliente)
      .then((rs) => {
        if (vivo) setRemitos(rs)
      })
      .catch(() => {
        if (!vivo) return
        setRemitos([])
        setError(true)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente])

  // El descuento por remito ya no aplica: la lista aplana varios remitos en una sola factura.
  const resumen = useMemo(() => resumenFactura(facturaItems, cliente, 0), [facturaItems, cliente])
  // La factura consume línea: no se avanza si el cliente no la tiene disponible.
  const bloqueo = useBloqueoCredito(resumen.neto)
  const yaEnLaFactura = useMemo(() => new Set(facturaItems.map((it) => it.uid)), [facturaItems])

  // Aplanado de todos los remitos pendientes de facturar, con lookup uid → línea original.
  const { pendientes, prodPorUid } = useMemo(() => {
    const filas: PendienteFila[] = []
    const porUid = new Map<string, RemitoProducto>()
    for (const r of remitos) {
      r.productos.forEach((prod, i) => {
        const uid = facturaItemUid(r.id, i)
        const estado = avanceLinea(prod.cantFacturada, prod.pendiente)
        porUid.set(uid, prod)
        filas.push({
          uid,
          codigo: prod.codigo,
          nombre: prod.nombre,
          origen: r.id,
          origenLabel: r.nro,
          referencia: prod.cantRemito,
          resuelta: prod.cantFacturada,
          pend: prod.pendiente,
          estadoColor: colorEstado(prod.estadoFacturacion, estado),
          // El board ya dice el estado de facturación de la línea; si no, se deriva del avance.
          estadoLabel: prod.estadoFacturacion || AVANCE_LABEL_FACTURA[estado],
          // Los productos en "Pend de Facturar" se listan, pero no se pueden llevar.
          seleccionable: prod.seleccionable !== false,
          motivoBloqueo: MOTIVO_NO_SELECCIONABLE,
          ya: yaEnLaFactura.has(uid),
        })
      })
    }
    return { pendientes: filas, prodPorUid: porUid }
  }, [remitos, yaEnLaFactura])

  const filas = useMemo<FilaProducto[]>(
    () =>
      facturaItems.map((it) => ({
        id: it.uid,
        codigo: it.codigo,
        nombre: it.nombre,
        cantidad: it.aFacturar,
        precio: it.precio,
        descuento: 0,
        rentabilidad: it.rent,
        producto: PRODUCTOS.find((p) => p.codigo === it.codigo),
      })),
    [facturaItems],
  )

  if (!cliente) return null

  const confirmar = (sel: { uid: string; cantidad: number }[]) => {
    const seleccion: SeleccionFactura[] = []
    for (const s of sel) {
      const prod = prodPorUid.get(s.uid)
      if (prod) seleccion.push({ uid: s.uid, prod, cantidad: s.cantidad })
    }
    dispatch({ type: 'agregarFacturaSeleccion', seleccion })
  }

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader pasos={PASOS_REMITO} actual={1} />

      <PasoTitulo
        numero={2}
        titulo="Cargar productos"
        descripcion="Elegí los productos ya remitidos que quedan pendientes de facturar y ajustá la cantidad."
      />

      {/* Resumen de remitos a la izquierda (filtro); todos sus productos, a la derecha. */}
      <div className="pend-grid">
        <ResumenRemitos
          remitos={remitos}
          cargando={cargando}
          error={error}
          seleccionado={filtroOrigen}
          onSelect={(id) => setFiltroOrigen((prev) => (prev === id ? null : id))}
        />
        <PendientesSelector
          titulo="Todos los productos sin facturar"
          hint="Seleccioná los productos, ajustá la cantidad a facturar (no puede superar lo pendiente) y confirmalos para agregarlos a la facturación."
          vacio={
            cargando
              ? 'Buscando los remitos pendientes de facturar del cliente…'
              : error
                ? 'No se pudieron traer los productos de los remitos. Reintentá en unos segundos.'
                : 'Este cliente no tiene remitos con productos pendientes de facturar.'
          }
          colReferencia="Cant. entregada"
          colResuelta="Cant. facturada"
          colPend="Pend. de facturar"
          colAccion="A facturar"
          filas={pendientes}
          filtroOrigen={filtroOrigen}
          onVerTodos={() => setFiltroOrigen(null)}
          onConfirmar={confirmar}
        />
      </div>

      <TablaProductos
        titulo="Productos a facturar"
        filas={filas}
        onRemove={(uid) => dispatch({ type: 'removeFacturaItem', uid })}
      />

      <ResumenFacturaBand resumen={resumen} />

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
            if (facturaItems.length === 0) {
              setSinProductos(true)
              return
            }
            if (bloqueo.frenar()) return
            dispatch({ type: 'goto', paso: 'cobro' })
          }}
        >
          Continuar a cobro <i className="fas fa-chevron-right" />
        </button>
      </footer>

      {sinProductos && (
        <AvisoModal titulo="No hay productos seleccionados" onClose={() => setSinProductos(false)}>
          Tenés que agregar al menos un producto a facturar para continuar. Elegilos de los remitos
          pendientes del cliente y confirmalos.
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
