import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { PRODUCTOS } from '@/data/mock'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import { FormaPagoSelect } from '@/features/productos/FormaPagoSelect'
import { PendientesSelector, type PendienteFila } from '@/features/shared/PendientesSelector'
import { descuentoDeFormaPago } from '@/lib/cobros'
import { descuentoUnitario } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { indiceDePaso, pasosDe } from '@/lib/pasos'
import {
  AVANCE_COLOR,
  AVANCE_LABEL,
  avanceLinea,
  resumenVenta,
  ventaItemUid,
} from '@/lib/selectors'
import { getPresupuestosVigentes, type PresupuestoVigente } from '@/services/monday'
import { hayDocumentoEmitido, maxAVender, type SeleccionVenta } from '@/state/appState'
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
  const state = useApp()
  const {
    cliente,
    operacion,
    tipoVenta,
    tipoEntrega,
    ventaItems,
    formaPago,
    descuentosPago,
    comisiones,
    tasaCambio,
  } = state
  const dispatch = useDispatch()
  /* GUARDRAIL post-emisión: con un documento oficial ya emitido, la carga de productos queda en
     SOLO LECTURA (la emisión hacia Monday es irreversible). */
  const bloqueadoPorEmision = hayDocumentoEmitido(state)
  /* Descuento por forma de pago (pronto pago) de la venta: CONTADO 6%, débito 5%, crédito 3%
     (definidos en la config del sistema). Se compone con el descuento del presupuesto en la tabla
     y en el resumen, y se refleja también al escribir la venta en Monday. */
  const descFormaPago = descuentoDeFormaPago(formaPago, descuentosPago)
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
        dispatch({ type: 'errorMonday', accion: 'traer los presupuestos del cliente' })
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, dispatch])

  // Sólo se llega acá con la venta configurada como CON PRESUPUESTO PREVIO.
  const tipo = tipoVenta ?? 'CON PRESUPUESTO PREVIO'
  const resumen = useMemo(
    () => resumenVenta(ventaItems, cliente, tipo, descFormaPago, comisiones),
    [ventaItems, cliente, tipo, descFormaPago, comisiones],
  )
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
        /* Subtotal del producto en el presupuesto: para los productos en pesos, el TOTAL $ guardado
           en el subelemento (numeric_mm5w3qtg); para los dolarizados —que no tienen ese total en
           pesos— se convierte el precio unitario a pesos y se multiplica por la cant. disponible. */
        const subtotal = esDolar(prod.moneda)
          ? round2(prod.precio * (tasaCambio ?? 0) * prod.pend)
          : prod.subtotalPesos || round2(prod.precio * prod.pend)
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
          // Subtotal (en pesos) y rentabilidad (%) leídos/derivados del subelemento del presupuesto.
          subtotal,
          rentabilidad: prod.rent,
          estadoColor: AVANCE_COLOR[estado],
          // El board ya dice en qué estado de uso está la línea; si no, se deriva del avance.
          estadoLabel: prod.estadoUso || AVANCE_LABEL[estado],
          ya: yaEnLaVenta.has(uid),
        })
      })
    }
    return { pendientes: filas, prodPorUid: porUid }
  }, [presupuestos, yaEnLaVenta, tasaCambio])

  /* El precio, la rentabilidad y el descuento son los del presupuesto; acá el descuento no se edita.
     Los importes ya vienen en pesos (los productos en dólares se convirtieron al entrar). Se
     precalculan tres valores por línea, con las fórmulas compartidas de `lib/descuentos`:
       1. Importe Bonif = descuento por unidad, EN CASCADA (forma de pago y después el del
          presupuesto sobre el precio ya rebajado).
       2. Total Final = (Precio Unitario − Importe Bonif) × cantidad, SIN IVA. */
  const filas = useMemo<FilaProducto[]>(
    () =>
      ventaItems.map((it) => {
        const precio = it.precio
        /* El descuento se RECALCULA con el % de la línea (`it.desc`) y la forma de pago de ESTA
           venta, no se lee `it.impBonificado`: el "Descuento TOTAL" que trae el presupuesto lleva
           el pronto pago que se eligió allá, que no tiene por qué ser el de la venta. */
        const impBonif = descuentoUnitario(precio, it.desc ?? 0, descFormaPago).total
        // Importe Total de la línea, ya bonificado (con la forma de pago aplicada).
        const totalLinea = round2((precio - impBonif) * it.aVender)
        return {
          id: it.uid,
          codigo: it.codigo,
          nombre: it.nombre,
          cantidad: it.aVender,
          precio,
          descuento: it.desc,
          rentabilidad: it.rent,
          // Ficha del catálogo para el desplegable de stock, cuando el código coincide.
          producto: PRODUCTOS.find((p) => p.codigo === it.codigo),
          cantidadMax: maxAVender(it),
          impBonif,
          totalLinea,
        }
      }),
    [ventaItems, descFormaPago],
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
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={indiceDePaso('venta', operacion, tipoVenta, tipoEntrega)} />

      <PasoTitulo
        numero={indiceDePaso('venta', operacion, tipoVenta, tipoEntrega) + 1}
        titulo="Cargar productos"
        descripcion="Elegí los productos disponibles de los presupuestos vigentes y ajustá la cantidad a vender."
      />

      {/* Forma de Pago de la venta, debajo del título y la descripción. Post-emisión, bloqueada. */}
      <FormaPagoSelect bloqueado={bloqueadoPorEmision} />

      {/* Post-emisión: se oculta el selector de productos (no se agregan más ítems a la venta). */}
      {bloqueadoPorEmision ? (
        <div className="card aviso-bloqueo">
          <i className="fas fa-lock" /> El documento ya fue emitido en Monday: la carga de productos
          quedó bloqueada y no puede modificarse.
        </div>
      ) : (
        /* Resumen de presupuestos a la izquierda (filtro); todos sus productos, a la derecha. */
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
                  ? ''
                  : 'Este cliente no tiene presupuestos vigentes con productos disponibles.'
            }
            colReferencia="Presupuestada"
            colResuelta="Vendida"
            colPend="Disponible"
            colAccion="A vender"
            // Sin columna "Tipo" (el dato se usa para dividir la mercadería al facturar, no se muestra).
            // Se muestran el Subtotal (en pesos) y la Rentabilidad del producto en el presupuesto.
            mostrarSubtotal
            mostrarRentabilidad
            filas={pendientes}
            filtroOrigen={filtroOrigen}
            onVerTodos={() => setFiltroOrigen(null)}
            onConfirmar={confirmar}
          />
        </div>
      )}

      {/* Se llena al confirmar productos de la lista de pendientes. En la venta presupuestada el
          descuento queda fijo al del presupuesto: se puede editar la cantidad, pero NO el
          descuento (por eso no se pasa `onDescuento`; la celda lo muestra en modo lectura).
          Post-emisión, la tabla completa pasa a SOLO LECTURA (sin editar cantidad ni quitar). */}
      <TablaProductos
        titulo="Productos seleccionados para la Venta"
        filas={filas}
        onRemove={
          bloqueadoPorEmision ? undefined : (uid) => dispatch({ type: 'removeVentaItem', uid })
        }
        onCantidad={
          bloqueadoPorEmision
            ? undefined
            : (uid, cantidad) => dispatch({ type: 'setVentaCantidad', uid, cantidad })
        }
        soloLectura={bloqueadoPorEmision}
        // El descuento por forma de pago alimenta la rentabilidad efectiva (los importes ya
        // vienen precalculados en las filas).
        descFormaPago={descFormaPago}
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
            // La forma de pago define el ramal del cobro: es obligatoria para avanzar.
            if (!formaPago) {
              setAviso({
                titulo: 'Falta la forma de pago',
                texto:
                  'Seleccioná la forma de pago del cliente antes de continuar a la siguiente etapa.',
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
