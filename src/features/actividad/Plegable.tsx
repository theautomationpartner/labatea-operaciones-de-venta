import { useEffect, type ReactNode } from 'react'

/**
 * Cuánto dura el plegado, en milisegundos. Tiene que coincidir con la animación `act-plegar` de
 * `actividad.css`: es el reloj de respaldo por si el navegador no dispara `animationend`.
 */
export const SALIDA_MS = 260

/**
 * Envuelve un bloque que aparece y se pliega con animación: entra deslizándose desde arriba y se va
 * por donde vino, así se ve DE DÓNDE salió —es la respuesta que se acaba de dar la que lo abre—.
 *
 * Plegándose, el bloque sigue MONTADO hasta que la animación termina: sin eso, el contenido
 * desaparecía de golpe en el mismo cuadro en que se contestaba la pregunta. Quien lo usa lo
 * desmonta recién en `onFin`.
 *
 * Vive en su propio archivo porque lo usan los DOS despliegues de la operación de actividades: el
 * formulario que crece con las respuestas (`FormularioActividad`) y la tabla que abre la pregunta
 * "¿Querés asociar actividades…?" (`TablaActividades`). La alternativa —que cada uno se anime por
 * su cuenta— es cómo la app terminó con cuatro diseños distintos del botón "Volver".
 */
export function Plegable({
  saliendo,
  onFin,
  className = '',
  children,
}: {
  saliendo: boolean
  onFin?: () => void
  className?: string
  children: ReactNode
}) {
  /* Red de seguridad: con la pestaña en segundo plano o las animaciones desactivadas por el
     sistema, `animationend` puede no llegar nunca, y el bloque quedaría montado para siempre. */
  useEffect(() => {
    if (!saliendo || !onFin) return
    const t = setTimeout(onFin, SALIDA_MS + 120)
    return () => clearTimeout(t)
  }, [saliendo, onFin])

  return (
    <div
      className={`act-plegable ${saliendo ? 'act-plegable--saliendo' : ''} ${className}`.trim()}
      aria-hidden={saliendo || undefined}
      /* Sólo la animación de ESTE bloque lo desmonta: `animationend` burbujea, y la de un bloque
         plegable de adentro cerraría al padre antes de tiempo. */
      onAnimationEnd={(e) => {
        if (saliendo && e.target === e.currentTarget) onFin?.()
      }}
    >
      {children}
    </div>
  )
}
