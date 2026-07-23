import type { ReactNode } from 'react'
import { estadoCtaCte, type ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'

interface ImpactoCtaCteProps {
  cliente: Cliente
  resumen: ResumenCobro
  /** Acción que cierra el paso (registrar el cobro), al pie y a la derecha de la card. */
  accion?: ReactNode
}

/**
 * Cómo queda la cuenta corriente del cliente después de esta venta y su cobro.
 *
 * Cierra el panel a todo su ancho porque es la consecuencia directa de lo que se carga
 * arriba: la venta engrosa el saldo pendiente y, con él, consume crédito disponible; lo que
 * se cobra ahora lo devuelve. Sin esto, un cliente con cuenta corriente no ve el efecto del
 * pago sobre su línea hasta después de facturar. La acción va adentro, pegada al número que
 * la justifica.
 */
export function ImpactoCtaCte({ cliente, resumen, accion }: ImpactoCtaCteProps) {
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
            <i className="fas fa-scale-balanced" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Límite de crédito</span>
            <span className="cobro-imp-num">{money(cta.limite)}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--gris">
            <i className="fas fa-wallet" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Saldo pendiente inicial</span>
            <span className="cobro-imp-num">{money(cta.saldoPendiente)}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--verde">
            <i className="fas fa-hand-holding-dollar" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Monto cancelado</span>
            <span className="cobro-imp-num cobro-imp-num--verde">{money(cta.cancelado)}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--azul">
            <i className="fas fa-file-invoice-dollar" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">SALDO RESULTANTE</span>
            <span className={`cobro-imp-num cobro-imp-num--total ${excedido ? 'is-over' : ''}`}>
              {money(cta.resultante)}
            </span>
          </div>
        </div>
      </div>

      {accion}
    </div>
  )
}
