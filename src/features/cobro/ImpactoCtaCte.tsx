import { estadoCtaCte, type ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'

interface ImpactoCtaCteProps {
  cliente: Cliente
  resumen: ResumenCobro
}

/**
 * Cómo queda la cuenta corriente del cliente después de esta venta.
 *
 * Se monta sólo en el camino que deja deuda —cuenta corriente sin cobro en el acto, ver
 * `mostrarImpactoCtaCte`—, así que lee de corrido: de dónde parte la cuenta, cuánto le suma
 * esta venta y en cuánto queda. La deuda va en verde porque es el número que el vendedor tiene
 * que reconocer antes de cerrar: es lo que se va a asentar en la cuenta del cliente.
 */
export function ImpactoCtaCte({ cliente, resumen }: ImpactoCtaCteProps) {
  const cta = estadoCtaCte(cliente, resumen.totalACobrar, resumen.cancelado)
  // Pasarse del límite es el dato que hay que ver de un vistazo.
  const excedido = cta.resultante > cta.limite

  return (
    <div className="cobro-imp">
      <h3 className="cobro-imp-title">Impacto en cuenta corriente</h3>

      <div className="cobro-imp-row">
        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--gris">
            <i className="fas fa-id-card" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">N° de cuenta</span>
            <span className="cobro-imp-num">{cta.cuenta}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--gris">
            <i className="fas fa-wallet" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Saldo actual</span>
            <span className="cobro-imp-num">{money(cta.saldoPendiente)}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        {/* La deuda que genera esta venta: rótulo y valor en verde. */}
        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--verde">
            <i className="fas fa-file-invoice-dollar" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl cobro-cab-lbl--verde">Deuda</span>
            <span className="cobro-imp-num cobro-imp-num--verde">
              {money(resumen.totalACobrar)}
            </span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--azul">
            <i className="fas fa-scale-balanced" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">SALDO RESULTANTE</span>
            <span className={`cobro-imp-num cobro-imp-num--total ${excedido ? 'is-over' : ''}`}>
              {money(cta.resultante)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
