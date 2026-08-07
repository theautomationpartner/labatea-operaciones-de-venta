import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ContactosPicker } from '@/features/shared/ContactosPicker'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { faltaParaMedio, sinViaDeEnvio } from '@/lib/validaciones'
import {
  asignarDestinatarios,
  asignarDestinatariosFactura,
  asignarDestinatariosRemito,
  comprobanteFacturaGenerado,
  dispararEnvio,
  dispararEnvioFactura,
  dispararEnvioRemito,
  enviarProforma,
  ENVIO_ESTADO,
  ENVIO_FACTURA_ESTADO,
  getContactosCliente,
  getPresupuestoPdf,
  getRemitoPdf,
  seguirEnvio,
  seguirEnvioFactura,
  seguirEnvioRemito,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Contacto, LogEntry, MedioEnvio } from '@/types'

const MEDIOS: readonly MedioEnvio[] = ['Email', 'WhatsApp', 'Ambos']

/**
 * Un <option> nativo sólo admite texto, así que el ícono va como emoji.
 * 'Ambos' no tiene app propia: lleva el sobre y el chat juntos.
 */
const ICONO_MEDIO: Record<MedioEnvio, string> = {
  Email: '📧',
  WhatsApp: '💬',
  Ambos: '📧💬',
}

interface EnviarDocumentoProps {
  /** 'presupuesto' | 'factura' | 'remito': arma los textos del bloque y del log. */
  documento: string
  numero: string
  /** Se dispara cuando el envío se completó bien: habilita "Finalizar Operación" en la vista. */
  onEnviado?: () => void
}

/** Estado del envío, que se muestra como una sola línea dentro de la card. */
type EstadoEnvio = 'idle' | 'enviando' | 'enviado' | 'error'


/**
 * El registro del envío es una sola entrada: interesa si salió y a cuántos, no el detalle
 * contacto por contacto.
 */
function construirLog(contactos: Contacto[], documento: string, numero: string): LogEntry[] {
  const aceptan = contactos.filter((c) => c.ok).length
  return [
    {
      id: 'envio',
      tipo: 'ok',
      titulo: 'Documento enviado correctamente',
      detalle: `${numero} enviado a ${aceptan} de ${contactos.length} contactos por ${documento}.`,
    },
  ]
}

