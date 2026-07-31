import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { pasosDe } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import { EntregaCierreVenta } from './EntregaCierreVenta'

/**
 * Etapa "Entrega de Mercadería" de la VENTA. Sólo se llega con entrega POSTERIOR: es donde se
 * elige quién entrega (La Batea / Comisionista / Cliente) y, si es La Batea, su ruta. Antes vivía
 * dentro de "Logística y Cobros"; ahora es una etapa propia del wizard.
 */
export function EntregaView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, entregaVenta } = useApp()
  const dispatch = useDispatch()

  if (!cliente) return null

  const pasos = pasosDe(operacion, tipoVenta, tipoEntrega)
  const actual = Math.max(pasos.indexOf('Entrega de Mercadería'), 0)

  /* Guardrail: con La Batea no se avanza hasta seleccionar y confirmar una Ruta de Entrega. */
  const faltaRutaLaBatea =
    entregaVenta.responsable === 'LA_BATEA' && !entregaVenta.rutaConfirmada

  return (
    <section className="view cobro-v2 paso-layout">
      <PasoHeader pasos={pasos} actual={actual} />

      <div className="paso-body">
        <PasoTitulo
          numero={actual + 1}
          titulo="Entrega de Mercadería"
          descripcion="Indicá quién entrega la mercadería de la venta y, si entrega La Batea, su ruta."
        />

        <EntregaCierreVenta />

        <div className="footer-acts">
          <button
            type="button"
            className="cobro-btn cobro-btn--out"
            onClick={() => dispatch({ type: 'goto', paso: 'cobro' })}
          >
            <i className="fas fa-arrow-left" /> Volver a paso anterior
          </button>
          <button
            type="button"
            className="cobro-btn cobro-btn--primary"
            disabled={faltaRutaLaBatea}
            title={faltaRutaLaBatea ? 'Confirmá la Ruta de Entrega para continuar.' : undefined}
            onClick={() => dispatch({ type: 'goto', paso: 'factura' })}
          >
            Continuar a Emitir factura <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>
    </section>
  )
}
