import { useEffect } from 'react'
import { useDispatch } from '@/state/hooks'

/**
 * Publica en el estado global que un documento se está emitiendo o enviando (`emitiendoDocumento`
 * / `enviandoDocumento`), para que los botones de OTRAS vistas —"Registrar", "Enviar", "Finalizar
 * Operación"— se bloqueen mientras dure.
 *
 * La marca se baja sola al terminar y también si la vista se desmonta a mitad de camino: una
 * bandera que queda prendida dejaría la operación trabada.
 */
export function useAccionEnCurso(accion: 'emitiendo' | 'enviando', activo: boolean) {
  const dispatch = useDispatch()
  useEffect(() => {
    if (!activo) return
    dispatch({ type: 'setAccionEnCurso', accion, value: true })
    return () => dispatch({ type: 'setAccionEnCurso', accion, value: false })
  }, [accion, activo, dispatch])
}

/**
 * Por qué no se puede registrar (o finalizar) AHORA: hay un documento emitiéndose o enviándose.
 * `null` si no hay nada en curso. Registrar cierra la operación, así que esperar es la única opción.
 */
export function motivoAccionEnCurso(state: {
  emitiendoDocumento: boolean
  enviandoDocumento: boolean
}): string | null {
  if (state.emitiendoDocumento) return 'Esperá a que termine de emitirse el documento.'
  if (state.enviandoDocumento) return 'Esperá a que termine el envío del documento.'
  return null
}
