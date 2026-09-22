/**
 * Búsqueda de productos SOBRE EL CATÁLOGO YA CACHEADO, en el navegador y mientras se escribe.
 *
 * Es el reemplazo del ciclo "escribo, aprieto Buscar, espero la consulta a Monday, me faltó una
 * letra, vuelvo a empezar" en la etapa más tipeada de PRESUPUESTO, VENTA y REMITO. El catálogo
 * entero —1285 productos— lo trae `services/monday/catalogoProductos.ts` una vez por sesión; acá
 * sólo se puntúa y se ordena.
 *
 * Todo es puro y sin red: recorrer 1285 productos cuesta menos de 1 ms, así que la lista se rearma
 * en cada tecla sin debounce.
 *
 * ── El orden es el producto ──
 * Lo que el usuario necesita no es "los que contienen lo que escribí" sino "el que busco, primero".
 * Por eso el puntaje va por capas, de la coincidencia más fuerte a la más débil.
 *
 * ── Por qué no alcanza con `includes` ──
 * Los nombres del maestro son descriptivos y largos ("ACAROX ULTRA 500 ML", "AGUJA DESCARTABLE
 * 21G x 1"). Quien busca escribe los pedazos que recuerda y en el orden que se le ocurren: "acarox
 * 500", "aguja 21". Un `includes` del término entero no encuentra ninguno de los dos, porque en el
 * nombre esas palabras no están pegadas. Por eso la capa que más trabaja acá —y que no existe en
 * el buscador de clientes— es la de TODAS LAS PALABRAS: cada palabra de lo escrito tiene que
 * arrancar alguna palabra del nombre, en cualquier orden.
 */
import type { CampoFiltro, Filtro, ProductoCache } from '@/types'
import { normBusqueda, similitud, UMBRAL_SIMILITUD } from './similitud'

/**
 * Cuántas coincidencias se conservan. No es el tamaño de la página: la lista se pagina después
 * (ver `PRODUCTOS_POR_PAGINA`). Es el techo de lo que tiene sentido ofrecer — más allá de esto no
 * se navega, se afina la búsqueda o se filtra.
 */
export const TOPE_RESULTADOS_LOCALES = 150

/**
 * Puntajes por capa. Separados por huecos grandes para que ninguna combinación de capas baratas
 * pueda trepar por encima de una coincidencia exacta de código.
 */
const PUNTOS = {
  codigoExacto: 1000,
  codigoEmpieza: 800,
  nombreEmpieza: 700,
  palabraEmpieza: 600,
  /** Todas las palabras de lo escrito arrancan alguna palabra del nombre. Ver el encabezado. */
  todasLasPalabras: 550,
  nombreContiene: 500,
  /** La difusa aporta 0..100: siempre por debajo de cualquier coincidencia literal. */
  difusaMax: 100,
} as const

/** Una entrada del catálogo, con lo que hace falta para buscarla y filtrarla ya normalizado. */
export interface EntradaCatalogo {
  producto: ProductoCache
  nombre: string
  palabras: string[]
  codigo: string
  /** Taxonomía en tokens normalizados. Una columna dropdown puede traer varias etiquetas. */
  rubro: string[]
  subrubro: string[]
  categoria: string[]
}

/** Las etiquetas de una columna dropdown: vienen en un solo texto, separadas por coma. */
const etiquetas = (texto: string): string[] =>
  texto
    .split(',')
    .map((t) => normBusqueda(t))
    .filter(Boolean)

/**
 * Prepara el catálogo para buscar: normaliza una sola vez lo que si no habría que normalizar en
 * cada tecla y por cada producto. Con 1285 productos es la diferencia entre un buscador instantáneo
 * y uno que se siente pegajoso al tipear rápido.
 */
export function indexarCatalogo(productos: readonly ProductoCache[]): EntradaCatalogo[] {
  return productos.map((producto) => {
    const nombre = normBusqueda(producto.nombre)
    return {
      producto,
      nombre,
      palabras: nombre.split(/[^a-z0-9]+/).filter(Boolean),
      codigo: normBusqueda(producto.codigo),
      rubro: etiquetas(producto.rubro),
      subrubro: etiquetas(producto.subrubro),
      categoria: etiquetas(producto.categoria),
    }
  })
}

/** Sólo dígitos = el usuario está escribiendo un código interno. */
const esCodigo = (t: string): boolean => /^\d+$/.test(t)

const tokensDe = (entrada: EntradaCatalogo, campo: CampoFiltro): string[] =>
  campo === 'Rubro' ? entrada.rubro : campo === 'Subrubro' ? entrada.subrubro : entrada.categoria

/**
 * Los filtros de taxonomía aplicados: OR dentro de un mismo campo (Rubro A ó B) y AND entre campos.
 *
 * Es la misma semántica que las reglas de `query_params` que se le mandan a Monday cuando la
 * búsqueda va directa (`any_of` por criterio, `operator: and` entre criterios). Tiene que serlo:
 * si el filtrado local y el del servidor no coincidieran, apretar Buscar devolvería un conjunto
 * distinto del que se estaba viendo y nadie entendería por qué.
 */
