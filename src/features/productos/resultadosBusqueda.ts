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

export interface ResultadosBusqueda {
  /** Páginas ya traídas, en orden. Volver atrás no vuelve a consultar: el cursor sólo avanza. */
  paginas: Producto[][]
  /** Cursor devuelto DESPUÉS de cada página: `cursores[i]` trae la i+1. null = no hay más. */
  cursores: (string | null)[]
  pagina: number
  /** Visibilidad de la lista. Sólo la bajan una búsqueda nueva, el botón de cierre o el click afuera. */
  abierto: boolean
  origen: OrigenResultados
  /**
   * Quedaron coincidencias afuera del tope. La vista lo AVISA: callarlo es el bug que ya se pagó
   * una vez contra Monday —quien buscaba veía los primeros y concluía que su producto no estaba—.
   */
  truncado: boolean
}

/* Acá NO se guarda qué fila va marcada como "Seleccionado". Esa marca es del producto cargado
   AHORA en «Producto seleccionado», y la aporta el padre. Cuando vivía en este estado se
   ACUMULABA —era un Set de todo lo que se hubiera elegido en la búsqueda—, así que comparar tres
   productos antes de decidirse dejaba a los tres en gris, con cara de "ya no se pueden tomar". */

/** Sin búsqueda activa: es también el estado al que se vuelve al cerrar o al buscar de nuevo. */
export const SIN_RESULTADOS: ResultadosBusqueda = {
  paginas: [],
  cursores: [],
  pagina: 0,
  abierto: false,
  origen: 'monday',
  truncado: false,
}

/** Primera página de una búsqueda nueva contra Monday: reinicia la paginación entera. */
export const conPrimeraPagina = (pagina: PaginaProductos): ResultadosBusqueda => ({
  paginas: [pagina.productos],
  cursores: [pagina.cursor],
  pagina: 0,
  abierto: true,
  origen: 'monday',
  truncado: false,
})

/**
 * Resultados del live search sobre el caché, cortados en páginas del mismo tamaño que las de
 * Monday.
 *
 * Acá se conocen TODAS las coincidencias de entrada —la búsqueda se resolvió en memoria—, así que
 * la paginación es un `slice` y no hay cursores: todas las páginas existen desde el primer momento
 * y navegar entre ellas no consulta nada.
 *
 * Se pagina igual que la búsqueda directa, y no se muestra una lista larga y scrolleable, para que
 * las dos búsquedas se manejen igual: quien filtra por rubro y recibe ochenta productos navega con
 * las mismas flechas que venía usando.
 *
 * `porPagina` llega por parámetro y no importado de `services/monday` a propósito: este módulo es
 * el estado puro de la lista y no tiene que arrastrar el SDK de Monday —ni su lectura de
 * `import.meta.env`— sólo para conocer un número. Quien lo llama ya tiene la constante a mano.
 */
export const conResultadosLocales = (
  productos: readonly Producto[],
  porPagina: number,
  truncado = false,
): ResultadosBusqueda => {
  const paginas: Producto[][] = []
  for (let i = 0; i < productos.length; i += Math.max(1, porPagina)) {
    paginas.push(productos.slice(i, i + Math.max(1, porPagina)))
  }
  return {
    paginas,
    /* Sin cursores: `haySiguiente` se apoya sólo en que exista la página de al lado, que es
       exactamente lo que corresponde cuando ya están todas traídas. */
    cursores: paginas.map(() => null),
    pagina: 0,
    abierto: paginas.length > 0,
    origen: 'cache',
    truncado,
  }
}

/**
 * Se eligió un producto: la lista se REPLIEGA para despejar el paso siguiente, pero la paginación
 * queda intacta —mismas páginas, misma página actual, mismo cursor— para poder volver a abrirla.
 *
 * No recibe el producto: cuál se eligió no es asunto de este estado (ver el comentario del
 * `ResultadosBusqueda`). Lo único que pasa acá es que la lista se cierra.
 */
export const replegado = (estado: ResultadosBusqueda): ResultadosBusqueda => ({
  ...estado,
  abierto: false,
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
