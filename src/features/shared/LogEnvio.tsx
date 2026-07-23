import { useApp } from '@/state/hooks'
import type { LogTipo } from '@/types'

const ICONO: Record<LogTipo, string> = { ok: '✓', err: '✕', info: 'i' }

export function LogEnvio() {
  const { log } = useApp()

  return (
    <div className="card log-card">
      <h3 className="ctitle">Log de envío</h3>
      {!log ? (
        <div className="log-empty">
          El log se generará al confirmar el envío del presupuesto.
        </div>
      ) : (
        <div className="timeline">
          {log.map((entry) => (
            <div className="tli" key={entry.id}>
              <div className={`tlic i-${entry.tipo}`}>{ICONO[entry.tipo]}</div>
              <div className="tlc">
                <h4>{entry.titulo}</h4>
                <p>{entry.detalle}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
