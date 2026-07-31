import { Fragment, type ReactNode } from 'react'

interface StepperProps {
  steps: readonly string[]
  /** Índice del paso actual (0-based). Los anteriores se marcan como completados. */
  current: number
  className?: string
}

const stateOf = (index: number, current: number) =>
  index < current ? 'done' : index === current ? 'cur' : 'off'

/**
 * Une todas las palabras del nombre con espacios DE NO-QUIEBRE salvo la última: así, cuando el
 * texto no entra, el único salto de línea posible es antes de la última palabra (no en el medio).
 */
function etiquetaConSaltoUltima(label: string): ReactNode {
  const palabras = label.trim().split(/\s+/)
  if (palabras.length < 2) return label
  const inicio = palabras.slice(0, -1).join(' ')
  const ultima = palabras[palabras.length - 1]
  return `${inicio} ${ultima}`
}

export function Stepper({ steps, current, className = '' }: StepperProps) {
  return (
    <div className={`stepper ${className}`}>
      {steps.map((label, i) => {
        const state = stateOf(i, current)
        return (
          <Fragment key={label}>
            <div className={`step ${state}`}>
              <div className="sic">{state === 'done' ? <i className="fas fa-check" /> : i + 1}</div>
              <span>{etiquetaConSaltoUltima(label)}</span>
            </div>
            {/* La línea se rellena de verde cuando el tramo ya fue transitado. */}
            {i < steps.length - 1 && <div className={`sline ${i < current ? 'done' : ''}`} />}
          </Fragment>
        )
      })}
    </div>
  )
}
