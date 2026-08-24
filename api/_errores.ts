/**
 * El vocabulario de rechazo, en un módulo sin dependencias.
 *
 * Vive aparte por una razón práctica: `_guard`, `_whitelist` y `_mfa` lo necesitan, y `_guard`
 * necesita a los otros dos. Si el tipo viviera en `_guard`, los imports se harían circulares —anda,
 * pero es el tipo de fragilidad que rompe el día que un bundler cambia el orden de evaluación—.
 */

/** Quién es el usuario, según lo que la firma de Monday deja probar. */
export interface Sesion {
  userId: string
  accountId: string
  isGuest: boolean
}

/**
 * Rechazo de acceso. `status` es lo único que sale a la red junto con un mensaje genérico; `motivo`
 * existe para el log del servidor.
 */
export class ErrorAuth extends Error {
  constructor(
    readonly status: 401 | 403 | 429,
    readonly motivo: string,
    /**
     * Pista PÚBLICA, la única excepción al mensaje mudo.
     *
     * `mfa` significa que falta el segundo factor. No revela nada: para recibirla hay que haber
     * pasado la firma y la lista blanca, o sea ya ser ese usuario. Y sin ella el frontend no
     * puede distinguir "enrolate" de "no tenés permiso", que son dos pantallas distintas.
     */
    readonly pista?: 'mfa',
  ) {
    super(MENSAJES[status])
    this.name = 'ErrorAuth'
  }
}

/** Lo único que ve el que golpea la puerta. Ni una palabra sobre qué control fue el que falló. */
const MENSAJES: Record<401 | 403 | 429, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  429: 'Too Many Requests',
}
