/**
 * Precio unitario del producto según la lista del cliente y su condición frente al IVA.
 *
 * Del Maestro de Productos siempre sale el precio de la lista (L1..L8). Al Responsable
 * Inscripto se le factura ese precio; al Monotributista, Consumidor Final y Exento se le
 * suma el IVA del producto, que cada ítem trae en su propia columna.
 */

import { trunc2 } from '@/lib/format'
import { costoDe } from '@/lib/selectors'

/** Condiciones fiscales a las que el precio les va con IVA incluido. */
const CONDICIONES_CON_IVA = /monotribut|consumidor|exent/i

/** La condición frente al IVA del cliente decide si el precio de lista lleva IVA. */
export const clienteLlevaIva = (condicionFiscal: string): boolean =>
  CONDICIONES_CON_IVA.test(condicionFiscal ?? '')

/**
 * Precio final de una unidad: el de la lista, más el IVA del producto cuando corresponde.
 * Un producto sin IVA cargado no suma nada, así que el precio queda en el de lista.
 *
 * Se lleva a dos decimales (truncados) acá y no más adelante: éste es el precio con el que se
 * calculan los subtotales y el que se escribe en Monday, así que tiene que ser uno solo.
 */
export function precioConIva(precioLista: number, ivaPct: number, llevaIva: boolean): number {
  if (!llevaIva || !ivaPct) return trunc2(precioLista)
  return trunc2(precioLista * (1 + ivaPct / 100))
}

/**
 * Precio de lista con IVA (si corresponde) que usa la conversión de un producto en dólares.
 *
 * Antes era a precisión completa, para conservar el tercer decimal del dólar al multiplicar por la
 * tasa. El criterio acordado con el comercio es que TODO valor se toma con dos decimales
 * truncados, también el precio en dólares: 55,803 U$ es 55,80 U$ y en pesos se convierte ESE
 * valor. Por eso ahora da lo mismo que `precioConIva`; se conserva como punto único de la
 * conversión para que el criterio quede escrito donde se decide.
 */
export function precioListaSinRedondear(
  precioLista: number,
  ivaPct: number,
  llevaIva: boolean,
): number {
  return precioConIva(precioLista, ivaPct, llevaIva)
}

/**
 * Producto con el precio unitario PISADO a mano (override del administrador, ver `lib/permisos`).
 *
 * La rentabilidad no se guarda: se deriva del precio vigente contra el costo y el flete cada vez
 * que se muestra (ver `rentabilidadFinalLinea`), así que pisar el precio la recalcula sola. El
 * "Margen" del maestro (`rentabilidad`) tampoco se toca: es sólo el respaldo para despejar el costo.
 *
 * El COSTO y el FLETE no cambian porque se venda más barato. Si el producto no trajo el costo del
 * maestro, se despeja del precio y el margen ORIGINALES (`costoDe`) y queda fijado: si no, al
 * recalcularlo después contra el precio ya pisado, el costo se movería con cada override.
 *
 * Un precio de 0 o negativo no es un precio: se devuelve el producto sin tocar.
 */
export function productoConPrecio<
  T extends {
    precio: number
    rentabilidad: number
    precioSinIva?: number
    precioCosto?: number
    flete?: number
  },
>(producto: T, precio: number): T {
  const nuevo = trunc2(precio)
  if (!(nuevo > 0) || !(producto.precio > 0)) return producto
  const netoAnterior = producto.precioSinIva ?? producto.precio
  const costo = costoDe(producto)
  // El precio SIN IVA acompaña al override en la misma proporción: la alícuota no cambió.
  const netoNuevo = trunc2(netoAnterior * (nuevo / producto.precio))
  return { ...producto, precio: nuevo, precioSinIva: netoNuevo, precioCosto: costo }
}
