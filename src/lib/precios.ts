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

/**
 * Igual que `precioConIva` pero SIN redondear: es el precio de lista con IVA (si corresponde) a
 * precisión completa. Lo usa la conversión de un producto en dólares, que multiplica este valor por
 * la tasa del día y redondea RECIÉN el resultado en pesos. Redondear el dólar a 2 decimales antes de
 * convertir pierde el tercer decimal, que al cambio equivale a más de un peso.
 */
export function precioListaSinRedondear(
  precioLista: number,
  ivaPct: number,
  llevaIva: boolean,
): number {
  return !llevaIva || !ivaPct ? precioLista : precioLista * (1 + ivaPct / 100)
}

/**
 * Producto con el precio unitario PISADO a mano (override del administrador, ver `lib/permisos`).
 *
 * La rentabilidad BASE (`rentabilidad`, el "Margen" del maestro) NO se toca: es el dato de
 * referencia de dónde arrancaba el producto y tiene que seguir diciendo eso aunque se pise el
 * precio. Lo que cambia es la rentabilidad FINAL, que no se guarda: se deriva del precio vigente
 * contra el costo cada vez que se muestra (ver `rentabilidadFinalLinea`).
 *
 * El COSTO tampoco cambia porque se venda más barato. Si el producto no lo trajo del maestro, se
 * despeja del precio y el margen ORIGINALES y queda fijado: si no, al recalcularlo después contra
 * el precio ya pisado, el costo se movería con cada override.
 *
 * Un precio de 0 o negativo no es un precio: se devuelve el producto sin tocar.
 */
export function productoConPrecio<
  T extends { precio: number; rentabilidad: number; precioSinIva?: number; precioCosto?: number },
>(producto: T, precio: number): T {
  const nuevo = round2(precio)
  if (!(nuevo > 0) || !(producto.precio > 0)) return producto
  const netoAnterior = producto.precioSinIva ?? producto.precio
  const costo =
    producto.precioCosto && producto.precioCosto > 0
      ? producto.precioCosto
      : round2(netoAnterior / (1 + producto.rentabilidad / 100))
  // El precio SIN IVA acompaña al override en la misma proporción: la alícuota no cambió.
  const netoNuevo = round2(netoAnterior * (nuevo / producto.precio))
  return { ...producto, precio: nuevo, precioSinIva: netoNuevo, precioCosto: costo }
}
