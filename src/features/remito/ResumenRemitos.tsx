import { entregadoDeRemito, pendienteDeRemito, type RemitoPendiente } from '@/services/monday'

/** Clase del badge según lo que diga la columna de estado de facturación del board. */
const badgeDe = (estado: string): string =>
  /100%/i.test(estado) ? 'comp' : /parcial/i.test(estado) ? 'parc' : 'venc'

interface ResumenRemitosProps {
  remitos: RemitoPendiente[]
  cargando: boolean
  error: boolean
  /** Remito elegido como filtro; null = todos. */
  seleccionado: string | null
  onSelect: (id: string) => void
}

/**
 * Remitos del cliente pendientes de facturar, leídos del board. Cada card muestra el ID del
 * remito, su fecha de emisión, cuánto se entregó, cuánto queda por facturar y el estado de
 * facturación; al tocarla, filtra la lista de productos de al lado.
 *
 * Es el equivalente de `ResumenPresupuestos` en la venta con presupuesto previo: mismo panel,
 * mismas cards, mismos estados de carga y error.
 */
export function ResumenRemitos({
  remitos,
  cargando,
  error,
  seleccionado,
  onSelect,
}: ResumenRemitosProps) {
  return (
    <div className="presup-panel">
      <div className="presup-head">Remitos de venta del cliente</div>
      <div className="presup-list">
        {cargando && (
          <div className="presup-vacio">
            <i className="fas fa-spinner fa-spin" /> Buscando remitos pendientes de facturar…
          </div>
        )}
        {!cargando && error && (
          <div className="presup-vacio presup-vacio--alerta">
            No se pudieron traer los remitos del cliente. Reintentá en unos segundos.
          </div>
        )}
        {!cargando && !error && remitos.length === 0 && (
          <div className="presup-vacio presup-vacio--alerta">
            Este cliente no tiene remitos pendientes de facturar.
          </div>
        )}
        {!cargando &&
          remitos.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`pcard ${seleccionado === r.id ? 'sel' : ''}`}
              aria-pressed={seleccionado === r.id}
              onClick={() => onSelect(r.id)}
            >
              <div className="pcard-top">
                <span className="pcard-id">{r.nro}</span>
                <span className={`pbadge ${badgeDe(r.estadoFacturacion)}`}>
                  {r.estadoFacturacion || 'Sin estado'}
                </span>
              </div>
              <div className="pcard-row">
                <div>
                  <div className="pcol-l">Fecha</div>
                  <div className="pcol-v">{r.fecha}</div>
                </div>
                <div>
                  <div className="pcol-l">Pend. de facturar</div>
                  <div className="pcol-v">
                    {pendienteDeRemito(r)} / {entregadoDeRemito(r)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pcol-l">Productos</div>
                  <div className="pcol-v">{r.productos.length}</div>
                </div>
              </div>
            </button>
          ))}
      </div>
      <div className="presup-foot">
        {cargando
          ? 'Consultando el tablero de Remitos…'
          : `Mostrando ${remitos.length} ${
              remitos.length === 1 ? 'remito pendiente' : 'remitos pendientes'
            }`}
      </div>
    </div>
  )
}
