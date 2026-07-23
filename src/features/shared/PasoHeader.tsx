import { useState, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Stepper } from '@/components/ui/Stepper'
import { SelectoresOperacion } from '@/features/shared/TopSelectors'
import { useDispatch } from '@/state/hooks'

interface PasoHeaderProps {
  pasos: readonly string[]
  /** Índice del paso en curso (0-based). */
  actual: number
}

/**
 * Barra de contexto del flujo: a la izquierda la operación y el vendedor (que valen para toda
 * la transacción) y a la derecha el avance por pasos, que ocupa el resto del ancho.
 */
export function PasoHeader({ pasos, actual }: PasoHeaderProps) {
  return (
    <header className="paso-header">
      <div className="paso-header-in">
        <div className="paso-header-sel">
          <SelectoresOperacion />
        </div>

        <div className="paso-header-steps">
          <Stepper steps={pasos} current={actual} className="stepper--tight" />
        </div>
      </div>
    </header>
  )
}

interface PasoTituloProps {
  /** Número del paso, el mismo que marca el stepper. */
  numero: number
  titulo: string
  descripcion: ReactNode
}

/**
 * Encabezado del paso: número, título y bajada, con la salida de la operación a la derecha.
 * Cancelar descarta lo cargado, así que pasa por una confirmación.
 */
export function PasoTitulo({ numero, titulo, descripcion }: PasoTituloProps) {
  const dispatch = useDispatch()
  const [confirmar, setConfirmar] = useState(false)

  return (
    <header className="header-section">
      <div className="step-indicator-main">
        <div className="step-badge-main">{numero}</div>
        <div className="step-details-main">
          <h1 className="step-title-main">{titulo}</h1>
          <p className="step-desc-main">{descripcion}</p>
        </div>

        <button type="button" className="btn-cancelar" onClick={() => setConfirmar(true)}>
          <i className="fas fa-xmark" /> Cancelar operación
        </button>
      </div>

      {confirmar && (
        <Modal
          title="¿Cancelar la operación?"
          icon={<i className="fas fa-triangle-exclamation modal-icon--warn" />}
          onClose={() => setConfirmar(false)}
          actions={
            <>
              <button type="button" className="btn btn-out" onClick={() => setConfirmar(false)}>
                Seguir con la carga
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setConfirmar(false)
                  dispatch({ type: 'reset' })
                }}
              >
                Sí, cancelar
              </button>
            </>
          }
        >
          ¿Estás seguro de cancelar este presupuesto? Se perderán los datos ingresados.
        </Modal>
      )}
    </header>
  )
}
