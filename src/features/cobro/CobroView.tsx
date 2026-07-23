import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  balancePagos,
  bloqueoCobro,
  cobroActivo,
  cobroConfirmable,
  cierreCompleto,
  esAgenteRetencion,
  MENSAJE_RETENCION,
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
  vincularVentaAlCobro,
  registrarCobroSimultaneo,
  registrarDeudaPosterior,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { CabeceraCobro } from './CabeceraCobro'
import { ImpactoCtaCte } from './ImpactoCtaCte'
import { FormularioCobro } from './FormularioCobro'
import { TablaMovimientos } from './TablaMovimientos'

/**
 * En qué anda el cierre mientras se escribe en Monday. El orden importa y se le muestra al
 * usuario: primero la deuda del cliente, después la venta.
 */
type FaseCierre = null | 'deuda' | 'venta'

/** Qué decir en cada fase: título y qué se está escribiendo, para que la espera se entienda. */
const TEXTO_FASE: Record<'deuda' | 'venta', { titulo: string; detalle: string }> = {
  deuda: {
    titulo: 'Registrando la deuda…',
    detalle:
      'Creando el movimiento en la cuenta corriente del cliente y su factura pendiente de cobro.',
  },
  venta: {
    titulo: 'Creando la venta en Monday…',
    detalle: 'Estamos registrando la venta y sus productos. No cierres esta pantalla.',
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
  const simultaneo = pagoSimultaneo(cliente)
  /* Hay cuerpo que desplegar cuando se va a cargar un cobro: siempre en contado, y en cuenta
     corriente sólo si el vendedor eligió "SI". */
  const activo = cobroActivo(cliente, cobro)
  const bloqueoMsg = bloqueoCobro(cliente, cobro, fechaEmision, resumen)
  const confirmable = cobroConfirmable(cliente, cobro, fechaEmision, resumen)
  const puedeEmitir = puedeEmitirFactura(cliente, cobro, fechaEmision, resumen)
  // Ya escrito en Monday: no se vuelve a registrar para no duplicar el recibo ni la deuda.
  const yaEscrito = Boolean(cobro.cobroId || cobro.deudaId)

  /**
   * El registro se bifurca por el tipo de cobro: simultáneo crea el recibo con sus
   * movimientos; posterior no toca el tablero de Cobros y genera la deuda en la cuenta
   * corriente del cliente.
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
  /* Pasar a la factura: en posterior no hay nada cargado que confirmar, así que es acá donde
     se crea la deuda (movimiento en la cuenta corriente + factura pendiente de cobro). Sólo
     se navega si la escritura salió bien. */
  const continuarAFactura = async () => {
    if (fase) return
    /* Primero la deuda: el movimiento en la cuenta corriente y su factura pendiente de cobro.
       Recién con eso escrito tiene sentido crear la venta. */
    if (!simultaneo && !cobro.confirmado) {
      setFase('deuda')
      const ok = await registrar()
      if (!ok) {
        setFase(null)
        return
      }
    }

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
          cobroSimultaneo: simultaneo,
          rentabilidad: rentabilidadVenta,
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
                {simultaneo ? 'Cobro de la venta' : '¿Desea registrar un Cobro?'}
              </span>
            </button>

            {/* Cuenta corriente: cobrar ahora es opcional. Arranca en NO. */}
            {!simultaneo && (
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
              {simultaneo ? (
                <>
                  La condición del cliente es de {cliente.condicionPago}: registrá el cobro para
                  poder facturar.
                </>
              ) : (
                <>
                  Si deja por defecto la opción «NO», la venta se creará como pendiente de cobro y
                  se registrará la deuda en la cuenta corriente del cliente.
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

                  </div>

                  {/* Cierra el panel a todo su ancho: la venta engrosa el saldo pendiente y lo
                      cobrado lo devuelve, así que acá se ve el efecto sobre el crédito antes
                      de confirmar. La acción vive adentro, junto a su consecuencia. */}
                  <ImpactoCtaCte
                    cliente={cliente}
                    resumen={resumen}
                    accion={
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
                    }
                  />
                </div>
            </div>
          )}
        </div>

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
            disabled={!puedeEmitir || Boolean(fase)}
            aria-busy={Boolean(fase)}
            title={
              puedeEmitir
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
