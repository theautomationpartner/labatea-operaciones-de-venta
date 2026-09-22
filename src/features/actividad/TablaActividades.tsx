import { useEffect, useState, type ReactNode } from 'react'
import { condensarNombres, etiquetaActividad } from '@/lib/actividad'
import type { ActividadListada } from '@/types'
import { Plegable } from './Plegable'

interface TablaActividadesProps {
  actividades: ActividadListada[]
  /** IDs de las actividades tildadas para el documento. */
  elegidas: string[]
  /** La consulta al tablero está en curso: en lugar de la lista va el renglón de búsqueda. */
  cargando: boolean
  onToggle: (actividad: ActividadListada) => void
  /** Título de la caja. Los dos usos lo nombran: el de la venta es una pregunta, no un rótulo. */
  titulo: string
  /* --- Lo que cambia entre los dos usos de la tabla. Los valores por defecto son los de la etapa
     "Registrar Actividad" de la venta y el presupuesto, que es de donde salió el componente. --- */
  /** Qué se está buscando, para el renglón de carga. */
  buscando?: string
  /** Qué decir cuando la consulta no trajo nada. */
  vacio?: ReactNode
  /**
   * El reclamo en rojo mientras no haya ninguna tildada. Tildar al menos una es OBLIGATORIO en los
   * dos usos —en el de la venta, desde que se contesta que sí—, así que la cabecera siempre
   * reclama; lo único que cambia entre uno y otro es QUÉ pide.
   */
  avisoRequerida?: string
  /**
   * Control que gobierna la caja, a la derecha del título: el SÍ/NO de "¿Querés asociar
   * actividades?" en la etapa de la venta y el presupuesto.
   */
  accion?: ReactNode
  /**
   * La caja está PLEGADA: se ve el título con su `accion` y nada más. Es el estado en el que abre
   * la etapa de la venta y el presupuesto, con la pregunta contestada que NO.
   */
  colapsada?: boolean
}

/**
 * Cuántas actividades entran en una página.
 *
 * La tabla no tiene tope propio —lista lo que traiga el tablero, hasta 100 ítems— y sin cortarla la
 * etapa se vuelve un scroll: el pie con "Continuar", o con "Finalizar Operación", se va abajo de
 * todo y la decisión que la etapa viene a pedir deja de estar a la vista. Con diez filas la caja
 * mide siempre lo mismo, se elija la página que se elija.
 */
const POR_PAGINA = 10

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
 * En la etapa de la venta y el presupuesto la caja se PLIEGA (`colapsada`) y su título es la
 * pregunta "¿Querés asociar actividades…?", con el SÍ/NO como `accion`: contestada que no, de la
 * tabla no se ve nada más que esa línea. Contestada que sí, tildar al menos una es obligatorio y la
 * cabecera lo reclama en rojo, igual que la lista de pendientes.
 *
 * La actividad NO se edita acá: esta etapa la asocia, no la modifica. Para cargar una nueva está la
 * operación REGISTRO DE ACTIVIDADES.
 */
