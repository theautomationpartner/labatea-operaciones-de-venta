import { addDays } from '@/lib/dates'
import { useApp } from '@/state/hooks'

/** Ícono de calendario del mockup, coloreado según el campo. */
function IconoCalendario({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

/**
 * Fechas del presupuesto. La emisión es el día de hoy; los días de vigencia salen de la
 * configuración de Monday y no se editan; el vencimiento es derivado (emisión + vigencia).
 */
export function DatosPresupuesto() {
  const { fechaEmision, diasVigencia } = useApp()

  const vencimiento = addDays(fechaEmision, diasVigencia)

  return (
    <div className="card budget-card no-radius">
      <h3>Datos del presupuesto</h3>

      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="fecha-emision">Fecha de emisión</label>
          <div className="input-wrapper">
            <IconoCalendario color="var(--c-primary)" />
            <input
              id="fecha-emision"
              type="text"
              className="form-control with-icon"
              value={fechaEmision}
              readOnly
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="dias-vigencia">Días de vigencia</label>
          <div className="input-wrapper">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--c-text-muted)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input
              id="dias-vigencia"
              type="text"
              className="form-control with-icon"
              style={{ color: 'var(--c-text-muted)' }}
              value={`${diasVigencia} días`}
              readOnly
              title="Definido en la configuración del sistema (Monday)"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="fecha-vencimiento">Fecha de vencimiento</label>
          <div className="input-wrapper">
            <IconoCalendario color="var(--c-success)" />
            <input
              id="fecha-vencimiento"
              type="text"
              className="form-control with-icon"
              style={{ color: 'var(--c-success)', fontWeight: 600 }}
              value={vencimiento}
              readOnly
            />
          </div>
        </div>
      </div>

      {/* La moneda del presupuesto es siempre pesos: se informa, no se elige. */}
      <div className="moneda-row">
        <div className="form-group">
          <label htmlFor="moneda">Moneda</label>
          <div className="input-wrapper">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--c-primary)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <input
              id="moneda"
              type="text"
              className="form-control with-icon"
              value="Pesos (ARS)"
              readOnly
            />
          </div>
        </div>
      </div>
    </div>
  )
}
