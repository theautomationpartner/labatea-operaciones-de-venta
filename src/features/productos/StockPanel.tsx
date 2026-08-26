import { cobertura, stockConIngreso } from '@/lib/selectors'
import type { Producto } from '@/types'

interface Caja {
  titulo: string
  valor: number
  fondo: string
  color: string
  icono: string
  /**
   * Cómo quedaría la métrica si la devolución se registrara. Se muestra EN VERDE al lado del valor
   * base, que no se toca: lo que hay en el tablero sigue siendo lo que hay hasta que la operación
   * se cierre, y pisarlo haría creer que el movimiento ya ocurrió.
   */
  proyectado?: number
}

/**
 * Qué le hace al stock la cantidad que se está cargando:
 *  · `consumo` — sale mercadería (presupuesto, venta, remito de entrega). Es el caso normal.
 *  · `ingreso` — VUELVE mercadería (devolución): suma al stock en vez de comprometerlo.
 */
export type ModoStock = 'consumo' | 'ingreso'

const cajas = (p: Producto, modo: ModoStock, cantidad: number): Caja[] => {
  /* Entra mercadería (devolución): se proyectan las cuatro métricas con las MISMAS fórmulas del
     tablero. La proyección acompaña a cada base; sólo "Ingresos" muestra el valor ya sumado,
     porque es la única métrica que la devolución mueve de forma directa. */
  const entra = modo === 'ingreso' && cantidad > 0
  const pro = entra ? stockConIngreso(p, cantidad) : null
  return [
    ...(modo === 'ingreso'
      ? [
          {
            titulo: 'Ingresos',
            valor: pro ? pro.ingresos : p.ingresos,
            fondo: '#e0f7f4',
            color: '#00897b',
            icono: 'fa-inbox',
          },
        ]
      : []),
    {
      titulo: 'Stock físico',
      valor: p.fisico,
      proyectado: pro?.fisico,
      fondo: '#e5f0ff',
      color: 'var(--primary-blue)',
      icono: 'fa-box',
    },
    {
      titulo: 'Stock comercial',
      valor: p.comercial,
      proyectado: pro?.comercial,
      fondo: '#e6f9f0',
      color: 'var(--green-dark)',
      icono: 'fa-lock-open',
    },
    {
      titulo: 'Stock disponible',
      valor: p.disponible,
      proyectado: pro?.disponible,
      fondo: '#f0e6ff',
      color: '#6200ee',
      icono: 'fa-pallet',
    },
  ]
}

/**
 * Proveedor y tipo de mercadería en UNA sola línea: código, razón social y tipo. Se renderiza
 * suelto (en la cabecera del detalle de la línea) o dentro del panel de stock.
 */
export function ProveedorLinea({ producto }: { producto: Producto }) {
  const esConsignada = producto.tipo.trim().toUpperCase() === 'CO'

  return (
    <div className="stock-prov">
      {/* Código del proveedor (mirror del maestro) y su razón social, uno al lado del otro. */}
      <span className="stock-prov-cod">{producto.provCod || '—'}</span>
      <span className="stock-prov-name">{producto.provNombre || 'Sin proveedor asignado'}</span>
      {/* La mercadería consignada se distingue a simple vista. */}
      <span className={`stock-tipo ${esConsignada ? 'stock-tipo--consignada' : ''}`}>
        Tipo: <b>{producto.tipo || '—'}</b>
      </span>
    </div>
  )
}

interface StockPanelProps {
  producto: Producto
  /** Unidades en curso: mueven la barra de cobertura, nunca el stock. */
  cantidad: number
  /** El detalle de la línea lo muestra en su cabecera: ahí se omite para no repetirlo. */
  conProveedor?: boolean
  /** En qué sentido mueve el stock la cantidad cargada. Por defecto, consumo. */
  modo?: ModoStock
}

/** Detalle de proveedor y stock; se reutiliza en el preview y en la fila expandida. */
export function StockPanel({
  producto,
  cantidad,
  conProveedor = true,
  modo = 'consumo',
}: StockPanelProps) {
  const cov = cobertura(producto, cantidad)
  const entra = modo === 'ingreso'

  return (
    <div className="stock">
      {conProveedor && <ProveedorLinea producto={producto} />}

      <div className="stock-main">
        <div className="stock-boxes">
          {cajas(producto, modo, cantidad).map((c) => (
            <div className="stock-box" key={c.titulo}>
              <div>
                <div className="stock-box-t">{c.titulo}</div>
                <div className="stock-box-v">
                  {c.valor}
                  {/* Cómo quedaría al cerrar la devolución, al lado del valor que hoy tiene el
                      tablero. El base no se toca: el movimiento todavía no ocurrió. */}
                  {c.proyectado != null && (
                    <span
                      className="stock-box-proy"
                      title={`Si se registra la devolución, ${c.titulo.toLowerCase()} queda en ${c.proyectado}`}
                    >
                      +{c.proyectado}
                    </span>
                  )}
                </div>
              </div>
              <div className="stock-box-ic" style={{ background: c.fondo, color: c.color }}>
                <i className={`fas ${c.icono}`} />
              </div>
            </div>
          ))}
        </div>

        <div className={`cov-wrap ${!entra && cov.excede ? 'cov-wrap--excede' : ''}`}>
          {/* La cobertura mide cuánto del stock disponible se LLEVA la cantidad cargada. Cuando la
              mercadería entra (devolución) no hay nada que consumir: la barra marcaría siempre lo
              mismo y el rótulo hablaría de algo que no está pasando. Queda sólo la nota. */}
          {!entra && (
            <>
              <div className="cov-title">
                Cobertura
                <i
                  className="fas fa-circle-info cov-info"
                  title="Cuánto del stock disponible consume la cantidad cargada en esta línea."
                />
              </div>
              {/* Barra de temperatura: se llena y se calienta a medida que consume lo disponible. */}
              <div
                className="cov-bar"
                role="meter"
                aria-valuenow={Math.round(cov.pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Cobertura sobre el stock disponible"
              >
                <div
                  className="cov-fill"
                  style={{ width: `${cov.pctBarra}%`, background: cov.color }}
                >
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
            </>
          )}
          <div className="cov-note">
            {entra ? (
              <>
                Ingreso: {cantidad} {cantidad === 1 ? 'unidad' : 'unidades'} (impacta en tu stock
                físico).
              </>
            ) : (
              <>
                Presupuestado: {cantidad} {cantidad === 1 ? 'unidad' : 'unidades'} (
                {cov.pct.toFixed(1)}% de la cobertura total)
              </>
            )}
            {/* Pasarse de lo disponible sólo es un problema cuando la mercadería SALE. */}
            {!entra && cov.excede && (
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
