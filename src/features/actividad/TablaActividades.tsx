import type { ReactNode } from 'react'
import { etiquetaActividad } from '@/lib/actividad'
import type { ActividadListada } from '@/types'

interface TablaActividadesProps {
  actividades: ActividadListada[]
  /** IDs de las actividades tildadas para el documento. */
  elegidas: string[]
  /** La consulta al tablero está en curso: en lugar de la lista va el renglón de búsqueda. */
  cargando: boolean
  onToggle: (actividad: ActividadListada) => void
  /* --- Lo que cambia entre los dos usos de la tabla. Los valores por defecto son los de la etapa
     "Registrar Actividad" de la venta y el presupuesto, que es de donde salió el componente. --- */
  /** Título de la caja. */
  titulo?: string
  /** Qué se está buscando, para el renglón de carga. */
  buscando?: string
  /** Qué decir cuando la consulta no trajo nada. */
  vacio?: ReactNode
  /**
   * Tildar al menos una es OBLIGATORIO. Con esto la cabecera lo reclama en rojo —el mismo aviso en
   * línea del cobro— en vez de aclarar que es opcional.
   */
  requerida?: boolean
  /** El reclamo en rojo, cuando `requerida`. */
  avisoRequerida?: string
}

/**
 * Color del estado, el mismo que tiene en el tablero: amarillo lo que queda por hacer, verde lo
 * hecho y rojo lo que se pasó de fecha. Un estado que no conocemos se muestra en gris, no se
 * esconde: el dato del board manda sobre lo que la app cree saber.
 */
const claseEstado = (estado: string): string => {
  const e = estado.trim().toLowerCase()
  if (e === 'completado' || e === 'done') return 'act-badge--verde'
  if (e === 'pendiente' || e === 'open') return 'act-badge--amarillo'
  if (e === 'vencido') return 'act-badge--rojo'
  return 'act-badge--gris'
}

/**
 * Una lista de actividades del tablero con su casilla para elegir cuáles. La usan los DOS lugares
 * donde se eligen actividades ya cargadas, con la misma forma y los mismos estilos:
 *   · la etapa "Registrar Actividad" de la venta y el presupuesto, para asociar la gestión que
 *     originó el documento (es el uso por defecto, el que describen los párrafos de abajo);
 *   · REGISTRO DE ACTIVIDADES · "COMPLETAR ACTIVIDAD PENDIENTE", para elegir cuáles pendientes de
 *     la gente elegida en la etapa 1 pasan a "Completado".
 *
 * Elegir una es OPCIONAL en las tres operaciones que llegan acá (presupuesto, venta y venta con
 * proforma): el documento puede no tener todavía, en el tablero, la gestión que lo originó. Sin
 * nada tildado la cabecera lo dice en gris, sin reclamar nada, y el paso a la emisión sigue abierto.
 *
 * La actividad NO se edita acá: esta etapa la asocia, no la modifica. Para cargar una nueva está la
 * operación REGISTRO DE ACTIVIDADES.
 */
export function TablaActividades({
  actividades,
  elegidas,
  cargando,
  onToggle,
  titulo = 'Actividades sin asociar',
  buscando = 'Buscando actividades sin asociar…',
  vacio = (
    <>
      <i className="fas fa-calendar-xmark" /> No hay actividades sin asociar en el tablero.
      Registrá la gestión con la operación REGISTRO DE ACTIVIDADES y volvé a esta etapa.
    </>
  ),
  requerida = false,
  avisoRequerida = 'Tildá al menos una actividad',
}: TablaActividadesProps) {
  const elegidasCount = elegidas.length

  return (
    <div className="act-tabla-caja">
      <div className="act-tabla-head">
        <h3 className="act-tabla-title">
          <i className="fas fa-clipboard-list" /> {titulo}
        </h3>
        {/* Igual que el aviso en línea del cobro: en rojo mientras el dato falta, y en cuanto se
            cumple deja de reclamar y pasa a contar lo elegido. Mientras se consulta no reclama
            nada: todavía no hay ninguna fila que tildar. */}
        {elegidasCount > 0 ? (
          <span className="act-tabla-hint">
            {elegidasCount} de {actividades.length} seleccionada
            {elegidasCount === 1 ? '' : 's'}
          </span>
        ) : (
          !cargando &&
          (requerida ? (
            <span className="act-tabla-req" role="status" aria-live="polite">
              <i className="fas fa-circle-exclamation" /> {avisoRequerida}
            </span>
          ) : (
            <span className="act-tabla-hint">Opcional: podés continuar sin tildar ninguna.</span>
          ))
        )}
      </div>

      <div className="act-tabla-scroll">
        <table className="act-tabla">
          <thead>
            <tr>
              <th className="act-tabla-chk" />
              <th>Actividad</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Resolución / Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr className="act-tabla-fila--skeleton">
                <td className="act-tabla-cargando" colSpan={5}>
                  <i className="fas fa-spinner fa-spin" /> {buscando}
                </td>
              </tr>
            )}

            {!cargando && actividades.length === 0 && (
              <tr className="act-tabla-vacia">
                <td colSpan={5}>{vacio}</td>
              </tr>
            )}

            {!cargando &&
              actividades.map((a) => {
                const elegida = elegidas.includes(a.id)
                /* El rótulo es el TIPO y con quién se hizo; la fecha y el estado ya tienen su
                   propia columna, y la Persona es la que se eligió en la etapa anterior. */
                const etiqueta = etiquetaActividad(a)
                return (
                  <tr
                    key={a.id}
                    className={`act-tabla-fila ${elegida ? 'is-on' : ''}`}
                    onClick={() => onToggle(a)}
                  >
                    <td className="act-tabla-chk">
                      <label className="act-chk" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="act-chk-input"
                          /* La casilla se anuncia con lo MISMO que se lee en la fila: el nombre
                             entero del ítem repite la fecha y la Persona, que ya están a la vista. */
                          aria-label={`Seleccionar la actividad ${etiqueta.visible}`}
                          checked={elegida}
                          onChange={() => onToggle(a)}
                        />
                        <span className="act-chk-box" aria-hidden="true">
                          <i className="fas fa-check" />
                        </span>
                      </label>
                    </td>
                    {/* El resto de los contactos queda detrás del "+", con la lista entera en el
                        `title`: pasar el mouse alcanza para verlos sin abrir nada. */}
                    <td title={etiqueta.titulo || undefined}>
                      <span className="act-resumen">
                        <span className="act-resumen-nom act-tabla-nom">{etiqueta.visible}</span>
                        {etiqueta.ocultas > 0 && (
                          <span className="act-resumen-mas">
                            , +{etiqueta.ocultas > 1 ? etiqueta.ocultas : ''}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="act-tabla-dato act-tabla-fecha">{a.fecha || '—'}</td>
                    <td>
                      <span className={`act-badge ${claseEstado(a.estado)}`}>
                        {a.estado || 'Sin estado'}
                      </span>
                    </td>
                    {/* La resolución puede ser larga: se recorta a un renglón y el texto completo
                        queda en el `title`, para que la fila no crezca y la tabla siga legible. */}
                    <td className="act-tabla-dato act-tabla-resol" title={a.resolucion || undefined}>
                      {a.resolucion || '—'}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
