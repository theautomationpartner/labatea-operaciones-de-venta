import { aIso, desdeIso } from '@/lib/dates'
import { TIPOS_ACTIVIDAD } from '@/services/monday'
import type { TipoActividad } from '@/types'

/** El asterisco de campo obligatorio, con el mismo tono que en el resto de la app. */
export const Req = () => (
  <span className="act-req" aria-hidden="true">
    *
  </span>
)

interface CamposActividadProps {
  /** Prefijo de los `id` de los campos: el formulario se monta DOS veces (la actividad y la
   *  proyectada) y sin esto los `label` de la segunda apuntarían a los campos de la primera. */
  idPrefijo: string
  tipo: TipoActividad | null
  fecha: string
  /** HH:mm. Va pegada a la fecha: la gestión pasa a una hora, no a un día suelto. */
  hora: string
  resolucion: string
  onTipo: (v: TipoActividad) => void
  onFecha: (v: string) => void
  onHora: (v: string) => void
  onResolucion: (v: string) => void
  /** Piso del calendario, en ISO. La proyectada no admite hoy ni antes. */
  fechaMin?: string
  /** Por qué la fecha cargada no sirve. Pinta el campo y se muestra debajo. */
  errorFecha?: string | null
}

/**
 * Los campos que tiene TODA actividad, en este orden: tipo, fecha y hora, y resolución. Los comparten
 * la actividad que se está cargando y la proyectada —que es una actividad más—, así que viven en un
 * solo lugar: si mañana el board suma un campo, las dos lo suman juntas y no se desincronizan.
 *
 * No hay campo de descripción: el nombre del item no se escribe a mano, se arma con el tipo, la
 * fecha, las Personas y sus contactos (ver `nombreDe`, en el servicio). Y la resolución es
 * OPCIONAL: una actividad completada puede no tener nada que aclarar.
 */
export function CamposActividad({
  idPrefijo,
  tipo,
  fecha,
  hora,
  resolucion,
  onTipo,
  onFecha,
  onHora,
  onResolucion,
  fechaMin,
  errorFecha,
}: CamposActividadProps) {
  return (
    <>
      <div className="act-fila">
        <div className="act-campo">
          <label className="act-lbl" htmlFor={`${idPrefijo}-tipo`}>
            Tipo de Actividad
            <Req />
          </label>
          <select
            id={`${idPrefijo}-tipo`}
            className={`act-in ${tipo ? '' : 'act-in--ph'}`}
            value={tipo ?? ''}
            onChange={(e) => onTipo(e.target.value as TipoActividad)}
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {TIPOS_ACTIVIDAD.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="act-campo">
          <label className="act-lbl" htmlFor={`${idPrefijo}-fecha`}>
            Fecha de Actividad
            <Req />
          </label>
          {/* El `min` acota el CALENDARIO, no lo que se tipea: la regla de verdad la aplica
              `errorFechaProyectada` y por eso el campo puede quedar en error igual. */}
          <input
            id={`${idPrefijo}-fecha`}
            type="date"
            className={`act-in ${errorFecha ? 'act-in--error' : ''}`}
            aria-invalid={errorFecha ? true : undefined}
            aria-describedby={errorFecha ? `${idPrefijo}-fecha-err` : undefined}
            min={fechaMin}
            value={aIso(fecha)}
            onChange={(e) => onFecha(desdeIso(e.target.value))}
          />
          {errorFecha && (
            <span className="act-error" id={`${idPrefijo}-fecha-err`} role="alert">
              {errorFecha}
            </span>
          )}
        </div>

        {/* La hora va al lado de la fecha, y más angosta: son el mismo dato partido en dos campos.
            "✋Fecha Act" del board guarda las dos cosas, y el asiento entra por el widget de la
            Persona, donde la gestión se ubica en un momento del día. */}
        <div className="act-campo act-campo--corto">
          <label className="act-lbl" htmlFor={`${idPrefijo}-hora`}>
            Hora
            <Req />
          </label>
          <input
            id={`${idPrefijo}-hora`}
            type="time"
            className="act-in"
            value={hora}
            onChange={(e) => onHora(e.target.value)}
          />
        </div>
      </div>

      {/* Debajo del tipo y la fecha, a lo ancho: es texto libre, no un dato de una línea. Sin
          asterisco: se puede cerrar una actividad sin nada que aclarar. */}
      <div className="act-campo act-campo--ancho">
        <label className="act-lbl" htmlFor={`${idPrefijo}-resol`}>
          Resolución / Observaciones
        </label>
        <textarea
          id={`${idPrefijo}-resol`}
          className="act-area"
          rows={3}
          placeholder="Cómo se resolvió la actividad, qué se acordó, qué quedó pendiente."
          value={resolucion}
          onChange={(e) => onResolucion(e.target.value)}
        />
      </div>
    </>
  )
}
