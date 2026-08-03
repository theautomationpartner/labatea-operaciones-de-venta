import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { PRODUCTOS } from '@/data/mock'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import { pasosDe } from '@/lib/pasos'
import { resumenVenta, ventaItemUid } from '@/lib/selectors'
import { getProformasCliente, type ProformaVigente } from '@/services/monday'
import { hayDocumentoEmitido, type SeleccionVenta } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import { ResumenProformas } from './ResumenProformas'
import { ResumenVentaCard } from './ResumenVentaCard'

/**
 * Paso 2 de la VENTA CON PROFORMA. Se traen las proformas del cliente y se listan sus productos
 * en modo lectura estricta: la selección es "todo o nada" —una sola proforma a la vez, con TODOS
 * sus productos— y no se editan cantidades, precios ni descuentos. La primera proforma queda
 * elegida por defecto.
 */
export function VentaProformaView() {
  const state = useApp()
  const { cliente, operacion, tipoVenta, tipoEntrega, ventaItems } = state
  const dispatch = useDispatch()
  /* GUARDRAIL post-emisión: emitido un documento oficial, no se puede cambiar la proforma de origen
     (la tabla ya es de sólo lectura). La emisión hacia Monday es irreversible. */
  const bloqueadoPorEmision = hayDocumentoEmitido(state)

  const [proformas, setProformas] = useState<ProformaVigente[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)
  // Proforma elegida (exclusiva). Arranca en null y se fija a la primera al llegar la lista.
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null)

  // Proformas del cliente, leídas del board al entrar al paso.
  useEffect(() => {
    if (!cliente) {
      setProformas([])
      return
    }
    let vivo = true
    setCargando(true)
    setError(false)
    getProformasCliente(cliente.id)
      .then((ps) => {
        if (!vivo) return
        setProformas(ps)
        // Selección por defecto: la primera proforma de la lista.
        setSeleccionada(ps[0]?.id ?? null)
      })
      .catch(() => {
        if (!vivo) return
        setProformas([])
        setError(true)
        setSeleccionada(null)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente])

  // La proforma elegida manda todos sus productos a la venta (reemplazo exclusivo: todo o nada).
  useEffect(() => {
    const p = proformas.find((x) => x.id === seleccionada)
    const seleccion: SeleccionVenta[] = p
      ? p.productos.map((prod, i) => ({ uid: ventaItemUid(p.id, i), prod, cantidad: prod.total }))
      : []
    dispatch({ type: 'setVentaSeleccion', seleccion })
    // Se guarda el id de la proforma elegida: al facturar se la marca "Usada" (evita doble facturación).
    dispatch({ type: 'setProformaId', value: p?.id ?? null })
  }, [seleccionada, proformas, dispatch])

  // La proforma no lleva comisión editable: el resumen usa la base de una venta con presupuesto.
  const tipo = tipoVenta ?? 'CON PRESUPUESTO PREVIO'
  const resumen = useMemo(() => resumenVenta(ventaItems, cliente, tipo), [ventaItems, cliente, tipo])
  // El IMPORTE TOTAL se toma de la proforma elegida (su columna Total), no del recálculo.
  const importeProforma = proformas.find((p) => p.id === seleccionada)?.importe ?? 0
  // Venta: bloqueante. No se avanza al cobro si el cliente está bloqueado o se pasa de su línea.
  const bloqueo = useBloqueoCredito(resumen.total, { bloqueante: true })

  /* Filas de la tabla, en modo lectura: precio, cantidad y descuento vienen de la proforma, y el
     Importe Bonif., el IVA en $ y el Total se muestran tal cual se calcularon y guardaron en la
     proforma (no se recalculan). */
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
        producto: PRODUCTOS.find((p) => p.codigo === it.codigo),
        impBonif: it.impBonificado,
        ivaMonto: it.ivaMonto,
        totalLinea: it.totalLinea,
      })),
    [ventaItems],
  )

  if (!cliente) return null

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={1} />

      <PasoTitulo
        numero={2}
        titulo="Cargar productos"
        descripcion="Elegí una proforma del cliente: entran todos sus productos, sin edición. La selección es exclusiva (una proforma a la vez)."
      />

      {/* Proformas a la izquierda (selección exclusiva); sus productos, a la derecha, en lectura. */}
      <div className="pend-grid">
        <ResumenProformas
          proformas={proformas}
          cargando={cargando}
          error={error}
          seleccionada={seleccionada}
          // Post-emisión no se cambia la proforma de origen: la selección queda fija.
          onSelect={bloqueadoPorEmision ? () => {} : (id) => setSeleccionada(id)}
        />
        <TablaProductos
          titulo="Productos de la proforma"
          filas={filas}
          soloLectura
          mostrarIva
        />
      </div>

      <ResumenVentaCard resumen={resumen} ocultarSubtotal totalOverride={importeProforma} />

      <footer className="page-footer">
        <button
          type="button"
          className="btn-outline"
          onClick={() => dispatch({ type: 'goto', paso: 'cliente' })}
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            if (ventaItems.length === 0) {
              setAviso({
                titulo: 'No hay proforma seleccionada',
                texto:
                  'Elegí una proforma del cliente para continuar. Entran todos sus productos automáticamente.',
              })
              return
            }
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
