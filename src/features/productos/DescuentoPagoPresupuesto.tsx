import { FORMAS_PAGO_PRESUPUESTO, descuentoDeFormaPago } from '@/lib/cobros'
import { useApp, useDispatch } from '@/state/hooks'
import type { FormaPagoVenta } from '@/types'

/**
 * Descuento por forma de pago del PRESUPUESTO. Va debajo del título y la descripción del paso de
 * selección de productos y es el equivalente del `FormaPagoSelect` de la VENTA, con una diferencia:
 * acá el descuento es OPCIONAL, así que primero hay que contestar la pregunta.
 *
 * La pregunta y el selector son UN SOLO control: viven dentro de la misma caja de configuración
 * (`cfgbox`), separados por una divisoria interna, porque uno no significa nada sin el otro. A la
 * izquierda la pregunta con su check cuadrado —nace apagada, el presupuesto sale a precios de
 * lista—; a la derecha el selector de Forma de Pago, que sólo se habilita con la pregunta
 * contestada que sí y no ofrece la CUENTA CORRIENTE, que no bonifica nada.
 *
 * Elegida la forma de pago, su % de pronto pago se aplica al PRECIO UNITARIO de cada producto —la
 * misma cascada que la venta (`lib/descuentos`)— y se refleja en la tabla, en el detalle de cada
 * línea y en el resumen del presupuesto.
 */
/** `bloqueado`: presupuesto ya emitido en Monday; ni la pregunta ni el selector se tocan. */
export function DescuentoPagoPresupuesto({ bloqueado = false }: { bloqueado?: boolean }) {
  const { formaPago, descuentoPagoActivo, descuentosPago } = useApp()
  const dispatch = useDispatch()
  // El selector sólo vive mientras la pregunta esté contestada que sí (y el presupuesto sin emitir).
  const habilitado = descuentoPagoActivo && !bloqueado
  /* Descuento por pronto pago de la forma elegida. Con la pregunta apagada no hay descuento que
     mostrar: el valor queda en "—", igual que cuando todavía no se eligió ninguna forma. */
  const descuento = descuentoDeFormaPago(formaPago, descuentosPago)
  const hayDescuento = descuentoPagoActivo && !!formaPago

  return (
    <div className="forma-pago forma-pago--presup">
      <div className="cfgbox dpago-box">
        {/* La pregunta y su check cuadrado. Toda la mitad izquierda es el label: se tilda haciendo
            click en cualquier parte de ella, no sólo en el cuadradito. */}
        <label className={`dpago-check ${bloqueado ? 'dpago-check--off' : ''}`}>
          <input
            type="checkbox"
            className="dpago-check-input"
            checked={descuentoPagoActivo}
            disabled={bloqueado}
            onChange={(e) => dispatch({ type: 'setDescuentoPagoActivo', value: e.target.checked })}
          />
          <span
            className={`dpago-check-box ${descuentoPagoActivo ? 'dpago-check-box--on' : ''}`}
            aria-hidden="true"
          >
            <i className="fas fa-check" />
          </span>
          <span className="dpago-check-txt">¿Desea aplicar descuentos por forma de pago?</span>
        </label>

        <span className="dpago-sep" aria-hidden="true" />

        {/* Mitad derecha: el selector, con el mismo ancho y los mismos estilos que en la VENTA.
            Sin la pregunta tildada se apaga en gris: es un control deshabilitado. */}
        <div className={`dpago-fp ${habilitado ? '' : 'dpago-fp--off'}`}>
          <div className="cfg-ic">
            <i className="fas fa-money-bill-wave" />
          </div>
          <div className="cfg-c">
            <label className="cfg-l" htmlFor="forma-pago-presup">
              Forma de pago
            </label>
            <select
              id="forma-pago-presup"
              className={`cfg-sel ${formaPago ? '' : 'cfg-sel--ph'}`}
              value={formaPago ?? ''}
              disabled={!habilitado}
              /* Sin la pregunta contestada el selector no es un destino de tabulación: es un
                 control inerte, no un campo que el usuario tenga que saltear. */
              tabIndex={habilitado ? undefined : -1}
              title={
                habilitado
                  ? undefined
                  : 'Tildá la pregunta para elegir una forma de pago y aplicar su descuento.'
              }
              onChange={(e) =>
                dispatch({ type: 'setFormaPago', value: e.target.value as FormaPagoVenta })
              }
            >
              <option value="" disabled>
                Seleccionar...
              </option>
              {FORMAS_PAGO_PRESUPUESTO.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Descuento (%) por producto que aplica la forma elegida. Reactivo, igual que en la venta. */}
      <div className="forma-pago-desc">
        <span className="forma-pago-desc-lbl">Descuento (%) x Producto</span>
        <span className="forma-pago-desc-val">{hayDescuento ? `${descuento}%` : '—'}</span>
      </div>

      {/* La aclaración sólo tiene sentido con la pregunta contestada que SÍ: con el check apagado
          no hay ningún descuento que se vaya a aplicar, y anunciarlo hace dudar de si el
          presupuesto sale a precios de lista o no. */}
      {descuentoPagoActivo && (
        <p className="forma-pago-nota">
          <i className="fas fa-circle-info" /> El descuento se aplicara al precio unitario por
          producto
        </p>
      )}
    </div>
  )
}
