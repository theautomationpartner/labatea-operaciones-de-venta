import { useState } from 'react'

/* Cuánto vive el enlace local al PDF. La pestaña ya lo cargó entero mucho antes; se suelta para no
   dejar el archivo retenido en memoria mientras la app siga abierta. */
const VIDA_ENLACE_MS = 5 * 60_000

interface VerPresupuestoPdfProps {
  /** El PDF que generó la emisión. `null` = todavía no se emitió. */
  archivo: File | null
  /** El texto del botón. Lo usa también el remito, que tiene dos PDF. */
  etiqueta?: string
}

/**
 * "Ver Presupuesto PDF": abre en una pestaña aparte el PDF que se acaba de generar, y desde ahí se
 * imprime o se descarga con el visor del navegador. Es el mismo botón que "Ver / Imprimir" del
 * Resumen Cta Cte (app de cobros y recibos), siempre debajo del de emitir.
 *
 * Está SIEMPRE, pero se habilita sólo cuando hay PDF. A diferencia del resumen, el archivo no hay que
 * bajarlo de Monday: lo generó la app y está en memoria, así que la pestaña se abre directo con él,
 * en el mismo clic —abrirla más tarde haría que el navegador la tome por ventana emergente—.
 */
export function VerPresupuestoPdf({ archivo, etiqueta = 'Ver Presupuesto PDF' }: VerPresupuestoPdfProps) {
  const [error, setError] = useState<string | null>(null)

  const abrir = () => {
    if (!archivo) return
    setError(null)
    const url = URL.createObjectURL(archivo)
    const pestana = window.open(url, '_blank')
    if (!pestana) {
      URL.revokeObjectURL(url)
      setError(
        'El navegador bloqueó la pestaña del PDF. Permití las ventanas emergentes de este sitio y volvé a hacer clic.',
      )
      return
    }
    setTimeout(() => URL.revokeObjectURL(url), VIDA_ENLACE_MS)
  }

  return (
    <div className="pres-pdf">
      <button
        type="button"
        className="btn btn-out pres-pdf-btn"
        disabled={!archivo}
        title={archivo ? `Abrir ${archivo.name}` : 'Se habilita al emitir'}
        onClick={abrir}
      >
        <i className="fas fa-print" /> {etiqueta}
      </button>

      {error && (
        <div className="pres-pdf-aviso" role="alert">
          <i className="fas fa-triangle-exclamation" /> {error}
        </div>
      )}
    </div>
  )
}