export function TablaActividades({
  actividades,
  elegidas,
  cargando,
  onToggle,
  titulo,
  buscando = 'Buscando actividades sin asociar…',
  vacio = (
    <>
      <i className="fas fa-calendar-xmark" /> No hay actividades sin asociar en el tablero.
      Registrá la gestión con la operación REGISTRO DE ACTIVIDADES y volvé a esta etapa.
    </>
  ),
  avisoRequerida = 'Tildá al menos una actividad',
  accion,
  colapsada = false,
}: TablaActividadesProps) {
  const elegidasCount = elegidas.length
  /* Plegar se ANIMA, así que el cuerpo no puede desmontarse en el mismo cuadro en que se contesta
     que no: sigue montado mientras se va (`Plegable`) y recién ahí se descarta. Desplegado de
     entrada —la lista de pendientes— arranca montado y nunca se pliega. */
  const [montado, setMontado] = useState(!colapsada)
  useEffect(() => {
    if (!colapsada) setMontado(true)
  }, [colapsada])

  /* Paginado de a `POR_PAGINA`. Lo tildado NO es por página —viaja por id, en `elegidas`—, así que
     pasar de página no suelta nada y el contador de la cabecera sigue contando sobre el total. */
  const [pagina, setPagina] = useState(0)
  const paginas = Math.max(1, Math.ceil(actividades.length / POR_PAGINA))
  /* La página se acota en el render y no al guardarla: la lista puede encogerse por su cuenta —las
     pendientes se recalculan cuando cambia el cliente— y dejar el número apuntando a una página que
     ya no existe mostraría una tabla vacía con filas que sí están. */
  const actual = Math.min(pagina, paginas - 1)
  const visibles = actividades.slice(actual * POR_PAGINA, actual * POR_PAGINA + POR_PAGINA)

  /* Otra lista arranca en la primera página. Se mira el CONTENIDO y no el array: las pendientes se
     recalculan en cada render (ver `ActividadView`), y atado a la referencia el paginador se
     reseteaba solo cada vez que se tildaba una fila. */
  const clave = actividades.map((a) => a.id).join(',')
  useEffect(() => {
    setPagina(0)
  }, [clave])

  return (
    <div className={`act-tabla-caja ${colapsada ? 'act-tabla-caja--plegada' : ''}`.trim()}>
      <div className="act-tabla-head">
        <h3 className="act-tabla-title">
          <i className="fas fa-clipboard-list" /> {titulo}
        </h3>
        {/* Igual que el aviso en línea del cobro: en rojo mientras el dato falta, y en cuanto se
            cumple deja de reclamar y pasa a contar lo elegido. Mientras se consulta no reclama
            nada: todavía no hay ninguna fila que tildar. */}
        {accion}
        {!colapsada &&
          (elegidasCount > 0 ? (
            <span className="act-tabla-hint">
              {elegidasCount} de {actividades.length} seleccionada
              {elegidasCount === 1 ? '' : 's'}
            </span>
          ) : (
            !cargando && (
              <span className="act-tabla-req" role="status" aria-live="polite">
                <i className="fas fa-circle-exclamation" /> {avisoRequerida}
              </span>
            )
          ))}
      </div>

      {montado && (
        <Plegable saliendo={colapsada} onFin={() => setMontado(false)}>
          <div className="act-tabla-scroll">
            <table className="act-tabla">
              <thead>
                <tr>
                  <th className="act-tabla-chk" />
                  <th>Actividad</th>
                  <th>Contactos</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Resolución / Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {cargando && (
                  <tr className="act-tabla-fila--skeleton">
                    <td className="act-tabla-cargando" colSpan={6}>
                      <i className="fas fa-spinner fa-spin" /> {buscando}
                    </td>
                  </tr>
                )}

                {!cargando && actividades.length === 0 && (
                  <tr className="act-tabla-vacia">
                    <td colSpan={6}>{vacio}</td>
                  </tr>
                )}

                {!cargando &&
                  visibles.map((a) => {
                    const elegida = elegidas.includes(a.id)
                    /* El rótulo es el TIPO y con quién se hizo; la fecha y el estado ya tienen su
                       propia columna, y la Persona es la que se eligió en la etapa anterior. */
                    const etiqueta = etiquetaActividad(a)
                    /* Con quiénes se hizo la gestión. Se leen dos y el resto va detrás del "+": son
                       nombres largos y una celda no puede crecer sin desarmar la fila. */
                    const contactos = condensarNombres(a.contactos, 2)
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
                        {/* La lista entera en el `title`: pasar el mouse alcanza para verla. */}
                        <td className="act-tabla-dato" title={contactos.titulo || undefined}>
                          {contactos.visible ? (
                            <span className="act-resumen">
                              <span className="act-resumen-nom">{contactos.visible}</span>
                              {contactos.ocultas > 0 && (
                                <span className="act-resumen-mas">
                                  , +{contactos.ocultas > 1 ? contactos.ocultas : ''}
                                </span>
                              )}
                            </span>
                          ) : (
                            '—'
                          )}
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

              {/* Relleno de la última página. La tabla mide SIEMPRE diez filas: sin esto, pasar de
                  una página llena a una de tres renglones encogía la caja, el pie de la etapa
                  saltaba hacia arriba y el botón de "Siguiente" se movía de abajo del cursor.

                  Son filas de verdad, con los mismos elementos que definen el alto de una fila real
                  —el nombre y la pastilla del estado—, escondidas con `visibility`: así el hueco
                  mide exactamente lo que mediría la fila que falta, sin ningún alto fijo en píxeles
                  que haya que recordar cambiar cuando cambie el de la fila.

                  Sólo con paginador: un tablero con tres gestiones no tiene de dónde a dónde saltar,
                  y reservarle diez renglones sería dejar la etapa casi vacía. */}
              {!cargando &&
                paginas > 1 &&
                Array.from({ length: POR_PAGINA - visibles.length }, (_, i) => (
                  <tr key={`hueca-${i}`} className="act-tabla-fila--hueca" aria-hidden="true">
                    <td className="act-tabla-chk" />
                    <td>
                      <span className="act-tabla-nom">&nbsp;</span>
                    </td>
                    <td className="act-tabla-dato">&nbsp;</td>
                    <td className="act-tabla-dato act-tabla-fecha">&nbsp;</td>
                    <td>
                      <span className="act-badge act-badge--gris">&nbsp;</span>
                    </td>
                    <td className="act-tabla-dato act-tabla-resol">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sin una segunda página no hay nada que elegir: el pie no se dibuja. */}
          {!cargando && paginas > 1 && (
            <div className="act-tabla-pager">
              <button
                type="button"
                className="act-tabla-pager-btn"
                disabled={actual === 0}
                onClick={() => setPagina(actual - 1)}
              >
                <i className="fas fa-chevron-left" /> Anterior
              </button>
              {/* Se anuncia el total, no lo que se ve: es lo que dice si falta buscar en otra
                  página la gestión que se vino a asociar. */}
              <span className="act-tabla-pager-info" aria-live="polite">
                Página {actual + 1} de {paginas} · {actividades.length} actividades
              </span>
              <button
                type="button"
                className="act-tabla-pager-btn"
                disabled={actual === paginas - 1}
                onClick={() => setPagina(actual + 1)}
              >
                Siguiente <i className="fas fa-chevron-right" />
              </button>
            </div>
          )}
        </Plegable>
      )}
    </div>
  )
}
