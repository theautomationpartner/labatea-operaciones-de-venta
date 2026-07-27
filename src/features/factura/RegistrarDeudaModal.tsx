import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { estadoCtaCte } from '@/lib/cobros'
import { money } from '@/lib/format'
import { registrarDeudaPosterior } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

interface RegistrarDeudaModalProps {
  cliente: Cliente
  /** Deuda a registrar: el total facturado de la venta, con IVA. */
  total: number
  /** Nombre del movimiento en la cuenta corriente (cliente y fecha). */
  concepto: string
  /** La deuda quedó escrita: la operación puede cerrarse. */
  onRegistrada: () => void
  /** Se cierra sin registrar: la operación NO se cierra y el vendedor sigue en la factura. */
  onCancelar: () => void
}

/**
 * Registro de la deuda en la cuenta corriente, al finalizar la operación.
 *
 * Sólo se monta cuando la venta va a cuenta corriente con pago POSTERIOR (ver
 * `requiereRegistroDeuda`): la deuda no nace con el pedido sino recién acá, con la factura
 * legal ya emitida y enviada. Escribe el movimiento en la Cta Cte del cliente y su factura
 * pendiente de cobro; hasta que eso salga bien, la operación no se cierra.
 */
export function RegistrarDeudaModal({
  cliente,
  total,
  concepto,
  onRegistrada,
  onCancelar,
}: RegistrarDeudaModalProps) {
  const dispatch = useDispatch()
  const [registrando, setRegistrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cómo queda la cuenta con esta venta. Nada cancelado: la deuda entra entera.
  const cta = estadoCtaCte(cliente, total, 0)
  const excedido = cta.resultante > cta.limite

  const registrar = async () => {
    if (registrando) return
    if (!cliente.ctaCteId) {
      setError(
        `${cliente.name} no tiene cuenta corriente conectada: no se puede registrar la deuda.`,
      )
      return
    }
    setRegistrando(true)
    setError(null)
    try {
      const { deudaId, saldoAnterior } = await registrarDeudaPosterior({
        ctaCteId: cliente.ctaCteId,
        total,
        concepto,
      })
      dispatch({ type: 'confirmarCobro', deudaId, saldoAnterior })
      onRegistrada()
    } catch {
      setError('No se pudo registrar la deuda en la cuenta corriente. Reintentá en unos segundos.')
    } finally {
      setRegistrando(false)
    }
  }

  return (
    <Modal
      title="Registrar la deuda en cuenta corriente"
      icon={<i className="fas fa-file-invoice-dollar modal-icon--warn" />}
      onClose={registrando ? () => {} : onCancelar}
      actions={
        <>
          <button
            type="button"
            className="btn btn-out"
            disabled={registrando}
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={registrando}
            aria-busy={registrando}
            onClick={registrar}
          >
            {registrando ? (
              <>
                <i className="fas fa-circle-notch spin" /> Registrando…
              </>
            ) : (
              'Registrar deuda y finalizar'
            )}
          </button>
        </>
      }
    >
      <p>
        La factura de <strong>{cliente.name}</strong> se emitió y se envió, y su condición de pago
        es <strong>{cliente.condicionPago}</strong> con cobro posterior. Para cerrar la operación
        hay que asentar la deuda en su cuenta corriente.
      </p>

      <ul className="modal-datos">
        <li>
          <span>N° de cuenta</span>
          <strong>{cta.cuenta}</strong>
        </li>
        <li>
          <span>Deuda a registrar</span>
          <strong>{money(total)}</strong>
        </li>
        <li>
          <span>Saldo pendiente actual</span>
          <strong>{money(cta.saldoPendiente)}</strong>
        </li>
        <li>
          <span>Saldo resultante</span>
          <strong className={excedido ? 'is-over' : undefined}>{money(cta.resultante)}</strong>
        </li>
      </ul>

      {excedido && (
        <p className="modal-nota">
          <i className="fas fa-circle-exclamation" /> El saldo resultante supera el límite de
          crédito ({money(cta.limite)}).
        </p>
      )}

      {error && <p className="modal-error">{error}</p>}
    </Modal>
  )
}
