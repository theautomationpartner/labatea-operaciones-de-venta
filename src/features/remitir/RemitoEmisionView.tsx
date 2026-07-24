import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { Stepper } from '@/components/ui/Stepper'
import { NRO_REMITO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { SelectoresOperacion } from '@/features/shared/TopSelectors'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { round2 } from '@/lib/format'
import { pasosDe } from '@/lib/pasos'
import {
  actualizarCantEntregada,
  emitirRemito,
  esperarRemitoPdf,
  mondayHabilitado,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { ResumenRemitoEmision } from './ResumenRemitoEmision'
import { RemitoAGenerar } from './RemitoAGenerar'

/** Estado de la emisión: idle → generando (dispara la automatización) → listo, o error. */
type EstadoPdf = 'idle' | 'generando' | 'listo' | 'error'

/** Paso 4 de REMITO: resumen, generación del PDF del remito y envío a los contactos del cliente. */
export function RemitoEmisionView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, remito } = useApp()
  const dispatch = useDispatch()

  /* Generación del PDF: pone el remito en "Emitir" (dispara la automatización) y espera el archivo. */
  const [estado, setEstado] = useState<EstadoPdf>('idle')
  const [error, setError] = useState<string | null>(null)
  // El envío se completó: junto con el remito ya emitido habilita "Finalizar Operación".
  const [enviado, setEnviado] = useState(false)
  // Si se sale del paso mientras se espera el PDF, no actualizamos estado desmontado.
  const activo = useRef(true)
  useEffect(() => {
    activo.current = true
    return () => {
      activo.current = false
    }
  }, [])

  // Emitir el remito es una salida del sistema: no sale con el cliente bloqueado.
  const bloqueo = useBloqueoCredito(0)

  /**
   * Emite el remito: escribe las observaciones y pasa su estado a "Emitir" —lo que dispara la
   * automatización que genera el PDF—, además de asentar en los subelementos de la venta la
   * cantidad entregada (emisión ANTERIOR). Después espera a que el archivo aparezca en la columna.
   */
  const emitir = async () => {
    if (!cliente) return
    if (bloqueo.frenar()) return
    /* Sin ítem no hay nada que emitir. El remito nace al confirmar la entrega: si se llegó sin
       remito creado, hay que volver al paso anterior y confirmarla. */
    const id = remito.remitoId
    if (!id) {
      setError(
        'El remito todavía no está creado. Volvé al paso anterior y confirmá la entrega para crearlo.',
      )
      setEstado('error')
      return
    }
    setEstado('generando')
    setError(null)
    try {
      await emitirRemito(id, remito.observaciones)
      // La cantidad entregada de cada línea se asienta en el subelemento de la venta (ANTERIOR).
      await actualizarCantEntregada(
        remito.items
          .filter((it) => it.subitemId)
          .map((it) => ({
            subitemId: it.subitemId as string,
            cantEntregada: round2((it.entregadaPrevia ?? 0) + it.cantidad),
          })),
      )
      dispatch({ type: 'emitirRemito' })
      const generado = await esperarRemitoPdf(id)
      if (!activo.current) return
      if (generado) {
        setEstado('listo')
      } else if (mondayHabilitado()) {
        setError('El PDF está tardando más de lo esperado. Reintentá en unos segundos.')
        setEstado('error')
      } else {
        // Modo local (sin token): no hay archivo real, se muestra el visor vacío.
        setEstado('listo')
      }
    } catch {
      if (!activo.current) return
      setError('No se pudo emitir el remito. Reintentá.')
      setEstado('error')
    }
  }

  if (!cliente) return null

  return (
    <section className="view emision-v2 paso-layout">
      <SelectoresOperacion />
      <Stepper
        steps={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        current={3}
        className="stepper--tight"
      />

      {/* Izquierda: el resumen con el botón de emisión. Derecha: el remito a generar en un
          desplegable y, debajo, el envío —mismo armado que el paso de factura—. */}
      <div className="emision-grid">
        <div className="emision-col">
          <ResumenRemitoEmision
            generando={estado === 'generando'}
            emitido={estado === 'listo'}
            onEmitir={emitir}
          />
        </div>

        {/* Bajo `.factura-v2` para reutilizar el desplegable de comprobantes (clases `comp-*` y sus
            variables); se neutraliza el box de página del namespace para que encaje en la columna. */}
        <div className="factura-v2" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
          <RemitoAGenerar numero={NRO_REMITO} items={remito.items} />
          <EnviarDocumento
            documento="remito"
            numero={NRO_REMITO}
            onEnviado={() => setEnviado(true)}
          />
        </div>
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          onClick={() => dispatch({ type: 'goto', paso: 'remito-envio' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
        {/* Cierra el remito y reinicia la app. Sólo con el remito emitido y ya enviado. */}
        <button
          type="button"
          className="btn btn-green"
          disabled={!(estado === 'listo' && enviado)}
          onClick={() => dispatch({ type: 'reset' })}
        >
          <i className="fas fa-flag-checkered" /> Finalizar Operación
        </button>
      </div>

      {/* La emisión ya no tiene visor: un fallo se avisa en el mismo modal reutilizado. */}
      {estado === 'error' && error && (
        <AvisoModal
          titulo="No se pudo emitir el remito"
          onClose={() => {
            setError(null)
            setEstado('idle')
          }}
        >
          {error}
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
