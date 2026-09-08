import type { Cliente } from '@/types'

/** Muestra el valor o «Sin especificar» si el board no lo tiene cargado. */
const oSinEsp = (v: string | null | undefined) => (v && v.trim() ? v : 'Sin especificar')

/**
 * La Persona a la que se le asienta la actividad: nombre, dirección y si está activa.
 *
 * Es una ficha CORTA a propósito. La del cliente (`ClienteFicha`) muestra límite, saldo y uso de
 * crédito porque de eso depende si se puede vender; acá no se vende nada, y esos números sólo
 * agregarían ruido a la decisión, que es "es esta Persona, o no".
 *
 * Sin Persona elegida (o mientras se busca) se dibuja igual, en skeleton: la etapa no cambia de
 * forma cuando llega el dato.
 */
export function PersonaElegida({ persona, cargando = false }: { persona: Cliente | null; cargando?: boolean }) {
  const vacio = !persona || cargando
  const activa = persona?.activity === 'Activo'

  return (
    <div className={`act-persona ${vacio ? 'act-persona--vacio' : ''}`}>
      <div className="act-persona-datos">
        {vacio ? (
          <>
            <span className="skeleton skeleton--linea skeleton--corto" />
            <span className="skeleton skeleton--linea skeleton--titulo" />
            <span className="skeleton skeleton--linea skeleton--medio" />
          </>
        ) : (
          <>
            <span className="act-persona-cod">Código: {persona.codigo}</span>
            <h3 className="act-persona-nom">{persona.name}</h3>
            <span className="act-persona-dir">
              <i className="fas fa-location-dot" /> {oSinEsp(persona.addr)}
            </span>
          </>
        )}
      </div>

      <div className="act-persona-estado">
        {vacio ? (
          <span className="skeleton skeleton--estado" />
        ) : (
          <span className={`act-persona-badge ${activa ? 'is-activo' : 'is-inactivo'}`}>
            <span className="act-persona-dot" /> {persona.activity}
          </span>
        )}
      </div>
    </div>
  )
}