/** Envío del PDF por mail. Lo comparten la emisión del presupuesto y la de la factura. */
export function EnviarDocumento({ documento, numero, onEnviado }: EnviarDocumentoProps) {
  const {
    medioEnvio,
    contactos,
    cliente,
    presupuestoId,
    ventaId,
    proformaId,
    remito,
    documentoEnviado,
    documentoEmitido,
    factura,
  } = useApp()
  const dispatch = useDispatch()
  const esFactura = documento === 'factura'
  const articulo = documento === 'factura' || documento === 'proforma' ? 'la' : 'el'
  /* ¿El comprobante ya fue emitido? De ello depende poder enviarlo (MÓDULO 1). La bandera cambia
     según el documento: factura → hay comprobantes escritos; proforma → hay id de proforma; el resto
     (presupuesto y remito) → la bandera global de emisión. */
  const emitido =
    documento === 'factura'
      ? factura.comprobantes.length > 0
      : documento === 'proforma'
        ? Boolean(proformaId)
        : documentoEmitido
  // Aviso al intentar enviar sin haber emitido el comprobante todavía.
  const [avisoNoEmitido, setAvisoNoEmitido] = useState(false)
  /* El envío no consume línea nueva: el bloqueo sólo mira el estado del cliente, no un importe
     (por eso va con cero). Y el PRESUPUESTO no frena por crédito: se envía siempre. */
  const bloqueo = useBloqueoCredito(0, { bloqueante: documento !== 'presupuesto' })
  // Estado del envío: gobierna íntegramente el botón (idle / loading / success / error).
  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('idle')
  // Progreso que reporta la columna de estado en Monday: es el callback de las funciones `seguir*`.
  const [, setEstadoMonday] = useState('')
  // Detalle del error, que se muestra a la derecha del botón cuando el envío falla.
  const enviando = estadoEnvio === 'enviando'
  /* Éxito PERSISTENTE: el envío ya se completó (bandera global) o se acaba de completar (estado
     local). Sobrevive a la navegación con el stepper, así el botón NO vuelve a habilitarse ni pierde
     su color de éxito al volver a esta etapa. */
  const enviadoOk = documentoEnviado || estadoEnvio === 'enviado'
  /* Pasar a error: guarda el detalle y tiñe el botón de rojo, con el mensaje a su derecha. */
  /* Deja el botón en rojo para poder reintentar. Es lo único que hace: el detalle del problema va
     al log de la derecha, y si el problema fue la API de Monday, a su ventana global. */
  const marcarError = () => setEstadoEnvio('error')

  /* Fallo de la API de Monday: además del botón en rojo, dispara la ventana global. `accion`
     completa la frase "No se pudo …". */
  const fallar = (accion: string) => {
    marcarError()
    dispatch({ type: 'errorMonday', accion })
  }

  /**
   * Los contactos del cliente se traen al entrar al paso, así ya están listos cuando el
   * usuario elige enviar. Se reparten según su clasificación: los que aceptan el documento
   * quedan seleccionados de entrada, y los que no, disponibles en el buscador por si igual
   * se los quiere sumar.
   */
  const [disponibles, setDisponibles] = useState<Contacto[]>([])
  const [cargando, setCargando] = useState(false)
  // Si el cliente no tiene ningún contacto en el tablero, el envío no es posible.
  const [sinContactos, setSinContactos] = useState(false)
  /* La selección elegida vive en el estado global y sobrevive a la navegación. Se lee por ref para
     no meterla en las deps del efecto (la pisaría en cada cambio). */
  const contactosRef = useRef(contactos)
  contactosRef.current = contactos
  useEffect(() => {
    if (!cliente) {
      setDisponibles([])
      return
    }
    let vivo = true
    setCargando(true)
    /* La consulta está CACHEADA por cliente y documento: al volver a esta etapa con el stepper
       resuelve al instante y no se le pega de nuevo a Monday. */
    getContactosCliente(cliente.id, documento)
      .then((cs) => {
        if (!vivo) return
        setSinContactos(cs.length === 0)
        /* El buscador conserva a todos: el picker ya descarta los que están seleccionados,
           así que arranca mostrando sólo los que no aceptan, y un contacto quitado a mano
           vuelve a quedar disponible. */
        setDisponibles(cs)
        /* La selección se siembra UNA sola vez: si ya hay contactos elegidos —porque el usuario
           los ajustó y navegó con el stepper— no se los pisa con la lista por defecto. */
        if (contactosRef.current.length === 0) {
          dispatch({ type: 'setContactos', contactos: cs.filter((c) => c.ok) })
        }
      })
      .catch(() => {
        if (!vivo) return
        setDisponibles([])
        setSinContactos(true)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [cliente, documento, dispatch])

  /** Item de Monday a enviar según el documento, y contactos como ids numéricos. */
  const contactoItemIds = () =>
    contactos.map((c) => c.itemId).filter((id): id is string => Boolean(id))

  /** Aviso de que el documento todavía no existe en su columna: no se envía sin él. */
  const avisarSinDocumento = () => {
    dispatch({
      type: 'setLog',
      entries: [
        {
          id: 'err-doc',
          tipo: 'err',
          titulo: `Todavía no hay ${documento} generada`,
          detalle: `El PDF de la ${documento} aún no figura en Monday. Esperá a que termine de generarse y reintentá.`,
        },
      ],
    })
    /* No es un fallo de la API: el documento todavía no se generó. El log de al lado ya lo explica. */
    marcarError()
  }

  const confirmar = async () => {
    // Anti-duplicado: si el envío ya se ejecutó con éxito (incluso tras navegar con el stepper), la
    // acción se anula internamente y NO se vuelve a disparar la mutación de envío.
    if (enviando || enviadoOk) return
    /* MÓDULO 1 · sin el comprobante emitido NO se envía: early return sin tocar la API de Monday, y
       se avisa por modal que primero hay que emitirlo. */
    if (!emitido) {
      setAvisoNoEmitido(true)
      return
    }
    // El envío es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
    if (bloqueo.frenar()) return
    setEstadoEnvio('enviando')
    setEstadoMonday('')
    try {
      /* Antes de enviar cualquier documento se valida que el PDF EXISTA en la columna del
         tablero que corresponde. Sin documento generado no se dispara el envío. */
      if (esFactura && ventaId) {
        // Factura: el PDF vive en el mirror del ítem de la venta; el envío se dispara ahí.
        if (!(await comprobanteFacturaGenerado(ventaId))) {
          avisarSinDocumento()
          return
        }
        await asignarDestinatariosFactura(ventaId, contactoItemIds(), medioEnvio)
        await dispararEnvioFactura(ventaId)
        const final = await seguirEnvioFactura(ventaId, setEstadoMonday)
        if (final === ENVIO_FACTURA_ESTADO.error) {
          fallar(`enviar ${articulo} ${documento}`)
          return
        }
      } else if (documento === 'presupuesto' && presupuestoId) {
        // Presupuesto: el PDF vive en la columna file del propio ítem (file_mkse56g9).
        if (!(await getPresupuestoPdf(presupuestoId))) {
          avisarSinDocumento()
          return
        }
        // 1) Destinatarios y medio en el ítem; 2) el estado dispara el envío.
        await asignarDestinatarios(presupuestoId, contactoItemIds(), medioEnvio)
        await dispararEnvio(presupuestoId)
        // 3) Se sigue la columna de estado hasta que la automatización la cierra.
        const final = await seguirEnvio(presupuestoId, setEstadoMonday)
        if (final === ENVIO_ESTADO.error) {
          fallar(`enviar ${articulo} ${documento}`)
          return
        }
      } else if (documento === 'remito' && remito.remitoId) {
        // Remito: el PDF vive en la columna file del propio ítem (file_mkwbmr11).
        if (!(await getRemitoPdf(remito.remitoId))) {
          avisarSinDocumento()
          return
        }
        // Ventas de origen de la mercadería remitada: se aseguran en el link del remito.
        const ventaIds = Array.from(
          new Set(remito.items.map((it) => it.ventaId).filter((v): v is string => !!v)),
        )
        // 1) Contactos, medio y ventas en el ítem; 2) el estado dispara el envío.
        await asignarDestinatariosRemito(remito.remitoId, contactoItemIds(), medioEnvio, ventaIds)
        await dispararEnvioRemito(remito.remitoId)
        // 3) Se sigue la columna de estado hasta que la automatización la cierra.
        const final = await seguirEnvioRemito(remito.remitoId, setEstadoMonday)
        if (/error/i.test(final)) {
          fallar(`enviar ${articulo} ${documento}`)
          return
        }
      } else if (documento === 'proforma' && proformaId) {
        // Proforma: se despacha desde el ítem de la proforma (contactos + medio + estado "Enviar").
        await enviarProforma(proformaId, contactoItemIds(), medioEnvio)
      }
      dispatch({ type: 'setLog', entries: construirLog(contactos, documento, numero) })
      // Bandera GLOBAL de éxito: persiste el envío para que el botón quede bloqueado y en verde
      // aunque el usuario navegue con el stepper y vuelva a esta etapa.
      dispatch({ type: 'setDocumentoEnviado', value: true })
      setEstadoEnvio('enviado')
      onEnviado?.()
    } catch {
      dispatch({
        type: 'setLog',
        entries: [
          {
            id: 'err-envio',
            tipo: 'err',
            titulo: 'No se pudo enviar',
            detalle: `Falló el envío de la ${documento} en Monday. Reintentá.`,
          },
        ],
      })
      fallar(`enviar ${articulo} ${documento}`)
    }
  }

  return (
    <div className="card card--neutral card--flush">
      {/* MÓDULO 2 · el envío es obligatorio post-emisión: la card queda SIEMPRE abierta y fija (sin
          pregunta "¿Desea enviar?" ni toggle SI/NO). Se muestra directo el bloque de envío. */}
      {/* Con el envío YA hecho nunca se tapa el bloque: el "Enviado exitosamente" tiene que seguir
          a la vista aunque se vuelva a entrar a la etapa. */}
      {cargando && !enviadoOk ? (
        <div className="contactos-cargando">
          <i className="fas fa-spinner fa-spin" /> Cargando contactos del cliente…
        </div>
      ) : sinContactos && !enviadoOk ? (
          /* Sin contactos en el tablero no hay a quién enviarle: se explica y no se ofrece envío. */
          <div className="envio-sin-contactos" role="alert">
            <i className="fas fa-triangle-exclamation" />
            <div>
              <div className="envio-sin-contactos-t">El cliente no tiene contactos asignados</div>
              <p>
                {cliente?.name ? <strong>{cliente.name}</strong> : 'Este cliente'} no tiene contactos
                cargados en el tablero de Contactos, así que no es posible realizar el envío.
                Asignale al menos un contacto y volvé a reintentar.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="igp">
              <label htmlFor="medio">Medio de envío *</label>
              <select
                id="medio"
                className="full w-medio"
                style={{ cursor: 'pointer' }}
                value={medioEnvio}
                onChange={(e) =>
                  dispatch({ type: 'setMedioEnvio', value: e.target.value as MedioEnvio })
                }
              >
                {/* El value queda limpio: el emoji es sólo la etiqueta. */}
                {MEDIOS.map((m) => (
                  <option key={m} value={m}>
                    {ICONO_MEDIO[m]} {m}
                  </option>
                ))}
              </select>
            </div>

            <ContactosPicker disponibles={disponibles} />

            <div className="font-b" style={{ fontSize: 14, marginTop: 24 }}>
              Contactos seleccionados ({contactos.length})
            </div>
            <div className="selc">
              {contactos.map((c) => {
                const falta = faltaParaMedio(c, medioEnvio)
                /* Sólo se marca al contacto que NO tiene por dónde recibirlo. Con "Ambos", que le
                   falte uno de los dos datos no es un problema: se envía por el que tenga. */
                const incompleto = sinViaDeEnvio(c, medioEnvio)
                /* Rojo únicamente cuando el envío no puede llegarle. Si sigue siendo alcanzable por
                   el otro canal, el dato ausente se informa en gris oscuro: no es un error. */
                const claseFalta = incompleto ? 'citem-sub--falta' : 'citem-sub--aviso'
                return (
                <div className={`citem ${incompleto ? 'citem--sin-dato' : ''}`} key={c.id}>
                  <div className="cinfo">
                    <div className="cava" style={{ background: c.color }}>
                      {c.ini}
                    </div>
                    <div>
                      <div className="citem-name">{c.name}</div>
                      {/* Falta el dato del medio elegido: se avisa acá, en rojo o en gris oscuro
                          según si el contacto queda o no sin vía de envío. */}
                      <div className={`citem-sub ${falta.telefono ? claseFalta : ''}`}>
                        {falta.telefono ? 'SIN TELEFONO' : c.phone}
                      </div>
                      <div className={`citem-sub ${falta.email ? claseFalta : ''}`}>
                        {falta.email ? 'SIN EMAIL' : c.email}
                      </div>
                    </div>
                  </div>
                  <div className="citem-right">
                    {/* El color del badge ya dice si acepta o no: no hace falta rótulo ni ícono. */}
                    <span className={`cbadge ${c.ok ? 'ok' : 'no'}`}>{c.status}</span>
                    <button
                      type="button"
                      className="del"
                      aria-label={`Quitar ${c.name}`}
                      onClick={() => dispatch({ type: 'removeContacto', id: c.id })}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                )
              })}
            </div>

            {/* Todo el feedback vive DENTRO del botón (idle / loading / success / error); el
                detalle del error va a su derecha. Sin líneas de texto sueltas debajo. */}
            <div className="enviar-row">
              <button
                type="button"
                className="btn-block btn-block--enviar"
                /* MÓDULO 3 · el fondo verde de éxito depende de la bandera GLOBAL (`enviadoOk`): se
                   conserva al volver a esta etapa con el stepper. */
                style={{
                  background: enviadoOk
                    ? 'var(--green)'
                    : estadoEnvio === 'error'
                      ? 'var(--red)'
                      : 'var(--primary-blue)',
                }}
                disabled={contactos.length === 0 || enviando || enviadoOk}
                aria-busy={enviando}
                onClick={confirmar}
              >
                {enviando ? (
                  <>
                    <i className="fas fa-circle-notch spin" /> Enviando...
                  </>
                ) : enviadoOk ? (
                  <>
                    <i className="fas fa-check" /> Enviado exitosamente
                  </>
                ) : estadoEnvio === 'error' ? (
                  <>
                    <i className="fas fa-xmark" /> Error de Envío
                  </>
                ) : (
                  <>
                    <i className="fas fa-paper-plane" /> Confirmar y Enviar
                  </>
                )}
              </button>
            </div>
          </>
        )}

      {bloqueo.modal}

      {/* MÓDULO 1 · aviso al intentar enviar sin haber emitido el comprobante. */}
      {avisoNoEmitido && (
        <AvisoModal titulo="Falta emitir el comprobante" onClose={() => setAvisoNoEmitido(false)}>
          No es posible realizar el envío. Primero debe emitir el comprobante para poder enviarlo.
        </AvisoModal>
      )}
    </div>
  )
}
