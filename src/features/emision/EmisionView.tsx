import { useEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { NRO_PRESUPUESTO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { addDays } from '@/lib/dates'
import { PASOS_PRESUPUESTO } from '@/lib/pasos'
import { resumenPresupuesto, resumenPresupuestoBimoneda } from '@/lib/selectors'
import { faltantesPresupuesto } from '@/lib/validaciones'
import {
  crearPresupuesto,
  emitirPresupuesto,
  esperarPresupuestoPdf,
  mondayHabilitado,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { PresupuestoAGenerar } from './PresupuestoAGenerar'
import { ResumenEmision } from './ResumenEmision'

/** Estado de la emisión: idle → generando (dispara Make.com) → listo, o error. */
type EstadoPdf = 'idle' | 'generando' | 'listo' | 'error'

/** Paso 3 de PRESUPUESTAR: revisión, PDF y envío a los contactos. */
export function EmisionView() {
  const {
    lineas,
    fechaEmision,
    diasVigencia,
    cliente,
    presupuestoId,
    nroPresupuesto,
    vendedor,
    moneda,
    tasaCambio,
    documentoEmitido,
    documentoEnviado,
  } = useApp()
  const dispatch = useDispatch()
  /* Éxito PERSISTENTE de la emisión: la bandera global sobrevive a la navegación con el stepper, así
     el botón "Emitir Presupuesto" no se reactiva al volver a esta etapa. */
  const emitido = documentoEmitido

  // El presupuesto no liquida IVA: el importe total es el subtotal de sus productos.
  const resumen = useMemo(() => resumenPresupuesto(lineas, false), [lineas])
  /* Totales bimonetarios (pesos y dólares por separado): los mismos que muestra el paso de armado.
     Se escriben en el ítem del presupuesto al crearlo (TOTAL EN PESOS / TOTAL EN DOLARES). */
  const bimoneda = useMemo(
    () => resumenPresupuestoBimoneda(lineas, tasaCambio ?? 0),
    [lineas, tasaCambio],
  )
  const vencimiento = useMemo(
    () => addDays(fechaEmision, diasVigencia),
    [fechaEmision, diasVigencia],
  )

  /* Generación del PDF: crea el presupuesto en "Emitir" (dispara Make.com) y espera el archivo. */
  const [estado, setEstado] = useState<EstadoPdf>('idle')
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

  // Emisión del PRESUPUESTO: el crédito NO frena (sólo la venta bloquea). Un presupuesto con el
  // crédito agotado igual se emite, genera el PDF y se envía. El cliente bloqueado sí frena.
  const bloqueo = useBloqueoCredito(resumen.neto, { bloqueante: false })

  /**
   * "Emitir Presupuesto" es el ÚNICO disparador de la creación en Monday (ejecución diferida):
   * a este paso se llega sin ítem creado. Acá se crea el ítem con todos sus productos, se
   * `await`ea su confirmación, y recién entonces se pasa a "Emitir" —lo que dispara Make.com— y
   * se espera el PDF. Un ítem ya creado (reintento tras un fallo del PDF) no se vuelve a crear.
   */
  const generar = async () => {
    if (!cliente) return
    // Anti-duplicado: si el presupuesto ya se emitió con éxito (incluso tras volver con el stepper),
    // la acción se anula internamente y NO se vuelve a crear/emitir el documento.
    if (documentoEmitido) return
    if (estado === 'generando') return
    if (bloqueo.frenar()) return
    if (lineas.length === 0) {
      setError('Agregá al menos un producto antes de emitir el presupuesto.')
      setEstado('error')
      return
    }
    // Nada se manda a Monday si falta un dato del ítem o de sus subitems.
    const faltan = faltantesPresupuesto(
      { cliente, lineas, fechaEmision, fechaVencimiento: vencimiento, diasVigencia },
      mondayHabilitado(),
    )
    if (faltan.length > 0) {
      setFaltantes(faltan)
      return
    }
    setEstado('generando')
    setError(null)
    try {
      /* La creación del ítem se difiere hasta acá: nace al emitir, no al entrar al paso. Se
         `await`ea y se corta si algún producto no entró. Idempotente: si ya existe, no se recrea. */
      let id = presupuestoId
      if (!id) {
        const creado = await crearPresupuesto({
          cliente,
          vendedor,
          lineas,
          fechaEmision,
          fechaVencimiento: vencimiento,
          diasVigencia,
          rentabilidad: resumen.rentabilidad,
          moneda,
          totalPesos: bimoneda.ars.neto,
          totalUsd: bimoneda.usd.neto,
        })
        if (creado.subitemsCreados !== lineas.length) {
          setError(
            `El presupuesto se creó pero quedó incompleto: entraron ${creado.subitemsCreados} de ${lineas.length} productos. Revisalo en Monday antes de emitirlo.`,
          )
          setEstado('error')
          return
        }
        id = creado.id
        dispatch({ type: 'setPresupuestoId', value: id })
      }
      await emitirPresupuesto(id)
      const generado = await esperarPresupuestoPdf(id)
      if (!activo.current) return
      if (generado) {
        setEstado('listo')
        // Bandera GLOBAL de emisión exitosa: persiste al navegar con el stepper.
        dispatch({ type: 'setDocumentoEmitido', value: true })
      } else if (mondayHabilitado()) {
        setError('El PDF está tardando más de lo esperado. Reintentá en unos segundos.')
        setEstado('error')
      } else {
        // Modo local (sin token): no hay archivo real, se muestra la maqueta.
        setEstado('listo')
        dispatch({ type: 'setDocumentoEmitido', value: true })
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

      {/* Izquierda: el resumen con el botón de emisión. Derecha: el presupuesto a registrar en un
          desplegable y, debajo, el envío —mismo armado que el paso de factura—. */}
      <div className="emision-grid">
        <div className="emision-col">
          <ResumenEmision
            resumen={resumen}
            vencimiento={vencimiento}
            generando={estado === 'generando'}
            emitido={emitido}
            onGenerar={generar}
          />
        </div>

        {/* Bajo `.factura-v2` para reutilizar el desplegable de comprobantes (clases `comp-*` y sus
            variables); se neutraliza el box de página del namespace para que encaje en la columna. */}
        <div className="factura-v2" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
          <PresupuestoAGenerar
            numero={nroPresupuesto ?? NRO_PRESUPUESTO}
            lineas={lineas}
            emitido={emitido}
          />
          <EnviarDocumento documento="presupuesto" numero={nroPresupuesto ?? NRO_PRESUPUESTO} />
        </div>
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          onClick={() => dispatch({ type: 'goto', paso: 'productos' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
        {/* Cierra el presupuesto y reinicia la app. Sólo con el PDF generado y ya enviado. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!(emitido && documentoEnviado)}
          onClick={() => dispatch({ type: 'reset' })}
        >
          <i className="fas fa-flag-checkered" /> Finalizar Operación
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

      {/* La emisión ya no tiene visor: un fallo del PDF se avisa en el mismo modal reutilizado. */}
      {estado === 'error' && error && (
        <AvisoModal
          titulo="No se pudo emitir el presupuesto"
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
