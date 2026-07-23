import { cobertura } from '@/lib/selectors'
import type { Producto } from '@/types'

interface Caja {
  titulo: string
  valor: number
  fondo: string
  color: string
  icono: string
}

const cajas = (p: Producto): Caja[] => [
  { titulo: 'Stock físico', valor: p.fisico, fondo: '#e5f0ff', color: 'var(--primary-blue)', icono: 'fa-box' },
  { titulo: 'Stock comercial', valor: p.comercial, fondo: '#e6f9f0', color: 'var(--green-dark)', icono: 'fa-lock-open' },
  { titulo: 'Stock disponible', valor: p.disponible, fondo: '#f0e6ff', color: '#6200ee', icono: 'fa-pallet' },
]

interface StockPanelProps {
  producto: Producto
  /** Unidades en curso: mueven la barra de cobertura, nunca el stock. */
  cantidad: number
}

/** Detalle de proveedor y stock; se reutiliza en el preview y en la fila expandida. */
export function StockPanel({ producto, cantidad }: StockPanelProps) {
  const cov = cobertura(producto, cantidad)
  const esConsignada = producto.tipo.trim().toUpperCase() === 'CO'

  return (
    <div className="stock">
      <div className="stock-prov">
        <div className="stock-lbl">Proveedor</div>
        {/* Código del proveedor (mirror del maestro) y su razón social. */}
        <div className="stock-prov-cod">{producto.provCod || '—'}</div>
        <div className="stock-prov-name">{producto.provNombre || 'Sin proveedor asignado'}</div>
        {/* La mercadería consignada se distingue a simple vista. */}
        <div className={`stock-tipo ${esConsignada ? 'stock-tipo--consignada' : ''}`}>
          Tipo: <b>{producto.tipo || '—'}</b>
        </div>
      </div>

      <div className="stock-main">
        <div className="stock-boxes">
          {cajas(producto).map((c) => (
            <div className="stock-box" key={c.titulo}>
              <div>
                <div className="stock-box-t">{c.titulo}</div>
                <div className="stock-box-v">{c.valor}</div>
              </div>
              <div className="stock-box-ic" style={{ background: c.fondo, color: c.color }}>
                <i className={`fas ${c.icono}`} />
              </div>
            </div>
          ))}
        </div>

        <div className={`cov-wrap ${cov.excede ? 'cov-wrap--excede' : ''}`}>
          <div className="cov-title">Barra de cobertura</div>
          {/* Barra de temperatura: se llena y se calienta a medida que consume lo disponible. */}
          <div
            className="cov-bar"
            role="meter"
            aria-valuenow={Math.round(cov.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Cobertura sobre el stock disponible"
          >
            <div className="cov-fill" style={{ width: `${cov.pctBarra}%`, background: cov.color }}>
              {/* El degradado se escala al ancho de la pista: la punta marca la temperatura. */}
              <div
                className="cov-heat"
                style={{ width: cov.pctBarra > 0 ? `${(100 / cov.pctBarra) * 100}%` : '100%' }}
              />
            </div>
          </div>
          <div className="cov-track">
            <i
              className="fas fa-caret-up cov-needle"
              style={{ left: `${cov.pctBarra}%`, color: cov.color }}
            />
          </div>
          <div className="cov-note">
            Presupuestado: {cantidad} {cantidad === 1 ? 'unidad' : 'unidades'} (
            {cov.pct.toFixed(1)}% de la cobertura total)
            {cov.excede && (
              <span className="cov-alerta">
                <i className="fas fa-triangle-exclamation" /> Excede el stock disponible (
                {producto.disponible})
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
