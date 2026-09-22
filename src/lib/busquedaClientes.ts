/**
 * Búsqueda de clientes SOBRE EL PADRÓN YA CACHEADO, en el navegador y mientras se escribe.
 *
 * Es el reemplazo del ciclo "escribo, aprieto Buscar, espero la paginación de Monday, me equivoqué
 * en una letra, vuelvo a empezar". El padrón entero —2681 clientes— lo trae `services/monday/
 * padronPersonas.ts` una vez por sesión; acá sólo se ordena.
 *
 * Todo es puro y sin red: recorrer 2681 clientes cuesta ~1 ms, así que la lista se rearma en cada
 * tecla sin debounce.
 *
 * ── El orden es el producto ──
 * Lo que el usuario necesita no es "los que contienen lo que escribí" sino "el que busco, primero".
 * Por eso el puntaje va por capas, de la coincidencia más fuerte a la más débil, y no por una
 * distancia sola: quien escribe un código quiere ESE código arriba, no el cliente cuyo CUIT termina
 * en esos dígitos.
 */
import type { Cliente } from '@/types'
import { normBusqueda, similitud, UMBRAL_SIMILITUD } from './similitud'

/** Cuántos resultados se ofrecen. Más que esto no se lee: se afina la búsqueda. */
export const TOPE_RESULTADOS_LOCALES = 30

/**
 * Puntajes por capa. Separados por huecos grandes para que ninguna combinación de capas baratas
 * pueda trepar por encima de una coincidencia exacta de identificador.
 */
const PUNTOS = {
  codigoExacto: 1000,
  cuitExacto: 900,
  codigoEmpieza: 800,
  nombreEmpieza: 700,
  palabraEmpieza: 600,
  nombreContiene: 500,
  /** La difusa aporta 0..100: siempre por debajo de cualquier coincidencia literal. */
  difusaMax: 100,
} as const

/**
 * El nombre sin el código que lo encabeza.
 *
 * En este tablero los clientes se llaman "2 - ZUBIAURRE S.A.", "4077 - RAYCLE S.A. (LA GLICINA)":
 * el código va adelante, dentro del nombre. Sin sacarlo, "empieza con" no serviría para nada
 * —ningún nombre empieza con la razón social— y quien escribe "ZUBIAURRE" quedaría mezclado con
 * cualquiera que la contenga en el medio.
 */
export const nombreSinCodigo = (name: string): string => name.replace(/^\s*\d+\s*-\s*/, '')

/** Sólo dígitos: es como se comparan los CUIT, que en el tablero conviven con y sin guiones. */
const digitos = (s: string): string => s.replace(/\D/g, '')

/** Una entrada del padrón, con lo que hace falta para buscarla ya normalizado. */
export interface EntradaPadron {
  cliente: Cliente
  nombre: string
  palabras: string[]
  codigo: string
  cuit: string
}

/**
 * ¿Esta persona se puede ofrecer en el paso de cliente?
 *
 * El padrón cacheado guarda clientes Y proveedores, y el servidor ya entrega sólo los clientes
 * (`/api/personas` con `categoria: 'cliente'`). Esto es el segundo cerrojo, y está puesto a
 * propósito: ofrecer un proveedor como cliente de una venta es facturarle a quien nos vende, y esa
 * clase de error no se arregla después. Un cerrojo de más cuesta una comparación por tecla.
 *
 * Sin `categorias` pasa: es lo que devuelven el mock y la consulta directa a Monday, donde ya se
 * sabe que lo que llegó es un cliente.
 */
const esCliente = (c: Cliente): boolean => !c.categorias || c.categorias.includes('cliente')

/**
 * Prepara el padrón para buscar: normaliza una sola vez lo que si no habría que normalizar en cada
 * tecla y por cada cliente. Con 2681 clientes es la diferencia entre un buscador instantáneo y uno
 * que se siente pegajoso al tipear rápido.
 */
export function indexarPadron(personas: readonly Cliente[]): EntradaPadron[] {
  return personas.filter(esCliente).map((cliente) => {
    const nombre = normBusqueda(nombreSinCodigo(cliente.name))
    return {
      cliente,
      nombre,
      palabras: nombre.split(/[^a-z0-9]+/).filter(Boolean),
      codigo: normBusqueda(cliente.codigo),
      cuit: digitos(cliente.cuit),
    }
  })
}

/**
 * Cuánto matchea esta entrada con lo buscado. `0` = no matchea y no se muestra.
 *
 * Exportada para poder testear el orden capa por capa sin armar un padrón entero.
 */
export function puntuar(entrada: EntradaPadron, termino: string): number {
  const t = normBusqueda(termino)
  if (!t) return 0
  const tDigitos = digitos(t)

  /* Identificadores primero, y EXACTOS. Un código o un CUIT o es el que se buscó o no lo es:
     ofrecer parecidos ahí invita a elegir al cliente que no era, y de ahí sale una venta
     facturada a otro. */
  if (entrada.codigo === t) return PUNTOS.codigoExacto
  if (tDigitos.length > 0 && entrada.cuit === tDigitos) return PUNTOS.cuitExacto

  /* El código SÍ admite prefijo: escribir "40" mientras se busca el 4077 es tipear, no confundirse.
     Va sólo si lo escrito es numérico, para que buscar "SA" no liste códigos. */
  if (tDigitos === t && entrada.codigo.startsWith(t)) return PUNTOS.codigoEmpieza

  if (entrada.nombre.startsWith(t)) return PUNTOS.nombreEmpieza
  if (entrada.palabras.some((p) => p.startsWith(t))) return PUNTOS.palabraEmpieza
  if (entrada.nombre.includes(t)) return PUNTOS.nombreContiene

  /* Último recurso: el error de tipeo. Con menos de cuatro letras no se aplica —con dos o tres,
     la distancia de edición empareja a media base y el resultado es ruido—. */
  if (t.length >= 4) {
    const s = similitud(t, entrada.nombre)
    if (s >= UMBRAL_SIMILITUD) return Math.round(s * PUNTOS.difusaMax)
  }
  return 0
}

export interface ResultadoLocal {
  clientes: Cliente[]
  /**
   * Se cortó por el tope y quedaron coincidencias afuera. La vista lo AVISA: callarlo es el bug
   * que ya se pagó una vez contra Monday —quien buscaba "MARIA" veía los primeros y concluía que
   * su cliente no estaba cargado—.
   */
  truncado: boolean
}

/**
 * Los clientes que coinciden, el que más matchea primero.
 *
 * Los empates se rompen por nombre, que es estable: sin un desempate fijo, dos búsquedas iguales
 * podrían devolver el mismo conjunto en distinto orden y la lista "saltaría" al tipear.
 */
export function buscarEnPadron(
  padron: readonly EntradaPadron[],
  termino: string,
  tope: number = TOPE_RESULTADOS_LOCALES,
): ResultadoLocal {
  const t = termino.trim()
  if (!t) return { clientes: [], truncado: false }

  const conPuntaje: { entrada: EntradaPadron; puntaje: number }[] = []
  for (const entrada of padron) {
    const puntaje = puntuar(entrada, t)
    if (puntaje > 0) conPuntaje.push({ entrada, puntaje })
  }

  conPuntaje.sort(
    (a, b) => b.puntaje - a.puntaje || a.entrada.nombre.localeCompare(b.entrada.nombre),
  )
  return {
    clientes: conPuntaje.slice(0, tope).map((x) => x.entrada.cliente),
    truncado: conPuntaje.length > tope,
  }
}
