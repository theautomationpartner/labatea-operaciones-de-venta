import { useState } from 'react'
import type { RemitoItem } from '@/types'

interface RemitoAGenerarProps {
  /** ID del remito que se va a generar: es el título del desplegable. */
  numero: string
  items: RemitoItem[]
}

/**
 * El remito a generar, con el mismo desplegable que los comprobantes de la factura (clases
 * `comp-*` del sistema de diseño): cabecera siempre visible con el ID y la cantidad de productos
 * remitados, y el detalle por producto al desplegar. El remito documenta mercadería, no importes:
 * no lleva precios, subtotales ni totales.
 */
export function RemitoAGenerar({ numero, items }: RemitoAGenerarProps) {
  const [abierta, setAbierta] = useState(true)

  return (
    <div className="comprobantes">
      <div className="comprobantes-head">
        <h3 className="resumen-title">Remito a generar</h3>
      </div>

      <div className="comp-card">
        <div className="comp-head">
          <button
            type="button"
            className="comp-toggle"
            aria-expanded={abierta}
            onClick={() => setAbierta((v) => !v)}
          >
            <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
            <span className="comp-tit">{numero}</span>
          </button>

          <div className="comp-head-datos">
            <div className="comp-head-dato">
              <span className="comp-head-lbl">Productos</span>
              <span className="comp-head-val">{items.length}</span>
            </div>
          </div>
        </div>

        {abierta && (
          <div className="comp-body">
            <table className="comp-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="ta-c">Unidad de medida</th>
                  <th className="ta-c">Cantidad a remitir</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.uid}>
                    <td>
                      {it.codigo && <span className="comp-cod">{it.codigo}</span>}
                      <span className="comp-nom">{it.nombre}</span>
                    </td>
                    <td className="ta-c">{it.um || '—'}</td>
                    <td className="ta-c comp-total-prod">{it.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
