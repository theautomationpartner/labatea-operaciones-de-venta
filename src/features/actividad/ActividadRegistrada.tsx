import { useEffect } from 'react'

/**
 * Cuánto queda el aviso en pantalla antes de que la app se reinicie sola. Le da lugar a la
 * animación del tilde (~1,2 s) y todavía deja un instante para leer el mensaje.
 */
const ESPERA_MS = 2000

/**
 * Cierre de la operación: el tilde se dibuja, se lee "Actividad registrada" y la app vuelve sola
 * a su estado inicial.
 *
 * Reemplaza a la ventana con detalle y botón "Finalizar". Lo que se creó ya está en el tablero y
 * no hay ninguna decisión pendiente: pedir un click más era pura ceremonia. El aviso no se puede
 * cerrar a mano a propósito —no hay nada que elegir— y el reinicio lo dispara este mismo aviso al
 * terminar, así que la pantalla nunca queda a mitad de camino.
 */
export function ActividadRegistrada({
  onFin,
  texto = 'Actividad registrada',
}: {
  onFin: () => void
  /** Qué se hizo. La operación tiene dos cierres: se registró una nueva, o se cerraron pendientes. */
  texto?: string
}) {
  useEffect(() => {
    const t = setTimeout(onFin, ESPERA_MS)
    return () => clearTimeout(t)
  }, [onFin])

  return (
    <div className="act-exito" role="status" aria-live="polite">
      <div className="act-exito-caja">
        {/* El tilde se DIBUJA (stroke-dasharray): primero el aro, después la marca. Es la misma
            idea que el spinner que venía antes —algo que avanza—, pero terminando en el gesto que
            dice que salió bien. */}
        <svg className="act-exito-svg" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="act-exito-aro" cx="26" cy="26" r="23" />
          <path className="act-exito-tilde" d="M15 27 l7.5 7.5 L38 19" />
        </svg>
        <strong className="act-exito-txt">{texto}</strong>
      </div>
    </div>
  )
}
