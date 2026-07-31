import { type ReactNode } from 'react'
import { Stepper } from '@/components/ui/Stepper'
import { SelectoresOperacion } from '@/features/shared/TopSelectors'

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
 * Encabezado del paso: número, título y bajada. La salida de la operación ya no vive acá: el
 * cambio de operación se gestiona desde el selector superior, con su propia advertencia.
 */
export function PasoTitulo({ numero, titulo, descripcion }: PasoTituloProps) {
  return (
    <header className="header-section">
      <div className="step-indicator-main">
        <div className="step-badge-main">{numero}</div>
        <div className="step-details-main">
          <h1 className="step-title-main">{titulo}</h1>
          <p className="step-desc-main">{descripcion}</p>
        </div>
      </div>
    </header>
  )
}
