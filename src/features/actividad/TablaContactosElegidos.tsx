import type { ContactoElegido } from '@/types'

/** Un dato del contacto que el board no tiene cargado. */
const oGuion = (v: string) => (v && v.trim() ? v : '—')

interface TablaContactosElegidosProps {
  contactos: ContactoElegido[]
  /** Saca un contacto de la selección. Es la ÚNICA forma de deshacer una confirmación. */
  onQuitar: (itemId: string) => void
}

/**
 * Los contactos ya CONFIRMADOS, de todas las Personas: es la selección de verdad, la que viaja al
 * asiento.
 *
 * La tabla de arriba lista los contactos de la Persona que está en pantalla y se vacía al buscar
 * otra; ésta acumula. Sin ella, al buscar el segundo cliente lo elegido en el primero desaparecía
 * de la vista y había que confiar en un contador.
 *
 * Cada renglón dice de qué Persona salió: mezclando contactos de varias firmas, un nombre suelto
 * no alcanza para saber a quién se le está asentando la gestión.
 *
 * Quitar se hace SÓLO desde acá. En la tabla de arriba los ya confirmados se ven tildados y
 * bloqueados: si se pudiera destildar en los dos lados, la misma acción viviría en dos lugares y
 * el usuario tendría que adivinar cuál manda.
 */
export function TablaContactosElegidos({ contactos, onQuitar }: TablaContactosElegidosProps) {
  return (
    <div className="act-tabla-caja">
      <div className="act-tabla-head">
        <h3 className="act-tabla-title">
          <i className="fas fa-user-check" /> Contactos seleccionados
        </h3>
        {contactos.length > 0 && (
          <span className="act-tabla-hint">
            {contactos.length} contacto{contactos.length === 1 ? '' : 's'} confirmado
            {contactos.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="act-tabla-scroll">
        <table className="act-tabla">
          <thead>
            <tr>
              <th>Contacto</th>
              <th>Whatsapp</th>
              <th>Email</th>
              <th className="act-tabla-chk" />
            </tr>
          </thead>
          <tbody>
            {contactos.length === 0 && (
              <tr className="act-tabla-vacia">
                <td colSpan={4}>
                  <i className="fas fa-user-plus" /> Todavía no confirmaste ningún contacto. Tildá
                  los de la Persona y confirmalos para sumarlos acá.
                </td>
              </tr>
            )}

            {contactos.map((c) => (
              <tr key={c.itemId} className="act-tabla-fila">
                {/* La Persona va como segundo renglón: se pueden mezclar contactos de varias, y sin
                    esto no se sabe de quién es cada uno. */}
                <td>
                  <span className="act-tabla-nom">{c.nombre}</span>
                  <span className="act-tabla-sub">{c.personaNombre}</span>
                </td>
                <td className="act-tabla-dato">{oGuion(c.telefono)}</td>
                <td className="act-tabla-dato">{oGuion(c.email)}</td>
                {/* El MISMO tacho de la tabla de productos seleccionados: sacar un renglón de una
                    selección es el mismo gesto en toda la app, y con dos íconos distintos habría
                    que aprenderlo dos veces. */}
                <td className="act-tabla-chk ta-c">
                  <i
                    className="far fa-trash-alt trash"
                    role="button"
                    aria-label={`Quitar a ${c.nombre} de la selección`}
                    title="Quitar de la selección"
                    onClick={() => onQuitar(c.itemId)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
