import { useEffect, useState } from 'react'
import { getComisionistas, getRutasEntrega, type RutaEntrega } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Comisionista, ResponsableEntrega } from '@/types'

/** Las tres opciones de quién entrega, iguales a las del Remito. El padding interno lo pone el CSS
 *  (uniforme en las tres), no cada card. */
const OPCIONES: { id: ResponsableEntrega; label: string; icon: string; desc: string }[] = [
  { id: 'LA_BATEA', label: 'La Batea', icon: 'fa-truck-fast', desc: 'Flota propia de La Batea' },
  { id: 'COMISIONISTA', label: 'Comisionista', icon: 'fa-people-carry-box', desc: 'Traslado tercerizado' },
  { id: 'CLIENTE', label: 'Cliente Responsable', icon: 'fa-user-check', desc: 'Lo retira el cliente' },
]

/**
 * Responsable logístico de la venta, en el Cierre de Venta (SÓLO entrega POSTERIOR). Es el mismo
 * componente desplegable del Remito ("Especificación del envío"): arranca ABIERTO al llegar a la
 * etapa y, una vez elegida una opción, se puede plegar y muestra su resumen en la cabecera. Con
 * La Batea pide únicamente una "Ruta de Entrega" que se confirma y bloquea; comisionista y cliente
 * conservan el comportamiento del Remito.
 */
