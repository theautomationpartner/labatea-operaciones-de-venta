interface DonutProps {
  percent: number
  color: string
  label: string
  caption: string
}

/** Anillo de progreso resuelto con conic-gradient (sin librería de charts). */
export function Donut({ percent, color, label, caption }: DonutProps) {
  return (
    <div className="donut">
      <div
        className="circle"
        style={{ background: `conic-gradient(${color} ${percent}%, var(--border) 0)` }}
        role="img"
        aria-label={`${label}: ${percent}%`}
      >
        <div className="circle-in">
          <div className="circle-v" style={{ color }}>
            {percent}%
          </div>
          <div className="circle-l">{label}</div>
        </div>
      </div>
      <div className="prog-txt">{caption}</div>
    </div>
  )
}
