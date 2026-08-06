import { money, pct, pctDec } from '@/lib/format'
import type { ResumenVenta } from '@/lib/selectors'

/** Umbrales del semáforo de rentabilidad general de la venta. */
const RENT_BUENA = 20
const RENT_ACEPTABLE = 10

const colorRentabilidad = (rentabilidad: number) => {
  if (rentabilidad >= RENT_BUENA) return 'var(--p-success)'
  if (rentabilidad >= RENT_ACEPTABLE) return 'var(--yellow)'
  return 'var(--p-danger)'
}

interface ResumenVentaCardProps {
  resumen: ResumenVenta
  /** Oculta el renglón "Subtotal" (VENTA PROFORMA: el importe ya viene de la proforma). */
  ocultarSubtotal?: boolean
  /** Reemplaza el IMPORTE TOTAL calculado por uno dado (VENTA PROFORMA: el total de la proforma). */
  totalOverride?: number
}

/** Totales en una tarjeta; rentabilidad e impacto en el crédito de la venta, en la otra. */
export function ResumenVentaCard({ resumen, ocultarSubtotal = false, totalOverride }: ResumenVentaCardProps) {
  const colorCredito = resumen.critico ? 'var(--p-danger)' : 'var(--p-success)'
  const colorRent = colorRentabilidad(resumen.rentabilidad)
  const usado = Math.min(Math.max(resumen.usadoPct, 0), 100)
  // El anillo se llena hasta el 100%: el número del centro sí muestra el valor real.
  const rentGrafico = Math.min(Math.max(resumen.rentabilidad, 0), 100)

  return (
    <div className="totals-grid totals-grid--2" aria-label="Resumen de la venta">
      <div className="kpi-card">
        <div className="subtotal-lines">
          {/* Desglose del importe (VENTA normal): Subtotal bruto, el descuento total —la suma de la
              columna Importe Bonif.—, que se resta, y el IVA, que se suma sobre el neto. En VENTA
              PROFORMA no se muestra: el total viene dado por la proforma. */}
          {!ocultarSubtotal && (
            <>
              <div className="sub-row">
                <span>Subtotal</span>
                <span>{money(resumen.subtotal)}</span>
              </div>
              {/* Descuento total = suma de los importes bonificados; se resta del subtotal. */}
              <div className="sub-row">
                <span>Descuento</span>
                <span>
                  {resumen.descuento > 0 ? `− ${money(resumen.descuento)}` : money(0)}
                </span>
              </div>
              {/* Gravado = suma de la columna Importe Total (Subtotal − Descuento): el neto antes
                  del IVA. Va debajo del Descuento. */}
              <div className="sub-row">
                <span>Gravado ($)</span>
                <span>{money(resumen.total)}</span>
              </div>
              {/* IVA total sobre el neto (Subtotal − Descuento); se suma para el importe total. */}
              <div className="sub-row">
                <span>IVA ($)</span>
                <span>{money(resumen.iva)}</span>
              </div>
            </>
          )}
          {/* TOTAL = Subtotal − Descuento + IVA (neto con impuestos). La VENTA PROFORMA lo
              reemplaza por el total de la proforma. */}
          <div className="total-row">
            <span>TOTAL</span>
            <span>{money(totalOverride ?? resumen.total + resumen.iva)}</span>
          </div>
          {/* Comisión total (dinámica). DEBAJO del total, SIEMPRE visible (aunque sea 0) para
              mantener la métrica estandarizada. */}
          <div className="sub-row">
            <span>Comisión ($)</span>
            <span>{money(resumen.comision)}</span>
          </div>
        </div>
      </div>

      {/* Rentabilidad y crédito juntos: los dos indicadores de salud de la venta. */}
      <div className="kpi-card">
        <span className="rent-lbl">Rentabilidad y crédito</span>
        <div className="indicadores-layout">
          <div className="donut-container">
            <div
              className="donut-chart"
              role="meter"
              aria-valuenow={resumen.rentabilidad}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Rentabilidad general de la venta"
              style={{
                background: `conic-gradient(${colorRent} 0% ${rentGrafico}%, var(--p-border) ${rentGrafico}% 100%)`,
              }}
            >
              <div className="donut-inner">
                {/* Con decimales cuando los tiene: la rentabilidad general no es un entero. */}
                <span className="donut-val" style={{ color: colorRent }}>
                  {pctDec(resumen.rentabilidad)}
                </span>
                <span className="donut-lbl">General</span>
              </div>
            </div>
            <div className="donut-footer">Rentabilidad</div>
          </div>

          <div className="donut-container">
            <div
              className="donut-chart"
              role="meter"
              aria-valuenow={Math.round(usado)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Uso del límite de crédito"
              style={{
                background: `conic-gradient(${colorCredito} 0% ${usado}%, var(--p-border) ${usado}% 100%)`,
              }}
            >
              <div className="donut-inner">
                <span className="donut-val">{pct(resumen.usadoPct)}</span>
                <span className="donut-lbl">Utilizado</span>
              </div>
            </div>
            <div className="donut-footer">Del límite de crédito</div>
          </div>

          <div className="credit-details">
            <div className="credit-row">
              <span className="c-lbl">Límite asignado</span>
              <span className="c-val">{money(resumen.limite)}</span>
            </div>
            {/* Crédito que le queda al cliente con esta venta incluida: baja al sumar productos. */}
            <div className="credit-row">
              <span className="c-lbl">Crédito disponible</span>
              <span
                className="c-val"
                style={{ color: resumen.resultante < 0 ? 'var(--p-danger)' : colorCredito }}
              >
                {money(resumen.resultante)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
