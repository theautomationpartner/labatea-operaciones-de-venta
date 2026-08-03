import { money, round2 } from '@/lib/format'
import type { RemitoItem } from '@/types'

interface TablaRemitoProps {
  items: RemitoItem[]
  onCantidad: (uid: string, cantidad: number) => void
  onRemove: (uid: string) => void
  /**
   * Remito POSTERIOR: además de las cantidades, muestra el precio unitario, el total por producto
   * (cantidad × precio) y, debajo, el importe pendiente de facturar. El remito ANTERIOR es un
   * documento de sólo cantidades y no expone importes.
   */
  mostrarImporte?: boolean
  /** Post-emisión: la tabla pasa a SOLO LECTURA (cantidades no editables, sin quitar líneas). */
  soloLectura?: boolean
}

/** Total de la línea: cantidad a entregar × precio unitario. */
const totalLinea = (it: RemitoItem): number => round2(it.cantidad * (it.precioUnitario ?? 0))

/**
 * Líneas a remitar. En ANTERIOR es un documento de cantidades (código, producto, cantidad y u.m.).
 * En POSTERIOR, además, muestra precio unitario, total por producto y el importe pendiente de
 * facturar, que es la suma de todos los totales.
 */
export function TablaRemito({
  items,
  onCantidad,
  onRemove,
  mostrarImporte = false,
  soloLectura = false,
}: TablaRemitoProps) {
  // Sin importes: 6 columnas. Con importes (POSTERIOR): 8. −1 sin la columna de acciones (sólo lectura).
  const colSpanVacio = (mostrarImporte ? 8 : 6) - (soloLectura ? 1 : 0)
  const importePendFacturar = round2(items.reduce((acc, it) => acc + totalLinea(it), 0))

  const tabla = (
    <div className="tablec">
      <div className="thtitle">Productos a remitar ({items.length})</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 20 }} />
            <th colSpan={2}>Producto</th>
            <th className="ta-c">Cantidad a entregar</th>
            <th className="ta-c">Unidad de medida</th>
            {mostrarImporte && <th className="ta-c">Precio unitario</th>}
            {mostrarImporte && <th className="ta-c">Total por producto</th>}
            {!soloLectura && <th className="ta-c">Acc.</th>}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={colSpanVacio} className="tablec-empty">
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

                <td className="ta-c" style={{ fontWeight: 600 }}>
                  {soloLectura ? (
                    it.cantidad
                  ) : (
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
                  )}
                </td>

                <td className="ta-c" style={{ fontWeight: 600 }}>
                  {it.um}
                </td>

                {mostrarImporte && <td className="ta-c">{money(it.precioUnitario ?? 0)}</td>}
                {mostrarImporte && (
                  <td className="ta-c" style={{ fontWeight: 700 }}>
                    {money(totalLinea(it))}
                  </td>
                )}

                {!soloLectura && (
                  <td className="ta-c">
                    <i
                      className="far fa-trash-alt trash"
                      role="button"
                      aria-label={`Quitar ${it.nombre}`}
                      onClick={() => onRemove(it.uid)}
                    />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      {tabla}

      {/* Resumen financiero del remito POSTERIOR: misma tarjeta de importes que el resto de la app
          (Subtotal + total destacado), ubicada a la izquierda. */}
      {mostrarImporte && items.length > 0 && (
        <div className="remito-importe-wrap">
          <div className="kpi-card">
            <div className="subtotal-lines">
              <div className="sub-row">
                <span>Subtotal</span>
                <span>{money(importePendFacturar)}</span>
              </div>
              <div className="total-row">
                <span>IMPORTE PEND DE FACTURAR</span>
                <span>{money(importePendFacturar)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
