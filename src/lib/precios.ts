/**
 * Precio unitario del producto según la lista del cliente y su condición frente al IVA.
 *
 * Del Maestro de Productos siempre sale el precio de la lista (L1..L8). Al Responsable
 * Inscripto se le factura ese precio; al Monotributista, Consumidor Final y Exento se le
 * suma el IVA del producto, que cada ítem trae en su propia columna.
 */

import { round2 } from '@/lib/format'

/** Condiciones fiscales a las que el precio les va con IVA incluido. */
const CONDICIONES_CON_IVA = /monotribut|consumidor|exent/i

/** La condición frente al IVA del cliente decide si el precio de lista lleva IVA. */
export const clienteLlevaIva = (condicionFiscal: string): boolean =>
  CONDICIONES_CON_IVA.test(condicionFiscal ?? '')

/**
 * Precio final de una unidad: el de la lista, más el IVA del producto cuando corresponde.
 * Un producto sin IVA cargado no suma nada, así que el precio queda en el de lista.
 *
 * Se redondea a dos decimales acá y no más adelante: éste es el precio con el que se calculan
 * los subtotales y el que se escribe en Monday, así que tiene que ser uno solo.
 */
export function precioConIva(precioLista: number, ivaPct: number, llevaIva: boolean): number {
  if (!llevaIva || !ivaPct) return round2(precioLista)
  return round2(precioLista * (1 + ivaPct / 100))
}
