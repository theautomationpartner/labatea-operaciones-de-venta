import { EMISIONES_REMITO } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import type { TipoEmisionRemito } from '@/types'

/** Configuración exclusiva de REMITO: el tipo de emisión define de dónde salen los productos. */
export function RemitoConfig() {
  const { remito } = useApp()
  const dispatch = useDispatch()

  return (
    <div className="venta-cfg">
      <div className="cfgbox">
        <div className="cfg-ic">
          <i className="fas fa-truck-ramp-box" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">La venta es...</div>
          <select
            className={`cfg-sel ${remito.tipoEmision ? '' : 'cfg-sel--ph'}`}
            value={remito.tipoEmision ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setTipoEmisionRemito',
                value: e.target.value as TipoEmisionRemito,
              })
            }
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {EMISIONES_REMITO.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Aclara el efecto de cada emisión: es la decisión que ramifica todo el flujo. */}
      {remito.tipoEmision && (
        <div className="cfg-hint">
          <i className="fas fa-circle-info" />
          {remito.tipoEmision === 'POSTERIOR'
            ? 'Se remite mercadería que quedará pendiente de facturar.'
            : 'Se remite mercadería de una venta ya facturada, pendiente de entregar.'}
        </div>
      )}
    </div>
  )
}
