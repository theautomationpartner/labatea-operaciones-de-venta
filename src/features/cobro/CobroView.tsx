import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  balancePagos,
  cobroSimultaneoOperacion,
  descuentoDeFormaPago,
  esPagoConTarjeta,
  resumenCobro,
  tipoTarjetaDe,
  type DescuentosPago,
} from '@/lib/cobros'
import { round2 } from '@/lib/format'
import { esFlujoRemito, pasoDeProductos, pasoTrasCobro, pasosDe } from '@/lib/pasos'
import { IVA_RATE, resumenFactura, resumenPresupuesto, resumenVenta } from '@/lib/selectors'
import { useApp, useDispatch } from '@/state/hooks'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { CabeceraCobro } from './CabeceraCobro'
import { CobroProforma } from './CobroProforma'
import { CobroTarjeta } from './CobroTarjeta'
import { ImpactoCtaCte } from './ImpactoCtaCte'
import { FormularioCobro } from './FormularioCobro'
import { TablaMovimientos } from './TablaMovimientos'

/** El cobro de contado no aplica descuentos por medio de pago: se cobra el importe cargado. */
const SIN_DESCUENTO: DescuentosPago = {
  Efectivo: 0,
  Cheque: 0,
  Transferencia: 0,
  'Tarjeta de débito': 0,
  'Tarjeta de crédito': 0,
}

/**
 * Compara dos importes SIN considerar los centavos: se toman como iguales cuando difieren en
 * menos de un peso. Así el cobro cierra aunque el total de la venta traiga centavos que el
 * efectivo no puede igualar (p. ej. $ 181.396,91 se cubre cobrando $ 181.396).
 */
const mismoImporte = (a: number, b: number): boolean => Math.abs(a - b) < 1

/**
 * Paso 3 de VENTA: cierre de la venta. El cobro es opcional y vive en un
 * desplegable; lo que sí se valida es que la factura proforma se pueda emitir.
 */
