interface ProgressBarProps {
  percent: number
  color?: string
  className?: string
}

export function ProgressBar({ percent, color = 'var(--green)', className = '' }: ProgressBarProps) {
  return (
    <div className={`pbar ${className}`}>
      <div
        className="pfill"
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%`, background: color }}
      />
    </div>
  )
}
