import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { PRODUCTOS } from '@/data/mock'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import { FormaPagoSelect } from '@/features/productos/FormaPagoSelect'
import { PendientesSelector, type PendienteFila } from '@/features/shared/PendientesSelector'
import { pasosDe } from '@/lib/pasos'
import {
  AVANCE_COLOR,
  AVANCE_LABEL,
  avanceLinea,
  resumenVenta,
  ventaItemUid,
} from '@/lib/selectors'
import { getPresupuestosVigentes, type PresupuestoVigente } from '@/services/monday'
import { maxAVender, type SeleccionVenta } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import type { PresupuestoProducto } from '@/types'
import { ResumenPresupuestos } from './ResumenPresupuestos'
import { ResumenVentaCard } from './ResumenVentaCard'

/**
 * Paso 2 de VENTA con presupuesto previo: se traen del board los presupuestos que
 * todavía no vencieron y se listan todos sus productos en una sola lista, con lo presupuestado,
 * lo vendido y lo que queda disponible. De ahí se llevan a la venta con la cantidad elegida.
 */
export function VentaView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, ventaItems } = useApp()
  const dispatch = useDispatch()
  // Flujo Proforma directo (agente de retención con entrega != POSTERIOR): crea la venta acá.
  // Presupuesto elegido como filtro de la lista de productos (toggle desde las cards).
  const [filtroOrigen, setFiltroOrigen] = useState<string | null>(null)
  // Ventana de advertencia cuando se quiere continuar sin productos en la venta.
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null)

  // Presupuestos vigentes del cliente, leídos del tablero al entrar al paso.
  const [presupuestos, setPresupuestos] = useState<PresupuestoVigente[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!cliente) {
      setPresupuestos([])
      return
    }
    let vivo = true
    setCargando(true)
    setError(false)
    getPresupuestosVigentes(cliente.id)
      .then((ps) => {
        if (vivo) setPresupuestos(ps)
      })
      .catch(() => {
        if (!vivo) return
        setPresupuestos([])
        setError(true)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente])

  // Sólo se llega acá con la venta configurada como CON PRESUPUESTO PREVIO.
  const tipo = tipoVenta ?? 'CON PRESUPUESTO PREVIO'
  const resumen = useMemo(() => resumenVenta(ventaItems, cliente, tipo), [ventaItems, cliente, tipo])
  // Venta: bloqueante. No se avanza al cierre si el cliente está bloqueado o la venta se pasa de
  // su línea; el aviso salta al hacer click en "Continuar a cobro".
  const bloqueo = useBloqueoCredito(resumen.total, { bloqueante: true })
  const yaEnLaVenta = useMemo(() => new Set(ventaItems.map((it) => it.uid)), [ventaItems])

  // Aplanado de todos los presupuestos vigentes, con lookup uid → línea original.
  const { pendientes, prodPorUid } = useMemo(() => {
    const filas: PendienteFila[] = []
    const porUid = new Map<string, PresupuestoProducto>()
    for (const p of presupuestos) {
      p.productos.forEach((prod, i) => {
        const uid = ventaItemUid(p.id, i)
        const estado = avanceLinea(prod.vend, prod.pend)
        porUid.set(uid, prod)
        filas.push({
          uid,
          codigo: prod.codigo,
          nombre: prod.nombre,
          origen: p.id,
          origenLabel: p.nro,
          referencia: prod.total,
          resuelta: prod.vend,
          pend: prod.pend,
          tipo: prod.tipo,
          estadoColor: AVANCE_COLOR[estado],
          // El board ya dice en qué estado de uso está la línea; si no, se deriva del avance.
          estadoLabel: prod.estadoUso || AVANCE_LABEL[estado],
          ya: yaEnLaVenta.has(uid),
        })
      })
    }
    return { pendientes: filas, prodPorUid: porUid }
  }, [presupuestos, yaEnLaVenta])

  // El precio, la rentabilidad y el descuento son los del presupuesto; acá el descuento no se edita.
  const filas = useMemo<FilaProducto[]>(
    () =>
      ventaItems.map((it) => ({
        id: it.uid,
        codigo: it.codigo,
        nombre: it.nombre,
        cantidad: it.aVender,
        precio: it.precio,
        descuento: it.desc,
        rentabilidad: it.rent,
        // Ficha del catálogo para el desplegable de stock, cuando el código coincide.
        producto: PRODUCTOS.find((p) => p.codigo === it.codigo),
        cantidadMax: maxAVender(it),
      })),
    [ventaItems],
  )

  if (!cliente) return null

  const confirmar = (sel: { uid: string; cantidad: number }[]) => {
    const seleccion: SeleccionVenta[] = []
    for (const s of sel) {
      const prod = prodPorUid.get(s.uid)
      if (prod) seleccion.push({ uid: s.uid, prod, cantidad: s.cantidad })
    }
    dispatch({ type: 'agregarVentaSeleccion', seleccion })
  }

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={1} />

      <PasoTitulo
        numero={2}
        titulo="Cargar productos"
        descripcion="Elegí los productos disponibles de los presupuestos vigentes y ajustá la cantidad a vender."
      />

      {/* Forma de Pago de la venta, debajo del título y la descripción. */}
      <FormaPagoSelect />

      {/* Resumen de presupuestos a la izquierda (filtro); todos sus productos, a la derecha. */}
      <div className="pend-grid">
        <ResumenPresupuestos
          presupuestos={presupuestos}
          cargando={cargando}
          error={error}
          seleccionado={filtroOrigen}
          onSelect={(id) => setFiltroOrigen((prev) => (prev === id ? null : id))}
        />
        <PendientesSelector
          titulo="Todos los productos presupuestados"
          hint="Seleccioná los productos, ajustá la cantidad a vender (no puede superar lo disponible) y confirmalos para agregarlos a la venta."
          vacio={
            cargando
              ? 'Buscando los presupuestos vigentes del cliente…'
              : error
                ? 'No se pudieron traer los productos presupuestados. Reintentá en unos segundos.'
                : 'Este cliente no tiene presupuestos vigentes con productos disponibles.'
          }
          colReferencia="Presupuestada"
          colResuelta="Vendida"
          colPend="Disponible"
          colAccion="A vender"
          mostrarTipo
          filas={pendientes}
          filtroOrigen={filtroOrigen}
          onVerTodos={() => setFiltroOrigen(null)}
          onConfirmar={confirmar}
        />
      </div>

      {/* Se llena al confirmar productos de la lista de pendientes. En la venta presupuestada el
          descuento queda fijo al del presupuesto: se puede editar la cantidad, pero NO el
          descuento (por eso no se pasa `onDescuento`; la celda lo muestra en modo lectura). */}
      <TablaProductos
        titulo="Productos seleccionados para la Venta"
        filas={filas}
        onRemove={(uid) => dispatch({ type: 'removeVentaItem', uid })}
        onCantidad={(uid, cantidad) => dispatch({ type: 'setVentaCantidad', uid, cantidad })}
      />

      <ResumenVentaCard resumen={resumen} />

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
            if (ventaItems.length === 0) {
              setAviso({
                titulo: 'No hay productos seleccionados',
                texto:
                  'Tenés que agregar al menos un producto a la venta para continuar. Elegilos de los presupuestos vigentes del cliente y confirmalos.',
              })
              return
            }
            // El aviso de crédito se dispara acá, al continuar, y la venta frena.
            if (bloqueo.frenar()) return
            dispatch({ type: 'goto', paso: 'cobro' })
          }}
        >
          Continuar a cobro <i className="fas fa-chevron-right" />
        </button>
      </footer>

      {aviso && (
        <AvisoModal titulo={aviso.titulo} onClose={() => setAviso(null)}>
          {aviso.texto}
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
