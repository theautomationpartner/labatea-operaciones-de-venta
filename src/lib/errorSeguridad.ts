/**
 * Canal único por donde viajan los rechazos de las capas de seguridad.
 *
 * Existe por un problema concreto: cuando el borde rechaza, TODAS las consultas fallan a la vez.
 * Los `catch` de cada pantalla están pensados para un fallo aislado —dejar la lista vacía y seguir—
 * así que ante un rechazo global la app se ve entera pero sin datos, sin decir por qué. Eso ya pasó
 * en producción: el selector de vendedor vacío y doce errores 500 en la consola, y nada en pantalla.
 *
 * El aviso se publica desde `services/monday/sdk.ts`, que es por donde pasan todos los pedidos, así
 * que ninguna pantalla tiene que acordarse de nada. No usa el estado de la app porque el sdk no es
 * un módulo de React y no tiene manera de despachar.
 */

/** Qué fue lo que pasó. De esto depende el texto y qué puede hacer la persona al respecto. */
export type ClaseErrorSeguridad =
  /** 401 · el servidor no pudo confirmar quién sos. */
  | 'sesion'
  /** 403 · sos vos, pero no estás habilitado. */
  | 'sinPermiso'
  /** 403 + pista `mfa` · falta el segundo factor. */
  | 'segundoFactor'
  /** 429 · demasiados intentos fallidos. */
  | 'demasiadosIntentos'
  /** 5xx · el servicio no responde; casi siempre, falta configuración del lado del servidor. */
  | 'servidor'

export interface ErrorSeguridad {
  clase: ClaseErrorSeguridad
  status: number
}

let actual: ErrorSeguridad | null = null
const oyentes = new Set<(e: ErrorSeguridad | null) => void>()

/**
 * Avisa que el borde rechazó un pedido.
 *
 * El PRIMERO gana y los demás se ignoran hasta que alguien cierre el aviso: una pantalla dispara
 * diez consultas en paralelo y las diez fallan igual, pero mostrar la ventana diez veces —o peor,
 * cambiarle el texto mientras se lee— no informa más, molesta.
 */
export function notificarErrorSeguridad(clase: ClaseErrorSeguridad, status: number): void {
  if (actual) return
  actual = { clase, status }
  for (const oyente of oyentes) oyente(actual)
}

export function limpiarErrorSeguridad(): void {
  actual = null
  for (const oyente of oyentes) oyente(null)
}

/** Devuelve la función para desuscribirse. */
export function suscribirErrorSeguridad(oyente: (e: ErrorSeguridad | null) => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export function errorSeguridadActual(): ErrorSeguridad | null {
  return actual
}