export function EntregaCierreVenta() {
  const { entregaVenta } = useApp()
  const dispatch = useDispatch()
  const responsable = entregaVenta.responsable
  const esLaBatea = responsable === 'LA_BATEA'
  const esComisionista = responsable === 'COMISIONISTA'

  // Arranca abierto: al entrar a la etapa el desplegable ya está desplegado.
  const [abierto, setAbierto] = useState(true)

  const [comisionistas, setComisionistas] = useState<Comisionista[]>([])
  const [cargandoComisionistas, setCargandoComisionistas] = useState(false)
  const [rutas, setRutas] = useState<RutaEntrega[]>([])
  const [cargandoRutas, setCargandoRutas] = useState(false)

  // Comisionistas: sólo cuando la entrega es tercerizada.
  useEffect(() => {
    if (!esComisionista) return
    let vivo = true
    setCargandoComisionistas(true)
    getComisionistas()
      .then((cs) => vivo && setComisionistas(cs))
      .catch(() => vivo && setComisionistas([]))
      .finally(() => vivo && setCargandoComisionistas(false))
    return () => {
      vivo = false
    }
  }, [esComisionista])

  // Rutas: sólo cuando entrega La Batea. `getRutasEntrega` cachea la respuesta a nivel de módulo,
  // así reentrar a la etapa no vuelve a pegarle a la API.
  useEffect(() => {
    if (!esLaBatea) return
    let vivo = true
    setCargandoRutas(true)
    getRutasEntrega()
      .then((rs) => vivo && setRutas(rs))
      .catch(() => vivo && setRutas([]))
      .finally(() => vivo && setCargandoRutas(false))
    return () => {
      vivo = false
    }
  }, [esLaBatea])

  const elegirComisionista = (id: string) => {
    const c = comisionistas.find((x) => x.id === id)
    dispatch({
      type: 'setEntregaVenta',
      patch: { comisionistaId: id, comisionistaNombre: c?.name ?? '', comisionistaCuit: c?.cuit ?? '' },
    })
  }

  const elegirRuta = (id: string) => {
    const r = rutas.find((x) => x.id === id)
    dispatch({ type: 'setEntregaVenta', patch: { rutaId: id, rutaNombre: r?.name ?? '' } })
  }

  /* Radio group de opción única: elegir una reemplaza a la anterior. El estado es mutable y se
     puede cambiar libremente entre las tres en cualquier momento; cambiar de opción limpia los
     datos de la que estaba elegida. */
  const elegir = (id: ResponsableEntrega) =>
    dispatch({ type: 'setEntregaVentaResponsable', value: id })

  /* La opción elegida está "completa" cuando tiene sus datos: es lo que enciende el tilde. El
     cliente responsable no pide datos extra, así que alcanza con elegirlo. */
  const entregaCompleta = esLaBatea
    ? entregaVenta.rutaConfirmada
    : esComisionista
      ? Boolean(entregaVenta.comisionistaId)
      : responsable === 'CLIENTE'

  /* Se puede plegar una vez elegida una opción; hasta entonces queda siempre abierto (como el
     Remito). Al plegarlo se muestra un resumen corto en la cabecera. */
  const colapsable = responsable !== null
  const cuerpoVisible = abierto || !colapsable
  const resumen = esLaBatea
    ? `La Batea · ${entregaVenta.rutaNombre || '—'}`
    : esComisionista
      ? `Comisionista · ${entregaVenta.comisionistaNombre || '—'}`
      : responsable === 'CLIENTE'
        ? 'Cliente'
        : ''

  return (
    <div className="cobro-acc entrega-cierre">
      <div className="cobro-acc-head">
        {colapsable && (
          <button
            type="button"
            className="cobro-acc-chev"
            aria-expanded={abierto}
            aria-label={abierto ? 'Cerrar el detalle de la entrega' : 'Abrir el detalle de la entrega'}
            onClick={() => setAbierto((v) => !v)}
          >
            <i className={`fas fa-chevron-down ${abierto ? 'open' : ''}`} />
          </button>
        )}

        {/* +5px sobre el tamaño base: es una de las preguntas principales de la etapa. */}
        <span className="font-b" style={{ fontSize: 19 }}>
          <i className="fas fa-truck" /> ¿Quién entrega la mercadería?
        </span>

        {colapsable && !abierto && <span className="entrega-resumen">{resumen}</span>}

        <span
          className={`cobro-ok ${entregaCompleta ? 'on' : ''}`}
          title={entregaCompleta ? 'Entrega definida' : 'Entrega sin definir'}
        >
          <i className="fas fa-check" />
        </span>
      </div>

      {cuerpoVisible && (
        <div className="cobro-acc-body">
          {/* Radio group: una sola activa a la vez, pero todas siguen clickeables para poder
              cambiar libremente de opción. Cada card lleva su padding propio. */}
          <div className="entrega-opts" role="radiogroup" aria-label="¿Quién entrega la mercadería?">
            {OPCIONES.map((opt) => {
              const activa = responsable === opt.id
              return (
                <button
                  type="button"
                  key={opt.id}
                  className={`entrega-opt ${activa ? 'active' : ''}`}
                  role="radio"
                  aria-checked={activa}
                  onClick={() => elegir(opt.id)}
                >
                  <span className="entrega-opt-ic">
                    <i className={`fas ${opt.icon}`} />
                  </span>
                  <span className="entrega-opt-txt">
                    <span className="entrega-opt-l">{opt.label}</span>
                    <span className="entrega-opt-d">{opt.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* LA BATEA: sólo la Ruta de Entrega (sin destino/transporte). Se confirma y se bloquea. */}
          {esLaBatea && (
            <div className="card card--config card--flush entrega-form">
              <h3 className="ctitle">
                <i className="fas fa-route" /> Ruta de entrega
              </h3>
              <div className="ruta-row">
                <select
                  className="ruta-select"
                  style={{ cursor: entregaVenta.rutaConfirmada ? 'default' : 'pointer' }}
                  value={entregaVenta.rutaId ?? ''}
                  disabled={entregaVenta.rutaConfirmada}
                  onChange={(e) => elegirRuta(e.target.value)}
                >
                  <option value="" disabled>
                    {cargandoRutas
                      ? 'Buscando rutas de entrega…'
                      : rutas.length === 0
                        ? 'No hay rutas cargadas'
                        : 'Seleccionar ruta...'}
                  </option>
                  {rutas.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="btn btn-primary ruta-confirmar"
                  disabled={!entregaVenta.rutaId || entregaVenta.rutaConfirmada}
                  onClick={() => dispatch({ type: 'confirmarRutaEntrega' })}
                >
                  {entregaVenta.rutaConfirmada ? (
                    <>
                      <i className="fas fa-check" /> Ruta confirmada
                    </>
                  ) : (
                    'Confirmar Ruta'
                  )}
                </button>

                {/* A la derecha del botón: aviso de que hay que confirmar la ruta (mismo estilo info
                    que las aclaraciones de la app). Desaparece al confirmar, reemplazado por el tilde. */}
                {entregaVenta.rutaConfirmada ? (
                  <span className="ruta-ok" title={`Ruta confirmada: ${entregaVenta.rutaNombre}`}>
                    <i className="fas fa-circle-check" /> {entregaVenta.rutaNombre}
                  </span>
                ) : (
                  <div className="cfg-hint ruta-hint">
                    <i className="fas fa-circle-info" /> Debes seleccionar y confirmar una Ruta de
                    Entrega para continuar
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COMISIONISTA: seleccionar de los cargados en el sistema (igual que el Remito). */}
          {esComisionista && (
            <div className="card card--config card--flush entrega-form">
              <h3 className="ctitle">
                <i className="fas fa-people-carry-box" /> Comisionista responsable
              </h3>
              <div className="igp">
                <label htmlFor="entrega-comisionista">Seleccionar comisionista responsable</label>
                <select
                  id="entrega-comisionista"
                  className="full"
                  style={{ cursor: 'pointer' }}
                  value={entregaVenta.comisionistaId ?? ''}
                  onChange={(e) => elegirComisionista(e.target.value)}
                >
                  <option value="" disabled>
                    {cargandoComisionistas
                      ? 'Buscando comisionistas…'
                      : comisionistas.length === 0
                        ? 'No hay comisionistas cargados'
                        : 'Seleccionar comisionista...'}
                  </option>
                  {comisionistas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {entregaVenta.comisionistaId && (
                <div className="envio-dest-card">
                  <i className="fas fa-people-carry-box" />
                  <div>
                    <div className="envio-dest-name">{entregaVenta.comisionistaNombre}</div>
                    <div className="envio-dest-dir">
                      {entregaVenta.comisionistaCuit ? `CUIT ${entregaVenta.comisionistaCuit}` : 'SIN CUIT'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CLIENTE RESPONSABLE: es sólo una opción clickeable, sin datos extra que cargar. */}
        </div>
      )}
    </div>
  )
}