export function CobroView() {
  const state = useApp()
  const { cliente, operacion, tipoVenta, tipoEntrega, fechaEmision, cobro, formaPago, proformaId } =
    state
  const dispatch = useDispatch()
  /* Débito y crédito son dos formas de pago, pero un mismo ramal de cobro: el formulario de
     tarjeta. Qué tipo es sale de la forma elegida, ya no de un selector aparte. */
  const conTarjeta = esPagoConTarjeta(formaPago)

  /* Neto de la venta (sin IVA): es la base del crédito. La línea del cliente se mide sobre el
     neto, igual que en la selección de productos, no sobre el total con IVA. De dónde sale
     depende del flujo por el que se armó. */
  /* Descuento por forma de pago (pronto pago): el cobro NO lo aplica por movimiento, así que tiene
     que estar YA descontado en el importe a cobrar —igual que en el resumen del paso anterior—. */
  const descFormaPago = descuentoDeFormaPago(formaPago, state.descuentosPago)
  /* Neto (base del crédito) y TOTAL con IVA de la venta, calculados con las MISMAS fórmulas que el
     resumen del paso anterior (incluido el descuento por forma de pago). El total resultante es el
     valor de la métrica "TOTAL" de esa card: es el que se cobra, se adeuda o va a la proforma. */
  const { netoVenta, totalVenta } = useMemo(() => {
    // La entrega ANTERIOR manda sobre el tipo de venta: se factura lo remitido (sin forma de pago).
    if (esFlujoRemito(tipoEntrega)) {
      const neto = resumenFactura(state.facturaItems, cliente, 0).neto
      return { netoVenta: neto, totalVenta: round2(neto * (1 + IVA_RATE)) }
    }
    // CON PRESUPUESTO PREVIO y la VENTA PROFORMA arman la venta en `ventaItems`.
    if (tipoVenta === 'CON PRESUPUESTO PREVIO' || operacion === 'VENTA PROFORMA') {
      const r = resumenVenta(
        state.ventaItems,
        cliente,
        tipoVenta ?? 'CON PRESUPUESTO PREVIO',
        descFormaPago,
      )
      return { netoVenta: r.total, totalVenta: round2(r.total + r.iva) }
    }
    // Venta DIRECTA armada desde el catálogo: mismo cálculo que el ResumenBox de la venta.
    const r = resumenPresupuesto(state.lineas, true, descFormaPago)
    return { netoVenta: r.neto, totalVenta: r.total }
  }, [state, cliente, tipoVenta, tipoEntrega, descFormaPago])

  /* El cobro de contado NO aplica descuentos por medio de pago: lo cobrado es el importe cargado,
     y "Total Cobrado" debe dar exactamente el total de la venta (Diferencia 0) para avanzar. */
  const balances = useMemo(
    () => balancePagos(cobro.movimientos, SIN_DESCUENTO),
    [cobro.movimientos],
  )
  const resumen = useMemo(() => resumenCobro(balances, totalVenta), [balances, totalVenta])

  /* MÓDULO 2 · reactividad del cobro: si la venta cambió (se editaron productos en un paso anterior)
     y lo cobrado ya no cubre el total, se reabre el cobro confirmado para exigir registrar la
     diferencia antes de volver a avanzar. Sólo aplica al cobro SIMULTÁNEO, que exige el 100%. */
  useEffect(() => {
    if (
      cliente &&
      cobro.confirmado &&
      cobroSimultaneoOperacion(cliente, cobro) &&
      !mismoImporte(resumen.cancelado, resumen.totalACobrar)
    ) {
      dispatch({ type: 'desconfirmarCobro' })
    }
  }, [cliente, cobro, resumen.cancelado, resumen.totalACobrar, dispatch])
  /* Bloqueo por crédito. Lo que consume la línea es el NETO de la venta —la misma base que la
     selección de productos—, no el total con IVA: medir el bloqueo sobre el bruto frenaba
     ventas que en el resumen todavía mostraban crédito disponible. Y si la venta se cobra
     entera en el acto no deja deuda, así que no consume nada. */
  const aCredito = useMemo(() => {
    // Cobrado todo (ignorando centavos): iguala el total o lo supera.
    const cobradoTodo =
      mismoImporte(resumen.cancelado, resumen.totalACobrar) ||
      resumen.cancelado >= resumen.totalACobrar
    return cobradoTodo ? 0 : netoVenta
  }, [netoVenta, resumen.cancelado, resumen.totalACobrar])
  const bloqueo = useBloqueoCredito(aCredito)
  /* Forma de pago CONTADO: el vendedor elige entre emitir una proforma o registrar el cobro. */
  const [contadoTab, setContadoTab] = useState<'proforma' | 'cobro'>('cobro')
  /* Pago con tarjeta: el cobro se da por hecho al confirmar los datos de la tarjeta. */
  const [tarjetaConfirmada, setTarjetaConfirmada] = useState(false)
  /* Modal de cierre de la venta con proforma (Guardar Venta): al aceptar limpia todo el estado. */
  const [guardando, setGuardando] = useState(false)

  if (!cliente) return null

  /* El cobro cierra cuando lo cobrado (sin descuentos) iguala el total de la venta SIN considerar
     los centavos. Es la validación para poder confirmar y avanzar. */
  const cobroCompleto =
    cobro.movimientos.length > 0 && mismoImporte(resumen.cancelado, resumen.totalACobrar)
  /* Motivo por el que el cobro todavía no cierra (se muestra al lado del botón). */
  const bloqueoMsg =
    cobro.movimientos.length > 0 && !cobroCompleto
      ? 'El total cobrado debe igualar el total de la venta (sin contar los centavos).'
      : null
  /* El responsable logístico (y su ruta) se pregunta SÓLO en la entrega POSTERIOR. */
  const esEntregaPosterior = tipoEntrega === 'POSTERIOR'

  /**
   * "Confirmar Cobro" es una confirmación LOCAL: marca el cobro como cargado en el estado, pero
   * NO escribe nada en Monday. El registro real —el recibo del cobro simultáneo o la deuda del
   * pago posterior— se difiere y se dispara fire-and-forget al "Finalizar Operación", junto con
   * la creación de la venta. Acá sólo se valida el crédito y se pliega el desplegable.
   */
  const registrar = async (): Promise<boolean> => {
    if (cobro.confirmado) return true
    if (bloqueo.frenar()) return false
    dispatch({ type: 'confirmarCobro' })
    return true
  }
  /* Pasar a la factura. La deuda del pago posterior NO se escribe acá: el cliente recién queda
     endeudado cuando la factura legal está emitida y enviada, así que su registro vive en el
     cierre de la operación (modal de "Finalizar Operación"). */
  /* Avanzar es una transición de UI local y 100% silenciosa: la venta NO se crea acá, su creación
     se traslada al "Finalizar Operación". Con entrega POSTERIOR se pasa antes por "Entrega de
     Mercadería"; si no, directo a la factura. */
  const continuarAFactura = () => {
    dispatch({ type: 'goto', paso: pasoTrasCobro(tipoEntrega) })
  }

  /* Ya confirmado: el registro queda a la vista pero no se edita más. */
  const bloqueado = cobro.confirmado

  /* CONTADO·EMITIR PROFORMA no continúa a otra etapa: la venta se cierra ahí mismo con "Guardar
     Venta" (dentro de CobroProforma), que limpia el estado. Por eso el pie no ofrece "Continuar". */
  const enProforma = formaPago === 'CONTADO' && contadoTab === 'proforma'

  /* Se puede avanzar según la forma de pago: CUENTA CORRIENTE alcanza con ver el impacto; las
     tarjetas exigen confirmar los datos; CONTADO·cobro exige el cobro confirmado (Diferencia 0). */
  const puedeContinuar =
    formaPago === 'CUENTA CORRIENTE'
      ? true
      : conTarjeta
        ? tarjetaConfirmada
        : cobro.confirmado

  return (
    <section className="view cobro-v2 paso-layout">
      {/* ZONA 1 · mismo encabezado que el resto de las etapas. */}
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={2} />

      <div className="paso-body">
        <PasoTitulo
          numero={3}
          titulo="Cobro"
          descripcion={
            formaPago === 'CUENTA CORRIENTE'
              ? 'Revisá cómo queda el saldo de la cuenta corriente del cliente con esta venta.'
              : conTarjeta
                ? 'Completá los datos de la tarjeta para registrar el cobro.'
                : 'Registrá el cobro de la venta para poder emitir la factura.'
          }
        />

        {/* Forma de pago CONTADO: se elige entre emitir una proforma o registrar el cobro. */}
        {formaPago === 'CONTADO' && (
          <div
            className="entrega-opts contado-tabs"
            role="radiogroup"
            aria-label="¿Qué querés hacer con este cobro de contado?"
          >
            <button
              type="button"
              className={`entrega-opt ${contadoTab === 'proforma' ? 'active' : ''}`}
              role="radio"
              aria-checked={contadoTab === 'proforma'}
              onClick={() => setContadoTab('proforma')}
            >
              <span className="entrega-opt-ic">
                <i className="fas fa-file-invoice" />
              </span>
              <span className="entrega-opt-txt">
                <span className="entrega-opt-l">EMITIR PROFORMA</span>
                <span className="entrega-opt-d">Generar y enviar una factura proforma</span>
              </span>
            </button>
            <button
              type="button"
              className={`entrega-opt ${contadoTab === 'cobro' ? 'active' : ''}`}
              role="radio"
              aria-checked={contadoTab === 'cobro'}
              onClick={() => setContadoTab('cobro')}
            >
              <span className="entrega-opt-ic">
                <i className="fas fa-hand-holding-dollar" />
              </span>
              <span className="entrega-opt-txt">
                <span className="entrega-opt-l">REGISTRAR COBRO</span>
                <span className="entrega-opt-d">Cobrar el 100% ahora (cobro simultáneo)</span>
              </span>
            </button>
          </div>
        )}

        {/* CONTADO · EMITIR PROFORMA: datos + emisión de la proforma, card resumen y envío a los
            contactos. La navegación (Volver / Continuar) vive en el pie de la etapa, no acá dentro. */}
        {formaPago === 'CONTADO' && contadoTab === 'proforma' && <CobroProforma />}

        {/* CUENTA CORRIENTE: sin "¿Desea registrar un cobro?". Sólo el "Impacto en cuenta
            corriente": cómo queda el saldo del cliente al registrarse la nueva deuda. */}
        {formaPago === 'CUENTA CORRIENTE' && <ImpactoCtaCte cliente={cliente} resumen={resumen} />}

        {/* Tarjeta: formulario de cobro (débito: Banco + Tipo; crédito: + Cuotas). */}
        {conTarjeta && (
          <CobroTarjeta
            tipo={tipoTarjetaDe(formaPago)}
            confirmada={tarjetaConfirmada}
            onConfirmar={() => setTarjetaConfirmada(true)}
          />
        )}

        {/* REGISTRAR COBRO. Bloque ESTÁTICO (ya no es acordeón), siempre visible. OCULTO para
            CUENTA CORRIENTE y tarjetas; en CONTADO, sólo bajo la pestaña "REGISTRAR COBRO". */}
        {formaPago !== 'CUENTA CORRIENTE' &&
          !conTarjeta &&
          (formaPago !== 'CONTADO' || contadoTab === 'cobro') && (
          <div className="cobro-static">
            <CabeceraCobro cliente={cliente} resumen={resumen} />

            <div className="cobro-card">
              <h3 className="cobro-card-title">Registrar cobro</h3>
              <p className="cobro-card-desc">Especificar cómo pagó el cliente</p>

              <FormularioCobro fechaFactura={fechaEmision} bloqueado={bloqueado} />

              <h4 className="cobro-card-sub">Cobros registrados ({balances.length})</h4>
              <TablaMovimientos balances={balances} bloqueado={bloqueado} />

              {/* Footer de la card: el botón de confirmación (la métrica TOTAL COBRADO ahora vive
                  arriba, junto a TOTAL VENTA y DIFERENCIA); a su derecha, el motivo que traba el
                  cobro si el total cobrado no llega al de la venta. */}
              <div className="cobro-card-acts">
                <button
                  type="button"
                  className="cobro-btn cobro-btn--primary"
                  disabled={!cobroCompleto || cobro.confirmado}
                  onClick={registrar}
                >
                  {cobro.confirmado ? (
                    <>
                      <i className="fas fa-check" /> Cobro confirmado
                    </>
                  ) : (
                    'Confirmar Cobro'
                  )}
                </button>
                {bloqueoMsg && (
                  <span className="cobro-bloqueo-inline">
                    <i className="fas fa-circle-exclamation" /> {bloqueoMsg}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Volver / Continuar viven SIEMPRE en el pie de la etapa, sin importar la rama elegida. */}
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
          {/* A la derecha: en EMITIR PROFORMA, "Guardar Venta" (a la izquierda del "Continuar", que
              queda deshabilitado). En el resto, sólo "Continuar". */}
          <div className="footer-acts-right">
            {enProforma && (
              <button
                type="button"
                className="cobro-btn cobro-btn--primary"
                onClick={() => setGuardando(true)}
                disabled={!proformaId}
                title={proformaId ? undefined : 'Emití la proforma para poder guardar la venta.'}
              >
                <i className="fas fa-floppy-disk" /> Guardar Venta
              </button>
            )}
            <button
              type="button"
              className="cobro-btn cobro-btn--primary"
              /* EMITIR PROFORMA no avanza a otra etapa: el botón se muestra pero queda inhabilitado. */
              disabled={enProforma || !puedeContinuar}
              title={
                enProforma
                  ? 'La venta con proforma se cierra con "Guardar Venta", no continúa a otra etapa.'
                  : puedeContinuar
                    ? undefined
                    : conTarjeta
                      ? 'Confirmá los datos de la tarjeta para continuar.'
                      : 'Registrá el cobro de la venta para poder emitir la factura.'
              }
              onClick={continuarAFactura}
            >
              {esEntregaPosterior
                ? 'Continuar a Entrega de Mercadería'
                : 'Continuar a Emitir factura'}{' '}
              <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>

        {bloqueo.modal}

        {/* Cierre de la venta con proforma: informa que quedó registrada y, al aceptar, limpia todo
            el estado global (vuelve al inicio). La factura se emitirá luego sobre esa proforma. */}
        {guardando && (
          <Modal
            title="Venta guardada"
            icon={<i className="fas fa-circle-check" style={{ color: 'var(--green)' }} />}
            onClose={() => setGuardando(false)}
            actions={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => dispatch({ type: 'reset' })}
              >
                Aceptar
              </button>
            }
          >
            La Proforma se registró en el sistema. Luego podrá emitir factura sobre esa proforma una
            vez cerrada la venta.
          </Modal>
        )}
      </div>
    </section>
  )
}
