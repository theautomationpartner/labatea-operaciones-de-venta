import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { Modal } from '@/components/ui/Modal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import {
  SIN_DESCUENTOS_PAGO,
  balancePagos,
  cobroSimultaneoOperacion,
  descuentoDeFormaPago,
  diferenciaCobro,
  esPagoConTarjeta,
  resumenCobro,
  tipoTarjetaDe,
} from '@/lib/cobros'
import { indiceDePaso, pasoDeProductos, pasoTrasCobro, pasosDe } from '@/lib/pasos'
import { totalVentaOperacion } from '@/lib/selectors'
import { useApp, useDispatch } from '@/state/hooks'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { CabeceraCobro } from './CabeceraCobro'
import { CobroProforma } from './CobroProforma'
import { CobroTarjetas } from './CobroTarjetas'
import { ImpactoCtaCte } from './ImpactoCtaCte'
import { FormularioCobro } from './FormularioCobro'
import { TablaMovimientos } from './TablaMovimientos'

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
  const { cliente, operacion, tipoVenta, tipoEntrega, cobro, formaPago, proformaId } = state
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
  /* Neto (base del crédito) y TOTAL con IVA de la venta. Sale de `totalVentaOperacion`, el MISMO
     selector que usa el cierre para el importe que se adeuda y el que viaja al recibo: así la
     métrica "TOTAL VENTA" de esta card y lo que se escribe en el board no pueden divergir. */
  const { neto: netoVenta, total: totalVenta } = useMemo(
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
        descFormaPago,
      }),
    [
      cliente,
      operacion,
      tipoVenta,
      tipoEntrega,
      state.lineas,
      state.ventaItems,
      state.facturaItems,
      state.proformaImporte,
      descFormaPago,
    ],
  )

  /* El cobro de contado NO aplica descuentos por medio de pago: lo cobrado es el importe cargado,
     y "Total Cobrado" debe dar exactamente el total de la venta (Diferencia 0) para avanzar. */
  const balances = useMemo(
    () => balancePagos(cobro.movimientos, SIN_DESCUENTOS_PAGO),
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
      cobroSimultaneoOperacion(formaPago) &&
      !mismoImporte(resumen.cancelado, resumen.totalACobrar)
    ) {
      dispatch({ type: 'desconfirmarCobro' })
    }
  }, [cliente, cobro.confirmado, formaPago, resumen.cancelado, resumen.totalACobrar, dispatch])
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
  /* Modal de cierre de la venta con proforma (Guardar Venta): al aceptar limpia todo el estado. */
  const [guardando, setGuardando] = useState(false)
  /* Aviso al intentar continuar con la diferencia sin cancelar: falta cobrar (>0) o se cobró de más (<0). */
  const [avisoDif, setAvisoDif] = useState<'falta' | 'exceso' | null>(null)

  if (!cliente) return null

  /* El cobro cierra cuando lo cobrado (sin descuentos) iguala el total de la venta SIN considerar
     los centavos. Es la validación para poder avanzar. */
  const cobroCompleto =
    cobro.movimientos.length > 0 && mismoImporte(resumen.cancelado, resumen.totalACobrar)
  /* Diferencia entre lo que hay que cobrar y lo cargado, SIN recortar: >0 falta cobrar, <0 se cobró
     de más. Es la métrica DIFERENCIA de la cabecera. */
  const restante = diferenciaCobro(resumen)
  /* TARJETA: la única condición para avanzar es que la DIFERENCIA sea exactamente 0. No se tolera
     ni de menos ni de más, y tampoco el redondeo de un peso que sí acepta el contado. */
  const tarjetaCobrada = restante === 0 && cobro.movimientos.length > 0
  /* Motivo por el que el cobro todavía no cierra (hint en vivo dentro de la card). */
  const bloqueoMsg =
    cobro.movimientos.length > 0 && !cobroCompleto
      ? restante < 0
        ? 'El total cobrado supera el total de la venta: ajustá los importes para no cobrar de más.'
        : 'El total cobrado debe igualar el total de la venta (sin contar los centavos).'
      : null
  /* El responsable logístico (y su ruta) se pregunta SÓLO en la entrega POSTERIOR. */
  const esEntregaPosterior = tipoEntrega === 'POSTERIOR'

  /* Avanzar es una transición de UI local y 100% silenciosa: la venta NO se crea acá, su creación
     se traslada al "Finalizar Operación". Con entrega POSTERIOR se pasa antes por "Entrega de
     Mercadería"; si no, directo a la factura. */
  const continuarAFactura = () => {
    dispatch({ type: 'goto', paso: pasoTrasCobro(tipoEntrega) })
  }

  /* Ya no hay botón "Confirmar cobro": el registro de cobros queda SIEMPRE editable durante la
     etapa (importes y movimientos). La confirmación se hace implícita al continuar, recién cuando
     la diferencia es 0. */
  const bloqueado = false

  /* CONTADO·EMITIR PROFORMA no continúa a otra etapa: la venta se cierra ahí mismo con "Guardar
     Venta" (dentro de CobroProforma), que limpia el estado. Por eso el pie no ofrece "Continuar". */
  const enProforma = formaPago === 'CONTADO' && contadoTab === 'proforma'

  /**
   * Continuar a la etapa siguiente. En CONTADO·cobro se VALIDA que la diferencia sea 0 (sin
   * centavos): si falta cobrar (>0) o se cobró de más (<0) se avisa por modal y no se avanza. Recién
   * con la diferencia en 0 se confirma el cobro (para el registro diferido) y se avanza.
   */
  const continuar = () => {
    if (enProforma) return
    if (formaPago === 'CUENTA CORRIENTE') {
      if (bloqueo.frenar()) return
      continuarAFactura()
      return
    }
    /* TARJETA: sólo se avanza con la diferencia en CERO exacto. El botón ya está deshabilitado,
       pero la guarda queda igual para que ningún dato incompleto pase a la etapa siguiente.
       El tipo de cobro NO se toca acá: la tarjeta es POSTERIOR por su forma de pago (se acredita
       después), y eso lo decide `tipoPagoOperacion`, no esta vista. */
    if (conTarjeta) {
      if (!tarjetaCobrada) {
        setAvisoDif(restante < 0 ? 'exceso' : 'falta')
        return
      }
      dispatch({ type: 'confirmarCobro' })
      continuarAFactura()
      return
    }
    // CONTADO · REGISTRAR COBRO: la diferencia tiene que estar cancelada al 100%.
    if (!cobroCompleto) {
      setAvisoDif(restante < 0 ? 'exceso' : 'falta')
      return
    }
    if (bloqueo.frenar()) return
    dispatch({ type: 'confirmarCobro' })
    continuarAFactura()
  }

  /* El botón "Continuar" queda clickeable en CONTADO·cobro (valida al hacer click) y en cuenta
     corriente; con TARJETA queda estrictamente bloqueado hasta que la diferencia sea 0; en EMITIR
     PROFORMA, inhabilitado. */
  const continuarDeshabilitado = enProforma || (conTarjeta && !tarjetaCobrada)

  return (
    <section className="view cobro-v2 paso-layout">
      {/* ZONA 1 · mismo encabezado que el resto de las etapas. */}
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={indiceDePaso('cobro', operacion, tipoVenta, tipoEntrega)} />

      <div className="paso-body">
        <PasoTitulo
          numero={indiceDePaso('cobro', operacion, tipoVenta, tipoEntrega) + 1}
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

        {/* TARJETA: cabecera de métricas + carga de tarjetas + tabla de movimientos. Sin botón de
            confirmar: cierra cuando la DIFERENCIA llega a 0. */}
        {conTarjeta && (
          <CobroTarjetas
            cliente={cliente}
            tipo={tipoTarjetaDe(formaPago)}
            resumen={resumen}
            balances={balances}
            diferencia={restante}
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

              {/* El cliente viaja entero: su CUIT y su "Recibimos CHEQUE" validan cada cheque. */}
              <FormularioCobro cliente={cliente} bloqueado={bloqueado} />

              <h4 className="cobro-card-sub">Cobros registrados ({balances.length})</h4>
              <TablaMovimientos balances={balances} bloqueado={bloqueado} />

              {/* Sin botón "Confirmar cobro": la diferencia se valida al Continuar. Acá sólo se avisa
                  en vivo si el total cobrado todavía no iguala el de la venta (falta o se cobró de más). */}
{/* El renglón del aviso va SIEMPRE montado, con o sin mensaje: su alto está reservado por
                  CSS, así que completar el cobro hace desaparecer el texto sin que la card pegue un
                  salto. Montarlo condicionalmente le sacaba ~65px de golpe (el renglón más su
                  separación con la tabla).
                  Al estar siempre presente puede ser una región viva de verdad: el lector de
                  pantalla anuncia el aviso cuando aparece, cosa que con el montaje condicional no
                  pasaba. */}
              <div className="cobro-card-acts">
                <span className="cobro-bloqueo-inline" role="status" aria-live="polite">
                  {bloqueoMsg && (
                    <>
                      <i className="fas fa-circle-exclamation" /> {bloqueoMsg}
                    </>
                  )}
                </span>
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
              /* EMITIR PROFORMA no avanza; con tarjeta el avance queda bloqueado hasta que la
                 diferencia sea 0. CONTADO·cobro queda clickeable: la diferencia se valida al hacer
                 click (modal si no está en 0). */
              disabled={continuarDeshabilitado}
              title={
                enProforma
                  ? 'La venta con proforma se cierra con "Guardar Venta", no continúa a otra etapa.'
                  : conTarjeta && !tarjetaCobrada
                    ? 'La DIFERENCIA tiene que quedar en $ 0 para continuar: cargá o ajustá las tarjetas.'
                    : undefined
              }
              onClick={continuar}
            >
              {esEntregaPosterior
                ? 'Continuar a Entrega de Mercadería'
                : 'Continuar a Emitir factura'}{' '}
              <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>

        {bloqueo.modal}

        {/* Diferencia sin cancelar: no se puede avanzar hasta cobrar el 100% exacto de la venta. */}
        {avisoDif && (
          <AvisoModal
            titulo="No se puede continuar todavía"
            onClose={() => setAvisoDif(null)}
          >
            {avisoDif === 'falta'
              ? 'Para continuar tenés que cancelar el 100% de la diferencia: registrá o ajustá los importes hasta que el total cobrado iguale el total de la venta.'
              : 'Ajustá los importes ingresados para no cobrar de más: el total cobrado supera el total de la venta.'}
          </AvisoModal>
        )}

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
