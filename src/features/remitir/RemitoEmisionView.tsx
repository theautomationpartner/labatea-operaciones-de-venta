import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { NRO_REMITO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { pasosDe } from '@/lib/pasos'
import {
  afectarEntregaAnterior,
  emitirRemito,
  esperarRemitoPdf,
  getHojaTalonario,
  marcarHojaUsada,
  mondayHabilitado,
  type HojaTalonario,
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

  /* Talonario "En USO" y su primera hoja "Pend de Usar": son la numeración del remito. Sin ellos
     no se puede emitir (botón deshabilitado + aviso). Se chequea al entrar al paso. */
  const [talonario, setTalonario] = useState<HojaTalonario | null>(null)
  const [talonarioError, setTalonarioError] = useState<'sin-talonario' | 'sin-hoja' | null>(null)
  const [avisoTalonario, setAvisoTalonario] = useState(false)
  const [validandoTalonario, setValidandoTalonario] = useState(true)

  // Si se sale del paso mientras se espera el PDF, no actualizamos estado desmontado.
  const activo = useRef(true)
  useEffect(() => {
    activo.current = true
    return () => {
      activo.current = false
    }
  }, [])

  // Pre-validación del talonario al entrar al paso: define si la emisión está habilitada.
  useEffect(() => {
    let vivo = true
    setValidandoTalonario(true)
    getHojaTalonario()
      .then((res) => {
        if (!vivo) return
        if (res.estado === 'ok') {
          setTalonario(res.hoja)
          setTalonarioError(null)
        } else {
          setTalonario(null)
          setTalonarioError(res.estado)
          setAvisoTalonario(true)
        }
      })
      .catch(() => {
        if (!vivo) return
        // Ante un fallo de la consulta se bloquea igual: no se puede confirmar el talonario.
        setTalonario(null)
        setTalonarioError('sin-talonario')
        setAvisoTalonario(true)
      })
      .finally(() => {
        if (vivo) setValidandoTalonario(false)
      })
    return () => {
      vivo = false
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
    // Sin talonario "En USO" con hoja "Pend de Usar" no se numera el remito: se frena y se avisa.
    if (talonarioError || !talonario) {
      setAvisoTalonario(true)
      return
    }
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
      /* Estado "Emitir", observaciones y hoja del talonario en UNA sola mutación: es atómica, así
         no queda el remito emitido sin su número de hoja (ni al revés) si algo falla. */
      await emitirRemito(id, remito.observaciones, talonario.hojaId)
      /* Ya consumida y vinculada la hoja, se cierra su correlativo: pasa a "Usado". Best-effort:
         un fallo acá no revierte el remito ya emitido. */
      try {
        await marcarHojaUsada(talonario.hojaId)
      } catch {
        /* El cierre de la hoja del talonario es best-effort. */
      }
      /* Conciliación del remito ANTERIOR: dos bulk PARALELAS y DESACOPLADAS —Bulk A crea el subítem
         de historial en "Pends de Entrega"; Bulk B acumula lo entregado en el subelemento de la
         Venta—. Se dispara SIN await (fire-and-forget): no bloquea la finalización del remito, y las
         dos operaciones corren en paralelo (nunca A→B encadenadas). */
      void afectarEntregaAnterior(
        remito.items.map((it) => ({
          cantidad: it.cantidad,
          nombre: it.nombre,
          pendienteEntregaId: it.pendienteEntregaId,
          ventaSubitemId: it.subitemId,
        })),
      ).catch(() => {
        /* La conciliación de entrega es best-effort: el remito ya quedó emitido. */
      })
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
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={3}
      />
      <PasoTitulo
        numero={4}
        titulo="Emitir y enviar remito"
        descripcion="Revisá el resumen del remito, emitilo y mandáselo a los contactos del cliente."
      />

      {/* Izquierda: el resumen con el botón de emisión. Derecha: el remito a generar en un
          desplegable y, debajo, el envío —mismo armado que el paso de factura—. */}
      <div className="emision-grid">
        <div className="emision-col">
          <ResumenRemitoEmision
            generando={estado === 'generando'}
            emitido={estado === 'listo'}
            onEmitir={emitir}
            talonarioNombre={talonario?.talonarioNombre}
            hojaNombre={talonario?.hojaNombre}
            bloqueado={validandoTalonario || talonarioError != null || !talonario}
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

      {/* Bloqueo por talonario: sin talonario en uso o sin hojas disponibles no se puede emitir. */}
      {avisoTalonario && talonarioError && (
        <AvisoModal
          titulo={
            talonarioError === 'sin-talonario'
              ? 'No hay talonarios disponibles'
              : 'Sin hoja de talonario asignada'
          }
          onClose={() => setAvisoTalonario(false)}
        >
          {talonarioError === 'sin-talonario'
            ? 'No hay ningún talonario en uso para numerar el remito. Activá un talonario en Monday para poder emitir.'
            : 'El talonario actual no posee hojas disponibles.'}
        </AvisoModal>
      )}

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
