import { ENTREGAS } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import type { TipoEntrega, TipoVenta } from '@/types'

const TIPOS_VENTA: TipoVenta[] = ['CON PRESUPUESTO PREVIO', 'DIRECTA']

/** Configuración exclusiva de CARGAR VENTA. Nada viene preseleccionado. */
export function VentaConfig() {
  const { tipoVenta, tipoEntrega } = useApp()
  const dispatch = useDispatch()

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
          {/* Las tres entregas valen para cualquier tipo de venta. */}
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
            {ENTREGAS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
