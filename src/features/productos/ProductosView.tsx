import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { addDays } from '@/lib/dates'
import { pasosDe } from '@/lib/pasos'
import { clienteLlevaIva } from '@/lib/precios'
import { COMISION_PCT, comisionDe, impactoCredito, resumenPresupuesto } from '@/lib/selectors'
import { faltantesPresupuesto } from '@/lib/validaciones'
import { crearPresupuesto, mondayHabilitado } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Producto } from '@/types'
import { BuscadorProducto } from './BuscadorProducto'
import { CargaLinea } from './CargaLinea'
import { FiltrosProductos } from './FiltrosProductos'
import { ResumenBox } from './ResumenBox'
import { TablaProductos, type FilaProducto } from './TablaProductos'

/**
 * Paso 2 de armado de productos. Lo comparten PRESUPUESTAR y la venta DIRECTA:
 * misma lógica de catálogo, carga y totales; sólo cambia el encabezado y a dónde continúa.
 */
export function ProductosView() {
  const {
    cliente,
    lineas,
    operacion,
    tipoVenta,
    tipoEntrega,
    vendedor,
    fechaEmision,
    diasVigencia,
    moneda,
    presupuestoId,
  } = useApp()
  const dispatch = useDispatch()
  const [seleccionado, setSeleccionado] = useState<Producto | null>(null)
  // Confirmación del presupuesto: tapa la pantalla mientras se escribe en Monday.
  const [confirmando, setConfirmando] = useState(false)
  const [errorCreacion, setErrorCreacion] = useState<string | null>(null)
  // Aviso de la búsqueda, que se muestra en el lugar del producto elegido.
  const [avisoBusqueda, setAvisoBusqueda] = useState('')
  // Ventana de advertencia: sin productos, o con datos incompletos para escribir en Monday.
  const [aviso, setAviso] = useState<{ titulo: string; texto: string; faltantes?: string[] } | null>(
    null,
  )

  const esVenta = operacion === 'CARGAR VENTA'
  /* El presupuesto no liquida IVA: ni en el precio unitario ni en los totales. La venta sí,
     así que la misma vista calcula distinto según de qué operación se trate. */
  const resumen = useMemo(() => resumenPresupuesto(lineas, esVenta), [lineas, esVenta])
  /* El crédito se mide sobre el NETO (sin IVA), la misma base que usan el cierre y la venta
     con presupuesto previo: así lo que muestra el resumen y lo que evalúa el bloqueo coinciden. */
  const credito = useMemo(() => impactoCredito(cliente, resumen.neto), [cliente, resumen.neto])
  const filas = useMemo<FilaProducto[]>(
    () =>
      lineas.map((l) => ({
        id: l.id,
        codigo: l.producto.codigo,
        nombre: l.producto.nombre,
        cantidad: l.cantidad,
        precio: l.producto.precio,
        descuento: l.descuento,
        rentabilidad: l.producto.rentabilidad,
        producto: l.producto,
      })),
    [lineas],
  )

  if (!cliente) return null

  /* Precio unitario del catálogo. En la VENTA se le suma la alícuota del producto si el
     cliente la paga (Monotributista, Consumidor Final y Exento; el Resp. Inscripto no).
     En el PRESUPUESTO nunca: el precio es el de la lista, tal cual. */
  const conIva = esVenta && clienteLlevaIva(cliente.status)

  // Ningún ítem se crea ni se avanza si el cliente está bloqueado o se pasó de su línea.
  // El bloqueo se mide sobre el neto, igual que el impacto de crédito que muestra el resumen.
  const bloqueo = useBloqueoCredito(resumen.neto)

  const agregar = (cantidad: number, descuento: number) => {
    if (!seleccionado) return
    dispatch({ type: 'addLinea', producto: seleccionado, cantidad, descuento })
    setSeleccionado(null)
    setAvisoBusqueda('')
  }

  const avisoSinProductos = () =>
    setAviso({
      titulo: 'No hay productos seleccionados',
      texto: `Tenés que agregar al menos un producto para continuar con ${
        esVenta ? 'la venta' : 'el presupuesto'
      }.`,
    })

  /** Datos que Monday necesita para crear el ítem y sus subitems. */
  const validarParaMonday = (): boolean => {
    const faltan = faltantesPresupuesto(
      {
        cliente,
        lineas,
        fechaEmision,
        fechaVencimiento: addDays(fechaEmision, diasVigencia),
        diasVigencia,
      },
      mondayHabilitado(),
    )
    if (faltan.length === 0) return true
    setAviso({
      titulo: 'Faltan datos para crear el presupuesto',
      texto: 'No se puede registrar el presupuesto en Monday hasta completar estos datos:',
      faltantes: faltan,
    })
    return false
  }

  /**
   * Continuar a emisión confirma el presupuesto: crea el ítem con TODOS sus productos y recién
   * ahí abre el paso siguiente. Es el único punto donde nace el presupuesto —antes también lo
   * creaba "Generar PDF", y las dos vías terminaban duplicando ítems—.
   *
   * Si algún producto no entró, no se avanza: el paso de emisión trabajaría sobre un
   * presupuesto incompleto. Un ítem ya creado no se vuelve a crear, así que reintentar no
   * duplica nada.
   */
  const confirmarYContinuar = async () => {
    if (confirmando) return
    if (lineas.length === 0) {
      avisoSinProductos()
      return
    }
    if (bloqueo.frenar()) return
    if (!validarParaMonday()) return

    if (presupuestoId) {
      dispatch({ type: 'goto', paso: 'emision' })
      return
    }

    setConfirmando(true)
    setErrorCreacion(null)
    try {
      const creado = await crearPresupuesto({
        cliente,
        vendedor,
        lineas,
        fechaEmision,
        fechaVencimiento: addDays(fechaEmision, diasVigencia),
        diasVigencia,
        rentabilidad: resumen.rentabilidad,
        moneda,
      })
      if (creado.subitemsCreados !== lineas.length) {
        setErrorCreacion(
          `El presupuesto se creó pero quedó incompleto: entraron ${creado.subitemsCreados} de ${lineas.length} productos` +
            (creado.productosSinCrear.length > 0
              ? ` (faltan: ${creado.productosSinCrear.join(', ')})`
              : '') +
            '. Revisalo en Monday antes de emitirlo.',
        )
        return
      }
      dispatch({ type: 'setPresupuestoId', value: creado.id })
      dispatch({ type: 'goto', paso: 'emision' })
    } catch {
      setErrorCreacion('No se pudo crear el presupuesto en Monday. Reintentá en unos segundos.')
    } finally {
      setConfirmando(false)
    }
  }

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={1} />

      <PasoTitulo
        numero={2}
        titulo="Seleccionar productos"
        descripcion={`Buscá y filtrá para encontrar los productos que formarán parte ${
          esVenta ? 'de la venta' : 'del presupuesto'
        }.`}
      />

      {/* Buscador, filtros y carga de línea conviven en una sola card. */}
      <div className="card">
        <div className="search-area">
          <BuscadorProducto
            lista={cliente.list ?? 'L1'}
            conIva={conIva}
            onSelect={setSeleccionado}
            variante="v2"
            onAviso={setAvisoBusqueda}
          />
          <FiltrosProductos />
        </div>
        <CargaLinea
          key={seleccionado?.codigo ?? 'vacio'}
          producto={seleccionado}
          aviso={avisoBusqueda}
          onAdd={agregar}
        />
      </div>

      <TablaProductos
        titulo="Productos seleccionados"
        filas={filas}
        onRemove={(id) => dispatch({ type: 'removeLinea', id })}
        onCantidad={(id, cantidad) => dispatch({ type: 'setCantidadLinea', id, cantidad })}
        onDescuento={(id, descuento) => dispatch({ type: 'setDescuentoLinea', id, descuento })}
        cantidadMin={1}
      />

      <ResumenBox
        titulo={esVenta ? 'Resumen de la venta' : 'Resumen del presupuesto'}
        resumen={resumen}
        credito={credito}
        limite={cliente.limit}
        // El presupuesto no muestra IVA: no lo liquida.
        mostrarIva={esVenta}
        comision={
          // La comisión se liquida sobre el neto (ya bonificado), no sobre el bruto.
          esVenta && tipoVenta
            ? { pct: COMISION_PCT[tipoVenta], monto: comisionDe(resumen.neto, tipoVenta) }
            : undefined
        }
      />

      <footer className="page-footer">
        <button
          type="button"
          className="btn-outline"
          onClick={() => dispatch({ type: 'goto', paso: 'cliente' })}
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        <div className="actions-right">
          {/* El botón queda activo: si falta algo, la ventana explica qué, en vez de bloquear. */}
          <button
            type="button"
            className="btn-primary"
            disabled={confirmando}
            aria-busy={confirmando}
            onClick={() => {
              if (esVenta) {
                if (lineas.length === 0) {
                  avisoSinProductos()
                  return
                }
                if (bloqueo.frenar()) return
                dispatch({ type: 'goto', paso: 'cobro' })
                return
              }
              void confirmarYContinuar()
            }}
          >
            {esVenta ? 'Continuar a cobro' : 'Continuar a emisión'}{' '}
            <i className="fas fa-chevron-right" />
          </button>
        </div>
      </footer>

      {aviso && (
        <AvisoModal titulo={aviso.titulo} faltantes={aviso.faltantes} onClose={() => setAviso(null)}>
          {aviso.texto}
        </AvisoModal>
      )}

      {/* El presupuesto quedó a medias en el board: no se abre la emisión hasta resolverlo. */}
      {errorCreacion && (
        <AvisoModal titulo="No se pudo confirmar el presupuesto" onClose={() => setErrorCreacion(null)}>
          {errorCreacion}
        </AvisoModal>
      )}

      {/* Tapa la pantalla mientras se escribe en Monday: es una secuencia que no conviene
          interrumpir ni disparar dos veces. Mismo tratamiento que el cierre de la venta. */}
      {confirmando && (
        <ModalCargando
          titulo="Confirmando el presupuesto…"
          detalle={`Estamos creando el presupuesto y sus ${lineas.length} ${
            lineas.length === 1 ? 'producto' : 'productos'
          } en Monday. No cierres esta pantalla.`}
        />
      )}

      {bloqueo.modal}
    </section>
  )
}
