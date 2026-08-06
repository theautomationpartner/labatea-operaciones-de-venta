import { money, moneyU, pct, pctDec } from '@/lib/format'
import type { ImpactoCredito, ResumenPresupuesto } from '@/lib/selectors'

/**
 * Desglose bimonetario del PRESUPUESTO. Reemplaza el bloque de totales estándar: separa los
 * importes en pesos y agrega el total en dólares (los productos en USD no se convierten).
 */
export interface TotalesBimoneda {
  /** Σ (precio × cantidad) de los productos en pesos, sin bonificar. */
  subtotalArs: number
  /** Σ de lo bonificado de los productos en pesos. */
  descuentoArs: number
  /** Neto en pesos: el "TOTAL EN PESOS". */
  totalArs: number
  /** Neto en dólares: el "TOTAL EN DOLARES". */
  totalUsd: number
  /** Hay productos en dólares: habilita la aclaración de conversión bajo el crédito. */
  hayDolares: boolean
}

interface ResumenBoxProps {
  /** Cambia según la operación: presupuesto o venta directa. */
  titulo: string
  resumen: ResumenPresupuesto
  credito: ImpactoCredito
  /** Límite de crédito asignado al cliente. */
  limite: number
  /** Sólo en VENTA: monto de comisión total. El renglón "Comisión ($)" se muestra si es > 0. */
  comision?: number
  /** Sólo en VENTA: el presupuesto no liquida IVA, así que no lo muestra. */
  mostrarIva?: boolean
  /** Muestra ÚNICAMENTE el total (sin Subtotal ni Descuento global). */
  soloTotal?: boolean
  /** Etiqueta del renglón de total (ej. "TOTAL PRESUPUESTADO"). */
  totalLabel?: string
  /**
   * PRESUPUESTO bimonetario: cuando viene, reemplaza el bloque de totales por el desglose ARS/USD
   * (Subtotal ARS, Descuento ARS, TOTAL EN PESOS y TOTAL EN DOLARES) y muestra la aclaración de
   * conversión bajo el crédito. `soloTotal` y `totalLabel` se ignoran.
   */
  bimoneda?: TotalesBimoneda
}

/** Verde de los importes en dólares (mismo tono que la tabla del presupuesto). */
const VERDE_USD = 'var(--green-dark)'

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
  bimoneda,
}: ResumenBoxProps) {
  const colorCredito = credito.critico ? 'var(--p-danger)' : 'var(--p-success)'
  const colorRent = colorRentabilidad(resumen.rentabilidad)
  const usado = Math.min(Math.max(credito.usadoPct, 0), 100)
  // El anillo se llena hasta el 100%: el número del centro sí muestra el valor real.
  const rentGrafico = Math.min(Math.max(resumen.rentabilidad, 0), 100)

  return (
    <div className="totals-grid totals-grid--2" aria-label={titulo}>
      <div className="kpi-card">
        {bimoneda ? (
          /* PRESUPUESTO bimonetario: pesos y dólares desglosados, cada moneda con su total. */
          <div className="subtotal-lines">
            {/* Subtotal y descuento son SÓLO de los productos en pesos. */}
            <div className="sub-row">
              <span>Subtotal (ARS)</span>
              <span>{money(bimoneda.subtotalArs)}</span>
            </div>
            <div className="sub-row">
              <span>Descuento (-ARS)</span>
              <span>
                {bimoneda.descuentoArs > 0 ? `− ${money(bimoneda.descuentoArs)}` : money(0)}
              </span>
            </div>
            {/* Gravado = suma de la columna Importe Total (neto). Debajo del Descuento. En el
                presupuesto no hay IVA, así que coincide con el TOTAL EN PESOS. */}
            <div className="sub-row">
              <span>Gravado ($)</span>
              <span>{money(bimoneda.totalArs)}</span>
            </div>
            {/* Neto a pagar en pesos. */}
            <div className="total-row">
              <span>TOTAL EN PESOS</span>
              <span>{money(bimoneda.totalArs)}</span>
            </div>
            {/* Neto de los productos en dólares, en su moneda original y en verde. Misma
                jerarquía tipográfica que el total en pesos (renglón `total-row`). */}
            <div className="total-row" style={{ color: VERDE_USD }}>
              <span>TOTAL EN DOLARES</span>
              <span>{moneyU(bimoneda.totalUsd)}</span>
            </div>
          </div>
        ) : (
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
                {/* Gravado = suma de la columna Importe Total (Subtotal − Descuento): el neto antes
                    del IVA. Va debajo del Descuento. */}
                <div className="sub-row">
                  <span>Gravado ($)</span>
                  <span>{money(resumen.neto)}</span>
                </div>
                {/* IVA sólo en Cargar Venta; en Presupuestar no se declara. */}
                {mostrarIva && (
                  <div className="sub-row">
                    <span>IVA ($)</span>
                    <span>{money(resumen.iva)}</span>
                  </div>
                )}
              </>
            )}
            <div className="total-row">
              <span>{totalLabel}</span>
              <span>{money(resumen.total)}</span>
            </div>
            {/* Comisión (sólo Ventas): DEBAJO del total, misma jerarquía que Subtotal/Descuento.
                Se muestra SIEMPRE (aunque sea 0) para mantener la métrica estandarizada. */}
            {!soloTotal && comision != null && (
              <div className="sub-row">
                <span>Comisión ($)</span>
                <span>{money(comision)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rentabilidad y crédito juntos: los dos indicadores de salud de la operación. */}
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
              aria-label="Rentabilidad general de la operación"
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

        {/* Aclaración: el crédito proyectado incluye los dólares llevados a pesos al cambio de hoy. */}
        {bimoneda?.hayDolares && (
          <p className="credito-nota-usd">
            Los totales en dólares han sido convertidos al tipo de cambio a fecha de hoy para mostrar
            un resultado posible del crédito final del cliente.
          </p>
        )}
      </div>
    </div>
  )
}
