import { money, moneyU } from '@/lib/format'

interface TotalesDocProps {
  /** Bruto: suma de (precio × cantidad) sin bonificar. */
  subtotal: number
  /** Total bonificado (Subtotal − Gravado). Se muestra en negativo. */
  descuento: number
  /** Base gravada = Subtotal − Descuento (el neto antes del IVA). */
  gravado: number
  /** IVA en pesos. En el presupuesto es 0 (no lo liquida). */
  iva: number
  /** Total final (Gravado + IVA). */
  total: number
  /** Presupuesto bimonetario: total en dólares, mostrado aparte en verde (opcional). */
  totalUsd?: number | null
}

/** Verde de los importes en dólares (mismo tono que el resto de la app). */
const VERDE_USD = 'var(--green-dark)'

/**
 * Bloque de totales ESTÁNDAR de las cards de documentos (factura, factura proforma y presupuesto):
 * Subtotal → Descuento → Gravado → IVA → Total, en la misma posición y con las MISMAS clases
 * (`comp-tot*`) en las tres. Centraliza el layout para garantizar la consistencia visual.
 */
export function TotalesDoc({ subtotal, descuento, gravado, iva, total, totalUsd }: TotalesDocProps) {
  return (
    <div className="comp-tot">
      <div className="comp-tot-row">
        <span>Subtotal</span>
        <b>{money(subtotal)}</b>
      </div>
      {/* Descuento: monto negativo detallado, debajo del Subtotal. */}
      <div className="comp-tot-row">
        <span>Descuento</span>
        <b>{descuento > 0 ? `− ${money(descuento)}` : money(0)}</b>
      </div>
      {/* Gravado: base neta, debajo del Descuento. */}
      <div className="comp-tot-row">
        <span>Gravado</span>
        <b>{money(gravado)}</b>
      </div>
      <div className="comp-tot-row">
        <span>IVA</span>
        <b>{money(iva)}</b>
      </div>
      <div className="comp-tot-row comp-tot-row--total">
        <span>Total</span>
        <b>{money(total)}</b>
      </div>
      {/* Presupuesto bimonetario: el total en dólares se muestra aparte, sin mezclarlo con los pesos. */}
      {totalUsd != null && totalUsd > 0 && (
        <div className="comp-tot-row comp-tot-row--total" style={{ color: VERDE_USD }}>
          <span>Total en dólares</span>
          <b>{moneyU(totalUsd)}</b>
        </div>
      )}
    </div>
  )
}
