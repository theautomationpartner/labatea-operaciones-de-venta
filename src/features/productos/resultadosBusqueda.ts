/**
 * Estado de la lista de resultados del buscador de productos.
 *
 * Vive fuera del componente por una razón concreta: elegir un producto CIERRA la lista —para
 * dejar a la vista «Producto seleccionado», donde se ajusta cantidad y descuento— pero NO la
 * destruye. Los resultados ya traídos, el cursor de Monday y la fila en la que estaba parado el
 * usuario quedan en memoria, y volver a hacer click en el buscador los muestra de nuevo: se puede
 * elegir otro producto de ese mismo resultado sin volver a consultar. Sólo una búsqueda nueva los
 * reemplaza.
 *
 * ── Una sola lista, no páginas ──
 * Antes esto guardaba `Producto[][]` y un índice de página, y se navegaba con botones «Anterior» y
 * «Siguiente». Ahora es UNA lista que crece: se recorre con las flechas del teclado de punta a
 * punta y, cuando el resaltado se acerca al final de lo traído, el componente pide el tramo
 * siguiente y lo agrega acá. El usuario nunca ve un borde de página.
 *
 * El cursor sigue existiendo porque Monday pagina igual —no hay forma de pedirle "todo"—, pero pasó
 * a ser un detalle de cómo se rellena la lista, no algo que el usuario tenga que manejar.
 *
 * ── El resaltado es del estado, no del DOM ──
 * `activo` es el índice de la fila marcada. Está acá y no como `:focus` de un botón porque el foco
 * real nunca se va del input: el usuario sigue escribiendo mientras navega. Es el mismo patrón de
 * un combobox accesible (`aria-activedescendant`).
 *
 * Las transiciones son puras y no tocan la red: la única que trae datos es la de más resultados, y
 * recibe el tramo ya resuelto por el servicio.
 */
import type { PaginaProductos } from '@/services/monday'
import type { Producto } from '@/types'

/**
 * De dónde salieron estas filas. Va en el ESTADO y no en cada fila porque un conjunto de resultados
 * viene entero de un lado o entero del otro; repetirlo por fila permitiría estados imposibles.
 *
 * Lo que cambia según el origen es qué hace falta para entregar el producto elegido:
 *  · `monday` — la consulta ya trajo el stock anidado. El producto está completo; se entrega tal cual.
 *  · `cache`  — el caché no guarda stock (ver `api/_productos.ts`). Antes de entregarlo hay que
 *               leerlo contra Monday, o el panel de stock mostraría cero para todo.
 */
export type OrigenResultados = 'monday' | 'cache'

/** Ninguna fila resaltada. */
export const SIN_ACTIVO = -1

export interface ResultadosBusqueda {
  /** Todo lo traído hasta ahora, en una sola lista y en orden. */
  productos: Producto[]
  /**
   * Cursor de Monday para traer el tramo siguiente. `null` = no hay más, o los resultados salieron
   * del caché (que ya vino entero).
   */
  cursor: string | null
  /** Índice de la fila resaltada, o `SIN_ACTIVO`. Es lo que carga Enter. */
  activo: number
  /** Visibilidad de la lista. Sólo la bajan una búsqueda nueva, elegir, Escape o el click afuera. */
  abierto: boolean
  origen: OrigenResultados
  /**
   * Quedaron coincidencias afuera del tope. La vista lo AVISA: callarlo es el bug que ya se pagó
   * una vez contra Monday —quien buscaba veía los primeros y concluía que su producto no estaba—.
   */
  truncado: boolean
}

/** Sin búsqueda activa: es también el estado al que se vuelve al buscar de nuevo. */
export const SIN_RESULTADOS: ResultadosBusqueda = {
  productos: [],
  cursor: null,
  activo: SIN_ACTIVO,
  abierto: false,
  origen: 'monday',
  truncado: false,
}

/**
 * Primer tramo de una búsqueda nueva contra Monday.
 *
 * Arranca con la primera fila ya resaltada: el caso abrumadoramente más común es que lo que se
 * busca sea lo primero, y así Enter lo carga sin tocar una flecha.
 */
export const conPrimerosResultados = (pagina: PaginaProductos): ResultadosBusqueda => ({
  productos: [...pagina.productos],
  cursor: pagina.cursor,
  activo: pagina.productos.length > 0 ? 0 : SIN_ACTIVO,
  abierto: pagina.productos.length > 0,
  origen: 'monday',
  truncado: false,
})

