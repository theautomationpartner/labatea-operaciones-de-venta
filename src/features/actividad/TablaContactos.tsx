import type { Contacto } from '@/types'

interface TablaContactosProps {
  contactos: Contacto[]
  /** `itemId` de los tildados que TODAVÍA no se confirmaron. Son sólo de la Persona en pantalla. */
  tildados: string[]
  /** `itemId` de los que ya están confirmados (los de la tabla de abajo), de cualquier Persona. */
  yaElegidos: string[]
  /** La consulta a Monday está en curso: en lugar de los contactos va el renglón de búsqueda. */
  cargando: boolean
  /** Todavía no se eligió la Persona: no hay contactos que pedir. */
  sinPersona: boolean
  onToggle: (contacto: Contacto) => void
  /** Tilda o destilda TODOS los contactos elegibles de la Persona de una vez. */
  onTodos: (contactos: Contacto[]) => void
  /** Pasa los tildados a la selección confirmada. */
  onConfirmar: () => void
  /** Todavía no hay NINGÚN contacto confirmado: la cabecera lo reclama en rojo. */
  faltan: boolean
  /** La Persona tiene contactos, pero ya están TODOS en la selección: no queda nada que listar. */
  todosElegidos?: boolean
}

/** Un dato del contacto que el board no tiene cargado. */
const oGuion = (v: string) => (v && v.trim() ? v : '—')

/**
 * Contactos de la Persona que está en pantalla, con su casilla para elegir con cuáles se hizo la
 * actividad.
 *
 * Tildar NO alcanza: hay que confirmar. Los tildados son una selección en borrador de la Persona en
 * pantalla —se pierde al buscar otra— y el botón "Confirmar" los pasa a la tabla de abajo, que es
 * la selección de verdad. El rodeo existe porque la etapa deja mezclar contactos de varias firmas:
 * sin un paso explícito, buscar el segundo cliente hacía desaparecer de la vista lo elegido en el
 * primero, y no quedaba forma de revisarlo.
 *
 * Al confirmar, el contacto se TRASLADA: sale de esta lista y queda en la de abajo. Un mismo
 * contacto en dos tablas a la vez es el mismo dato dos veces, y obliga a mirar las dos para saber
 * qué está elegido.
 *
 * La marca "Ya seleccionado" es para otra cosa: el contacto que ya estaba en la selección cuando se
 * buscó a esta Persona —porque se lo confirmó desde otra firma, o en una búsqueda anterior—. Ése sí
 * se muestra, tildado y bloqueado, para que la lista no mienta diciendo que está libre. Se saca
 * desde la tabla de abajo; acá no se puede, para que la acción viva en un solo lugar.
 *
 * Elegir al menos uno es obligatorio: la actividad es una gestión CON alguien, y sin contacto el
 * asiento no dice con quién se hizo. Mientras no haya ninguno confirmado, la cabecera lo reclama en
 * rojo —el mismo aviso en línea que usa el cobro—, y el avance de la etapa lo frena.
 *
 * La estructura se dibuja SIEMPRE —encabezado incluido—, pero los renglones NO se rellenan hasta
 * que hay algo real que mostrar: sin Persona la tabla queda vacía, con una línea que dice qué hace
 * falta. Nada de skeleton acá: el gris de carga promete datos en camino, y antes de elegir una
 * Persona no hay ninguna consulta en curso —promete algo que no está pasando—. La animación de
 * búsqueda aparece recién cuando se elige, que es cuando efectivamente se está buscando.
 */
