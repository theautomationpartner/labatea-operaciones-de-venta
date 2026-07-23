import { useEffect, useRef, useState } from 'react'

/** Lo que tarda el "procesamiento" simulado. Cuando haya servicio, esto se cae. */
const DEMORA_MS = 1800

type EstadoCierre = 'idle' | 'procesando' | 'listo'

interface BotonCerrarVentaProps {
  disabled: boolean
}

/**
 * Cierre de la venta. Por ahora no procesa nada: muestra el spinner y termina en
 * un tilde para dejar armada la transición cuando exista el servicio real.
 */
export function BotonCerrarVenta({ disabled }: BotonCerrarVentaProps) {
  const [estado, setEstado] = useState<EstadoCierre>('idle')
  const timer = useRef<number | undefined>(undefined)

  // Si se sale del paso durante el procesamiento, el timer no debe sobrevivir.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const cerrar = () => {
    setEstado('procesando')
    timer.current = window.setTimeout(() => setEstado('listo'), DEMORA_MS)
  }

  return (
    <button
      type="button"
      className="btn-primary"
      disabled={disabled || estado !== 'idle'}
      aria-busy={estado === 'procesando'}
      onClick={cerrar}
    >
      {estado === 'idle' && (
        <>
          Cerrar Venta <i className="fas fa-arrow-right" />
        </>
      )}
      {estado === 'procesando' && (
        <>
          <i className="fas fa-circle-notch spin" /> Procesando...
        </>
      )}
      {estado === 'listo' && (
        <>
          <i className="fas fa-check tilde-lento" /> Venta cerrada
        </>
      )}
    </button>
  )
}
