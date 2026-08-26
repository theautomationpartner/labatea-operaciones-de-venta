import { EMISIONES_REMITO, EMISION_REMITO_LABEL } from '@/lib/pasos'
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
            {/* El `value` va explícito: la etiqueta que se lee ("DEVOLUCIÓN") no es el valor que
                viaja al estado ("DEVOLUCION"), y sin él el `option` usaría su texto. */}
            {EMISIONES_REMITO.map((t) => (
              <option key={t} value={t}>
                {EMISION_REMITO_LABEL[t]}
              </option>
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
            : remito.tipoEmision === 'ANTERIOR'
              ? 'Se remite mercadería de una venta ya facturada, pendiente de entregar.'
              : 'La mercadería vuelve del cliente: se imputa contra los remitos de entrega de los últimos 30 días, suma al stock y deja una nota de crédito pendiente de emitir.'}
        </div>
      )}
    </div>
  )
}
