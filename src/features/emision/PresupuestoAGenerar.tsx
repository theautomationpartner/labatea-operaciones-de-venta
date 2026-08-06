import { useState } from 'react'
import { TotalesDoc } from '@/features/shared/TotalesDoc'
import { money, moneyU, round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import type { LineaPresupuesto } from '@/types'

interface PresupuestoAGenerarProps {
  /** ID del presupuesto que se va a registrar: es el título del desplegable. */
  numero: string
  lineas: LineaPresupuesto[]
  /** El presupuesto ya se emitió en el tablero en esta sesión: tilda el check en verde. */
  emitido?: boolean
}

/** Verde de los importes en dólares (mismo tono que la tabla y el resumen del presupuesto). */
const VERDE_USD = 'var(--green-dark)'

/** La línea está cotizada en dólares. */
const esUsd = (l: LineaPresupuesto): boolean => esDolar(l.producto.moneda)

/** Importe bonificado por unidad: lo que se descuenta (precio × desc%/100). Es el valor que también
 *  se escribe en `numeric_mm5rddvm` del subelemento. En la moneda del producto. */
const bonifUnitDe = (l: LineaPresupuesto): number => round2(l.producto.precio * (l.descuento / 100))

/** Total de la línea, ya bonificado: (precio − bonif) × cantidad. En la moneda del producto. */
const totalDe = (l: LineaPresupuesto): number =>
  round2(l.producto.precio * (1 - l.descuento / 100) * l.cantidad)

/** Suma de los totales (ya bonificados) de las líneas de una moneda (pesos o dólares). */
const totalMoneda = (lineas: LineaPresupuesto[], usd: boolean): number =>
  round2(lineas.filter((l) => esUsd(l) === usd).reduce((acc, l) => acc + totalDe(l), 0))

/** Suma del BRUTO (precio × cantidad, sin bonificar) de las líneas de una moneda. */
const brutoMoneda = (lineas: LineaPresupuesto[], usd: boolean): number =>
  round2(
    lineas
      .filter((l) => esUsd(l) === usd)
      .reduce((acc, l) => acc + l.producto.precio * l.cantidad, 0),
  )

/**
 * El presupuesto a registrar, con el mismo desplegable que los comprobantes de la factura: una
 * card plegable (mismas clases `comp-*` del sistema de diseño) con la cabecera siempre visible
 * —productos e importe total— y el detalle por producto al desplegar.
 *
 * Es BIMONETARIO: los productos en dólares NO se convierten ni se suman con los de pesos. Cada
 * moneda tiene su propio total (TOTAL EN PESOS / TOTAL EN DOLARES) y los importes en dólares se
 * muestran con prefijo `$u` en verde. Precio unitario, Importe Bonif. y Subtotal por línea son los
 * mismos valores que se escriben en las columnas del subelemento en Monday.
 */
export function PresupuestoAGenerar({ numero, lineas, emitido = false }: PresupuestoAGenerarProps) {
  const [abierta, setAbierta] = useState(true)

  const totalPesos = totalMoneda(lineas, false)
  const totalUsd = totalMoneda(lineas, true)
  const hayDolares = lineas.some(esUsd)
  // Totales estándar en pesos: bruto, descuento (bruto − neto) y gravado (= neto). El presupuesto
  // NO liquida IVA, así que el IVA es 0 y el Total coincide con el Gravado.
  const brutoPesos = brutoMoneda(lineas, false)
  const descuentoPesos = round2(brutoPesos - totalPesos)

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
              <span className="comp-head-val comp-head-val--imp">{money(totalPesos)}</span>
              {/* Los dólares no se mezclan con los pesos: se muestran aparte, en verde. */}
              {hayDolares && (
                <span
                  className="comp-head-val comp-head-val--imp"
                  style={{ color: VERDE_USD, fontSize: '0.85em' }}
                >
                  {moneyU(totalUsd)}
                </span>
              )}
            </div>
          </div>

          {/* Check de emisión: verde cuando el presupuesto ya se emitió en el tablero. */}
          <span className="comp-estado">
            <span
              className={`cobro-ok ${emitido ? 'on' : ''}`}
              title={emitido ? 'Presupuesto emitido' : 'Pendiente de emisión'}
            >
              <i className="fas fa-check" />
            </span>
          </span>
        </div>

        {abierta && (
          <div className="comp-body">
            <table className="comp-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="ta-c">Moneda</th>
                  <th className="ta-c">Cant.</th>
                  <th className="ta-r">P. unitario</th>
                  <th className="ta-r">Importe Bonif.</th>
                  <th className="ta-r">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const usd = esUsd(l)
                  const fmt = usd ? moneyU : money
                  const colUsd = usd ? VERDE_USD : undefined
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.producto.codigo && <span className="comp-cod">{l.producto.codigo}</span>}
                        <span className="comp-nom">{l.producto.nombre}</span>
                      </td>
                      {/* Moneda del producto: "USD" (verde) para dólares, "ARS" para pesos. */}
                      <td className="ta-c" style={{ fontWeight: 700, color: colUsd }}>
                        {usd ? 'USD' : 'ARS'}
                      </td>
                      <td className="ta-c">{l.cantidad}</td>
                      <td className="ta-r" style={{ color: colUsd }}>
                        {fmt(round2(l.producto.precio))}
                      </td>
                      <td className="ta-r" style={{ color: colUsd }}>
                        {fmt(bonifUnitDe(l))}
                      </td>
                      <td className="ta-r comp-total-prod" style={{ color: colUsd }}>
                        {fmt(totalDe(l))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Totales estándar, en el MISMO renglón y posición que en la card de factura: el
                `comp-pie` es el que los separa de la tabla y los alinea a la derecha (acá no hay
                vencimiento a la izquierda, pero el bloque cae igual donde en la factura).
                El presupuesto no liquida IVA (IVA = 0, Total = Gravado); el total en dólares va
                aparte, en verde. */}
            <div className="comp-pie">
              <TotalesDoc
                subtotal={brutoPesos}
                descuento={descuentoPesos}
                gravado={totalPesos}
                iva={0}
                total={totalPesos}
                totalUsd={hayDolares ? totalUsd : null}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
