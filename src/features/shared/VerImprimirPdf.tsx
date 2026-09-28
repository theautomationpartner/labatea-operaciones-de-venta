import { useState } from 'react'
import { useApp, useDispatch } from '@/state/hooks'

/* Cuánto vive el enlace local al PDF. La pestaña ya lo cargó entero mucho antes; se suelta para no
   dejar el archivo retenido en memoria mientras la app siga abierta. */
const VIDA_ENLACE_MS = 5 * 60_000

interface VerImprimirPdfProps {
  /**
   * Los PDF emitidos, en el orden en que se abren: el presupuesto es uno; el remito, dos (VENTA y
   * PREIMPRESO). `null` = todavía no se emitió.
   */
  archivos: readonly File[] | null
}

/**
 * Los documentos emitidos que todavía no se abrieron: los que siguen a los `abiertos` primeros.
 */
export const pendientesDeAbrir = (archivos: readonly File[] | null, abiertos: number): File[] =>
  (archivos ?? []).slice(Math.min(abiertos, archivos?.length ?? 0))

/**
 * El botón "Ver / Imprimir (n)": cada clic abre en una pestaña el PDF del siguiente documento emitido,
 * y desde ahí se imprime con el visor del navegador. Es el mismo botón que el del Resumen Cta Cte de
 * la app de cobros y recibos.
 *
 * El número es cuántos documentos emitidos quedan por abrir: el presupuesto arranca en (1) y el
 * remito en (2) —primero el de VENTA, después el PREIMPRESO—. Cada documento que se abre resta uno.
 * Una sola pestaña por clic: es lo que el navegador siempre deja abrir sin tomarla por ventana
 * emergente.
 *
 * Está SIEMPRE, pero se habilita sólo con la emisión terminada y algún documento por abrir. La cuenta
 * vive en el estado de la app (`pdfsAbiertos`) y no acá: ir a otra etapa y volver no la pierde, y una
 * emisión nueva la pone en cero.
 *
 * A diferencia del resumen, los PDF no hay que bajarlos de Monday: los generó la app y están en
 * memoria, así que la pestaña se abre directo con el archivo, en el mismo clic.
 */
export function VerImprimirPdf({ archivos }: VerImprimirPdfProps) {
  const { pdfsAbiertos } = useApp()
  const dispatch = useDispatch()
  const [error, setError] = useState<string | null>(null)

  const pendientes = pendientesDeAbrir(archivos, pdfsAbiertos)
  const habilitado = pendientes.length > 0

  /** Abre el siguiente documento. Sólo si se abrió, deja de contar como pendiente. */
  const abrir = () => {
    const archivo = pendientes[0]
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
    dispatch({ type: 'setPdfsAbiertos', value: pdfsAbiertos + 1 })
  }

  return (
    <div className="pres-pdf">
      <button
        type="button"
        className="btn btn-out pres-pdf-btn"
        disabled={!habilitado}
        title={
          habilitado
            ? `Abrir ${pendientes[0].name}`
            : archivos
              ? 'Ya se abrieron todos los documentos emitidos'
              : 'Se habilita cuando termina la emisión'
        }
        onClick={abrir}
      >
        <i className="fas fa-print" /> {`Ver / Imprimir (${pendientes.length})`}
      </button>

      {error && (
        <div className="pres-pdf-aviso" role="alert">
          <i className="fas fa-triangle-exclamation" /> {error}
        </div>
      )}
    </div>
  )
}