export function TablaContactos({
  contactos,
  tildados,
  yaElegidos,
  cargando,
  sinPersona,
  onToggle,
  onTodos,
  onConfirmar,
  faltan,
  todosElegidos = false,
}: TablaContactosProps) {
  /* Tres estados distintos, y ninguno se puede confundir con otro: sin Persona todavía no hay a
     quién consultarle, buscando hay una consulta en curso (spinner), y con la respuesta ya se
     listan los contactos o se dice que no tiene. */
  const vacio = sinPersona || cargando
  /* Qué se puede tildar: `itemId` es lo que se linkea en Monday —el `id` que se muestra es el
     código del board ("CONTACT-009"), que no sirve para escribir la relación—, y los ya
     confirmados quedan afuera porque su casilla está bloqueada. */
  const elegibles = contactos.filter((c) => c.itemId && !yaElegidos.includes(c.itemId as string))
  const todosTildados = elegibles.length > 0 && tildados.length === elegibles.length
  const algunoTildado = tildados.length > 0 && !todosTildados

  return (
    <div className="act-tabla-caja">
      <div className="act-tabla-head">
        <h3 className="act-tabla-title">
          <i className="fas fa-address-book" /> Contactos de la Persona
        </h3>
        {/* Igual que el aviso en línea del cobro: en rojo mientras el dato falta, y en cuanto se
            cumple deja de reclamar y pasa a contar lo tildado.

            No aparece hasta que hay una Persona con sus contactos a la vista (`vacio`): antes de
            eso no hay nada que tildar, y reclamar algo que todavía no se puede hacer es ruido. */}
        {tildados.length > 0 ? (
          <span className="act-tabla-hint">
            {tildados.length} de {elegibles.length} tildado{tildados.length === 1 ? '' : 's'}, sin
            confirmar
          </span>
        ) : (
          faltan &&
          !vacio && (
            <span className="act-tabla-req" role="status" aria-live="polite">
              <i className="fas fa-circle-exclamation" /> Tilda con que contactos se hizo o se va a
              efectuar la actividad
            </span>
          )
        )}
      </div>

      <div className="act-tabla-scroll">
        <table className="act-tabla">
          <thead>
            <tr>
              <th className="act-tabla-chk">
                <label className="act-chk">
                  <input
                    type="checkbox"
                    className="act-chk-input"
                    aria-label="Seleccionar todos los contactos"
                    disabled={vacio || elegibles.length === 0}
                    checked={todosTildados}
                    ref={(el) => {
                      // Con algunos tildados la casilla va en indeterminado: no miente un "todos".
                      if (el) el.indeterminate = algunoTildado
                    }}
                    onChange={() => onTodos(todosTildados ? [] : elegibles)}
                  />
                  <span className="act-chk-box" aria-hidden="true">
                    <i className="fas fa-check" />
                  </span>
                </label>
              </th>
              <th>Contacto</th>
              <th>Email</th>
              <th>Whatsapp</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr className="act-tabla-fila--skeleton">
                <td className="act-tabla-cargando" colSpan={4}>
                  <i className="fas fa-spinner fa-spin" /> Buscando contactos del cliente
                  seleccionado…
                </td>
              </tr>
            )}

            {sinPersona && (
              <tr className="act-tabla-vacia">
                <td colSpan={4}>
                  <i className="fas fa-magnifying-glass" /> Buscá una Persona para ver sus contactos.
                </td>
              </tr>
            )}

            {!vacio && contactos.length === 0 && (
              <tr className="act-tabla-vacia">
                <td colSpan={4}>
                  {todosElegidos ? (
                    <>
                      <i className="fas fa-user-check" /> Ya seleccionaste todos los contactos de
                      esta Persona: están en la tabla de abajo.
                    </>
                  ) : (
                    <>
                      <i className="fas fa-user-slash" /> La Persona no tiene contactos cargados en
                      el sistema. Cargale al menos uno en el tablero para poder registrar la
                      actividad.
                    </>
                  )}
                </td>
              </tr>
            )}

            {!vacio &&
              contactos.map((c) => {
                const id = c.itemId
                const ya = !!id && yaElegidos.includes(id)
                const tildado = !!id && tildados.includes(id)
                return (
                  <tr
                    key={c.id}
                    className={`act-tabla-fila ${tildado ? 'is-on' : ''} ${ya ? 'is-ya' : ''}`}
                    onClick={() => id && !ya && onToggle(c)}
                  >
                    <td className="act-tabla-chk">
                      <label className="act-chk" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="act-chk-input"
                          aria-label={
                            ya ? `${c.name} ya está seleccionado` : `Seleccionar a ${c.name}`
                          }
                          // El confirmado se ve tildado pero no se toca: se quita desde la otra tabla.
                          disabled={!id || ya}
                          checked={tildado || ya}
                          onChange={() => id && !ya && onToggle(c)}
                        />
                        <span className="act-chk-box" aria-hidden="true">
                          <i className="fas fa-check" />
                        </span>
                      </label>
                    </td>
                    {/* Nombre + Apellido como nombre del contacto, con su código debajo: el board
                        nombra los ítems con la empresa, así que el `name` del ítem no sirve acá
                        (ver `mapContacto`). */}
                    <td>
                      <span className="act-tabla-nom">{c.name}</span>
                      {ya ? (
                        <span className="act-tabla-ya">
                          <i className="fas fa-check" /> Ya seleccionado
                        </span>
                      ) : (
                        <span className="act-tabla-sub">{c.id}</span>
                      )}
                    </td>
                    <td className="act-tabla-dato">{oGuion(c.email)}</td>
                    <td className="act-tabla-dato">{oGuion(c.phone)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Confirmar es lo que pasa los tildados a la selección de verdad. Se dibuja apenas hay
          contactos a la vista —apagado mientras no haya ninguno tildado— para que el paso se vea
          antes de necesitarlo, y no aparezca de la nada al primer tilde. */}
      {!vacio && contactos.length > 0 && (
        <div className="act-tabla-pie">
          <button
            type="button"
            className="btn btn-primary btn--h38"
            disabled={tildados.length === 0}
            onClick={onConfirmar}
          >
            <i className="fas fa-user-plus" /> Confirmar
            {tildados.length > 0
              ? ` ${tildados.length} contacto${tildados.length === 1 ? '' : 's'}`
              : ''}
          </button>
        </div>
      )}
    </div>
  )
}
