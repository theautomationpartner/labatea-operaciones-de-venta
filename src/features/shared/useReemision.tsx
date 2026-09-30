import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { firmaDocumento, type DocumentoGenerado } from '@/state/appState'
import { useApp, useDispatch } from '@/state/hooks'

const NOMBRE: Record<DocumentoGenerado, string> = {
  presupuesto: 'el presupuesto',
  remito: 'el remito',
  proforma: 'la factura proforma',
}

const EMITIDO: Record<DocumentoGenerado, string> = {
  presupuesto: 'emitido actualmente',
  remito: 'emitido actualmente',
  proforma: 'emitida actualmente',
}

/**
 * Reemisión de los documentos que genera la app (presupuesto, remito, proforma). Emitir se puede
 * repetir —para corregir un error—, y como emitir ya no deja los pasos anteriores en solo lectura,
 * hay que cuidar que el PDF no quede viejo:
 *
 *   · `firma`: la de los datos ACTUALES; se guarda con el PDF al emitir (ver `firmaDocumento`).
 *   · Si hay PDF y su firma no coincide con la actual —se volvió a un paso anterior y se cambió
 *     algo—, el PDF se descarta (con su envío) y la etapa vuelve a "Emitir".
 *   · `pedirEmision`: lo que hace el botón. Con un documento YA emitido —enviado o no— antes de
 *     reemitir se pide confirmación, porque el PDF actual se pierde; la primera emisión va directo.
 *   · `enviando`: hay un envío en curso. Mientras dure no se reemite: el botón de emitir se apaga
 *     y `pedirEmision` no hace nada, para no cambiar el PDF que se está mandando.
 *
 * `emitir` es la emisión de la vista; `emitido`, si ya hay PDF.
 */
export function useReemision(doc: DocumentoGenerado, emitido: boolean, emitir: () => void) {
  const state = useApp()
  const dispatch = useDispatch()
  const firma = firmaDocumento(state, doc)
  const { firmaPdf, envioIniciado, enviandoDocumento: enviando } = state

  useEffect(() => {
    if (emitido && firmaPdf != null && firmaPdf !== firma) dispatch({ type: 'descartarPdf' })
  }, [emitido, firmaPdf, firma, dispatch])

  const [confirmar, setConfirmar] = useState(false)

  const pedirEmision = () => {
    if (enviando) return
    if (emitido) setConfirmar(true)
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
            Aceptar
          </button>
        </>
      }
    >
      {`Se va a emitir un documento nuevo con los datos actuales y ${NOMBRE[doc]} ${EMITIDO[doc]} se va a perder.`}
      {envioIniciado &&
        ' Como ya lo enviaste a los contactos, el envío vuelve a empezar y vas a tener que enviarles el documento nuevo.'}{' '}
      ¿Desea continuar?
    </Modal>
  ) : null

  return { firma, pedirEmision, modal, enviando }
}
