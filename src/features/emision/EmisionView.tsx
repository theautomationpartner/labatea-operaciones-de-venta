import { useEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { NRO_PRESUPUESTO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { addDays } from '@/lib/dates'
import { PASOS_PRESUPUESTO } from '@/lib/pasos'
import { resumenPresupuesto } from '@/lib/selectors'
import { faltantesPresupuesto } from '@/lib/validaciones'
import {
  emitirPresupuesto,
  esperarPresupuestoPdf,
  mondayHabilitado,
  type PresupuestoPdf,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { PdfPreview, type EstadoPdf } from './PdfPreview'
import { ResumenEmision } from './ResumenEmision'

/** Paso 3 de PRESUPUESTAR: revisión, PDF y envío a los contactos. */
export function EmisionView() {
  const { lineas, fechaEmision, diasVigencia, cliente, presupuestoId, nroPresupuesto } = useApp()
  const dispatch = useDispatch()

  // El presupuesto no liquida IVA: el importe total es el subtotal de sus productos.
  const resumen = useMemo(() => resumenPresupuesto(lineas, false), [lineas])
  const vencimiento = useMemo(
    () => addDays(fechaEmision, diasVigencia),
    [fechaEmision, diasVigencia],
  )

  /* Generación del PDF: crea el presupuesto en "Emitir" (dispara Make.com) y espera el archivo. */
  const [estado, setEstado] = useState<EstadoPdf>('idle')
  const [pdf, setPdf] = useState<PresupuestoPdf | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Datos que faltan para escribir el presupuesto en Monday; frenan la generación.
  const [faltantes, setFaltantes] = useState<string[] | null>(null)
  // Si se sale del paso mientras se espera el PDF, no actualizamos estado desmontado.
  const activo = useRef(true)
  useEffect(() => {
    activo.current = true
    return () => {
      activo.current = false
    }
  }, [])

  // Ni el PDF se genera si el cliente está bloqueado o la operación se pasa de su línea.
  // El crédito se mide sobre el neto (en el presupuesto neto y total coinciden: no liquida IVA).
  const bloqueo = useBloqueoCredito(resumen.neto)

  /**
   * Generar PDF ya NO crea el presupuesto: a este paso se llega con el ítem creado desde
   * "Continuar a emisión". Acá sólo se pasa su estado a "Emitir" —lo que dispara Make.com— y
   * se espera el archivo.
   */
  const generar = async () => {
    if (!cliente) return
    if (bloqueo.frenar()) return
    // Nada se manda a Monday si falta un dato del ítem o de sus subitems.
    const faltan = faltantesPresupuesto(
      { cliente, lineas, fechaEmision, fechaVencimiento: vencimiento, diasVigencia },
      mondayHabilitado(),
    )
    if (faltan.length > 0) {
      setFaltantes(faltan)
      return
    }
    /* Sin ítem no hay nada que emitir. No se crea acá: si se llegó sin presupuesto, hay que
       volver al paso de productos y confirmarlo, que es donde nace. */
    const id = presupuestoId
    if (!id) {
      setError(
        'El presupuesto todavía no está creado. Volvé al paso de productos y confirmalo con "Continuar a emisión".',
      )
      setEstado('error')
      return
    }
    setEstado('generando')
    setError(null)
    setPdf(null)
    try {
      await emitirPresupuesto(id)
      const generado = await esperarPresupuestoPdf(id)
      if (!activo.current) return
      if (generado) {
        setPdf(generado)
        setEstado('listo')
      } else if (mondayHabilitado()) {
        setError('El PDF está tardando más de lo esperado. Reintentá en unos segundos.')
        setEstado('error')
      } else {
        // Modo local (sin token): no hay archivo real, se muestra la maqueta.
        setEstado('listo')
      }
    } catch {
      if (!activo.current) return
      setError('No se pudo generar el presupuesto. Reintentá.')
      setEstado('error')
    }
  }

  return (
    <section className="view emision-v2 paso-layout">
      <PasoHeader pasos={PASOS_PRESUPUESTO} actual={2} />

      <PasoTitulo
        numero={3}
        titulo="Emitir y enviar presupuesto"
        descripcion="Revisá el resumen, generá el PDF y mandáselo a los contactos del cliente."
      />

      {/* Columna izquierda: el resumen y, debajo, el envío. A la derecha, el documento. */}
      <div className="emision-grid">
        <div className="emision-col">
          <ResumenEmision
            resumen={resumen}
            vencimiento={vencimiento}
            generando={estado === 'generando'}
            onGenerar={generar}
          />
          <EnviarDocumento documento="presupuesto" numero={nroPresupuesto ?? NRO_PRESUPUESTO} />
        </div>

        <PdfPreview estado={estado} pdf={pdf} error={error} onReintentar={generar} />
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          onClick={() => dispatch({ type: 'goto', paso: 'productos' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
      </div>

      {faltantes && (
        <AvisoModal
          titulo="Faltan datos para emitir el presupuesto"
          faltantes={faltantes}
          onClose={() => setFaltantes(null)}
        >
          No se puede generar el PDF hasta completar estos datos en Monday:
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
