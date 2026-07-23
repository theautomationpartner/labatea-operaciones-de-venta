import { useEffect, useState } from 'react'
import { ContactosPicker } from '@/features/shared/ContactosPicker'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { faltaParaMedio } from '@/lib/validaciones'
import {
  asignarDestinatarios,
  dispararEnvio,
  ENVIO_ESTADO,
  getContactosCliente,
  seguirEnvio,
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
  /** 'presupuesto' | 'factura': arma los textos del bloque y del log. */
  documento: string
  numero: string
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
export function EnviarDocumento({ documento, numero }: EnviarDocumentoProps) {
  const { enviar, medioEnvio, contactos, cliente, presupuestoId } = useApp()
  const dispatch = useDispatch()
  const articulo = documento === 'factura' ? 'la' : 'el'
  /* El envío no consume línea nueva: acá el bloqueo mira el estado del cliente, no un
     importe, así que alcanza con cero. */
  const bloqueo = useBloqueoCredito(0)
  // Estado del envío: gobierna el botón y la línea de feedback al pie de la card.
  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('idle')
  // Lo que dice la columna de estado en Monday mientras la automatización trabaja.
  const [estadoMonday, setEstadoMonday] = useState('')
  const enviando = estadoEnvio === 'enviando'

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

  const confirmar = async () => {
    if (enviando) return
    // El envío es una salida del sistema: no sale nada de un cliente bloqueado o excedido.
    if (bloqueo.frenar()) return
    setEstadoEnvio('enviando')
    setEstadoMonday('')
    try {
      if (documento === 'presupuesto' && presupuestoId) {
        // 1) Destinatarios y medio en el ítem; 2) el estado dispara el envío.
        await asignarDestinatarios(
          presupuestoId,
          contactos.map((c) => c.itemId).filter((id): id is string => Boolean(id)),
          medioEnvio,
        )
        await dispararEnvio(presupuestoId)
        // 3) Se sigue la columna de estado hasta que la automatización la cierra.
        const final = await seguirEnvio(presupuestoId, setEstadoMonday)
        if (final === ENVIO_ESTADO.error) {
          setEstadoEnvio('error')
          return
        }
      }
      dispatch({ type: 'setLog', entries: construirLog(contactos, documento, numero) })
      setEstadoEnvio('enviado')
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
      setEstadoEnvio('error')
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

            <button
              type="button"
              className="btn-block btn-block--enviar"
              style={{ background: '#575ce5', marginTop: 16 }}
              disabled={contactos.length === 0 || enviando || estadoEnvio === 'enviado'}
              aria-busy={enviando}
              onClick={confirmar}
            >
              {enviando ? (
                <>
                  <i className="fas fa-circle-notch spin" /> Enviando...
                </>
              ) : estadoEnvio === 'enviado' ? (
                <>
                  <i className="fas fa-check" /> Enviado
                </>
              ) : (
                '🛫 Confirmar y Enviar'
              )}
            </button>

            {/* Estado del envío: una sola línea, no una entrada por contacto. */}
            {estadoEnvio !== 'idle' && (
              <div className={`envio-estado envio-estado--${estadoEnvio}`} role="status" aria-live="polite">
                {enviando && (
                  <>
                    <i className="fas fa-circle-notch spin" />
                    {/* Mientras dura, se muestra lo que dice la columna de estado en Monday. */}
                    <span>{estadoMonday ? `${estadoMonday}…` : 'Enviando…'}</span>
                  </>
                )}
                {estadoEnvio === 'enviado' && (
                  <>
                    <i className="fas fa-circle-check tilde-lento" />
                    <span>
                      Enviado · {numero} a {contactos.length}{' '}
                      {contactos.length === 1 ? 'contacto' : 'contactos'}
                    </span>
                  </>
                )}
                {estadoEnvio === 'error' && (
                  <>
                    <i className="fas fa-circle-xmark" />
                    <span>
                      {estadoMonday === ENVIO_ESTADO.error
                        ? 'El envío falló en Monday. Revisá los contactos y reintentá.'
                        : 'No se pudo enviar. Reintentá en unos segundos.'}
                    </span>
                  </>
                )}
              </div>
            )}
          </>
        ))}

      {bloqueo.modal}
    </div>
  )
}
