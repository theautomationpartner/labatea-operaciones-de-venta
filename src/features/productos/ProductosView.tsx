import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { pasosDe } from '@/lib/pasos'
import { clienteLlevaIva } from '@/lib/precios'
import { descuentoDeFormaPago } from '@/lib/cobros'
import { impactoCredito, resumenPresupuesto } from '@/lib/selectors'
import { useApp, useDispatch } from '@/state/hooks'
import { BuscadorProducto } from './BuscadorProducto'
import { CargaLinea } from './CargaLinea'
import { FiltrosProductos } from './FiltrosProductos'
import { FormaPagoSelect } from './FormaPagoSelect'
import { ResumenBox } from './ResumenBox'
import { TablaProductos, type FilaProducto } from './TablaProductos'
import { useCotizacionProducto } from './useCotizacionProducto'

/**
 * Paso 2 de armado de productos. Lo comparten PRESUPUESTAR y la venta DIRECTA:
 * misma lógica de catálogo, carga y totales; sólo cambia el encabezado y a dónde continúa.
 */
export function ProductosView() {
  const { cliente, lineas, operacion, tipoVenta, tipoEntrega, formaPago, descuentosPago } = useApp()
  const dispatch = useDispatch()
  // Selección de producto con conversión bimonetaria (dólares → pesos con la cotización).
  const { seleccionado, setSeleccionado, elegir, convirtiendo } = useCotizacionProducto()
  // Aviso de la búsqueda, que se muestra en el lugar del producto elegido.
  const [avisoBusqueda, setAvisoBusqueda] = useState('')
  // Ventana de advertencia: sin productos, o con datos incompletos para escribir en Monday.
  const [aviso, setAviso] = useState<{ titulo: string; texto: string; faltantes?: string[] } | null>(
    null,
  )

  const esVenta = operacion === 'VENTA'
  /* Descuento por pronto pago de la forma de pago elegida (sólo en la venta). Se compone con el
     descuento manual de cada línea en la tabla y en el resumen. */
  const descFormaPago = esVenta ? descuentoDeFormaPago(formaPago, descuentosPago) : 0
  /* El presupuesto no liquida IVA: ni en el precio unitario ni en los totales. La venta sí,
     así que la misma vista calcula distinto según de qué operación se trate. */
  const resumen = useMemo(
    () => resumenPresupuesto(lineas, esVenta, descFormaPago),
    [lineas, esVenta, descFormaPago],
  )
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

  /* Validación de crédito, distinta según el comprobante: la VENTA frena (no se confirma ni se
     cargan más ítems si se excedió); el PRESUPUESTO sólo avisa y deja seguir. El aviso salta al
     hacer click en continuar (no en vivo). El cliente bloqueado siempre frena. Se mide sobre el
     neto, igual que el impacto de crédito del resumen. */
  const bloqueo = useBloqueoCredito(resumen.neto, { bloqueante: esVenta })
  // Sólo en la venta: con el crédito excedido no se pueden cargar más productos.
  const cargaBloqueada = esVenta && bloqueo.excedido

  const agregar = (cantidad: number, descuento: number) => {
    if (!seleccionado) return
    // En la venta con el crédito excedido no se cargan más ítems: hay que bajar el importe.
    if (cargaBloqueada) {
      bloqueo.frenar()
      return
    }
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

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega)}
        actual={1}
      />

      <PasoTitulo
        numero={2}
        titulo="Seleccionar productos"
        descripcion={`Buscá y filtrá para encontrar los productos que formarán parte ${
          esVenta ? 'de la venta' : 'del presupuesto'
        }.`}
      />

      {/* Forma de Pago: sólo en la VENTA, justo debajo del título y la descripción. */}
      {esVenta && <FormaPagoSelect />}

      {/* Buscador, filtros y carga de línea conviven en una sola card. */}
      <div className="card">
        <div className="search-area">
          <BuscadorProducto
            lista={cliente.list ?? 'L1'}
            conIva={conIva}
            onSelect={elegir}
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
          bloqueado={cargaBloqueada}
          convirtiendo={convirtiendo}
        />
      </div>

      <TablaProductos
        titulo="Productos seleccionados"
        filas={filas}
        onRemove={(id) => dispatch({ type: 'removeLinea', id })}
        onCantidad={(id, cantidad) => dispatch({ type: 'setCantidadLinea', id, cantidad })}
        onDescuento={(id, descuento) => dispatch({ type: 'setDescuentoLinea', id, descuento })}
        cantidadMin={1}
        descFormaPago={descFormaPago}
        mostrarIva={esVenta}
      />

      <ResumenBox
        titulo={esVenta ? 'Resumen de la venta' : 'Resumen del presupuesto'}
        resumen={resumen}
        credito={credito}
        limite={cliente.limit}
        // El presupuesto no muestra IVA: no lo liquida.
        mostrarIva={esVenta}
        /* En el presupuesto se muestra ÚNICAMENTE el total, etiquetado "TOTAL PRESUPUESTADO". */
        soloTotal={!esVenta}
        totalLabel={esVenta ? 'TOTAL' : 'TOTAL PRESUPUESTADO'}
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
              /* PRESUPUESTO: avanzar a emisión es una transición local y silenciosa. El ítem NO se
                 crea acá: nace al hacer click en "Emitir Presupuesto". Sin queries ni modales. */
              if (lineas.length === 0) return
              dispatch({ type: 'goto', paso: 'emision' })
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

      {bloqueo.modal}
    </section>
  )
}
