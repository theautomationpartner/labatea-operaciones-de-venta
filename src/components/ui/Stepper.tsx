import { Fragment, type ReactNode } from 'react'

interface StepperProps {
  steps: readonly string[]
  /** Índice del paso actual (0-based). Los anteriores se marcan como completados. */
  current: number
  className?: string
  /**
   * Índice MÁS AVANZADO alcanzado: sólo se puede navegar (clic) a pasos con índice ≤ este valor
   * (ya completados/validados). Los pasos futuros quedan bloqueados. Por defecto, el actual.
   */
  maxReached?: number
  /** Navegar al paso `index`. Sin este callback, el stepper no es interactivo. */
  onStep?: (index: number) => void
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

export function Stepper({ steps, current, className = '', maxReached, onStep }: StepperProps) {
  // Tope navegable: hasta el paso más avanzado alcanzado (o, si no se pasó, sólo hasta el actual).
  const limite = Math.max(maxReached ?? current, current)
  // Un paso es navegable si hay handler, no es el actual y ya fue alcanzado (≤ límite).
  const puedeIr = (i: number) => !!onStep && i !== current && i <= limite

  return (
    <div className={`stepper ${className}`}>
      {steps.map((label, i) => {
        const state = stateOf(i, current)
        const nav = puedeIr(i)
        // Los pasos futuros (no alcanzados) quedan bloqueados; el actual no navega (ya estás ahí).
        const bloqueado = !!onStep && i > limite
        return (
          <Fragment key={label}>
            <div
              className={`step ${state} ${nav ? 'step--nav' : ''} ${bloqueado ? 'step--locked' : ''}`}
              role={nav ? 'button' : undefined}
              tabIndex={nav ? 0 : undefined}
              aria-disabled={bloqueado || undefined}
              aria-current={state === 'cur' ? 'step' : undefined}
              title={bloqueado ? 'Completá los pasos anteriores para llegar a esta etapa.' : undefined}
              onClick={nav ? () => onStep!(i) : undefined}
              onKeyDown={
                nav
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onStep!(i)
                      }
                    }
                  : undefined
              }
            >
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
