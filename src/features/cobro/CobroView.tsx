import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  balancePagos,
  bloqueoCobro,
  cobroActivo,
  cobroConfirmable,
  cobroSimultaneoOperacion,
  cierreCompleto,
  datosCobroVenta,
  esAgenteRetencion,
  MENSAJE_RETENCION,
  mostrarImpactoCtaCte,
  pagoSimultaneo,
  puedeEmitirFactura,
  resumenCobro,
} from '@/lib/cobros'
import { round2 } from '@/lib/format'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { esFlujoRemito, pasoDeProductos, pasosDe } from '@/lib/pasos'
import { IVA_RATE, resumenFactura, resumenVenta } from '@/lib/selectors'
import {
  actualizarCantVendida,
  crearVenta,
  registrarFacturacionVtasPend,
  vincularVentaAlCobro,
  registrarCobroSimultaneo,
  registrarDeudaPosterior,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { CabeceraCobro } from './CabeceraCobro'
import { EntregaCierreVenta } from './EntregaCierreVenta'
import { ImpactoCtaCte } from './ImpactoCtaCte'
import { FormularioCobro } from './FormularioCobro'
import { TablaMovimientos } from './TablaMovimientos'

/**
 * En qué anda el cierre mientras se escribe en Monday. La deuda del pago posterior ya no pasa
 * por acá: se registra al finalizar la operación, con la factura emitida y enviada.
 */
type FaseCierre = null | 'venta'

/** Qué decir en cada fase: título y qué se está escribiendo, para que la espera se entienda. */
const TEXTO_FASE: Record<'venta', { titulo: string; detalle: string }> = {
  venta: {
    titulo: 'Registrando venta...',
    detalle:
      'Estamos registrando la venta en el sistema junto a sus productos. Espera unos segundos',
  },
}

/**
 * Paso 3 de CARGAR VENTA: cierre de la venta. El cobro es opcional y vive en un
 * desplegable; lo que sí se valida es que la factura proforma se pueda emitir.
 */
export function CobroView() {
  const state = useApp()
  const { cliente, operacion, tipoVenta, tipoEntrega, fechaEmision, cobro, descuentosPago } = state
  const dispatch = useDispatch()

  /* Neto de la venta (sin IVA): es la base del crédito. La línea del cliente se mide sobre el
     neto, igual que en la selección de productos, no sobre el total con IVA. De dónde sale
     depende del flujo por el que se armó. */
  const netoVenta = useMemo(
    () =>
      // La entrega ANTERIOR manda sobre el tipo de venta: se factura lo remitido.
      esFlujoRemito(tipoEntrega)
        ? // La factura aplana varios remitos: ya no hay un descuento único por remito.
          resumenFactura(state.facturaItems, cliente, 0).neto
        : tipoVenta === 'CON PRESUPUESTO PREVIO'
          ? resumenVenta(state.ventaItems, cliente, 'CON PRESUPUESTO PREVIO').total
          : round2(
              state.lineas.reduce(
                (acc, l) => acc + round2(l.producto.precio * l.cantidad * (1 - l.descuento / 100)),
                0,
              ),
            ),
    [state, cliente, tipoVenta, tipoEntrega],
  )
  /* Lo que hay que cobrar es el TOTAL con IVA: es el importe que va a la factura, no el neto. */
  const totalVenta = useMemo(() => round2(netoVenta * (1 + IVA_RATE)), [netoVenta])

  /* Rentabilidad general de la venta: es lo que va a la cabecera del ítem en "📈Ventas".
     Cada línea pesa por su importe ya bonificado, igual que en el presupuesto. */
  const rentabilidadVenta = useMemo(() => {
    const productos = lineasDeVenta({
      tipoVenta,
      tipoEntrega,
      lineas: state.lineas,
      ventaItems: state.ventaItems,
      facturaItems: state.facturaItems,
    })
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
  }, [state, tipoVenta, tipoEntrega])

  const balances = useMemo(
    () => balancePagos(cobro.movimientos, descuentosPago),
    [cobro.movimientos, descuentosPago],
  )
  const resumen = useMemo(() => resumenCobro(balances, totalVenta), [balances, totalVenta])
  /* Bloqueo por crédito. Lo que consume la línea es el NETO de la venta —la misma base que la
     selección de productos—, no el total con IVA: medir el bloqueo sobre el bruto frenaba
     ventas que en el resumen todavía mostraban crédito disponible. Y si la venta se cobra
     entera en el acto no deja deuda, así que no consume nada. */
  const aCredito = useMemo(() => {
    const cobradoTodo = round2(resumen.cancelado) >= round2(resumen.totalACobrar)
    return cobradoTodo ? 0 : netoVenta
  }, [netoVenta, resumen.cancelado, resumen.totalACobrar])
  const bloqueo = useBloqueoCredito(aCredito)
  // Registrar el cobro pliega el item; de ahí en más se abre y cierra a mano.
  const [abierto, setAbierto] = useState(true)
  /* El plegado anima sobre `height`, así que hace falta el alto real del contenido: `auto`
     no interpola. Se remide cuando el contenido cambia (un pago más, un aviso) para que el
     desplegable abierto nunca recorte. */
  const cuerpoRef = useRef<HTMLDivElement>(null)
  const [altoCuerpo, setAltoCuerpo] = useState(0)
  // Escritura en Monday: en curso y su error, para no dejar el botón mudo.
  const [registrando, setRegistrando] = useState(false)
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null)
  /* Cierre de la operación: tapa la pantalla mientras se escribe en Monday y va contando en
     qué paso está. `null` = nada en curso. */
  const [fase, setFase] = useState<FaseCierre>(null)
  const [errorVenta, setErrorVenta] = useState<string | null>(null)

  // Se mide antes de pintar: el desplegable arranca abierto y no tiene que dar un salto.
  useLayoutEffect(() => {
    const el = cuerpoRef.current
    if (!el) return
    const medir = () => setAltoCuerpo(el.scrollHeight)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
    /* A propósito sin deps: cada render remide, así el alto nunca queda viejo cuando cambia
       el contenido (un pago más, un aviso). El observer cubre lo que no pasa por render:
       fuentes que cargan tarde, cambios de ancho de ventana. */
  })

  if (!cliente) return null

  const agente = esAgenteRetencion(cliente)
  /* Cómo es el cliente: de contado no elige nada (siempre cobra en el acto); el resto ve el
     SI/NO del cierre. Define la FORMA de la pantalla, no el camino del registro. */
  const clienteDeContado = pagoSimultaneo(cliente)
  /* Cómo se cobra ESTA operación: contado, o cuenta corriente con "SI" en el cierre. Es el
     flag que decide el registro (recibo vs. deuda) y el que viaja al board. */
  const simultaneo = cobroSimultaneoOperacion(cliente, cobro)
  /* Hay cuerpo que desplegar cuando se va a cargar un cobro: siempre en contado, y en cuenta
     corriente sólo si el vendedor eligió "SI". */
  const activo = cobroActivo(cliente, cobro)
  /* El impacto en cuenta corriente se muestra sólo si la venta va a dejar deuda: cuenta
     corriente con "NO". Elegir "SI" lo desmonta. */
  const mostrarImpacto = mostrarImpactoCtaCte(cliente, cobro)
  const bloqueoMsg = bloqueoCobro(cliente, cobro, fechaEmision, resumen)
  const confirmable = cobroConfirmable(cliente, cobro, fechaEmision, resumen)
  const puedeEmitir = puedeEmitirFactura(cliente, cobro, fechaEmision, resumen)
  // Ya escrito en Monday: no se vuelve a registrar para no duplicar el recibo ni la deuda.
  const yaEscrito = Boolean(cobro.cobroId || cobro.deudaId)
  /* El responsable logístico (y su ruta) se pregunta SÓLO en la entrega POSTERIOR. */
  const esEntregaPosterior = tipoEntrega === 'POSTERIOR'
  /* Guardrail de ruta: en POSTERIOR, si el responsable logístico es La Batea, no se puede avanzar
     hasta seleccionar y confirmar una Ruta de Entrega. Las otras opciones no la exigen. */
  const faltaRutaLaBatea =
    esEntregaPosterior &&
    state.entregaVenta.responsable === 'LA_BATEA' &&
    !state.entregaVenta.rutaConfirmada

  /**
   * El registro se bifurca por el TIPO DE PAGO DE LA OPERACIÓN, no por la condición del
   * cliente: SIMULTANEO crea el recibo con sus movimientos —también cuando el cliente es de
   * cuenta corriente y acá se eligió "SI"—; POSTERIOR no toca el tablero de Cobros y difiere
   * la deuda al cierre de la operación. Los dos caminos son excluyentes.
   */
  const registrar = async (): Promise<boolean> => {
    if (registrando) return yaEscrito
    if (yaEscrito) return true
    // La deuda del pago posterior consume línea: no se escribe si no entra.
    if (bloqueo.frenar()) return false
    setRegistrando(true)
    setErrorRegistro(null)
    try {
      if (simultaneo) {
        const { id } = await registrarCobroSimultaneo({
          totalACobrar: resumen.totalACobrar,
          cancelado: resumen.cancelado,
          balances,
          ctaCteId: cliente.ctaCteId,
          nombreCliente: cliente.name,
        })
        dispatch({ type: 'confirmarCobro', cobroId: id })
        setAbierto(false)
        return true
      } else {
        if (!cliente.ctaCteId) {
          setErrorRegistro(
            `${cliente.name} no tiene cuenta corriente conectada: no se puede registrar la deuda.`,
          )
          return false
        }
        const { deudaId, saldoAnterior } = await registrarDeudaPosterior({
          ctaCteId: cliente.ctaCteId,
          total: resumen.totalACobrar,
          concepto: `${cliente.name} · ${cobro.fecha}`,
        })
        dispatch({ type: 'confirmarCobro', deudaId, saldoAnterior })
        return true
      }
    } catch {
      setErrorRegistro(
        simultaneo
          ? 'No se pudo registrar el cobro en Monday. Reintentá en unos segundos.'
          : 'No se pudo registrar la deuda en la cuenta corriente. Reintentá en unos segundos.',
      )
      return false
    } finally {
      setRegistrando(false)
    }
  }
  /* Pasar a la factura. La deuda del pago posterior NO se escribe acá: el cliente recién queda
     endeudado cuando la factura legal está emitida y enviada, así que su registro vive en el
     cierre de la operación (modal de "Finalizar Operación"). */
  const continuarAFactura = async () => {
    if (fase) return
    // Guardrail: La Batea sin ruta confirmada no avanza (el botón ya está inhabilitado; defensa extra).
    if (faltaRutaLaBatea) return

    /* La venta se escribe en "📈Ventas" recién acá: es el punto donde la operación queda
       cerrada. Sólo se abre la facturación si la cabecera y TODOS sus productos entraron. */
    const productos = lineasDeVenta({
      tipoVenta,
      tipoEntrega,
      lineas: state.lineas,
      ventaItems: state.ventaItems,
      facturaItems: state.facturaItems,
    })
    setFase('venta')
    setErrorVenta(null)
    try {
      /* Si ya se creó en un intento anterior no se vuelve a crear: reintentar tras un fallo
         del vínculo no debe dejar dos ventas por la misma operación. */
      let ventaId = state.ventaId
      if (!ventaId) {
        const creada = await crearVenta({
          clienteId: cliente.id,
          nombre: cliente.name,
          tipoVenta: tipoVenta ?? 'DIRECTA',
          tipoEntrega: tipoEntrega ?? 'SIMULTANEA',
          /* Tipo de pago de la operación ('SIMULTANEO' / 'POSTERIOR'): lo arma el constructor
             del payload, no la vista. Es lo que queda asentado en el board. */
          ...datosCobroVenta(cliente, cobro),
          rentabilidad: rentabilidadVenta,
          /* Responsable logístico (dropdown) y ruta: SÓLO en la entrega POSTERIOR, que es donde se
             pregunta. La ruta se manda únicamente si La Batea la confirmó, y baja a los pendientes. */
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
            `La venta se creó pero quedó incompleta: entraron ${creada.subitemsCreados} de ${productos.length} productos. Revisala en Monday antes de facturar.`,
          )
          return
        }
        ventaId = creada.id
        dispatch({ type: 'setVentaId', value: ventaId })
      }

      /* CON PRESUPUESTO PREVIO: cada producto salió de una línea de presupuesto. Se asienta la
         cantidad vendida en su subelemento, acumulando lo que ya estaba vendido con lo que se
         lleva ahora. Es idempotente (valor absoluto), así que un reintento no la duplica. */
      if (tipoVenta === 'CON PRESUPUESTO PREVIO') {
        await actualizarCantVendida(
          state.ventaItems
            .filter((it) => it.subitemId)
            .map((it) => ({
              subitemId: it.subitemId as string,
              cantVendida: (it.vend ?? 0) + it.aVender,
            })),
        )
      }

      /* ENTREGA ANTERIOR (fuente "Vtas Pends de Facturar"): la facturación de esta operatoria se
         distribuye en dos niveles sobre el board 18421033947 —cantidad facturada por subítem y
         monto facturado por venta, con el enlace a la venta creada—. Best-effort: la venta ya se
         creó, así que un fallo acá no la revierte ni frena la operación. */
      if (state.facturaItems.length > 0) {
        try {
          await registrarFacturacionVtasPend(
            state.facturaItems.map((it) => ({
              subitemId: it.subitemId,
              ventaPendId: it.ventaPendId,
              aFacturar: it.aFacturar,
              precio: it.precio,
            })),
            ventaId,
          )
        } catch {
          /* La conciliación de "Vtas Pends de Facturar" es best-effort. */
        }
      }

      /* El recibo nace antes que la venta, así que el vínculo se cierra recién ahora. Sólo
         aplica al cobro simultáneo: el posterior no genera recibo. */
      if (cobro.cobroId) await vincularVentaAlCobro(cobro.cobroId, ventaId)

      dispatch({ type: 'goto', paso: 'factura' })
    } catch {
      setErrorVenta(
        state.ventaId
          ? 'La venta quedó creada pero no se pudo vincular al cobro. Reintentá: no se va a duplicar.'
          : 'No se pudo crear la venta en Monday. Reintentá en unos segundos.',
      )
    } finally {
      setFase(null)
    }
  }

  // El tilde de la cabecera: el recibo en simultáneo, la deuda en posterior.
  const etapaCerrada = cierreCompleto(cliente, cobro, fechaEmision, resumen)
  /* Ya escrito en Monday: el registro queda a la vista pero no se edita más. Se pliega solo
     al registrarlo, y de ahí en más se abre y cierra a voluntad. */
  const bloqueado = cobro.confirmado

  return (
    <section className="view cobro-v2 paso-layout">
      {/* ZONA 1 · mismo encabezado que el resto de las etapas. */}
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={2} />

      <div className="paso-body">
        <PasoTitulo
          numero={3}
          titulo="Cierre de Venta"
          descripcion={
            simultaneo
              ? 'Registrá el cobro de la venta para poder emitir la factura.'
              : 'Revisá la deuda que se genera en la cuenta corriente del cliente antes de facturar.'
          }
        />

        {/* El cálculo de retenciones vive en otra app: por ahora sólo se avisa. */}
        {agente && (
          <p className="cobro-aviso">
            <i className="fas fa-circle-exclamation" /> {MENSAJE_RETENCION}
          </p>
        )}

        {/* Desplegable del cobro: la cabecera, la carga y el impacto en cuenta corriente
            viven adentro; la barra de arriba sólo pliega y muestra el estado. */}
        <div className="cobro-acc">
          {/* La barra abre y cierra el cuerpo; en cuenta corriente además decide si se carga
              un cobro, así que los botones viven fuera del toggle. */}
          <div className="cobro-acc-head">
            <button
              type="button"
              className="cobro-acc-toggle"
              aria-expanded={abierto}
              aria-controls="cobro-detalle"
              disabled={!activo}
              onClick={() => setAbierto((v) => !v)}
            >
              <i className={`fas fa-chevron-down cobro-acc-chev ${abierto ? 'open' : ''}`} />
              <span className="cobro-acc-title">
                {clienteDeContado ? 'Cobro de la venta' : '¿Desea registrar un Cobro?'}
              </span>
            </button>

            {/* Cuenta corriente: cobrar ahora es opcional. Arranca en NO. El grupo sigue a la
                vista después de elegir "SI": es lo que permite volver atrás antes de registrar. */}
            {!clienteDeContado && (
              <div className="cobro-sino" role="group" aria-label="¿Desea registrar un cobro?">
                <button
                  type="button"
                  className={`cobro-sino-btn ${cobro.registrar ? 'is-on' : ''}`}
                  aria-pressed={cobro.registrar}
                  disabled={bloqueado}
                  onClick={() => dispatch({ type: 'setRegistrarCobro', value: true })}
                >
                  SI
                </button>
                <button
                  type="button"
                  className={`cobro-sino-btn ${cobro.registrar ? '' : 'is-on'}`}
                  aria-pressed={!cobro.registrar}
                  disabled={bloqueado}
                  onClick={() => dispatch({ type: 'setRegistrarCobro', value: false })}
                >
                  NO
                </button>
              </div>
            )}

            {/* Qué implica la elección, o qué exige la condición del cliente. */}
            <span className="cobro-tipo-nota">
              <i className="fas fa-circle-info" />{' '}
              {clienteDeContado ? (
                <>
                  La condición del cliente es de {cliente.condicionPago}: registrá el cobro para
                  poder facturar.
                </>
              ) : simultaneo ? (
                <>
                  Con «SI» la venta se registra como cobro <strong>SIMULTANEO</strong>: cobrá el
                  100% ahora y no se genera deuda en la cuenta corriente.
                </>
              ) : (
                <>
                  Si deja por defecto la opción «NO», la venta se creará como pendiente de cobro y
                  la deuda se registrará al finalizar la operación, una vez emitida y enviada la
                  factura.
                </>
              )}
            </span>

            <span
              className={`cobro-ok ${etapaCerrada ? 'on' : ''}`}
              title={
                etapaCerrada
                  ? simultaneo
                    ? 'Cobro registrado correctamente'
                    : 'Deuda registrada en la cuenta corriente'
                  : simultaneo
                    ? 'Cobro sin registrar'
                    : 'Deuda sin registrar'
              }
            >
              <i className="fas fa-check" />
            </span>
          </div>

          {/* El cuerpo queda montado siempre: es lo que permite animar el plegado. */}
          {activo && (
            <div
              id="cobro-detalle"
              className="cobro-acc-clip"
              style={{ height: abierto ? (altoCuerpo || 'auto') : 0 }}
              aria-hidden={!abierto}
            >
              <div className="cobro-acc-body" ref={cuerpoRef}>
                  <CabeceraCobro cliente={cliente} resumen={resumen} />

                  {/* La carga del cobro: formulario y lo ya registrado. */}
                  <div className="cobro-card">
                    <h3 className="cobro-card-title">Registrar cobro</h3>

                    <FormularioCobro fechaFactura={fechaEmision} bloqueado={bloqueado} />

                    <h4 className="cobro-card-sub">Cobros registrados ({balances.length})</h4>
                    <TablaMovimientos
                      balances={balances}
                      fecha={cobro.fecha}
                      bloqueado={bloqueado}
                    />

                    {/* La acción cierra la carga del cobro, pegada a lo que confirma. */}
                    <div className="cobro-card-acts">
                      {errorRegistro && <span className="cobro-err">{errorRegistro}</span>}
                      <button
                        type="button"
                        className="cobro-btn cobro-btn--primary"
                        disabled={!confirmable || cobro.confirmado || registrando}
                        aria-busy={registrando}
                        onClick={registrar}
                      >
                        {registrando ? (
                          <>
                            <i className="fas fa-circle-notch spin" /> Registrando...
                          </>
                        ) : cobro.confirmado ? (
                          <>
                            <i className="fas fa-check" /> Cobro registrado
                          </>
                        ) : (
                          'Registrar cobro'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
            </div>
          )}

          {/* Impacto en cuenta corriente: sólo en el camino que deja deuda —cuenta corriente
              con "NO"—. Con "SI" el cobro cancela la venta en el acto y no hay saldo
              proyectado que mostrar, así que el bloque ni se monta. */}
          {mostrarImpacto && <ImpactoCtaCte cliente={cliente} resumen={resumen} />}
        </div>

        {/* Responsable logístico de la venta (junto a la consulta del cobro). SÓLO se pregunta en
            la entrega POSTERIOR. Con La Batea pide sólo la ruta; comisionista y cliente, como el Remito. */}
        {esEntregaPosterior && <EntregaCierreVenta />}

        {bloqueoMsg && (
          <div className="cobro-bloqueo">
            <i className="fas fa-circle-exclamation" /> {bloqueoMsg}
          </div>
        )}

        {/* Avanzar está siempre a la vista, pero apagado hasta que el cobro quede registrado:
            así se ve a dónde lleva el paso sin poder saltearlo. */}
        <div className="footer-acts">
          <button
            type="button"
            className="cobro-btn cobro-btn--out"
            onClick={() =>
              dispatch({ type: 'goto', paso: pasoDeProductos(operacion, tipoVenta, tipoEntrega) })
            }
          >
            <i className="fas fa-arrow-left" /> Volver a paso anterior
          </button>
          <button
            type="button"
            className="cobro-btn cobro-btn--green"
            disabled={!puedeEmitir || Boolean(fase) || faltaRutaLaBatea}
            aria-busy={Boolean(fase)}
            title={
              faltaRutaLaBatea
                ? 'Confirmá la Ruta de Entrega para continuar.'
                : puedeEmitir
                  ? undefined
                  : 'Registrá el cobro de la venta para poder emitir la factura.'
            }
            onClick={continuarAFactura}
          >
            {/* El estado de la escritura lo cuenta la ventana de carga, no el botón. */}
            Continuar a Emitir factura <i className="fas fa-arrow-right" />
          </button>
        </div>

        {bloqueo.modal}

        {/* La venta quedó a medias en el board: no se abre la facturación hasta resolverlo. */}
        {errorVenta && (
          <AvisoModal titulo="No se pudo cerrar la venta" onClose={() => setErrorVenta(null)}>
            {errorVenta}
          </AvisoModal>
        )}

        {/* Tapa la pantalla mientras se escribe en Monday: es una secuencia que no conviene
            interrumpir ni disparar dos veces, y el texto dice en qué paso va. */}
        {fase && (
          <ModalCargando titulo={TEXTO_FASE[fase].titulo} detalle={TEXTO_FASE[fase].detalle} />
        )}
      </div>
    </section>
  )
}
