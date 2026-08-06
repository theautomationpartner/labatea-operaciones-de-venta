import { useState } from 'react'
import { useBancosEmisores } from './useBancosEmisores'

/** Valor centinela de la opción que abre el alta de un banco nuevo. */
const OPCION_NUEVO = '__nuevo__'

interface BancoEmisorSelectProps {
  /** id del control, para enganchar el <label htmlFor>. */
  id: string
  /** Banco elegido (nombre). Vacío = sin elegir. */
  value: string
  /** Se dispara con el banco elegido (o el recién creado). */
  onChange: (value: string) => void
  /** Marca el control en error (mismo criterio que los demás campos del cobro). */
  error?: boolean
  /** Texto del mensaje de error debajo del control. */
  errorMsg?: string
}

/**
 * Select de "Banco Emisor" del cobro (cheques y tarjetas). Ofrece los bancos fijos más los que el
 * usuario haya agregado —recordados en localStorage vía `useBancosEmisores`—. La opción "➕ Otro
 * banco…" cambia el control por un input para cargar uno nuevo: al confirmarlo queda seleccionado y
 * disponible para los próximos cobros. Un banco ya elegido que no esté en la lista (cargado en una
 * sesión previa) se agrega como opción para no perder el valor.
 */
export function BancoEmisorSelect({
  id,
  value,
  onChange,
  error = false,
  errorMsg = 'Elegí el banco emisor',
}: BancoEmisorSelectProps) {
  const { bancos, agregar } = useBancosEmisores()
  const [agregando, setAgregando] = useState(false)
  const [nuevo, setNuevo] = useState('')

  const opciones = value && !bancos.includes(value) ? [...bancos, value] : bancos

  const confirmarNuevo = () => {
    const limpio = nuevo.trim()
    if (!limpio) return
    agregar(limpio)
    onChange(limpio)
    setNuevo('')
    setAgregando(false)
  }

  const cancelarNuevo = () => {
    setNuevo('')
    setAgregando(false)
  }

  if (agregando) {
    return (
      <div className="banco-nuevo">
        <input
          id={id}
          className="cobro-in"
          placeholder="Nombre del banco"
          autoFocus
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirmarNuevo()
            }
            if (e.key === 'Escape') cancelarNuevo()
          }}
        />
        <button
          type="button"
          className="banco-nuevo-btn"
          title="Agregar banco"
          aria-label="Agregar banco"
          disabled={!nuevo.trim()}
          onClick={confirmarNuevo}
        >
          <i className="fas fa-check" />
        </button>
        <button
          type="button"
          className="banco-nuevo-btn banco-nuevo-btn--ghost"
          title="Cancelar"
          aria-label="Cancelar"
          onClick={cancelarNuevo}
        >
          <i className="fas fa-xmark" />
        </button>
      </div>
    )
  }

  return (
    <>
      <select
        id={id}
        className={`cobro-in ${error ? 'cobro-in--error' : ''}`}
        aria-invalid={error || undefined}
        value={value}
        onChange={(e) => {
          if (e.target.value === OPCION_NUEVO) {
            setAgregando(true)
            return
          }
          onChange(e.target.value)
        }}
      >
        <option value="" disabled>
          Seleccionar…
        </option>
        {opciones.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
        <option value={OPCION_NUEVO}>➕ Otro banco…</option>
      </select>
      {error && (
        <span className="cobro-in-err" role="alert">
          {errorMsg}
        </span>
      )}
    </>
  )
}
