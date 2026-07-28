import { money, pct, pctDec, round2 } from '@/lib/format'
import type { ResumenFactura } from '@/lib/selectors'

/** Comisión pasiva de la venta con entrega ANTERIOR: 1,5% de la base imponible (neto a facturar). */
const COMISION_PASIVA_PCT = 1.5

/** Umbrales del semáforo de rentabilidad general, iguales a los del resto de la app. */
const RENT_BUENA = 20
const RENT_ACEPTABLE = 10

const colorRentabilidad = (rentabilidad: number) => {
  if (rentabilidad >= RENT_BUENA) return 'var(--p-success)'
  if (rentabilidad >= RENT_ACEPTABLE) return 'var(--yellow)'
  return 'var(--p-danger)'
}

/** Totales de la factura e impacto en el crédito, en dos tarjetas. */
export function ResumenFacturaBand({ resumen }: { resumen: ResumenFactura }) {
  const colorCredito = resumen.critico ? 'var(--p-danger)' : 'var(--p-success)'
  const colorRent = colorRentabilidad(resumen.rentabilidad)
  const usado = Math.min(Math.max(resumen.usadoPct, 0), 100)
  // El anillo se llena hasta el 100%; el número del centro sí muestra el valor real.
  const rentGrafico = Math.min(Math.max(resumen.rentabilidad, 0), 100)
  // Comisión pasiva: 1,5% de la base imponible (neto a facturar). Es una ganancia en $.
  const comisionPasiva = round2((resumen.neto * COMISION_PASIVA_PCT) / 100)

  return (
    <div className="totals-grid totals-grid--2" aria-label="Resumen de la facturación">
      <div className="kpi-card">
        <div className="subtotal-lines">
          <div className="sub-row">
            <span>Importe subtotal</span>
            <span>{money(resumen.subtotal)}</span>
          </div>
          <div className="sub-row">
            <span>Descuento</span>
            <span style={resumen.descuento > 0 ? { color: 'var(--p-danger)' } : undefined}>
              {resumen.descuento > 0 ? `- ${money(resumen.descuento)}` : money(0)}
            </span>
          </div>
          {/* Comisión pasiva (1,5% del neto): ganancia en $, con la misma jerarquía que el resto. */}
          <div className="sub-row">
            <span>Comisión pasiva ({pctDec(COMISION_PASIVA_PCT)})</span>
            <span style={comisionPasiva > 0 ? { color: 'var(--p-success)' } : undefined}>
              {money(comisionPasiva)}
            </span>
          </div>
          <div className="total-row">
            <span>NETO A FACTURAR</span>
            <span>{money(resumen.neto)}</span>
          </div>
        </div>
      </div>

      {/* Rentabilidad y crédito juntos: la rentabilidad general va a la IZQUIERDA del crédito usado. */}
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
            {/* Crédito que le queda al cliente con esta factura incluida: baja al sumar productos. */}
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