export function pasaFiltros(entrada: EntradaCatalogo, filtros: readonly Filtro[]): boolean {
  if (filtros.length === 0) return true
  const porCampo = new Map<CampoFiltro, string[]>()
  for (const f of filtros) {
    porCampo.set(f.campo, [...(porCampo.get(f.campo) ?? []), normBusqueda(f.valor)])
  }
  for (const [campo, valores] of porCampo) {
    const tokens = tokensDe(entrada, campo)
    if (!valores.some((v) => tokens.includes(v))) return false
  }
  return true
}

/**
 * Cuánto matchea esta entrada con lo buscado. `0` = no matchea y no se muestra.
 *
 * Exportada para poder testear el orden capa por capa sin armar un catálogo entero.
 */
export function puntuar(entrada: EntradaCatalogo, termino: string): number {
  const t = normBusqueda(termino)
  if (!t) return 0

  /* El código o es el que se buscó o no lo es. Va primero y exacto: ofrecer códigos "parecidos"
     invita a cargar el producto que no era, y de ahí sale un presupuesto mal hecho. */
  if (entrada.codigo === t) return PUNTOS.codigoExacto

  /* El código SÍ admite prefijo: escribir "30" mientras se busca el 301 es tipear, no confundirse.
     Va sólo si lo escrito es numérico, para que buscar "ML" no liste códigos. */
  if (esCodigo(t) && entrada.codigo.startsWith(t)) return PUNTOS.codigoEmpieza

  if (entrada.nombre.startsWith(t)) return PUNTOS.nombreEmpieza

  const buscadas = t.split(/[^a-z0-9]+/).filter(Boolean)
  if (buscadas.length === 1) {
    if (entrada.palabras.some((p) => p.startsWith(buscadas[0]))) return PUNTOS.palabraEmpieza
  } else if (buscadas.every((b) => entrada.palabras.some((p) => p.startsWith(b)))) {
    /* "acarox 500" encuentra "ACAROX ULTRA 500 ML". Es la capa que hace usable este buscador: sin
       ella hay que escribir el nombre corrido y exacto, que es justo lo que nadie recuerda. */
    return PUNTOS.todasLasPalabras
  }

  if (entrada.nombre.includes(t)) return PUNTOS.nombreContiene

  /* Último recurso: el error de tipeo. Con menos de cuatro letras no se aplica —con dos o tres, la
     distancia de edición empareja medio catálogo y el resultado es ruido—. */
  if (t.length >= 4) {
    const s = similitud(t, entrada.nombre)
    if (s >= UMBRAL_SIMILITUD) return Math.round(s * PUNTOS.difusaMax)
  }
  return 0
}

export interface ResultadoLocal {
  productos: ProductoCache[]
  /**
   * Se cortó por el tope y quedaron coincidencias afuera. La vista lo AVISA: callarlo es el bug que
   * ya se pagó una vez contra Monday —quien buscaba veía los primeros y concluía que su producto no
   * estaba cargado—.
   */
  truncado: boolean
}

/**
 * Los productos que coinciden, el que más matchea primero.
 *
 * Con término vacío pero filtros aplicados devuelve TODO lo que pasa los filtros, ordenado por
 * nombre: es el caso de "mostrame la ferretería", que antes obligaba a consultar a Monday.
 *
 * Los empates se rompen por nombre, que es estable: sin un desempate fijo, dos búsquedas iguales
 * podrían devolver el mismo conjunto en distinto orden y la lista "saltaría" al tipear.
 */
export function buscarEnCatalogo(
  catalogo: readonly EntradaCatalogo[],
  termino: string,
  filtros: readonly Filtro[] = [],
  tope: number = TOPE_RESULTADOS_LOCALES,
): ResultadoLocal {
  const t = termino.trim()
  if (!t && filtros.length === 0) return { productos: [], truncado: false }

  const conPuntaje: { entrada: EntradaCatalogo; puntaje: number }[] = []
  for (const entrada of catalogo) {
    if (!pasaFiltros(entrada, filtros)) continue
    /* Sin término, el filtro es la búsqueda: todos los que pasaron entran con el mismo puntaje y el
       desempate por nombre los deja en orden alfabético. */
    const puntaje = t ? puntuar(entrada, t) : 1
    if (puntaje > 0) conPuntaje.push({ entrada, puntaje })
  }

  conPuntaje.sort(
    (a, b) => b.puntaje - a.puntaje || a.entrada.nombre.localeCompare(b.entrada.nombre),
  )
  return {
    productos: conPuntaje.slice(0, tope).map((x) => x.entrada.producto),
    truncado: conPuntaje.length > tope,
  }
}
