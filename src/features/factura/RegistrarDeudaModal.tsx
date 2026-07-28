import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { money } from '@/lib/format'
import { registrarDeudaPosterior } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

/**
 * Piso de tiempo que la ventana queda a la vista. La escritura en Monday suele volver antes de
 * que el ojo alcance a leer qué pasó; sin este piso el modal aparece y desaparece de un
 * parpadeo y la operación parece cerrarse sola.
 */
const MINIMO_VISIBLE_MS = 2000

interface RegistrarDeudaModalProps {
  cliente: Cliente
  /** Deuda a registrar: el total facturado de la venta, con IVA. */
  total: number
  /** Nombre del movimiento en la cuenta corriente (cliente y fecha). */
  concepto: string
  /** La deuda quedó escrita: la operación puede cerrarse. Recibe el id de la deuda recién creada
   *  ("Vta Pend de Cobro"), que la comisión de la venta enlaza en el cobro POSTERIOR. */
  onRegistrada: (deudaId: string) => void
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
 * No pide confirmación ni ofrece botones: montarlo ES la orden de registrar. "Finalizar
 * Operación" ya fue el clic del usuario, así que la escritura arranca sola y la ventana sólo
 * informa qué se está asentando y por cuánto. El resumen de la cuenta no se repite acá: vive
 * en el paso de cierre, donde el vendedor lo revisó antes de facturar.
 */
export function RegistrarDeudaModal({
  cliente,
  total,
  concepto,
  onRegistrada,
  onCancelar,
}: RegistrarDeudaModalProps) {
  const dispatch = useDispatch()
  const [error, setError] = useState<string | null>(null)
  /* La escritura se dispara una sola vez por montaje. El ref es imprescindible: en desarrollo
     StrictMode corre los efectos dos veces y, sin él, la deuda se escribiría duplicada. */
  const disparado = useRef(false)

  /* Montarse es el disparo: se escribe apenas aparece la ventana, sin paso intermedio.
     A propósito sin deps: son los datos de la venta que se está cerrando y no cambian
     mientras el modal vive; el ref es lo que garantiza una sola corrida. */
  useEffect(() => {
    if (disparado.current) return
    disparado.current = true

    const registrar = async () => {
      if (!cliente.ctaCteId) {
        setError(
          `${cliente.name} no tiene cuenta corriente conectada: no se puede registrar la deuda.`,
        )
        return
      }
      try {
        /* La espera mínima corre en paralelo con la escritura: no la demora, sólo evita que
           la ventana se cierre antes de poder leerla. */
        let nuevaDeudaId = ''
        await Promise.all([
          registrarDeudaPosterior({ ctaCteId: cliente.ctaCteId, total, concepto }).then(
            ({ deudaId, saldoAnterior }) => {
              nuevaDeudaId = deudaId
              dispatch({ type: 'confirmarCobro', deudaId, saldoAnterior })
            },
          ),
          new Promise((r) => setTimeout(r, MINIMO_VISIBLE_MS)),
        ])
        // El id de la deuda viaja al cierre: la comisión POSTERIOR lo enlaza como "Vta Pend de Cobro".
        onRegistrada(nuevaDeudaId)
      } catch {
        setError(
          'No se pudo registrar la deuda en la cuenta corriente. Cerrá este aviso y volvé a finalizar la operación.',
        )
      }
    }
    void registrar()
  })

  /* Falló la escritura: se avisa y se vuelve a la factura. Reintentar es volver a tocar
     "Finalizar Operación", que remonta esta ventana y dispara el registro de nuevo. */
  if (error) {
    return (
      <AvisoModal titulo="No se pudo registrar la deuda" onClose={onCancelar}>
        {error}
      </AvisoModal>
    )
  }

  return (
    <ModalCargando
      titulo="Registrando deuda..."
      detalle={`Estamos asentando ${money(total)} como deuda en la cuenta corriente de ${cliente.name}. Se crea el movimiento en su cuenta y la factura queda pendiente de cobro.`}
    />
  )
}
