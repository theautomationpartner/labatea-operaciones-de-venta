import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { NRO_REMITO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { round2 } from '@/lib/format'
import { pasosDe } from '@/lib/pasos'
import {
  afectarEntregaAnterior,
  crearRemito,
  crearVtaPendienteFacturar,
  emitirRemito,
  esperarRemitoPdf,
  getHojaTalonario,
  marcarHojaUsada,
  mondayHabilitado,
  type HojaTalonario,
  type LineaRemito,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { ResumenRemitoEmision } from './ResumenRemitoEmision'
import { RemitoAGenerar } from './RemitoAGenerar'

/** Estado de la emisión: idle → generando (dispara la automatización) → listo, o error. */
type EstadoPdf = 'idle' | 'generando' | 'listo' | 'error'

/** Paso 4 de REMITO: resumen, generación del PDF del remito y envío a los contactos del cliente. */
export function RemitoEmisionView() {
  const {
    cliente,
    vendedor,
    operacion,
    tipoVenta,
    tipoEntrega,
    remito,
    documentoEmitido,
  } = useApp()
  const dispatch = useDispatch()
  /* Éxito PERSISTENTE de la emisión: la bandera global sobrevive a la navegación con el stepper, así
     el botón "Emitir Remito" no se reactiva al volver a esta etapa. */
  const emitido = documentoEmitido

  /* Generación del PDF: pone el remito en "Emitir" (dispara la automatización) y espera el archivo. */
  const [estado, setEstado] = useState<EstadoPdf>('idle')
  const [error, setError] = useState<string | null>(null)

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
   * "Emitir Remito" es el ÚNICO disparador de la creación en Monday (ejecución diferida): a este
   * paso se llega sin remito creado. Acá se crea el remito (cabecera + un subelemento por
   * producto), se `await`ea su confirmación, y recién entonces se lo emite —escribe las
   * observaciones y pasa su estado a "Emitir", lo que dispara la automatización del PDF—, además
   * de asentar en los subelementos de la venta la cantidad entregada (emisión ANTERIOR). Un remito
   * ya creado (reintento tras un fallo del PDF) no se vuelve a crear.
   */
  const emitir = async () => {
    if (!cliente) return
    // Anti-duplicado: si el remito ya se emitió con éxito (incluso tras volver con el stepper), la
    // acción se anula internamente y NO se vuelve a emitir el documento.
    if (documentoEmitido) return
    if (estado === 'generando') return
    // Sin talonario "En USO" con hoja "Pend de Usar" no se numera el remito: se frena y se avisa.
    if (talonarioError || !talonario) {
      setAvisoTalonario(true)
      return
    }
    if (bloqueo.frenar()) return
    if (remito.items.length === 0) {
      setError('Agregá al menos un producto antes de emitir el remito.')
      setEstado('error')
      return
    }
    setEstado('generando')
    setError(null)
    try {
      /* Creación diferida: el remito nace al emitir, no al confirmar la entrega. Se `await`ea y se
         corta si algún producto no entró. Idempotente: si ya existe, no se recrea. */
      let id = remito.remitoId
      if (!id) {
        const { envio } = remito
        const lineas: LineaRemito[] = remito.items.map((it) => ({
          productoId: it.productoId,
          nombre: it.nombre,
          cantidad: it.cantidad,
          pesoUnitario: it.peso ?? 0,
          um: it.um,
          // Sólo POSTERIOR lo usa: alimenta el "🤖Total $" del subelemento y el pendiente de facturar.
          precioUnitario: it.precioUnitario,
        }))
        // Ventas de origen (emisión ANTERIOR), sin repetir: una línea por venta puede repetirse.
        const ventaIds = Array.from(
          new Set(remito.items.map((it) => it.ventaId).filter((v): v is string => !!v)),
        )
        const creado = await crearRemito({
          clienteId: cliente.id,
          vendedorId: vendedor?.id ?? null,
          nombre: cliente.name,
          tipoEmision: remito.tipoEmision ?? 'POSTERIOR',
          responsable: envio.responsable,
          destinoId: envio.destinoId,
          transportistaId: envio.choferId,
          vehiculoId: envio.vehiculoId,
          comisionistaId: envio.comisionistaId,
          clienteResponsable: envio.responsableNombre,
          ventaIds,
          lineas,
        })
        if (creado.subitemsCreados < lineas.length) {
          setError(
            'El remito se creó pero quedaron productos sin asentar. Revisá en Monday antes de emitir.',
          )
          setEstado('error')
          return
        }
        id = creado.id
        dispatch({ type: 'setRemitoCreado', value: id })

        /* POSTERIOR: la mercadería entregada queda pendiente de facturar. Con el remito ya creado
           (Σ cantidad × precio unitario = importe pendiente), se abre el registro en "Vtas Pends de
           Facturar" (ítem + subítems) enlazado al remito y a la cuenta. Best-effort.
           La app ya NO acumula ese importe en la cuenta corriente del cliente: ese requerimiento
           se descartó y el tablero de Cta Cte no se escribe desde acá. */
        if ((remito.tipoEmision ?? 'POSTERIOR') === 'POSTERIOR') {
          const importePendFacturar = round2(
            remito.items.reduce((acc, it) => acc + round2(it.cantidad * (it.precioUnitario ?? 0)), 0),
          )
          try {
            await crearVtaPendienteFacturar({
              nombre: cliente.name,
              clienteId: cliente.id,
              remitoId: id,
              importeTotal: importePendFacturar,
              lineas: remito.items.map((it) => ({
                productoId: it.productoId,
                precioUnitario: it.precioUnitario ?? 0,
                cantidad: it.cantidad,
                // Tipo de producto (CO / COM) del Maestro: se etiqueta en el subelemento pendiente.
                tipoMercaderia: it.tipo,
                // Rentabilidad según la lista del cliente: se guarda para reusarla al facturar.
                rentabilidad: it.rentabilidad,
                /* MISMA unidad de venta que se asienta en el subelemento del remito: es la que
                   después toma la línea de la factura (venta DIRECTA con entrega ANTERIOR). */
                um: it.um,
              })),
            })
          } catch {
            /* El registro de "Vtas Pends de Facturar" se crea best-effort. */
          }
        }
      }

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
        // El remito recién emitido se linkea a nivel ítem de cada pendiente de entrega.
        id,
      ).catch(() => {
        /* La conciliación de entrega es best-effort: el remito ya quedó emitido. */
      })
      dispatch({ type: 'emitirRemito' })
      const generado = await esperarRemitoPdf(id)
      if (!activo.current) return
      if (generado) {
        setEstado('listo')
        // Bandera GLOBAL de emisión exitosa: persiste al navegar con el stepper.
        dispatch({ type: 'setDocumentoEmitido', value: true })
      } else if (mondayHabilitado()) {
        setError('El PDF está tardando más de lo esperado. Reintentá en unos segundos.')
        setEstado('error')
      } else {
        // Modo local (sin token): no hay archivo real, se muestra el visor vacío.
        setEstado('listo')
        dispatch({ type: 'setDocumentoEmitido', value: true })
      }
    } catch {
      if (!activo.current) return
      /* Fallo de la API: lo comunica la ventana global de error de Monday. Acá sólo se libera el
         botón para poder reintentar; no se deja un mensaje propio. */
      setEstado('idle')
      dispatch({ type: 'errorMonday', accion: 'emitir el remito' })
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
            emitido={emitido}
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
          <EnviarDocumento documento="remito" numero={NRO_REMITO} />
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
        {/* Cierra el remito y reinicia la app. Alcanza con el remito EMITIDO: el envío al cliente
            es una gestión aparte y puede quedar pendiente. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!emitido}
          title={emitido ? undefined : 'Emití el remito para poder finalizar la operación.'}
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
