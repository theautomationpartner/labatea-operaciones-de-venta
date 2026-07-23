import { money, pctDec } from '@/lib/format'
import type { PresupuestoVigente } from '@/services/monday'

/** Clase del badge según lo que diga la columna de vigencia del board. */
const badgeDe = (vigencia: string): string =>
  /vigente/i.test(vigencia) ? 'disp' : /vencid/i.test(vigencia) ? 'venc' : 'comp'

const colorRentabilidad = (rent: number) =>
  rent >= 25 ? 'var(--green-dark)' : rent >= 18 ? 'var(--orange)' : 'var(--red)'

interface ResumenPresupuestosProps {
  presupuestos: PresupuestoVigente[]
  cargando: boolean
  error: boolean
  /** Presupuesto elegido como filtro; null = todos. */
  seleccionado: string | null
  onSelect: (id: string) => void
}

/**
 * Presupuestos del cliente todavía vigentes, leídos del board. Cada card muestra el ID del
 * presupuesto, su importe, la rentabilidad general, el estado de vigencia y cuántos productos
 * tiene; al tocarla, filtra la lista de productos de al lado.
 */
export function ResumenPresupuestos({
  presupuestos,
  cargando,
  error,
  seleccionado,
  onSelect,
}: ResumenPresupuestosProps) {
  return (
    <div className="presup-panel">
      <div className="presup-head">Presupuestos del cliente</div>
      <div className="presup-list">
        {cargando && (
          <div className="presup-vacio">
            <i className="fas fa-spinner fa-spin" /> Buscando presupuestos vigentes…
          </div>
        )}
        {!cargando && error && (
          <div className="presup-vacio presup-vacio--alerta">
            No se pudieron traer los presupuestos del cliente. Reintentá en unos segundos.
          </div>
        )}
        {!cargando && !error && presupuestos.length === 0 && (
          <div className="presup-vacio presup-vacio--alerta">
            Este cliente no tiene presupuestos vigentes.
          </div>
        )}
        {!cargando &&
          presupuestos.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`pcard ${seleccionado === p.id ? 'sel' : ''}`}
              aria-pressed={seleccionado === p.id}
              onClick={() => onSelect(p.id)}
            >
              <div className="pcard-top">
                <span className="pcard-id">{p.nro}</span>
                <span className={`pbadge ${badgeDe(p.vigencia)}`}>{p.vigencia || 'Sin estado'}</span>
              </div>
              <div className="pcard-row">
                <div>
                  <div className="pcol-l">Rentabilidad</div>
                  <div className="pcol-v" style={{ color: colorRentabilidad(p.rentabilidad) }}>
                    {pctDec(p.rentabilidad)}
                  </div>
                </div>
                <div>
                  <div className="pcol-l">Importe Presup.</div>
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
          ? 'Consultando el tablero de Presupuestos…'
          : `Mostrando ${presupuestos.length} ${
              presupuestos.length === 1 ? 'presupuesto vigente' : 'presupuestos vigentes'
            }`}
      </div>
    </div>
  )
}
