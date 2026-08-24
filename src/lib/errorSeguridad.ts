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

/**
 * ¿Este rechazo deja la app inservible?
 *
 * Cuando la respuesta es sí, la pantalla no se dibuja: el header con los selectores de operación y
 * vendedor sólo aparece si el pedido pasó el borde. Mostrar la app a alguien que abrió el enlace
 * fuera de Monday es enseñarle qué hay del otro lado de una puerta que está cerrada, y para el
 * usuario legítimo es peor todavía: una pantalla que se ve entera pero donde nada funciona.
 *
 * Los otros dos NO bloquean, y es a propósito. Un 5xx o un límite de intentos pueden ser pasajeros,
 * y desmontar la vista en medio de una carga de venta tiraría el trabajo hecho por un fallo que
 * quizá se resuelve solo en el próximo pedido.
 */
export function bloqueaLaApp(clase: ClaseErrorSeguridad): boolean {
  return clase === 'sesion' || clase === 'sinPermiso' || clase === 'segundoFactor'
}

/**
 * El estado del canal.
 *
 * Son DOS cosas distintas y conviene no confundirlas: `error` es que el borde rechazó —y mientras
 * eso sea cierto la app queda tapada—, `visible` es si la ventana está abierta. Cerrar el aviso
 * baja la ventana y nada más: el "Entendido" cierra el cartel, no abre la puerta.
 */
export interface EstadoSeguridad {
  error: ErrorSeguridad | null
  visible: boolean
}

let estado: EstadoSeguridad = { error: null, visible: false }
const oyentes = new Set<() => void>()

function publicar(nuevo: EstadoSeguridad): void {
  estado = nuevo
  for (const oyente of oyentes) oyente()
}

/**
 * Avisa que el borde rechazó un pedido.
 *
 * El PRIMERO gana y los demás se ignoran hasta que se reinicie: una pantalla dispara diez consultas
 * en paralelo y las diez fallan igual, pero mostrar la ventana diez veces —o peor, cambiarle el
 * texto mientras se lee— no informa más, molesta.
 */
export function notificarErrorSeguridad(clase: ClaseErrorSeguridad, status: number): void {
  if (estado.error) return
  publicar({ error: { clase, status }, visible: true })
}

/** Baja la ventana. El rechazo sigue en pie: si tapaba la app, la app sigue tapada. */
export function cerrarAvisoSeguridad(): void {
  if (estado.visible) publicar({ ...estado, visible: false })
}

/** Borra todo. Sólo para los tests: en la app, de un rechazo se sale recargando. */
export function reiniciarErrorSeguridad(): void {
  publicar({ error: null, visible: false })
}

export function suscribirErrorSeguridad(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export function estadoSeguridadActual(): EstadoSeguridad {
  return estado
}
