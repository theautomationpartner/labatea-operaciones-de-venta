import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { indiceDePaso, pasosDe } from '@/lib/pasos'
import { esAdministrador, puedeEditarPrecio, usuarioDeLaOperacion } from '@/lib/permisos'
import { clienteLlevaIva, productoConPrecio } from '@/lib/precios'
import { descuentoDeFormaPago } from '@/lib/cobros'
import {
  comisionLineas,
  impactoCredito,
  rentabilidadFinalLinea,
  resumenPresupuesto,
  resumenPresupuestoBimoneda,
} from '@/lib/selectors'
import { hayDocumentoEmitido } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'
import { BuscadorProducto } from './BuscadorProducto'
import { CargaLinea } from './CargaLinea'
import { DescuentoPagoPresupuesto } from './DescuentoPagoPresupuesto'
import { FiltrosProductos } from './FiltrosProductos'
import { FormaPagoSelect } from './FormaPagoSelect'
import { RentabForzada } from './RentabForzada'
import { ResumenBox } from './ResumenBox'
import { TablaProductos, type FilaProducto } from './TablaProductos'
import { useCotizacionProducto } from './useCotizacionProducto'

/**
 * Paso 2 de armado de productos. Lo comparten PRESUPUESTAR y la venta DIRECTA:
 * misma lógica de catálogo, carga y totales; sólo cambia el encabezado y a dónde continúa.
 */
