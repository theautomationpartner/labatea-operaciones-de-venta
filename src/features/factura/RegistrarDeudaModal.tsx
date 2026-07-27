import { useEffect, useRef, useState } from 'react'
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
 * legal ya emitida.
 *
 * No pide confirmación: montarlo ES la orden de registrar. "Finalizar Operación" ya fue el
 * clic del usuario, así que la escritura arranca sola y la ventana sólo muestra el resumen de
 * la cuenta y en qué anda. Lo único que se ofrece es reintentar si Monday falló: sin eso, un
 * error dejaría la operación trabada sin salida.
 */
export function RegistrarDeudaModal({
  cliente,
  total,
  concepto,
  onRegistrada,
  onCancelar,
}: RegistrarDeudaModalProps) {
  const dispatch = useDispatch()
  const [registrando, setRegistrando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /* La escritura se dispara una sola vez por montaje. El ref es imprescindible: en desarrollo
     StrictMode corre los efectos dos veces y, sin él, la deuda se escribiría duplicada. */
  const disparado = useRef(false)

  // Cómo queda la cuenta con esta venta. Nada cancelado: la deuda entra entera.
  const cta = estadoCtaCte(cliente, total, 0)
  const excedido = cta.resultante > cta.limite

  const registrar = async () => {
    if (!cliente.ctaCteId) {
      setRegistrando(false)
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
      setRegistrando(false)
      setError('No se pudo registrar la deuda en la cuenta corriente. Reintentá en unos segundos.')
    }
  }

  /* Montarse es el disparo: se escribe apenas aparece la ventana, sin paso intermedio.
     A propósito sin deps de los datos: son los de la venta que se está cerrando y no cambian
     mientras el modal vive. */
  useEffect(() => {
    if (disparado.current) return
    disparado.current = true
    void registrar()
  })

  return (
    <Modal
      title="Registrando la deuda en cuenta corriente"
      icon={<i className="fas fa-file-invoice-dollar modal-icon--warn" />}
      // Mientras se escribe no se puede cerrar: es una operación que no conviene interrumpir.
      onClose={registrando ? () => {} : onCancelar}
      actions={
        error ? (
          <button type="button" className="btn btn-primary" onClick={registrar}>
            <i className="fas fa-rotate-right" /> Reintentar
          </button>
        ) : undefined
      }
    >
      <p>
        La factura de <strong>{cliente.name}</strong> ya está emitida y su condición de pago es{' '}
        <strong>{cliente.condicionPago}</strong> con cobro posterior: la venta queda asentada como
        deuda en su cuenta corriente.
      </p>

      {/* Resumen de la cuenta: cómo queda el saldo del cliente después de esta operación. */}
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

      {/* En qué anda la escritura. Ocupa el lugar de la botonera que antes pedía confirmar. */}
      {registrando && (
        <p className="modal-progreso" role="status" aria-live="polite">
          <i className="fas fa-circle-notch spin" /> Creando el movimiento en la cuenta corriente y
          su factura pendiente de cobro…
        </p>
      )}

      {error && <p className="modal-error">{error}</p>}
    </Modal>
  )
}
