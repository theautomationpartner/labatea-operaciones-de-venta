import { useEffect, useState } from 'react'
import { urlArchivo, type PresupuestoPdf } from '@/services/monday'

/** Estado de la generación del PDF, orquestado por la vista de Emisión. */
export type EstadoPdf = 'idle' | 'generando' | 'listo' | 'error'

interface PdfPreviewProps {
  /** Estado de la generación disparada por el botón "GENERAR PDF". */
  estado: EstadoPdf
  /** PDF ya generado y subido por Make.com a la columna file (file_mkse56g9), si está disponible. */
  pdf: PresupuestoPdf | null
  error: string | null
  onReintentar: () => void
}

/**
 * Trae los bytes del PDF y los publica como URL local (`blob:`).
 *
 * Hace falta porque la `public_url` de Monday viene firmada con
 * `response-content-disposition=attachment`: apuntar el visor directo a esa URL hace que el
 * navegador descargue el archivo en vez de mostrarlo. Con el blob propio, el visor nativo lo
 * renderiza (y aporta su scroll y su zoom).
 */
function useBlobPdf(pdf: PresupuestoPdf | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    if (!pdf) {
      setBlobUrl(null)
      setFallo(false)
      return
    }
    let vivo = true
    let creada: string | null = null
    setFallo(false)

    fetch(urlArchivo(pdf.url))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then((b) => {
        if (!vivo) return
        // El tipo importa: sin él, el navegador no sabe que tiene que abrir el visor de PDF.
        creada = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'application/pdf' }))
        setBlobUrl(creada)
      })
      .catch(() => vivo && setFallo(true))

    return () => {
      vivo = false
      if (creada) URL.revokeObjectURL(creada)
    }
  }, [pdf])

  return { blobUrl, fallo }
}

/**
 * Visor real del PDF del presupuesto: refleja la columna file_mkse56g9. No hay maqueta de prueba:
 * mientras esa columna esté vacía el visor queda vacío. Al generar, superpone un loading y, cuando
 * el escenario de Make.com sube el archivo, lo embebe.
 */
export function PdfPreview({ estado, pdf, error, onReintentar }: PdfPreviewProps) {
  const { blobUrl, fallo } = useBlobPdf(pdf)

  return (
    <div className="pdfv" aria-busy={estado === 'generando'}>
      {estado === 'generando' && (
        <div className="pdf-overlay">
          <i className="fas fa-circle-notch spin pdf-overlay-icon" />
          <div className="pdf-overlay-msg">Generando presupuesto pdf....</div>
        </div>
      )}
      {estado === 'error' && (
        <div className="pdf-overlay pdf-overlay--error">
          <i className="fas fa-triangle-exclamation pdf-overlay-icon" />
          <div className="pdf-overlay-msg">{error ?? 'No se pudo generar el PDF.'}</div>
          <button type="button" className="btn btn-out" onClick={onReintentar}>
            <i className="fas fa-rotate-right" /> Reintentar
          </button>
        </div>
      )}

      <div className="pdftool">
        <div>
          <i className="far fa-file-pdf" />
          <span>{pdf?.nombre ?? 'Presupuesto.pdf'}</span>
        </div>
        {pdf && (
          <div>
            <a className="pdf-open" href={pdf.url} target="_blank" rel="noopener noreferrer">
              Abrir en pestaña <i className="fas fa-external-link-alt" />
            </a>
          </div>
        )}
      </div>

      {/* El visor refleja file_mkse56g9: si no hay archivo, queda vacío. */}
      {!pdf ? (
        <div className="pdf-empty">
          <i className="far fa-file-pdf" />
          <p>El PDF del presupuesto se mostrará acá cuando se genere.</p>
        </div>
      ) : blobUrl ? (
        <iframe className="pdfframe" src={blobUrl} title={pdf.nombre} />
      ) : fallo ? (
        /* Sin los bytes no hay render posible: queda la vía de abrirlo aparte. */
        <div className="pdf-empty">
          <i className="fas fa-triangle-exclamation" />
          <p>
            No se pudo mostrar el PDF acá. Abrilo en una pestaña con el enlace de arriba para
            verlo.
          </p>
        </div>
      ) : (
        <div className="pdf-empty">
          <i className="fas fa-circle-notch spin" />
          <p>Cargando el documento…</p>
        </div>
      )}
    </div>
  )
}