export function ProductosView() {
  const state = useApp()
  const {
    cliente,
    lineas,
    operacion,
    tipoVenta,
    tipoEntrega,
    formaPago,
    descuentoPagoActivo,
    descuentosPago,
    comisiones,
    tasaCambio,
  } = state
  const dispatch = useDispatch()
  /* GUARDRAIL post-emisión: si ya se emitió un documento oficial en el tablero, esta etapa queda en
     SOLO LECTURA (no se agregan/editan/quitan productos): la emisión es irreversible. */
  const bloqueadoPorEmision = hayDocumentoEmitido(state)
  /* RBAC: el override del precio de lista es exclusivo del equipo "Administradores" y de esta
     etapa. El guardrail post-emisión manda por encima: emitido, no se toca nada. */
  const precioEditable =
    !bloqueadoPorEmision &&
    puedeEditarPrecio(usuarioDeLaOperacion(state.usuarioActual, state.vendedor), state.paso, operacion)
  // Selección de producto con conversión bimonetaria (dólares → pesos con la cotización).
  const { seleccionado, setSeleccionado, elegir, convirtiendo } = useCotizacionProducto()
  // Aviso de la búsqueda, que se muestra en el lugar del producto elegido.
  const [avisoBusqueda, setAvisoBusqueda] = useState('')
  // Ventana de advertencia: sin productos, o con datos incompletos para escribir en Monday.
  const [aviso, setAviso] = useState<{ titulo: string; texto: string; faltantes?: string[] } | null>(
    null,
  )

  const esVenta = operacion === 'VENTA'
  /* La Rentabilidad Forzada es EXCLUSIVA del rol ADMINISTRADOR: un vendedor no la ve ni puede
     accederla. Además se habilita sólo en PRESUPUESTO y en la VENTA DIRECTA, salvo cuando la entrega
     es ANTERIOR (la mercadería ya salió por remito y sus precios no se pisan acá). */
  const mostrarRentabForzada =
    /* La rentabilidad forzada la habilita el VENDEDOR asignado, no quien opera: es una excepción
       que queda firmada a su nombre. */
    esAdministrador(usuarioDeLaOperacion(state.usuarioActual, state.vendedor)) &&
    (operacion === 'PRESUPUESTAR' ||
      (esVenta && tipoVenta === 'DIRECTA' && tipoEntrega !== 'ANTERIOR'))
  /* Descuento por pronto pago de la forma de pago elegida. Se compone con el descuento manual de
     cada línea en la tabla y en el resumen. En la VENTA rige siempre (la forma de pago define el
     ramal del cobro); en el PRESUPUESTO es opcional y sólo cuenta con la pregunta contestada que
     sí —apagada, el presupuesto sale a precios de lista aunque haya una forma de pago vieja—. */
  const aplicaDescPago = esVenta || descuentoPagoActivo
  const descFormaPago = aplicaDescPago ? descuentoDeFormaPago(formaPago, descuentosPago) : 0
  /* El presupuesto no liquida IVA: ni en el precio unitario ni en los totales. La venta sí,
     así que la misma vista calcula distinto según de qué operación se trate. */
  const resumen = useMemo(
    () => resumenPresupuesto(lineas, esVenta, descFormaPago),
    [lineas, esVenta, descFormaPago],
  )
  /* PRESUPUESTO bimonetario: los productos en dólares NO se convierten. Se separan los totales en
     pesos y en dólares, y el neto en dólares se proyecta a pesos (a la tasa del día) sólo para
     medir el crédito. La rentabilidad ponderada sale de este mismo cálculo. */
  const bimoneda = useMemo(
    () => resumenPresupuestoBimoneda(lineas, tasaCambio ?? 0, descFormaPago),
    [lineas, tasaCambio, descFormaPago],
  )
  /* El crédito se mide sobre el NETO (sin IVA), la misma base que usan el cierre y la venta
     con presupuesto previo. En el presupuesto se usa el neto proyectado a pesos (ARS + USD×tasa),
     que ya incluye los dólares convertidos; en la venta, el neto directo. */
  const importeCredito = esVenta ? resumen.neto : bimoneda.netoProyectado
  /* Comisión de la venta DIRECTA: la tasa "Pasiva" del tablero de configuración aplicada al neto
     —sin IVA y con el descuento total— de cada producto comisionable. El presupuesto no liquida. */
  const comision = useMemo(
    () => (esVenta ? comisionLineas(lineas, comisiones, tipoVenta ?? 'DIRECTA', descFormaPago) : 0),
    [esVenta, lineas, comisiones, tipoVenta, descFormaPago],
  )
  const credito = useMemo(
    () => impactoCredito(cliente, importeCredito),
    [cliente, importeCredito],
  )
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
        // Nota de Crédito x Comisión por unidad (rentabilidad forzada), para el "Detalle".
        notaCredito: l.montoDifNotaDeCreditoComision,
        // % forzado aplicado: es la rentabilidad FINAL de la línea (la base no se toca).
        rentabForzada: l.rentabForzadaAplicada,
        /* FINAL: el precio vigente —con el override del administrador y los dos descuentos— contra
           el costo del producto. Mismo selector que alimenta la rentabilidad general del resumen. */
        rentabFinal: rentabilidadFinalLinea(l, descFormaPago),
      })),
    [lineas, descFormaPago],
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
  const bloqueo = useBloqueoCredito(importeCredito, { bloqueante: esVenta })
  // Sólo en la venta: con el crédito excedido no se pueden cargar más productos.
  const cargaBloqueada = esVenta && bloqueo.excedido

  const agregar = (cantidad: number, descuento: number, precio?: number) => {
    if (!seleccionado) return
    // En la venta con el crédito excedido no se cargan más ítems: hay que bajar el importe.
    if (cargaBloqueada) {
      bloqueo.frenar()
      return
    }
    /* Precio pisado por un administrador en la carga: la línea nace con ese precio y con la
       rentabilidad recalculada a costo constante, igual que al pisarlo desde la tabla. */
    const producto = precio ? productoConPrecio(seleccionado, precio) : seleccionado
    dispatch({ type: 'addLinea', producto, cantidad, descuento })
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
        actual={indiceDePaso('productos', operacion, tipoVenta, tipoEntrega)}
      />

      <PasoTitulo
        numero={indiceDePaso('productos', operacion, tipoVenta, tipoEntrega) + 1}
        titulo="Seleccionar productos"
        descripcion={`Buscá y filtrá para encontrar los productos que formarán parte ${
          esVenta ? 'de la venta' : 'del presupuesto'
        }.`}
      />

      {/* Forma de Pago: justo debajo del título y la descripción. En la VENTA es obligatoria y
          define el ramal del cobro; en el PRESUPUESTO es opcional y va detrás de la pregunta que
          la habilita. Post-emisión las dos quedan deshabilitadas. */}
      {esVenta ? (
        <FormaPagoSelect bloqueado={bloqueadoPorEmision} />
      ) : (
        <DescuentoPagoPresupuesto bloqueado={bloqueadoPorEmision} />
      )}

      {/* Con un documento ya emitido, la búsqueda y la carga desaparecen: sólo se avisa que la etapa
          quedó bloqueada. Si no, buscador, filtros y carga de línea conviven en una sola card. */}
      {bloqueadoPorEmision ? (
        <div className="card aviso-bloqueo">
          <i className="fas fa-lock" /> El documento ya fue emitido en Monday: la selección de
          productos quedó bloqueada y no puede modificarse.
        </div>
      ) : (
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
          {/* Rentabilidad Forzada: debajo de los filtros del buscador (PRESUPUESTO / VENTA DIRECTA). */}
          {mostrarRentabForzada && <RentabForzada bloqueado={bloqueadoPorEmision} />}
          <CargaLinea
            key={seleccionado?.codigo ?? 'vacio'}
            producto={seleccionado}
            aviso={avisoBusqueda}
            onAdd={agregar}
            bloqueado={cargaBloqueada}
            convirtiendo={convirtiendo}
            /* El pronto pago define el "Precio Actual" sobre el que muerde el descuento manual:
               la carga muestra los mismos importes que va a tener la línea en la tabla. */
            descFormaPago={descFormaPago}
          />
        </div>
      )}

      {/* Post-emisión: la tabla pasa a SOLO LECTURA (sin editar cantidad/descuento ni quitar). */}
      <TablaProductos
        titulo="Productos seleccionados"
        filas={filas}
        onRemove={bloqueadoPorEmision ? undefined : (id) => dispatch({ type: 'removeLinea', id })}
        onCantidad={
          bloqueadoPorEmision
            ? undefined
            : (id, cantidad) => dispatch({ type: 'setCantidadLinea', id, cantidad })
        }
        onDescuento={
          bloqueadoPorEmision
            ? undefined
            : (id, descuento) => dispatch({ type: 'setDescuentoLinea', id, descuento })
        }
        /* RBAC: el precio de lista sólo lo pisa un administrador, y sólo acá (selección de
           productos de una VENTA o un PRESUPUESTO). Para el resto la celda es de lectura. */
        onPrecio={
          precioEditable ? (id, precio) => dispatch({ type: 'setPrecioLinea', id, precio }) : undefined
        }
        soloLectura={bloqueadoPorEmision}
        cantidadMin={1}
        descFormaPago={descFormaPago}
        /* Columna "Moneda" + importes en dólares con `$u` en verde: sólo en el presupuesto. */
        mostrarMoneda={!esVenta}
      />

      <ResumenBox
        titulo={esVenta ? 'Resumen de la venta' : 'Resumen del presupuesto'}
        /* En el presupuesto, la rentabilidad del donut sale del cálculo bimonetario (ponderado en
           pesos-equivalente); el resto de los totales los aporta `bimoneda`. */
        resumen={esVenta ? resumen : { ...resumen, rentabilidad: bimoneda.rentabilidad }}
        credito={credito}
        limite={cliente.limit}
        // El presupuesto no muestra IVA: no lo liquida.
        mostrarIva={esVenta}
        // Comisión: sólo en la venta DIRECTA (el presupuesto no la liquida).
        comision={esVenta ? comision : undefined}
        totalLabel={esVenta ? 'TOTAL' : 'TOTAL EN PESOS'}
        /* El presupuesto es bimonetario: desglose ARS/USD y aclaración de conversión del crédito. */
        bimoneda={
          esVenta
            ? undefined
            : {
                subtotalArs: bimoneda.ars.subtotal,
                descuentoArs: bimoneda.ars.descuento,
                totalArs: bimoneda.ars.neto,
                totalUsd: bimoneda.usd.neto,
                hayDolares: bimoneda.hayDolares,
              }
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
            onClick={() => {
              if (esVenta) {
                if (lineas.length === 0) {
                  avisoSinProductos()
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
                if (bloqueo.frenar()) return
                dispatch({ type: 'goto', paso: 'cobro' })
                return
              }
              /* PRESUPUESTO: avanzar a emisión es una transición local y silenciosa. El ítem NO se
                 crea acá: nace al hacer click en "Emitir Presupuesto". Sin queries ni modales. */
              if (lineas.length === 0) return
              /* Con la pregunta contestada que SÍ, la forma de pago es obligatoria para avanzar,
                 igual que en la venta: define el descuento que se aplica a cada precio unitario y
                 la leyenda que va al PDF. Con la pregunta apagada no hace falta ninguna. */
              if (descuentoPagoActivo && !formaPago) {
                setAviso({
                  titulo: 'Falta la forma de pago',
                  texto:
                    'Pediste aplicar descuentos por forma de pago: seleccioná cuál antes de continuar a la siguiente etapa.',
                })
                return
              }
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
