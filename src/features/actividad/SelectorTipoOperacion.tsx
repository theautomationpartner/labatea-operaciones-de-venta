import { useApp, useDispatch } from '@/state/hooks'
import { claseCajaSelector, claseSelector } from '@/features/shared/faltaSeleccion'
import type { TipoOperacionActividad } from '@/types'

/** Las dos cosas que se pueden hacer con la gente elegida, en el orden en que se ofrecen. */
const TIPOS_OPERACION: readonly TipoOperacionActividad[] = [
  'REGISTRAR NUEVA ACTIVIDAD',
  'COMPLETAR ACTIVIDAD PENDIENTE',
]

/**
 * "Tipo de Operación": qué se va a hacer con la Persona y los contactos que se están eligiendo.
 *
 * Vive en la etapa 1, junto a la selección, porque es parte de la misma decisión: se elige a quién
 * y para qué. La etapa 2 sólo ejecuta lo que se contestó acá —el formulario de la actividad nueva,
 * o la lista de pendientes de esa gente— y hasta se renombra según la respuesta (ver
 * `rotuloEtapaActividad`).
 *
 * Misma caja de configuración que el tipo de venta y el tipo de entrega: es la misma clase de
 * decisión —de qué va la operación— y no había razón para que se viera distinta. Nada viene
 * preseleccionado, por lo mismo que allá: son dos operaciones distintas y elegir una por defecto
 * sería adivinar a qué vino el usuario.
 */
export function SelectorTipoOperacion() {
  const { actividad, intentoAvanzar } = useApp()
  const dispatch = useDispatch()
  // Con la operación ya asentada no se puede cambiar de rama: lo que se hizo, se hizo.
  const cerrada = actividad.actividadId !== null || actividad.completadas

  return (
    <div className="venta-cfg">
      <div className={claseCajaSelector(actividad.tipoOperacion, intentoAvanzar)}>
        <div className="cfg-ic">
          <i className="fas fa-list-check" />
        </div>
        <div className="cfg-c">
          <div className="cfg-l">Tipo de Operación</div>
          <select
            className={`cfg-sel ${claseSelector(actividad.tipoOperacion)}`}
            value={actividad.tipoOperacion ?? ''}
            disabled={cerrada}
            onChange={(e) =>
              dispatch({
                type: 'setTipoOperacionActividad',
                value: e.target.value as TipoOperacionActividad,
              })
            }
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {TIPOS_OPERACION.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
