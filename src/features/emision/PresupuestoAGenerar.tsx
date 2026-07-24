import { useState } from 'react'
import { money, round2 } from '@/lib/format'
import type { LineaPresupuesto } from '@/types'

interface PresupuestoAGenerarProps {
  /** ID del presupuesto que se va a registrar: es el título del desplegable. */
  numero: string
  lineas: LineaPresupuesto[]
  /** Importe total del presupuesto (neto; el presupuesto no liquida IVA). */
  total: number
}

/**
 * Precio unitario con el descuento de la línea YA aplicado sobre el precio, no sobre el total.
 * El subtotal del ítem es cantidad × este precio.
 */
const precioConDescuento = (l: LineaPresupuesto): number =>
  round2(l.producto.precio * (1 - l.descuento / 100))

/**
 * El presupuesto a registrar, con el mismo desplegable que los comprobantes de la factura: una
 * card plegable (mismas clases `comp-*` del sistema de diseño) con la cabecera siempre visible
 * —productos e importe total— y el detalle por producto al desplegar. El descuento se aplica al
 * precio unitario y el subtotal de cada ítem es cantidad × ese precio bonificado.
 */
export function PresupuestoAGenerar({ numero, lineas, total }: PresupuestoAGenerarProps) {
  const [abierta, setAbierta] = useState(true)

  return (
    <div className="comprobantes">
      <div className="comprobantes-head">
        <h3 className="resumen-title">Presupuesto a generar</h3>
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
              <span className="comp-head-val">{lineas.length}</span>
            </div>
            <div className="comp-head-dato">
              <span className="comp-head-lbl">Importe total</span>
              <span className="comp-head-val comp-head-val--imp">{money(total)}</span>
            </div>
          </div>
        </div>

        {abierta && (
          <div className="comp-body">
            <table className="comp-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="ta-c">Cant.</th>
                  <th className="ta-r">P. unitario</th>
                  <th className="ta-r">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const punit = precioConDescuento(l)
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.producto.codigo && <span className="comp-cod">{l.producto.codigo}</span>}
                        <span className="comp-nom">{l.producto.nombre}</span>
                      </td>
                      <td className="ta-c">{l.cantidad}</td>
                      <td className="ta-r">{money(punit)}</td>
                      <td className="ta-r comp-total-prod">{money(round2(punit * l.cantidad))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pie del listado: el total del presupuesto, en pesos. */}
            <div className="comp-tot">
              <div className="comp-tot-row comp-tot-row--total">
                <span>TOTAL EN PESOS</span>
                <b>{money(total)}</b>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
