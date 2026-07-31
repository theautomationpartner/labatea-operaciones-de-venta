import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { addDays } from '@/lib/dates'
import { ivaPorDefecto, letraComprobante, PUNTO_VENTA_DEFAULT } from '@/lib/factura'
import {
  balancePagos,
  cobroSimultaneoOperacion,
  datosCobroVenta,
  descuentoDeFormaPago,
  requiereRegistroDeuda,
  resumenCobro,
} from '@/lib/cobros'
import { aIso } from '@/lib/dates'
import { comprobantesDeVenta, precioFacturado, totalesComprobantes } from '@/lib/facturacion'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { pasosDe } from '@/lib/pasos'
import {
  actualizarCantVendida,
  crearComisiones,
  crearComprobantes,
  crearConsignacionesCYO,
  crearVenta,
  FACT_VENCIMIENTO_DIAS,
  marcarProformaUsada,
  registrarCobroSimultaneo,
  registrarDeudaPosterior,
  registrarFacturacionVtasPend,
  vincularVentaAlCobro,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { ComprobantesAGenerar } from './ComprobantesAGenerar'
import { ResumenVenta } from './ResumenVenta'

/** Número de comprobante que asignaría AFIP al emitirla. */
const NRO_FACTURA = 'FC-0001-00001234'

/**
 * Paso 4 de VENTA: resumen de la venta y los comprobantes en los que se parte.
 *
 * La venta puede generar más de una factura —la mercadería común va en una y la consignada se
 * factura por separado, una por proveedor—, así que la pantalla se ordena en dos columnas: a
 * la izquierda el resumen con el botón de emisión, a la derecha un comprobante por card.
 */
export function FacturaView() {
  const state = useApp()
  const { cliente, operacion, tipoVenta, tipoEntrega, factura, fechaEmision, ventaId, cobro, formaPago } =
    state
  const dispatch = useDispatch()

  const [emitiendo, setEmitiendo] = useState(false)
  const [errorEmision, setErrorEmision] = useState<string | null>(null)
  /* Creación de la venta al "Finalizar Operación": tapa la pantalla con "Registrando venta"
     mientras se `await`ea el ítem principal en el board 18421035510. */
  const [creandoVenta, setCreandoVenta] = useState(false)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)
  /* Días de vencimiento por comprobante: fijos en 30 (no editables). Se mantiene el mapa por
     compatibilidad con `diasDe`, pero ya no se modifica desde la UI. */
  const [dias] = useState<Record<string, number>>({})

  /* Evaluación de la mercadería de la venta: en cuántos comprobantes se parte. Se hace sobre
     las líneas normalizadas, que son las que arrastran tipo de mercadería, proveedor e IVA. */
  const productos = useMemo(
    () =>
      lineasDeVenta({
        operacion,
        tipoVenta,
        tipoEntrega,
        lineas: state.lineas,
        ventaItems: state.ventaItems,
        facturaItems: state.facturaItems,
      }),
    [operacion, tipoVenta, tipoEntrega, state.lineas, state.ventaItems, state.facturaItems],
  )
  const comprobantes = useMemo(() => comprobantesDeVenta(productos), [productos])

  // Comprobantes ya escritos en el board, indexados por la clave del grupo que los originó.
  const emitidos = useMemo(
    () => new Map(factura.comprobantes.map((c) => [c.clave, c])),
    [factura.comprobantes],
  )

  /* Total facturado (con IVA): es el importe de la venta y lo que hay que cobrar. */
  const totalVenta = useMemo(() => totalesComprobantes(comprobantes).total, [comprobantes])
  /* Rentabilidad general de la venta (ponderada por el importe bonificado de cada línea): es lo
     que va a la cabecera del ítem en "📈Ventas". */
  const rentabilidadVenta = useMemo(() => {
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
    return Math.round(ponderada)
  }, [productos])
  // Balance de los movimientos de pago y su resumen contra el total: alimentan el recibo simultáneo.
  const balances = useMemo(
    () => balancePagos(cobro.movimientos, state.descuentosPago),
    [cobro.movimientos, state.descuentosPago],
  )
  const resumenC = useMemo(() => resumenCobro(balances, totalVenta), [balances, totalVenta])
  const esEntregaPosterior = tipoEntrega === 'POSTERIOR'

  if (!cliente) return null

  const ivaReceptor = factura.ivaReceptor ?? ivaPorDefecto(cliente)
  // A para responsable inscripto y monotributista; B para consumidor final y exento.
  const letra = factura.letra ?? letraComprobante(cliente.status)
  /* El vencimiento a plazo depende de la FORMA DE PAGO elegida: sólo la CUENTA CORRIENTE vence a
     plazo (30 días). En cualquier otra forma (contado, tarjetas) la factura se cobra al emitirse,
     así que su vencimiento es la propia fecha de emisión y se muestra "Pago contado". */
  const venceAPlazo = formaPago === 'CUENTA CORRIENTE'
  const diasDe = (clave: string) => dias[clave] ?? FACT_VENCIMIENTO_DIAS
  const vencimientoDe = (clave: string) =>
    venceAPlazo ? addDays(fechaEmision, diasDe(clave)) : fechaEmision

  /**
   * Escribe en el board un ítem por comprobante con sus líneas. Sólo se da por emitida la
   * venta si volvieron todos completos: una factura a medias no cierra la operación.
   */
  const emitir = async () => {
    if (emitiendo || comprobantes.length === 0) return
    setEmitiendo(true)
    setErrorEmision(null)
    try {
      const creados = await crearComprobantes(
        comprobantes.map((c) => ({ ...c, vencimiento: vencimientoDe(c.clave) })),
        {
          cliente,
          moneda: factura.moneda,
          tipoCambio: factura.tipoCambio,
          letra,
          ivaReceptor,
          fechaEmision,
          observaciones: factura.observaciones,
          ventaId,
        },
      )
      const incompletos = creados.filter((c) => !c.id || c.lineasCreadas < c.lineasEsperadas)
      if (incompletos.length > 0) {
        setErrorEmision(
          `Quedaron ${incompletos.length} de ${creados.length} comprobantes incompletos. Revisalos en el tablero antes de reintentar.`,
        )
      }
      dispatch({ type: 'emitirFactura', comprobantes: creados })
    } catch {
      setErrorEmision('No se pudieron crear los comprobantes. Reintentá en unos segundos.')
    } finally {
      setEmitiendo(false)
    }
  }

  /**
   * Registro de comisiones de la venta (best-effort, fire-and-forget), al finalizar la operación.
   * Universal: corre para cualquier tipo de venta/entrega. El servicio evalúa por producto si es
   * comisionable ("SI") y aborta solo si ninguno lo es (sin tocar el board). En el cobro POSTERIOR
   * enlaza la deuda recién creada; en el SIMULTANEO omite esa relación. No frena el cierre.
   */
  const dispararComisiones = (vId: string, pendienteCobroId?: string) => {
    if (!vId) return
    void crearComisiones({
      ventaId: vId,
      clienteId: cliente.id,
      tipoVenta: tipoVenta ?? 'DIRECTA',
      // Tipo de cobro de la operación e importe total (con IVA): definen el monto pendiente de cobro.
      tipoPago: datosCobroVenta(cliente, cobro).tipoPago,
      importeTotalVenta: totalesComprobantes(comprobantes).total,
      fecha: aIso(fechaEmision),
      pendienteCobroId,
      lineas: productos.map((p) => ({
        productoId: p.productoId,
        nombre: p.nombre,
        cantidad: p.cantidad,
        precioUnitario: p.precioUnitario,
      })),
    }).catch(() => {
      /* El registro de comisiones es best-effort: un fallo no revierte la venta ni frena el cierre. */
    })
  }

  /**
   * Registro de mercadería consignada CYO (best-effort, fire-and-forget), al finalizar la operación.
   * Sólo corre si durante la división de mercadería se EMITIÓ una factura consignada: por cada
   * comprobante CONSIGNADA efectivamente emitido (id + todas sus líneas), crea un ítem por producto
   * en el tablero de liquidación CYO. Venta 100% común → no crea nada. No congela la UI.
   */
  const dispararConsignacionesCYO = () => {
    const lineasCYO = comprobantes
      .filter((c) => c.tipo === 'CONSIGNADA')
      .flatMap((c) => {
        const emitido = emitidos.get(c.clave)
        // La factura consignada tiene que haberse emitido completa para registrar su liquidación.
        if (!emitido?.id || emitido.lineasCreadas < emitido.lineasEsperadas) return []
        return c.lineas
          .filter((l) => l.productoId)
          .map((l) => ({
            productoId: l.productoId,
            nombre: l.nombre,
            cantidad: l.cantidad,
            // Precio al que se facturó (ya bonificado): el mismo que va al comprobante.
            precioUnitario: precioFacturado(l),
            comprobanteId: emitido.id,
          }))
      })
    if (lineasCYO.length === 0) return
    void crearConsignacionesCYO(lineasCYO, aIso(fechaEmision)).catch(() => {
      /* El registro CYO es best-effort: un fallo no revierte la venta ni frena el cierre. */
    })
  }

  /**
   * Efectos secundarios de la venta, disparados TODOS fire-and-forget (sin `await` bloqueante) una
   * vez creada la venta: el usuario finaliza sin esperar a que terminen en Monday.
   *   · Cobro: el recibo del cobro SIMULTÁNEO (+ su vínculo a la venta) o la deuda del POSTERIOR.
   *   · Comisiones: en el POSTERIOR se encadenan a la deuda recién creada; en el resto van sueltas.
   *   · Conciliaciones de origen: cantidad vendida (presupuesto) y facturación (Vtas Pends de Facturar).
   *   · Consignación CYO. (Los pendientes de entrega ya los dispara `crearVenta` internamente.)
   */
  const dispararEfectosSecundarios = (vId: string) => {
    if (cobroSimultaneoOperacion(cliente, cobro)) {
      // Recibo del cobro simultáneo + su vínculo a la venta, encadenados pero sin bloquear la UI.
      void (async () => {
        const { id } = await registrarCobroSimultaneo({
          totalACobrar: totalVenta,
          cancelado: resumenC.cancelado,
          balances,
          ctaCteId: cliente.ctaCteId,
          nombreCliente: cliente.name,
        })
        await vincularVentaAlCobro(id, vId)
      })().catch(() => {
        /* El recibo del cobro es best-effort: un fallo no revierte la venta ya creada. */
      })
      dispararComisiones(vId)
    } else if (requiereRegistroDeuda(cliente, cobro) && cliente.ctaCteId) {
      // Deuda del pago posterior en la cuenta corriente; la comisión enlaza la deuda recién creada.
      void (async () => {
        const { deudaId } = await registrarDeudaPosterior({
          ctaCteId: cliente.ctaCteId as string,
          total: totalVenta,
          concepto: `${cliente.name} · ${cobro.fecha}`,
        })
        dispararComisiones(vId, deudaId)
      })().catch(() => {
        /* El registro de la deuda es best-effort: un fallo no revierte la venta ya creada. */
      })
    } else {
      dispararComisiones(vId)
    }

    // CON PRESUPUESTO PREVIO: cantidad vendida acumulada en los subelementos del presupuesto.
    if (tipoVenta === 'CON PRESUPUESTO PREVIO') {
      void actualizarCantVendida(
        state.ventaItems
          .filter((it) => it.subitemId)
          .map((it) => ({ subitemId: it.subitemId as string, cantVendida: (it.vend ?? 0) + it.aVender })),
      ).catch(() => {
        /* La cantidad vendida del presupuesto se asienta best-effort. */
      })
    }

    // ENTREGA ANTERIOR: conciliación de "Vtas Pends de Facturar" enlazada a la venta.
    if (state.facturaItems.length > 0) {
      void registrarFacturacionVtasPend(
        state.facturaItems.map((it) => ({
          subitemId: it.subitemId,
          ventaPendId: it.ventaPendId,
          aFacturar: it.aFacturar,
          precio: it.precio,
        })),
        vId,
      ).catch(() => {
        /* La conciliación de "Vtas Pends de Facturar" es best-effort. */
      })
    }

    dispararConsignacionesCYO()

    // VENTA PROFORMA: la proforma facturada pasa a "Usada" para que salga del listado disponible
    // y no se pueda volver a facturar (fire-and-forget: no bloquea el cierre de la operación).
    if (operacion === 'VENTA PROFORMA' && state.proformaId) {
      void marcarProformaUsada(state.proformaId).catch(() => {
        /* La transición de estado de la proforma es best-effort: un fallo no revierte la venta. */
      })
    }
  }

  /**
   * Cierre de la operación. Es el ÚNICO disparador de la creación de la venta (ejecución diferida):
   * apenas se hace click se tapa la pantalla con "Registrando venta" y se `await`ea la creación del
   * ítem principal en el board 18421035510. Recién con la venta ya creada se disparan sus efectos
   * secundarios —cobro, deuda, comisiones, conciliaciones— en formato fire-and-forget: no se
   * esperan, para que la ventana se cierre y el usuario finalice sin aguardar al resto de la API.
   */
  const finalizar = async () => {
    if (creandoVenta) return
    setCreandoVenta(true)
    setErrorVenta(null)
    try {
      /* Si ya se creó (reintento tras un fallo de un secundario), no se vuelve a crear. */
      let vId = ventaId
      if (!vId) {
        const creada = await crearVenta({
          clienteId: cliente.id,
          nombre: cliente.name,
          tipoVenta: tipoVenta ?? 'DIRECTA',
          tipoEntrega: tipoEntrega ?? 'SIMULTANEA',
          ...datosCobroVenta(cliente, cobro),
          rentabilidad: rentabilidadVenta,
          descFormaPago: descuentoDeFormaPago(formaPago, state.descuentosPago),
          tasaCambio: state.tasaCambio,
          importeTotalPesos: totalVenta,
          responsableEntrega: esEntregaPosterior
            ? state.entregaVenta.responsable ?? undefined
            : undefined,
          rutaId:
            esEntregaPosterior && state.entregaVenta.rutaConfirmada
              ? state.entregaVenta.rutaId ?? undefined
              : undefined,
          lineas: productos,
        })
        if (creada.subitemsCreados !== productos.length) {
          setErrorVenta(
            `La venta se creó pero quedó incompleta: entraron ${creada.subitemsCreados} de ${productos.length} productos. Revisala en Monday antes de cerrar.`,
          )
          setCreandoVenta(false)
          return
        }
        vId = creada.id
        dispatch({ type: 'setVentaId', value: vId })
      }
      // Efectos secundarios: fire-and-forget. No se esperan; la ventana se cierra al toque.
      dispararEfectosSecundarios(vId)
      setCreandoVenta(false)
      dispatch({ type: 'reset' })
    } catch {
      setErrorVenta('No se pudo crear la venta en Monday. Reintentá en unos segundos.')
      setCreandoVenta(false)
    }
  }

  const pasos = pasosDe(operacion, tipoVenta, tipoEntrega)
  // El índice de "Emitir factura" corre según exista o no la etapa "Entrega de Mercadería".
  const actualFactura = Math.max(pasos.indexOf('Emitir factura'), 0)

  return (
    <section className="view factura-v2 paso-layout">
      <PasoHeader pasos={pasos} actual={actualFactura} />

      <PasoTitulo
        numero={actualFactura + 1}
        titulo="Emitir y enviar factura"
        descripcion="Revisá el resumen de la venta, controlá cada comprobante y emitilos."
      />

      <div className="factura-grid-v2">
        <ResumenVenta
          cliente={cliente}
          cantidadProductos={productos.length}
          cantidadFacturas={comprobantes.length}
          emitidos={factura.comprobantes.length}
          emitiendo={emitiendo}
          onEmitir={emitir}
        />

        {/* Columna derecha: los comprobantes y, debajo, el envío de la factura. */}
        <div className="factura-col-der">
          <ComprobantesAGenerar
            comprobantes={comprobantes}
            letra={letra}
            puntoVenta={PUNTO_VENTA_DEFAULT}
            fechaEmision={fechaEmision}
            venceAPlazo={venceAPlazo}
            dias={Object.fromEntries(comprobantes.map((c) => [c.clave, diasDe(c.clave)]))}
            emitidos={emitidos}
            emitiendo={emitiendo}
          />

          {/* El estado del envío se muestra dentro de la propia card. No condiciona el cierre:
              la venta puede finalizarse con la factura emitida y el envío pendiente. */}
          <EnviarDocumento documento="factura" numero={NRO_FACTURA} />
        </div>
      </div>

      <footer className="page-footer">
        <button
          type="button"
          className="btn-outline"
          /* Con entrega POSTERIOR el paso anterior es "Entrega de Mercadería"; si no, el "Cobro". */
          onClick={() =>
            dispatch({ type: 'goto', paso: esEntregaPosterior ? 'entrega' : 'cobro' })
          }
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        {/* Cierra la venta y reinicia la app. Alcanza con la factura emitida: el envío al
            cliente es una gestión aparte y puede quedar pendiente. */}
        <button
          type="button"
          className="btn-primary"
          disabled={!factura.emitida || creandoVenta}
          aria-busy={creandoVenta}
          title={factura.emitida ? undefined : 'Emití la factura para poder finalizar la operación.'}
          onClick={finalizar}
        >
          <i className="fas fa-flag-checkered" /> Finalizar Operación
        </button>
      </footer>

      {errorEmision && (
        <AvisoModal titulo="No se pudieron emitir todos los comprobantes" onClose={() => setErrorEmision(null)}>
          {errorEmision}
        </AvisoModal>
      )}

      {/* Tapa la pantalla mientras se `await`ea la creación de la venta en Monday. Los efectos
          secundarios corren después SIN esperar, así que la ventana se cierra al toque. */}
      {creandoVenta && (
        <ModalCargando
          titulo="Registrando venta..."
          detalle="Estamos registrando la venta en el sistema junto a sus productos. Espera unos segundos"
        />
      )}

      {/* La venta quedó a medias en el board: no se cierra la operación hasta resolverlo. */}
      {errorVenta && (
        <AvisoModal titulo="No se pudo cerrar la venta" onClose={() => setErrorVenta(null)}>
          {errorVenta}
        </AvisoModal>
      )}
    </section>
  )
}
