import { Fragment } from 'react'

interface StepperProps {
  steps: readonly string[]
  /** Índice del paso actual (0-based). Los anteriores se marcan como completados. */
  current: number
  className?: string
}

const stateOf = (index: number, current: number) =>
  index < current ? 'done' : index === current ? 'cur' : 'off'

export function Stepper({ steps, current, className = '' }: StepperProps) {
  return (
    <div className={`stepper ${className}`}>
      {steps.map((label, i) => {
        const state = stateOf(i, current)
        return (
          <Fragment key={label}>
            <div className={`step ${state}`}>
              <div className="sic">{state === 'done' ? <i className="fas fa-check" /> : i + 1}</div>
              <span>{label}</span>
            </div>
            {/* La línea se rellena de verde cuando el tramo ya fue transitado. */}
            {i < steps.length - 1 && <div className={`sline ${i < current ? 'done' : ''}`} />}
          </Fragment>
        )
      })}
    </div>
  )
}
