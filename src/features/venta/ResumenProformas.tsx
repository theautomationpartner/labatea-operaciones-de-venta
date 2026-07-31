import { money, pctDec } from '@/lib/format'
import type { ProformaVigente } from '@/services/monday'

const colorRentabilidad = (rent: number) =>
  rent >= 25 ? 'var(--green-dark)' : rent >= 18 ? 'var(--orange)' : 'var(--red)'

interface ResumenProformasProps {
  proformas: ProformaVigente[]
  cargando: boolean
  error: boolean
  /** Proforma elegida (exclusiva); nunca null una vez que hay lista. */
  seleccionada: string | null
  onSelect: (id: string) => void
}

/**
 * Proformas del cliente, leídas del board. Cada card muestra el nombre de la proforma, su
 * importe, la rentabilidad general y cuántos productos tiene. La selección es EXCLUSIVA: al
 * tocar una card se elige esa proforma y se descarta la anterior (todo o nada).
 */
export function ResumenProformas({
  proformas,
  cargando,
  error,
  seleccionada,
  onSelect,
}: ResumenProformasProps) {
  return (
    <div className="presup-panel">
      <div className="presup-head">Proformas del cliente</div>
      <div className="presup-list">
        {cargando && (
          <div className="presup-vacio">
            <i className="fas fa-spinner fa-spin" /> Buscando proformas del cliente…
          </div>
        )}
        {!cargando && error && (
          <div className="presup-vacio presup-vacio--alerta">
            No se pudieron traer las proformas del cliente. Reintentá en unos segundos.
          </div>
        )}
        {!cargando && !error && proformas.length === 0 && (
          <div className="presup-vacio presup-vacio--alerta">
            Este cliente no tiene proformas.
          </div>
        )}
        {!cargando &&
          proformas.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`pcard ${seleccionada === p.id ? 'sel' : ''}`}
              aria-pressed={seleccionada === p.id}
              onClick={() => onSelect(p.id)}
            >
              <div className="pcard-top">
                <span className="pcard-id">{p.nro}</span>
                <span className="pbadge disp">Proforma</span>
              </div>
              <div className="pcard-row">
                <div>
                  <div className="pcol-l">Rentabilidad</div>
                  <div className="pcol-v" style={{ color: colorRentabilidad(p.rentabilidad) }}>
                    {pctDec(p.rentabilidad)}
                  </div>
                </div>
                <div>
                  <div className="pcol-l">Importe Total</div>
                  <div className="pcol-v">{money(p.importe)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pcol-l">Productos</div>
                  <div className="pcol-v">{p.productos.length}</div>
                </div>
              </div>
            </button>
          ))}
      </div>
      <div className="presup-foot">
        {cargando
          ? 'Consultando el tablero de Proformas…'
          : `Mostrando ${proformas.length} ${
              proformas.length === 1 ? 'proforma' : 'proformas'
            }`}
      </div>
    </div>
  )
}
