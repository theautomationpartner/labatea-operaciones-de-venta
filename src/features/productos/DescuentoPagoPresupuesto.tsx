import { useApp, useDispatch } from '@/state/hooks'

/**
 * Leyenda de descuentos por forma de pago del PRESUPUESTO: una sola pregunta, con su check.
 *
 * NO aplica ningún descuento. Es lo único que hace: tildarla marca la casilla del ítem en Monday
 * (`boolean_mm6dnwf1`) y eso le avisa al PDF que tiene que incluir la leyenda de las formas de pago
 * bonificadas. Los precios del presupuesto salen SIEMPRE de lista, con el descuento manual de cada
 * línea y nada más.
 *
 * Antes acompañaba a un selector de Forma de Pago cuyo % de pronto pago mordía el precio unitario
 * de cada producto. Eso se retiró: el presupuesto no cotiza un precio bonificado, informa que hay
 * bonificaciones disponibles. El descuento real se decide y se aplica recién en la VENTA.
 */
/** `bloqueado`: presupuesto ya emitido en Monday; la pregunta no se toca. */
export function DescuentoPagoPresupuesto({ bloqueado = false }: { bloqueado?: boolean }) {
  const { descuentoPagoActivo } = useApp()
  const dispatch = useDispatch()

  return (
    <div className="forma-pago forma-pago--presup">
      <div className="cfgbox dpago-box dpago-box--solo">
        {/* Todo el renglón es el label: se tilda haciendo click en cualquier parte, no sólo en el
            cuadradito. */}
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
          <span className="dpago-check-txt">
            ¿Desea aplicar la leyenda de descuentos por forma de pago?
          </span>
        </label>
      </div>
    </div>
  )
}
