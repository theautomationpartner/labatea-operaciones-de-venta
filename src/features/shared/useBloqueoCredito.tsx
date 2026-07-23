import { useState, type ReactNode } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import {
  clienteBloqueado,
  excedeCredito,
  MENSAJE_CLIENTE_BLOQUEADO,
  mensajeCreditoExcedido,
} from '@/lib/credito'
import { useApp } from '@/state/hooks'

interface BloqueoCredito {
  /**
   * Chequeo previo a crear, emitir o enviar. Devuelve `true` si frenó la acción (y ya dejó
   * la ventana emergente en pantalla); `false` si se puede seguir. Se usa como guarda:
   * `if (frenar()) return`.
   */
  frenar: () => boolean
  /** La ventana de aviso. Hay que montarla en la vista para que se vea. */
  modal: ReactNode
  /** El importe en curso no entra en la línea del cliente. */
  excedido: boolean
}

/**
 * Bloqueo de la operación por crédito. Dos motivos lo disparan: un cliente bloqueado en el
 * board, o un importe que se pasa del crédito disponible. Vale para cualquier punto que cree,
 * emita o envíe: la regla es la misma y el aviso también.
 *
 * `importe` es lo que la operación va a consumir de la línea. Si el crédito no rige para este
 * cliente (contado, o liberado sin crédito) nunca frena por importe: no hay tope que superar.
 */
export function useBloqueoCredito(importe: number): BloqueoCredito {
  const { cliente } = useApp()
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null)

  const excedido = excedeCredito(cliente, importe)

  const frenar = (): boolean => {
    if (!cliente) return false
    if (clienteBloqueado(cliente)) {
      setAviso({ titulo: 'Cliente bloqueado', texto: MENSAJE_CLIENTE_BLOQUEADO })
      return true
    }
    if (excedeCredito(cliente, importe)) {
      setAviso({
        titulo: 'Límite de crédito alcanzado',
        texto: mensajeCreditoExcedido(cliente, importe),
      })
      return true
    }
    return false
  }

  const modal = aviso ? (
    <AvisoModal titulo={aviso.titulo} onClose={() => setAviso(null)}>
      {aviso.texto}
    </AvisoModal>
  ) : null

  return { frenar, modal, excedido }
}
