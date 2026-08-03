import { formasPagoDeCliente } from '@/lib/cobros'
import { useApp, useDispatch } from '@/state/hooks'
import type { FormaPagoVenta } from '@/types'

/**
 * Selector de "Forma de Pago" de la VENTA. Va debajo del título y la descripción del paso de
 * selección de productos, y define el ramal del cobro.
 *
 * Se elige de una sola vez: débito y crédito son formas de pago independientes, no un subtipo
 * de "tarjetas", así que ya no hay un segundo selector de tipo. Comparte la caja de
 * configuración (`cfgbox`) del paso de cliente, así el control se lee igual en toda la app.
 */
/** `bloqueado`: post-emisión, el selector queda deshabilitado (no se cambia la forma de pago). */
export function FormaPagoSelect({ bloqueado = false }: { bloqueado?: boolean }) {
  const { formaPago, cliente } = useApp()
  const dispatch = useDispatch()
  // Las opciones dependen de la condición de pago del cliente: sólo la cuenta corriente las habilita
  // todas; el resto opera únicamente de contado.
  const opciones = formasPagoDeCliente(cliente?.condicionPago)

  return (
    <div className="forma-pago">
      <div className="cfgbox">
        <div className="cfg-ic">
          <i className="fas fa-money-bill-wave" />
        </div>
        <div className="cfg-c">
          <label className="cfg-l" htmlFor="forma-pago">
            Forma de pago
          </label>
          <select
            id="forma-pago"
            className={`cfg-sel ${formaPago ? '' : 'cfg-sel--ph'}`}
            value={formaPago ?? ''}
            disabled={bloqueado}
            onChange={(e) =>
              dispatch({ type: 'setFormaPago', value: e.target.value as FormaPagoVenta })
            }
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {opciones.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
