import type { RemitoItem } from '@/types'

interface TablaRemitoProps {
  items: RemitoItem[]
  onCantidad: (uid: string, cantidad: number) => void
  onRemove: (uid: string) => void
}

/**
 * Líneas a remitar. El remito es un documento de cantidades: sin precio, sin
 * rentabilidad, sin descuento ni importes. Sólo código, producto, cantidad y u.m.
 */
export function TablaRemito({ items, onCantidad, onRemove }: TablaRemitoProps) {
  return (
    <div className="tablec">
      <div className="thtitle">Productos a remitar ({items.length})</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 20 }} />
            <th colSpan={2}>Producto</th>
            <th className="ta-c">Cantidad entregada</th>
            <th className="ta-c">Unidad de medida</th>
            <th className="ta-c">Acc.</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="tablec-empty">
                Todavía no cargaste productos para remitar.
              </td>
            </tr>
          )}
          {items.map((it, i) => {
            const tope = it.max
            const excede = tope !== undefined && it.cantidad > tope
            return (
              <tr key={it.uid}>
                <td style={{ width: 20, color: 'var(--text-gray)', fontWeight: 600 }}>{i + 1}</td>
                <td style={{ width: 90 }}>
                  <span style={{ color: 'var(--primary-blue)', fontWeight: 700 }}>{it.codigo}</span>
                </td>
                <td style={{ fontWeight: 600 }}>{it.nombre}</td>

                <td className="ta-c">
                  <span className={`qbox ${excede ? 'qbox--error' : ''}`}>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={`Cantidad a remitar de ${it.nombre}`}
                      aria-invalid={excede}
                      title={excede ? `No se puede remitar más de ${tope} pendientes` : ''}
                      value={it.cantidad}
                      onChange={(e) =>
                        onCantidad(it.uid, Number(e.target.value.replace(/\D/g, '')) || 0)
                      }
                    />
                    <span className="qbtns">
                      <button
                        type="button"
                        aria-label={`Sumar una unidad de ${it.nombre}`}
                        disabled={tope !== undefined && it.cantidad >= tope}
                        onClick={() => onCantidad(it.uid, it.cantidad + 1)}
                      >
                        <i className="fas fa-angle-up" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Restar una unidad de ${it.nombre}`}
                        disabled={it.cantidad === 0}
                        onClick={() => onCantidad(it.uid, it.cantidad - 1)}
                      >
                        <i className="fas fa-angle-down" />
                      </button>
                    </span>
                  </span>
                </td>

                <td className="ta-c" style={{ fontWeight: 600 }}>
                  {it.um}
                </td>
                <td className="ta-c">
                  <i
                    className="far fa-trash-alt trash"
                    role="button"
                    aria-label={`Quitar ${it.nombre}`}
                    onClick={() => onRemove(it.uid)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
