import { money, pct } from '@/lib/format'
import type { ImpactoCredito, ResumenPresupuesto } from '@/lib/selectors'

interface ResumenBoxProps {
  /** Cambia según la operación: presupuesto o venta directa. */
  titulo: string
  resumen: ResumenPresupuesto
  credito: ImpactoCredito
  /** Límite de crédito asignado al cliente. */
  limite: number
  /** Sólo en VENTA: el presupuesto no liquida comisión. */
  comision?: { pct: number; monto: number }
  /** Sólo en VENTA: el presupuesto no liquida IVA, así que no lo muestra. */
  mostrarIva?: boolean
  /** Muestra ÚNICAMENTE el total (sin Subtotal ni Descuento global). */
  soloTotal?: boolean
  /** Etiqueta del renglón de total (ej. "TOTAL PRESUPUESTADO"). */
  totalLabel?: string
}

/** Umbrales del semáforo de rentabilidad general de la operación. */
const RENT_BUENA = 20
const RENT_ACEPTABLE = 10

const colorRentabilidad = (rentabilidad: number) => {
  if (rentabilidad >= RENT_BUENA) return 'var(--p-success)'
  if (rentabilidad >= RENT_ACEPTABLE) return 'var(--yellow)'
  return 'var(--p-danger)'
}

/** Totales en una tarjeta; rentabilidad e impacto en el crédito, en la otra. */
export function ResumenBox({
  titulo,
  resumen,
  credito,
  limite,
  comision,
  mostrarIva = true,
  soloTotal = false,
  totalLabel = 'TOTAL',
}: ResumenBoxProps) {
  const colorCredito = credito.critico ? 'var(--p-danger)' : 'var(--p-success)'
  const colorRent = colorRentabilidad(resumen.rentabilidad)
  const usado = Math.min(Math.max(credito.usadoPct, 0), 100)
  // El anillo se llena hasta el 100%: el número del centro sí muestra el valor real.
  const rentGrafico = Math.min(Math.max(resumen.rentabilidad, 0), 100)

  return (
    <div className="totals-grid totals-grid--2" aria-label={titulo}>
      <div className="kpi-card">
        <div className="subtotal-lines">
          {/* Con `soloTotal` no se muestran Subtotal, Descuento ni IVA: sólo el total final. */}
          {!soloTotal && (
            <>
              {/* El subtotal es el bruto: la suma de la columna Subtotal de la tabla. */}
              <div className="sub-row">
                <span>Subtotal</span>
                <span>{money(resumen.subtotal)}</span>
              </div>
              {/* El descuento se muestra SIEMPRE, aunque sea $0 (renglón fijo). */}
              <div className="sub-row">
                <span>Descuento</span>
                <span>{resumen.descuento > 0 ? `− ${money(resumen.descuento)}` : money(0)}</span>
              </div>
              {/* IVA sólo en Cargar Venta; en Presupuestar no se declara. */}
              {mostrarIva && (
                <div className="sub-row">
                  <span>IVA (21%)</span>
                  <span>{money(resumen.iva)}</span>
                </div>
              )}
            </>
          )}
          <div className="total-row">
            <span>{totalLabel}</span>
            <span>{money(resumen.total)}</span>
          </div>
          {/* Comisión (sólo Ventas): DEBAJO del total, con la misma jerarquía que Subtotal/Descuento. */}
          {!soloTotal && comision && (
            <div className="sub-row">
              <span>Comisión ({comision.pct}%)</span>
              <span>{money(comision.monto)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Rentabilidad y crédito juntos: los dos indicadores de salud de la operación. */}
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
              aria-label="Rentabilidad general de la operación"
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
                <span className="donut-val">{pct(credito.usadoPct)}</span>
                <span className="donut-lbl">Utilizado</span>
              </div>
            </div>
            <div className="donut-footer">Del límite de crédito</div>
          </div>

          <div className="credit-details">
            <div className="credit-row">
              <span className="c-lbl">Límite asignado</span>
              <span className="c-val">{money(limite)}</span>
            </div>
            <div className="credit-row">
              <span className="c-lbl">Crédito disponible</span>
              <span className="c-val" style={{ color: colorCredito }}>
                {money(credito.disponible)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
