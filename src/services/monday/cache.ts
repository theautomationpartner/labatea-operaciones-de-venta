/**
 * Caché en memoria para las consultas de lectura (documentos del cliente y catálogos).
 *
 * Objetivo: proteger los límites de complejidad de la API y dar navegación instantánea. Cada
 * consulta se ejecuta UNA sola vez —por cliente, en las que dependen del cliente; una sola vez a
 * secas, en los catálogos globales— y las llamadas siguientes (por ejemplo, al volver a un paso
 * con el stepper) reutilizan la MISMA promesa sin volver a pegarle a Monday.
 *
 * Se cachea la PROMESA, no el resultado: dos montajes casi simultáneos comparten el mismo fetch en
 * curso. Un fallo NO se cachea —se descarta la entrada— para poder reintentar. Misma convención que
 * la caché histórica de rutas (`rutas.ts`).
 *
 * Todas las cachés quedan registradas para poder vaciarlas de una con `limpiarCachesConsultas()`.
 */

/** Vaciados de todas las cachés creadas, para limpiarlas juntas cuando haga falta. */
const limpiadores: Array<() => void> = []

/** Vacía TODAS las cachés de consultas (documentos y catálogos). Fuerza refetch en la próxima lectura. */
export function limpiarCachesConsultas(): void {
  for (const limpiar of limpiadores) limpiar()
}

/**
 * Memoiza una consulta que depende del CLIENTE. Se ejecuta una vez por clave (id de cliente); el
 * resto de las llamadas con la misma clave devuelven la promesa guardada. `clave` extrae el id del
 * argumento (así sirve tanto si recibe el id como si recibe el `Cliente` entero).
 */
export function memoPorCliente<A, T>(
  fn: (arg: A) => Promise<T>,
  clave: (arg: A) => string,
): (arg: A) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  limpiadores.push(() => cache.clear())
  return (arg: A) => {
    const k = clave(arg)
    let pendiente = cache.get(k)
    if (!pendiente) {
      pendiente = fn(arg).catch((e) => {
        cache.delete(k)
        throw e
      })
      cache.set(k, pendiente)
    }
    return pendiente
  }
}

/**
 * Memoiza un catálogo GLOBAL (sin parámetros): rutas, transportistas, vehículos, comisionistas.
 * Se ejecuta una sola vez y todas las llamadas comparten la misma promesa.
 */
export function memoGlobal<T>(fn: () => Promise<T>): () => Promise<T> {
  let pendiente: Promise<T> | null = null
  limpiadores.push(() => {
    pendiente = null
  })
  return () => {
    if (!pendiente) {
      pendiente = fn().catch((e) => {
        pendiente = null
        throw e
      })
    }
    return pendiente
  }
}
