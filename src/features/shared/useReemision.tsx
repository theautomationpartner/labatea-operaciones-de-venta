import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { firmaDocumento, type DocumentoGenerado } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'

const NOMBRE: Record<DocumentoGenerado, string> = {
  presupuesto: 'el presupuesto',
  remito: 'el remito',
  proforma: 'la factura proforma',
}

/**
 * Reemisión de los documentos que genera la app (presupuesto, remito, proforma). Emitir se puede
 * repetir —para corregir un error—, y como emitir ya no deja los pasos anteriores en solo lectura,
 * hay que cuidar que el PDF no quede viejo:
 *
 *   · `firma`: la de los datos ACTUALES; se guarda con el PDF al emitir (ver `firmaDocumento`).
 *   · Si hay PDF y su firma no coincide con la actual —se volvió a un paso anterior y se cambió
 *     algo—, el PDF se descarta (con su envío) y la etapa vuelve a "Emitir".
 *   · `pedirEmision`: lo que hace el botón. Si el documento ya se había enviado a algún contacto,
 *     antes de reemitir se pide confirmación, porque el envío vuelve a cero; si no, emite directo.
 *
 * `emitir` es la emisión de la vista; `emitido`, si ya hay PDF.
 */
export function useReemision(doc: DocumentoGenerado, emitido: boolean, emitir: () => void) {
  const state = useApp()
  const dispatch = useDispatch()
  const firma = firmaDocumento(state, doc)
  const { firmaPdf, envioIniciado } = state

  useEffect(() => {
    if (emitido && firmaPdf != null && firmaPdf !== firma) dispatch({ type: 'descartarPdf' })
  }, [emitido, firmaPdf, firma, dispatch])

  const [confirmar, setConfirmar] = useState(false)

  const pedirEmision = () => {
    if (emitido && envioIniciado) setConfirmar(true)
    else emitir()
  }

  const modal = confirmar ? (
    <Modal
      title={`¿Volver a emitir ${NOMBRE[doc]}?`}
      icon={<i className="fas fa-triangle-exclamation modal-icon--warn" />}
      onClose={() => setConfirmar(false)}
      actions={
        <>
          <button type="button" className="btn btn-gray" onClick={() => setConfirmar(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setConfirmar(false)
              emitir()
            }}
          >
            Volver a emitir
          </button>
        </>
      }
    >
      Se va a generar un PDF nuevo con los datos actuales. Ya lo enviaste a los contactos: el envío
      vuelve a empezar y vas a tener que enviarles el documento nuevo.
    </Modal>
  ) : null

  return { firma, pedirEmision, modal }
}
