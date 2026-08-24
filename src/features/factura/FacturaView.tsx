import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { addDays } from '@/lib/dates'
import { netoLinea } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { ivaPorDefecto, letraComprobante, PUNTO_VENTA_DEFAULT } from '@/lib/factura'
import {
  SIN_DESCUENTOS_PAGO,
  balancePagos,
  cobroSimultaneoOperacion,
  datosCobroVenta,
  descuentoDeFormaPago,
  esPagoConTarjeta,
  requiereRegistroDeuda,
} from '@/lib/cobros'
import { aIso } from '@/lib/dates'
import { comprobantesDeVenta, precioNetoUnitario, totalesComprobantes } from '@/lib/facturacion'
import { comisionLinea, tasaComision, totalVentaOperacion } from '@/lib/selectors'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { pasosDe } from '@/lib/pasos'
import {
  actualizarCantVendida,
  crearComisiones,
  crearComprobantes,
  crearConsignacionesCYO,
  crearVenta,
  marcarProformaUsada,
  registrarCobro,
  registrarDeudaPosterior,
  registrarFacturacionVtasPend,
  vincularVentaAComprobantes,
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
  /* Descuento por forma de pago (pronto pago) de la operación, en %. Es el que compone —en
     cascada con el descuento manual de cada línea— la bonificación que muestra la card y la que
     se declara en el comprobante. Las líneas de la VENTA sobre PROFORMA traen el suyo propio y
     pisan a este. */
  const descFormaPago = useMemo(
    () => descuentoDeFormaPago(formaPago, state.descuentosPago),
    [formaPago, state.descuentosPago],
  )

  /* Los comprobantes llevan los MISMOS importes que la selección de productos: bruto, descuento
     total y gravado salen de las mismas fórmulas; lo único propio de la factura es que el IVA se
     liquida con la alícuota declarada de cada producto. */
  const comprobantes = useMemo(
    () => comprobantesDeVenta(productos, descFormaPago),
    [productos, descFormaPago],
  )

  /* Líneas con su NETO (sin IVA y ya bonificado): es la base de la comisión. Se calcula UNA vez y
     la comparten la métrica del resumen y lo que se manda al registro de comisiones, así el número
     que ve el vendedor y el que se escribe en el board no pueden divergir.
     La VENTA sobre PROFORMA trae su propio descuento por forma de pago; el resto usa el de la
     operación. */
  const lineasComision = useMemo(
    () =>
      productos.map((p) => ({
        ...p,
        /* Base de comisión = importe GRAVADO de la línea: Subtotal − Descuento Total, SIN IVA. El
           Descuento Total compone (en cascada) el descuento de línea y el de forma de pago. La VENTA
           sobre PROFORMA trae su propio descuento por forma de pago; el resto usa el de la operación. */
        neto: netoLinea(
          p.precioUnitario,
          p.cantidad,
          p.descuento ?? 0,
          p.descFormaPago ?? descFormaPago,
        ),
      })),
    [productos, descFormaPago],
  )

  /* Comisión del vendedor por esta venta: la tasa que rige su tipo de venta sobre el neto de cada
     producto comisionable. Es el importe que se muestra antes de emitir y el que se registra. */
  const comisionVenta = useMemo(() => {
    /* VENTA PROFORMA: la tasa la define el tipo de venta de la proforma elegida (Activa/Pasiva); el
       resto usa el tipo de la operación. Así la comisión registrada coincide con la mostrada. */
    const tasa = tasaComision(state.comisiones, state.proformaTipoVenta ?? tipoVenta ?? 'DIRECTA')
    return round2(
      lineasComision.reduce(
        (acc, l) => acc + comisionLinea(l.neto, l.comisionable === true, tasa),
        0,
      ),
    )
  }, [lineasComision, state.comisiones, tipoVenta, state.proformaTipoVenta])

  // Comprobantes ya escritos en el board, indexados por la clave del grupo que los originó.
  const emitidos = useMemo(
    () => new Map(factura.comprobantes.map((c) => [c.clave, c])),
    [factura.comprobantes],
  )

  /* Total FACTURADO (con IVA): la suma de los comprobantes a emitir. Sus líneas ya llevan el
     descuento por forma de pago, así que coincide con el total de la venta salvo por el IVA, que
     el comprobante liquida con la alícuota declarada de cada producto y no con una tasa única. */
  const totalFacturado = useMemo(() => totalesComprobantes(comprobantes).total, [comprobantes])
  /* Total REAL de la venta: el importe FINAL que se le cobra al cliente, con el descuento por forma
     de pago ya aplicado. Sale del MISMO selector que alimenta la métrica "TOTAL VENTA" del cobro, y
     es el que tiene que viajar al recibo, a la deuda y al importe total de la venta: usar el
     facturado dejaba la diferencia del recibo abierta por el monto del descuento. */
  const totalVenta = useMemo(
    () =>
      totalVentaOperacion({
        cliente,
        operacion,
        tipoVenta,
        tipoEntrega,
        lineas: state.lineas,
        ventaItems: state.ventaItems,
        facturaItems: state.facturaItems,
        proformaImporte: state.proformaImporte,
        descFormaPago: descuentoDeFormaPago(formaPago, state.descuentosPago),
      }).total,
    [
      cliente,
      operacion,
      tipoVenta,
      tipoEntrega,
      state.lineas,
      state.ventaItems,
      state.facturaItems,
      state.proformaImporte,
      formaPago,
      state.descuentosPago,
    ],
  )
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
    // Con decimales: redondear a entero asignaba una rentabilidad general incorrecta en el ítem.
    return round2(ponderada)
  }, [productos])
  /* Balance de los movimientos de pago y su resumen contra el total: alimentan el recibo simultáneo.
     Con TARJETA los movimientos van SIN descuento por medio de pago: el de la forma de pago ya está
     aplicado en el total de la venta, así que volver a descontarlo por movimiento lo contaría dos
     veces y el recibo no cerraría contra el total que se cobró. */
  const balances = useMemo(
    () =>
      balancePagos(
        cobro.movimientos,
        esPagoConTarjeta(formaPago) ? SIN_DESCUENTOS_PAGO : state.descuentosPago,
      ),
    [cobro.movimientos, state.descuentosPago, formaPago],
  )
  const esEntregaPosterior = tipoEntrega === 'POSTERIOR'

  if (!cliente) return null

  const ivaReceptor = factura.ivaReceptor ?? ivaPorDefecto(cliente)
  // A para responsable inscripto y monotributista; B para consumidor final y exento.
  const letra = factura.letra ?? letraComprobante(cliente.status)
  /* El vencimiento a plazo depende de la FORMA DE PAGO elegida: sólo la CUENTA CORRIENTE vence a
     plazo. En cualquier otra forma (contado, tarjetas) la factura se cobra al emitirse, así que su
     vencimiento es la propia fecha de emisión y se muestra "Pago contado".
     El plazo NO está escrito en la app: sale del tablero de configuración ("Dias de Vigencia Fact
     Vta"), que se lee al arrancar. */
  const venceAPlazo = formaPago === 'CUENTA CORRIENTE'
  const diasDe = (clave: string) => dias[clave] ?? state.diasVencFactura
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
          // Plazo de vencimiento del tablero de configuración, no un número escrito en la app.
          diasVencimiento: state.diasVencFactura,
          observaciones: factura.observaciones,
          ventaId,
          // Entra sólo en el "Importe Bonif $" de cada línea, no en el precio del comprobante.
          descFormaPago,
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
      // Fallo de la API: lo comunica la ventana global de error de Monday.
      dispatch({ type: 'errorMonday', accion: 'emitir los comprobantes de la venta' })
    } finally {
      setEmitiendo(false)
    }
  }

  /**
   * Registro de comisiones de la venta (best-effort, fire-and-forget), al finalizar la operación.
   * Universal: corre para cualquier tipo de venta/entrega. El servicio aborta sin tocar el board si
   * ningún producto de la venta comisiona. En el cobro POSTERIOR enlaza la deuda recién creada; en
   * el SIMULTANEO omite esa relación. No frena el cierre.
   */
  const dispararComisiones = (vId: string, pendienteCobroId?: string) => {
    if (!vId) return
    void crearComisiones({
      ventaId: vId,
      clienteId: cliente.id,
      vendedorId: state.vendedor?.id ?? null,
      tipoVenta: tipoVenta ?? 'DIRECTA',
      /* Tipo de cobro de la operación e importe total (con IVA): definen el monto pendiente de
         cobro. Va el total REAL de la venta, que es lo que efectivamente se le cobra al cliente. */
      tipoPago: datosCobroVenta(formaPago, operacion).tipoPago,
      importeTotalVenta: totalVenta,
      fecha: aIso(fechaEmision),
      pendienteCobroId,
      // Tasas del tablero: una sola por tipo de venta, la misma que se muestra en el resumen.
      comisiones: state.comisiones,
      // Las MISMAS líneas (con su neto) que alimentan la métrica "Comision x Venta" del resumen.
      lineas: lineasComision.map((l) => ({
        productoId: l.productoId,
        nombre: l.nombre,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        neto: l.neto,
        comisionable: l.comisionable === true,
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
            // Proveedor del comprobante consignado: prefija el nombre del ítem CYO ("Proveedor - Producto").
            proveedorNombre: c.proveedorNombre ?? undefined,
            cantidad: l.cantidad,
            /* Precio unitario NETO (ya bonificado). No es el que va al comprobante —ahí va el de
               lista, con la bonificación en su propia columna—: acá hace falta lo que se cobró. */
            precioUnitario: precioNetoUnitario(l, descFormaPago),
            comprobanteId: emitido.id,
          }))
      })
    if (lineasCYO.length === 0) return
    void crearConsignacionesCYO(lineasCYO, aIso(fechaEmision)).catch(() => {
      /* El registro CYO es best-effort: un fallo no revierte la venta ni frena el cierre. */
    })
  }

  /**
   * Las facturas que el cobro cancela: un elemento por comprobante EFECTIVAMENTE emitido, con su
   * id en el board de Facturación y su total (con IVA) como importe cancelado. La división de
   * mercadería puede emitir varios —el común y uno por proveedor consignado—, y cada uno deja su
   * propio subelemento en el recibo. Un comprobante que no llegó a crearse no cancela nada.
   */
  const facturasCanceladas = comprobantes.flatMap((c) => {
    const emitido = emitidos.get(c.clave)
    if (!emitido?.id) return []
    return [{ facturaId: emitido.id, importe: c.total }]
  })

  /** Ítems del board de Facturación que dejó la emisión: los comprobantes que hay que enlazar. */
  const comprobantesEmitidos = factura.comprobantes.map((c) => c.id).filter(Boolean)

  /**
   * Efectos secundarios de la venta, disparados TODOS fire-and-forget (sin `await` bloqueante) una
   * vez creada la venta: el usuario finaliza sin esperar a que terminen en Monday.
   *   · Cobro: el recibo del cobro SIMULTÁNEO (+ su vínculo a la venta) o la deuda del POSTERIOR.
   *   · Comisiones: en el POSTERIOR se encadenan a la deuda recién creada; en el resto van sueltas.
   *   · Conciliaciones de origen: cantidad vendida (presupuesto) y facturación (Vtas Pends de Facturar).
   *   · Consignación CYO. (Los pendientes de entrega ya los dispara `crearVenta` internamente.)
   */
  const dispararEfectosSecundarios = (vId: string) => {
    /* Las facturas quedan colgadas de la venta que las originó ("📈Ventas" del comprobante). Recién
       se puede acá: se emiten en este mismo paso, cuando la venta todavía no existe, así que al
       crear el comprobante no había id que asignarle. Universal: corre para cualquier tipo de venta
       y de cobro. */
    if (comprobantesEmitidos.length > 0) {
      void vincularVentaAComprobantes(vId, comprobantesEmitidos).catch(() => {
        /* El vínculo es best-effort: un fallo no revierte la venta ni las facturas ya emitidas. */
      })
    }

    /* El recibo se dispara EN SIMULTÁNEO con los demás efectos, apenas confirmada la creación de la
       venta. Adentro sí encadena: crea el ítem, espera sus subelementos y RECIÉN ahí pone el estado
       en "Registrar", que es lo que asienta el cobro en el sistema (ver `registrarCobro`). Ese
       encadenamiento vive del lado del servicio, así que acá se sigue sin esperar y el cierre no se
       congela. */
    if (cobroSimultaneoOperacion(formaPago, operacion)) {
      /* SIMULTÁNEO: el recibo nace con las facturas que cancela y con sus movimientos de pago.
         Las facturas salen de los comprobantes efectivamente EMITIDOS —la división de mercadería
         puede dejar más de uno— con el total de cada uno como importe cancelado. */
      void registrarCobro({
        clienteId: cliente.id,
        nombreCliente: cliente.name,
        vendedorId: state.vendedor?.id ?? null,
        totalVenta,
        facturas: facturasCanceladas,
        balances,
      }).catch(() => {
        /* El recibo del cobro es best-effort: un fallo no revierte la venta ya creada. Se avisa
           igual: un recibo que no se creó deja la caja sin el asiento de esta venta, y enterarse
           recién al buscarlo en el tablero es peor que un cartel. */
        dispatch({ type: 'errorMonday', accion: 'registrar el recibo del cobro' })
      })
      dispararComisiones(vId)
    } else {
      /* POSTERIOR (CUENTA CORRIENTE): la venta NO deja recibo. Lo único que se escribe es la deuda
         en "💰Fact Vtas Pends de Cobro": todavía no entró plata, así que no hay nada que recibir.
         El recibo lo va a crear el cobro de esa deuda, cuando ocurra.
         La comisión NO depende de la deuda: si la deuda falla, igual se registra (sin el vínculo).
         Encadenarla acá adentro hacía que un fallo de la deuda se llevara puesta la comisión. */
      void (async () => {
        let deudaId: string | null = null
        try {
          /* Ya no se exige que el cliente tenga cuenta corriente: la deuda cuelga de la VENTA
             (board_relation_mm4d3nn0) y el tablero resuelve desde ahí la imputación a la cuenta. */
          if (requiereRegistroDeuda(formaPago, operacion)) {
            deudaId = (
              await registrarDeudaPosterior({
                ventaId: vId,
                clienteId: cliente.id,
                nombreCliente: cliente.name,
                total: totalVenta,
                /* Las MISMAS fechas que declara el comprobante: la deuda vence cuando vence la
                   factura. Todos los comprobantes de la venta comparten el plazo (sale del tablero
                   de configuración), así que alcanza con el primero. */
                fechaEmision,
                vencimiento: vencimientoDe(comprobantes[0]?.clave ?? ''),
              })
            ).deudaId
          }
        } catch {
          /* El registro de la deuda es best-effort: se sigue sin su id. */
        }
        dispararComisiones(vId, deudaId ?? undefined)
      })().catch(() => {
        /* Ningún efecto secundario revierte la venta ya creada. */
      })
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
          // Vendedor de la operación → columna Person del board de Ventas. Sin esto la venta nace
          // sin vendedor asignado (los efectos secundarios sí lo mandaban; la venta no).
          vendedorId: state.vendedor?.id ?? null,
          nombre: cliente.name,
          tipoVenta: tipoVenta ?? 'DIRECTA',
          tipoEntrega: tipoEntrega ?? 'SIMULTANEA',
          // El tipo de cobro sale de la forma de pago elegida, no de la condición del cliente.
          ...datosCobroVenta(formaPago, operacion),
          rentabilidad: rentabilidadVenta,
          descFormaPago,
          tasaCambio: state.tasaCambio,
          /* "Importe Total $" (numeric_mm5qbwer): el total REAL de la venta. En VENTA PROFORMA es
             TAL CUAL el TOTAL de la proforma (numeric_mm5sw8n2), que el selector ya devuelve. */
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
      // Fallo de la API: lo comunica la ventana global de error de Monday.
      dispatch({ type: 'errorMonday', accion: 'registrar la venta' })
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
          totalAFacturar={totalFacturado}
          comision={comisionVenta}
          emitidos={factura.comprobantes.length}
          emitiendo={emitiendo}
          onEmitir={emitir}
        />

        {/* Columna derecha: los comprobantes y, debajo, el envío de la factura. */}
        <div className="factura-col-der">
          <ComprobantesAGenerar
            comprobantes={comprobantes}
            descFormaPago={descFormaPago}
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
