import { useEffect, useState } from 'react'
import { ContactosPicker } from '@/features/shared/ContactosPicker'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { faltaParaMedio } from '@/lib/validaciones'
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
  const { enviar, medioEnvio, contactos, cliente, presupuestoId, ventaId, proformaId, remito, documentoEnviado } =
    useApp()
  const dispatch = useDispatch()
  const esFactura = documento === 'factura'
  const articulo = documento === 'factura' || documento === 'proforma' ? 'la' : 'el'
  /* El envío no consume línea nueva: el bloqueo sólo mira el estado del cliente, no un importe
     (por eso va con cero). Y el PRESUPUESTO no frena por crédito: se envía siempre. */
  const bloqueo = useBloqueoCredito(0, { bloqueante: documento !== 'presupuesto' })
  // Estado del envío: gobierna íntegramente el botón (idle / loading / success / error).
  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('idle')
  // Progreso que reporta la columna de estado en Monday: es el callback de las funciones `seguir*`.
  const [, setEstadoMonday] = useState('')
  // Detalle del error, que se muestra a la derecha del botón cuando el envío falla.
  const [errorMsg, setErrorMsg] = useState('')
  const enviando = estadoEnvio === 'enviando'
  /* Éxito PERSISTENTE: el envío ya se completó (bandera global) o se acaba de completar (estado
     local). Sobrevive a la navegación con el stepper, así el botón NO vuelve a habilitarse ni pierde
     su color de éxito al volver a esta etapa. */
  const enviadoOk = documentoEnviado || estadoEnvio === 'enviado'
  /* Pasar a error: guarda el detalle y tiñe el botón de rojo, con el mensaje a su derecha. */
  const fallar = (msg: string) => {
    setErrorMsg(msg)
    setEstadoEnvio('error')
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
  useEffect(() => {
    if (!cliente) {
      setDisponibles([])
      return
    }
    let vivo = true
    setCargando(true)
    getContactosCliente(cliente.id, documento)
      .then((cs) => {
        if (!vivo) return
        setSinContactos(cs.length === 0)
        /* El buscador conserva a todos: el picker ya descarta los que están seleccionados,
           así que arranca mostrando sólo los que no aceptan, y un contacto quitado a mano
           vuelve a quedar disponible. */
        setDisponibles(cs)
        dispatch({ type: 'setContactos', contactos: cs.filter((c) => c.ok) })
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
    fallar(`El PDF ${articulo} ${documento} aún no figura en Monday. Esperá a que se genere y reintentá.`)
  }

  const confirmar = async () => {
    // Anti-duplicado: si el envío ya se ejecutó con éxito (incluso tras navegar con el stepper), la
    // acción se anula internamente y NO se vuelve a disparar la mutación de envío.
    if (enviando || enviadoOk) return
    // El envío es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
    if (bloqueo.frenar()) return
    setEstadoEnvio('enviando')
    setEstadoMonday('')
    setErrorMsg('')
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
          fallar('El envío falló en Monday. Revisá los contactos y reintentá.')
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
          fallar('El envío falló en Monday. Revisá los contactos y reintentá.')
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
          fallar('El envío falló en Monday. Revisá los contactos y reintentá.')
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
      fallar(`Falló el envío ${articulo === 'la' ? 'de la' : 'del'} ${documento} en Monday. Reintentá.`)
    }
  }

  return (
    <div className="card card--neutral card--flush">
      {/* La pregunta hace de título: no hace falta un rótulo que repita lo mismo. */}
      <div className="drow send-row">
        <span className="send-pregunta">
          ¿Desea enviar {articulo} {documento}?
        </span>
        <div className="toggle">
          {([true, false] as const).map((valor) => (
            <div
              key={String(valor)}
              className={`tbtn ${enviar === valor ? 'active' : ''}`}
              role="button"
              onClick={() => dispatch({ type: 'setEnviar', value: valor })}
            >
              {valor ? 'SI' : 'NO'}
            </div>
          ))}
        </div>
      </div>

      {/* Los elementos de envío aparecen sólo si se eligió SI. */}
      {enviar &&
        (cargando ? (
          <div className="contactos-cargando">
            <i className="fas fa-spinner fa-spin" /> Cargando contactos del cliente…
          </div>
        ) : sinContactos ? (
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
                const incompleto = falta.telefono || falta.email
                return (
                <div className={`citem ${incompleto ? 'citem--sin-dato' : ''}`} key={c.id}>
                  <div className="cinfo">
                    <div className="cava" style={{ background: c.color }}>
                      {c.ini}
                    </div>
                    <div>
                      <div className="citem-name">{c.name}</div>
                      {/* Sin el dato del medio elegido no hay a dónde mandarlo: se avisa acá. */}
                      <div className={`citem-sub ${falta.telefono ? 'citem-sub--falta' : ''}`}>
                        {falta.telefono ? 'SIN TELEFONO' : c.phone}
                      </div>
                      <div className={`citem-sub ${falta.email ? 'citem-sub--falta' : ''}`}>
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

              {/* Detalle del error, inmediatamente a la derecha del botón y en rojo. */}
              {estadoEnvio === 'error' && errorMsg && (
                <span className="enviar-error" role="alert">
                  {errorMsg}
                </span>
              )}
            </div>
          </>
        ))}

      {bloqueo.modal}
    </div>
  )
}
