import { ENTREGAS } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import type { TipoEntrega, TipoVenta } from '@/types'

const TIPOS_VENTA: TipoVenta[] = ['CON PRESUPUESTO PREVIO', 'DIRECTA']

/** Configuración exclusiva de CARGAR VENTA. Nada viene preseleccionado. */
export function VentaConfig() {
  const { tipoVenta, tipoEntrega } = useApp()
  const dispatch = useDispatch()

  /* La entrega ANTERIOR es de uso EXCLUSIVO de la venta DIRECTA: una venta que nace de un
     presupuesto nunca pudo tener mercadería entregada antes de emitirse. Con "CON PRESUPUESTO
     PREVIO" elegido, esa opción ni siquiera se ofrece. */
  const entregasDisponibles =
    tipoVenta === 'CON PRESUPUESTO PREVIO' ? ENTREGAS.filter((t) => t !== 'ANTERIOR') : ENTREGAS

  return (
    <div className="venta-cfg">
      <div className="cfgbox">
        <div className="cfg-ic">
          <i className="fas fa-tag" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">Tipo de venta</div>
          <select
            className={`cfg-sel ${tipoVenta ? '' : 'cfg-sel--ph'}`}
            value={tipoVenta ?? ''}
            onChange={(e) => dispatch({ type: 'setTipoVenta', value: e.target.value as TipoVenta })}
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {TIPOS_VENTA.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="cfgbox">
        <div className="cfg-ic">
          <i className="fas fa-truck" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">Tipo de entrega</div>
          {/* CON PRESUPUESTO PREVIO no ofrece la entrega ANTERIOR: sólo posterior/simultánea. */}
          <select
            className={`cfg-sel ${tipoEntrega ? '' : 'cfg-sel--ph'}`}
            value={tipoEntrega ?? ''}
            disabled={!tipoVenta}
            onChange={(e) =>
              dispatch({ type: 'setTipoEntrega', value: e.target.value as TipoEntrega })
            }
          >
            <option value="" disabled>
              {tipoVenta ? 'Seleccionar...' : 'Elegí el tipo de venta'}
            </option>
            {entregasDisponibles.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
