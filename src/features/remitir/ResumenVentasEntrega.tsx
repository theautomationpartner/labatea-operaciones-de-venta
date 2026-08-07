import { pendienteDeVentaEntrega } from '@/services/monday'
import type { VentaEntregaPendiente } from '@/types'

/** Clase del badge según lo que diga el estado de entrega del board. */
const badgeDe = (estado: string): string =>
  /100%/i.test(estado) ? 'comp' : /parcial/i.test(estado) ? 'parc' : 'venc'

interface ResumenVentasEntregaProps {
  ventas: VentaEntregaPendiente[]
  cargando: boolean
  error: boolean
  /** Venta elegida como filtro; null = todas. */
  seleccionado: string | null
  onSelect: (id: string) => void
}

/**
 * Ventas del cliente con entrega pendiente, leídas del board. Cada card muestra el número de
 * venta, su estado de entrega, la fecha, cuántos ítems tiene y las unidades que faltan
 * entregar; al tocarla, filtra la lista de productos de al lado.
 *
 * Es el equivalente de `ResumenPresupuestos` / `ResumenRemitos`: mismo panel, mismas cards y
 * mismos estados de carga y error.
 */
export function ResumenVentasEntrega({
  ventas,
  cargando,
  error,
  seleccionado,
  onSelect,
}: ResumenVentasEntregaProps) {
  return (
    <div className="presup-panel">
      <div className="presup-head">Ventas pendientes de entregar</div>
      <div className="presup-list">
        {cargando && (
          <div className="presup-vacio">
            <i className="fas fa-spinner fa-spin" /> Buscando ventas con entrega pendiente…
          </div>
        )}
        {/* El fallo de la API no se explica acá: lo comunica la ventana global. La lista queda
            vacía, pero SIN el mensaje de "no tiene…", que sería mentir sobre por qué no hay nada. */}
        {!cargando && !error && ventas.length === 0 && (
          <div className="presup-vacio presup-vacio--alerta">
            Este cliente no tiene ventas con entrega pendiente.
          </div>
        )}
        {!cargando &&
          ventas.map((v) => (
            <button
              type="button"
              key={v.id}
              className={`pcard ${seleccionado === v.id ? 'sel' : ''}`}
              aria-pressed={seleccionado === v.id}
              onClick={() => onSelect(v.id)}
            >
              <div className="pcard-top">
                <span className="pcard-id">{v.nro}</span>
                <span className={`pbadge ${badgeDe(v.estadoEntrega)}`}>
                  {v.estadoEntrega || 'Sin estado'}
                </span>
              </div>
              <div className="pcard-row">
                <div>
                  <div className="pcol-l">Fecha</div>
                  <div className="pcol-v">{v.fecha}</div>
                </div>
                <div>
                  <div className="pcol-l">Ítems</div>
                  <div className="pcol-v">{v.productos.length}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pcol-l">U. pendientes</div>
                  <div className="pcol-v" style={{ color: 'var(--orange)' }}>
                    {pendienteDeVentaEntrega(v)}
                  </div>
                </div>
              </div>
            </button>
          ))}
      </div>
      <div className="presup-foot">
        {cargando
          ? 'Consultando el tablero de Ventas…'
          : `Mostrando ${ventas.length} ${
              ventas.length === 1 ? 'venta pendiente' : 'ventas pendientes'
            }`}
      </div>
    </div>
  )
}
