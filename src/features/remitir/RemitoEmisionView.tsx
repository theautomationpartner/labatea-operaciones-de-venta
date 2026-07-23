import { Stepper } from '@/components/ui/Stepper'
import { NRO_REMITO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { SelectoresOperacion } from '@/features/shared/TopSelectors'
import { pasosDe } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import { RemitoPdf } from './RemitoPdf'
import { ResumenRemito } from './ResumenRemito'

/** Paso 4 de REMITO: resumen, PDF del remito y envío al cliente. */
export function RemitoEmisionView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, remito } = useApp()
  const dispatch = useDispatch()

  if (!cliente) return null

  return (
    <section className="view">
      <SelectoresOperacion />
      <Stepper
        steps={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        current={3}
        className="stepper--tight"
      />

      <div className="grow1 factura-grid">
        <ResumenRemito />
        <RemitoPdf />
      </div>

      {/* El estado del envío se muestra dentro de la propia card. */}
      <div className="grow2">
        <EnviarDocumento documento="remito" numero={NRO_REMITO} />
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          onClick={() => dispatch({ type: 'goto', paso: 'remito-envio' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
      </div>
    </section>
  )
}
