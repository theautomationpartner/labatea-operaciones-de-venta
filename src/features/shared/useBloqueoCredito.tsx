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
   * Chequeo previo a crear, emitir, enviar o CONTINUAR. Devuelve `true` si frenó la acción (y ya
   * dejó la ventana emergente en pantalla); `false` si se puede seguir. Se usa como guarda:
   * `if (frenar()) return`.
   *
   * Con `avisarSiempre` (el botón de continuar) el modal salta aunque la operación no frene: así
   * el presupuesto muestra el aviso al continuar pero igual avanza, y la venta avisa y frena.
   */
  frenar: (opciones?: { avisarSiempre?: boolean }) => boolean
  /** La ventana de aviso. Hay que montarla en la vista para que se vea. */
  modal: ReactNode
  /** El importe en curso no entra en la línea del cliente. */
  excedido: boolean
}

interface OpcionesBloqueo {
  /**
   * Estrategia según el comprobante. `true` (VENTA): al excederse el crédito, `frenar` frena la
   * operación. `false` (PRESUPUESTO): el exceso se avisa (si se pide), pero NO frena —se puede
   * guardar igual—. Un cliente bloqueado siempre frena, sea cual sea el comprobante.
   */
  bloqueante?: boolean
}

/**
 * Bloqueo de la operación por crédito. Dos motivos lo disparan: un cliente bloqueado en el
 * board, o un importe que se pasa del crédito disponible. La estrategia frente al exceso de
 * crédito se desacopla por comprobante (ver `bloqueante`): la venta frena, el presupuesto sólo
 * avisa. El cálculo del crédito vive centralizado en `@/lib/credito`; acá sólo se orquesta el
 * aviso y el freno, que se disparan al invocar `frenar` (típicamente en el botón de continuar).
 *
 * `importe` es lo que la operación va a consumir de la línea. Si el crédito no rige para este
 * cliente (contado, o liberado sin crédito) nunca frena ni avisa por importe: no hay tope.
 */
export function useBloqueoCredito(
  importe: number,
  { bloqueante = true }: OpcionesBloqueo = {},
): BloqueoCredito {
  const { cliente } = useApp()
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null)

  const excedido = excedeCredito(cliente, importe)

  const frenar = ({ avisarSiempre = false }: { avisarSiempre?: boolean } = {}): boolean => {
    if (!cliente) return false
    if (clienteBloqueado(cliente)) {
      setAviso({ titulo: 'Cliente bloqueado', texto: MENSAJE_CLIENTE_BLOQUEADO })
      return true
    }
    if (excedeCredito(cliente, importe)) {
      // Se avisa si la operación frena (venta) o si el llamador pide avisar igual (el botón de
      // continuar del presupuesto: muestra el modal, pero deja avanzar).
      if (bloqueante || avisarSiempre) {
        setAviso({
          titulo: 'Límite de crédito alcanzado',
          texto: mensajeCreditoExcedido(cliente, importe),
        })
      }
      return bloqueante
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