/**
 * Resultados del live search sobre el caché.
 *
 * Vienen todos de una —la búsqueda se resolvió en memoria— así que no hay cursor: no hay nada más
 * que pedir. La lista se recorre entera con las flechas.
 */
export const conResultadosLocales = (
  productos: readonly Producto[],
  truncado = false,
): ResultadosBusqueda => ({
  productos: [...productos],
  cursor: null,
  activo: productos.length > 0 ? 0 : SIN_ACTIVO,
  abierto: productos.length > 0,
  origen: 'cache',
  truncado,
})

/**
 * Llegó el tramo siguiente de Monday: se agrega al final y la lista sigue siendo una sola.
 *
 * El resaltado NO se mueve. El usuario está bajando con la flecha y esto ocurre por detrás; correrle
 * la selección sería moverle el piso.
 */
export const conMasResultados = (
  estado: ResultadosBusqueda,
  siguiente: PaginaProductos,
): ResultadosBusqueda => ({
  ...estado,
  productos: [...estado.productos, ...siguiente.productos],
  cursor: siguiente.cursor,
})

/** El cursor no trajo nada: no hay más que pedir y se deja de intentar. */
export const sinMasResultados = (estado: ResultadosBusqueda): ResultadosBusqueda => ({
  ...estado,
  cursor: null,
})

/**
 * Mueve el resaltado `delta` filas, sin dar la vuelta.
 *
 * No hay wrap a propósito: la lista CRECE sola cuando el resaltado se acerca al final, así que
 * saltar del último al primero dejaría al usuario arriba justo cuando estaba por aparecer más.
 * Frenar en el borde es lo que hace que bajar sostenido se sienta continuo.
 *
 * Sin nada resaltado, bajar entra por la primera fila y subir por la última.
 */
export function mover(estado: ResultadosBusqueda, delta: number): ResultadosBusqueda {
  const total = estado.productos.length
  if (total === 0) return estado
  const desde = estado.activo === SIN_ACTIVO ? (delta > 0 ? -1 : total) : estado.activo
  const activo = Math.min(total - 1, Math.max(0, desde + delta))
  return activo === estado.activo ? estado : { ...estado, activo }
}

/** Resalta una fila por índice. Lo usa el mouse; el teclado va por `mover`. */
export const resaltar = (estado: ResultadosBusqueda, activo: number): ResultadosBusqueda =>
  activo < 0 || activo >= estado.productos.length || activo === estado.activo
    ? estado
    : { ...estado, activo }

/** El producto resaltado, si hay alguno y la lista está a la vista. */
export const productoActivo = (estado: ResultadosBusqueda): Producto | null =>
  estado.abierto && estado.activo >= 0 ? (estado.productos[estado.activo] ?? null) : null

/**
 * ¿Conviene ir pidiendo el tramo siguiente?
 *
 * Se dispara ANTES de llegar al final —`margen` filas antes— para que el tramo llegue mientras el
 * usuario todavía está bajando. Si se esperara a tocar la última fila, la flecha se quedaría
 * clavada un segundo y medio en cada borde, que es exactamente lo que este cambio vino a sacar.
 */
export const convieneTraerMas = (estado: ResultadosBusqueda, margen: number): boolean =>
  estado.cursor !== null && estado.activo >= estado.productos.length - margen

/**
 * Se eligió un producto: la lista se REPLIEGA para despejar el paso siguiente, pero los resultados
 * quedan intactos —mismas filas, mismo resaltado, mismo cursor— para poder volver a abrirla.
 *
 * No recibe el producto: cuál se eligió no es asunto de este estado. Lo único que pasa acá es que
 * la lista se cierra.
 */
export const replegado = (estado: ResultadosBusqueda): ResultadosBusqueda =>
  estado.abierto ? { ...estado, abierto: false } : estado

/**
 * Vuelta al buscador: se relistan los resultados que ya se habían traído, con el resaltado donde
 * estaba. Sin resultados guardados no hay nada que abrir.
 */
export const reabierto = (estado: ResultadosBusqueda): ResultadosBusqueda =>
  estado.abierto || estado.productos.length === 0 ? estado : { ...estado, abierto: true }

/** Click afuera o Escape: se oculta la lista, sin perder lo traído. */
export const cerrado = (estado: ResultadosBusqueda): ResultadosBusqueda =>
  estado.abierto ? { ...estado, abierto: false } : estado
