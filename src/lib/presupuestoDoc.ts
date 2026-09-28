import { descuentoUnitario } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import type { LineaPresupuesto } from '@/types'

/**
 * Los números del presupuesto tal como los muestra la card "Presupuesto a generar". Viven acá y no
 * en el componente porque el PDF (`PresupuestoPdf`) toma sus importes de acá: si cada uno
 * hiciera su cuenta, el documento que recibe el cliente podría no coincidir con lo que vio el
 * vendedor.
 */

/** La línea está cotizada en dólares. */
export const esUsd = (l: LineaPresupuesto): boolean => esDolar(l.producto.moneda)

/** Importe bonificado por unidad: TODO lo que se descuenta (forma de pago + manual, en cascada).
 *  Es el "Descuento TOTAL" del subelemento (`numeric_mm5w6h1x`). En la moneda del producto. */
export const bonifUnitDe = (l: LineaPresupuesto): number =>
  descuentoUnitario(l.producto.precio, l.descuento).total

/** Total de la línea, ya bonificado: (precio − bonif) × cantidad. En la moneda del producto. */
export const totalDe = (l: LineaPresupuesto): number =>
  round2(descuentoUnitario(l.producto.precio, l.descuento).precioFinal * l.cantidad)

/** Suma de los totales (ya bonificados) de las líneas de una moneda (pesos o dólares). */
const totalMoneda = (lineas: LineaPresupuesto[], usd: boolean): number =>
  round2(
    lineas.filter((l) => esUsd(l) === usd).reduce((acc, l) => acc + totalDe(l), 0),
  )

/** Suma del BRUTO (precio × cantidad, sin bonificar) de las líneas de una moneda. */
const brutoMoneda = (lineas: LineaPresupuesto[], usd: boolean): number =>
  round2(
    lineas
      .filter((l) => esUsd(l) === usd)
      .reduce((acc, l) => acc + l.producto.precio * l.cantidad, 0),
  )

/** Totales del presupuesto, bimonetario: los dólares no se convierten ni se suman a los pesos. */
export interface TotalesPresupuesto {
  totalPesos: number
  totalUsd: number
  hayDolares: boolean
  /** Bruto en pesos (sin bonificar). */
  brutoPesos: number
  /** Bruto − neto, en pesos. */
  descuentoPesos: number
}

/**
 * Totales estándar en pesos: bruto, descuento (bruto − neto) y gravado (= neto). El presupuesto NO
 * liquida IVA, así que el IVA es 0 y el Total coincide con el Gravado.
 */
export function totalesPresupuesto(lineas: LineaPresupuesto[]): TotalesPresupuesto {
  const totalPesos = totalMoneda(lineas, false)
  const brutoPesos = brutoMoneda(lineas, false)
  return {
    totalPesos,
    totalUsd: totalMoneda(lineas, true),
    hayDolares: lineas.some(esUsd),
    brutoPesos,
    descuentoPesos: round2(brutoPesos - totalPesos),
  }
}
