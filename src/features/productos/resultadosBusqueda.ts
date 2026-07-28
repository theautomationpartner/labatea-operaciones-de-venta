/**
 * Estado de la lista de resultados paginada del buscador de productos.
 *
 * Vive fuera del componente por una razón concreta: elegir un producto CIERRA la lista —para
 * dejar a la vista «Producto seleccionado», donde se ajusta cantidad y descuento— pero NO la
 * destruye. Las páginas ya traídas, la página actual y el cursor de Monday quedan en memoria,
 * y volver a hacer click en el buscador las muestra de nuevo: se puede elegir otro producto de
 * ese mismo resultado sin volver a consultar. Sólo una búsqueda nueva los reemplaza.
 *
 * Las transiciones son puras y no tocan la red: la única que trae datos es la de la página
 * siguiente, y recibe la página ya resuelta por el servicio.
 */
import type { PaginaProductos } from '@/services/monday'
import type { Producto } from '@/types'

export interface ResultadosBusqueda {
  /** Páginas ya traídas, en orden. Volver atrás no vuelve a consultar: el cursor sólo avanza. */
  paginas: Producto[][]
  /** Cursor devuelto DESPUÉS de cada página: `cursores[i]` trae la i+1. null = no hay más. */
  cursores: (string | null)[]
  pagina: number
  /** Visibilidad de la lista. Sólo la bajan una búsqueda nueva, el botón de cierre o el click afuera. */
  abierto: boolean
  /** Códigos ya elegidos en esta búsqueda. Sólo alimentan el feedback visual de la fila. */
  elegidos: ReadonlySet<string>
}

/** Sin búsqueda activa: es también el estado al que se vuelve al cerrar o al buscar de nuevo. */
export const SIN_RESULTADOS: ResultadosBusqueda = {
  paginas: [],
  cursores: [],
  pagina: 0,
  abierto: false,
  elegidos: new Set(),
}

/** Primera página de una búsqueda nueva: reinicia todo, incluido lo ya elegido. */
export const conPrimeraPagina = (pagina: PaginaProductos): ResultadosBusqueda => ({
  paginas: [pagina.productos],
  cursores: [pagina.cursor],
  pagina: 0,
  abierto: true,
  elegidos: new Set(),
})

/**
 * Selección de un producto: se elige de a uno. La lista se repliega para despejar el paso
 * siguiente, pero la paginación queda intacta —mismas páginas, misma página actual, mismo
 * cursor— para poder volver a abrirla. El código se marca como ya elegido.
 */
export const conElegido = (
  estado: ResultadosBusqueda,
  producto: Producto,
): ResultadosBusqueda => ({
  ...estado,
  abierto: false,
  elegidos: new Set([...estado.elegidos, producto.codigo]),
})

/**
 * Vuelta al buscador: se relistan los resultados que ya se habían traído, en la misma página
 * en la que estaba. Sin resultados guardados no hay nada que abrir.
 */
export const reabierto = (estado: ResultadosBusqueda): ResultadosBusqueda =>
  estado.abierto || estado.paginas.length === 0 ? estado : { ...estado, abierto: true }

/** Página siguiente recién traída: se apila al final y pasa a ser la visible. */
export const conPaginaSiguiente = (
  estado: ResultadosBusqueda,
  siguiente: PaginaProductos,
): ResultadosBusqueda => ({
  ...estado,
  paginas: [...estado.paginas, siguiente.productos],
  cursores: [...estado.cursores, siguiente.cursor],
  pagina: estado.paginas.length,
})

/** Navegación a una página ya traída: no consulta nada. */
export const enPagina = (estado: ResultadosBusqueda, pagina: number): ResultadosBusqueda => ({
  ...estado,
  pagina,
})

/** El cursor no trajo nada: se marca la página actual como última. */
export const sinMasPaginas = (estado: ResultadosBusqueda): ResultadosBusqueda => ({
  ...estado,
  cursores: estado.cursores.map((c, i) => (i === estado.pagina ? null : c)),
})

/** Click afuera del buscador: se oculta la lista, sin perder lo traído. */
export const cerrado = (estado: ResultadosBusqueda): ResultadosBusqueda => ({
  ...estado,
  abierto: false,
})

export const paginaActual = (estado: ResultadosBusqueda): Producto[] =>
  estado.paginas[estado.pagina] ?? []

export const hayAnterior = (estado: ResultadosBusqueda): boolean => estado.pagina > 0

/** Hay siguiente si ya se trajo (se volvió atrás) o si Monday dejó un cursor para pedirla. */
export const haySiguiente = (estado: ResultadosBusqueda): boolean =>
  estado.pagina < estado.paginas.length - 1 || Boolean(estado.cursores[estado.pagina])

/** Cursor con el que pedir la próxima página, si hay que traerla. */
export const cursorActual = (estado: ResultadosBusqueda): string | null =>
  estado.cursores[estado.pagina] ?? null
