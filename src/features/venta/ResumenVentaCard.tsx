import { money, pct } from '@/lib/format'
import type { ResumenVenta } from '@/lib/selectors'

/** Umbrales del semáforo de rentabilidad general de la venta. */
const RENT_BUENA = 20
const RENT_ACEPTABLE = 10

const colorRentabilidad = (rentabilidad: number) => {
  if (rentabilidad >= RENT_BUENA) return 'var(--p-success)'
  if (rentabilidad >= RENT_ACEPTABLE) return 'var(--yellow)'
  return 'var(--p-danger)'
}

/** Totales en una tarjeta; rentabilidad e impacto en el crédito de la venta, en la otra. */
export function ResumenVentaCard({ resumen }: { resumen: ResumenVenta }) {
  const colorCredito = resumen.critico ? 'var(--p-danger)' : 'var(--p-success)'
  const colorRent = colorRentabilidad(resumen.rentabilidad)
  const usado = Math.min(Math.max(resumen.usadoPct, 0), 100)
  // El anillo se llena hasta el 100%: el número del centro sí muestra el valor real.
  const rentGrafico = Math.min(Math.max(resumen.rentabilidad, 0), 100)

  return (
    <div className="totals-grid totals-grid--2" aria-label="Resumen de la venta">
      <div className="kpi-card">
        <div className="subtotal-lines">
          {/* El subtotal es el bruto: la suma de la columna Subtotal de la tabla. */}
          <div className="sub-row">
            <span>Subtotal</span>
            <span>{money(resumen.subtotal)}</span>
          </div>
          {resumen.descuento > 0 && (
            <div className="sub-row">
              <span>Descuento</span>
              <span>− {money(resumen.descuento)}</span>
            </div>
          )}
          <div className="sub-row">
            <span>Comisión ({resumen.comisionPct}%)</span>
            <span>{money(resumen.comision)}</span>
          </div>
          <div className="total-row">
            <span>IMPORTE TOTAL</span>
            <span>{money(resumen.total)}</span>
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
              aria-valuenow={Math.round(resumen.rentabilidad)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Rentabilidad general de la venta"
              style={{
                background: `conic-gradient(${colorRent} 0% ${rentGrafico}%, var(--p-border) ${rentGrafico}% 100%)`,
              }}
            >
              <div className="donut-inner">
                <span className="donut-val" style={{ color: colorRent }}>
                  {pct(resumen.rentabilidad)}
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
