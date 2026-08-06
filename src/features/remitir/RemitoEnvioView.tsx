import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { TRANSPORTISTA } from '@/data/mock'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { pasosDe } from '@/lib/pasos'
import {
  getComisionistas,
  getDestinosCliente,
  getTransportistas,
  getVehiculos,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Chofer, Comisionista, Destino, ResponsableEntrega, Vehiculo } from '@/types'

/** Las tres opciones de quién entrega la mercadería. */
const OPCIONES: { id: ResponsableEntrega; label: string; icon: string; desc: string }[] = [
  { id: 'LA_BATEA', label: 'La Batea', icon: 'fa-truck-fast', desc: 'Flota propia de La Batea' },
  { id: 'COMISIONISTA', label: 'Comisionista', icon: 'fa-people-carry-box', desc: 'Traslado tercerizado' },
  { id: 'CLIENTE', label: 'Cliente Responsable', icon: 'fa-user-check', desc: 'Lo retira el cliente' },
]

/** COT: 16 dígitos, generado automáticamente al pedirlo. */
const generarCotNro = (): string =>
  Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('')

/**
 * Paso 3 de REMITO: quién entrega la mercadería. Según el responsable se piden datos
 * distintos (transporte propio + COT, comisionista, o cliente), y la entrega se confirma
 * en un desplegable con check, como el registro del cobro.
 */
export function RemitoEnvioView() {
  const { cliente, operacion, tipoVenta, tipoEntrega, remito } = useApp()
  const dispatch = useDispatch()
  const { envio } = remito
  const esLaBatea = envio.responsable === 'LA_BATEA'
  const esComisionista = envio.responsable === 'COMISIONISTA'
  /* Aviso al intentar avanzar: sin responsable elegido, o con sus datos a medio cargar. */
  const [aviso, setAviso] = useState<'sin-responsable' | 'incompleto' | null>(null)

  /* Destinos, transportistas y vehículos se traen de Monday sólo cuando entrega La Batea; los
     comisionistas, cuando la entrega es tercerizada. Es ahí donde aparecen sus inputs. Cada
     uno con su estado de carga, para que el select avise. */
  const [destinos, setDestinos] = useState<Destino[]>([])
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [comisionistas, setComisionistas] = useState<Comisionista[]>([])
  const [cargando, setCargando] = useState({
    destinos: false,
    choferes: false,
    vehiculos: false,
    comisionistas: false,
  })

  const clienteId = cliente?.id
  useEffect(() => {
    if (!esLaBatea || !clienteId) return
    let vivo = true
    setCargando((c) => ({ ...c, destinos: true }))
    getDestinosCliente(clienteId)
      .then((ds) => vivo && setDestinos(ds))
      .catch(() => vivo && setDestinos([]))
      .finally(() => vivo && setCargando((c) => ({ ...c, destinos: false })))
    setCargando((c) => ({ ...c, choferes: true, vehiculos: true }))
    getTransportistas()
      .then((cs) => vivo && setChoferes(cs))
      .catch(() => vivo && setChoferes([]))
      .finally(() => vivo && setCargando((c) => ({ ...c, choferes: false })))
    getVehiculos()
      .then((vs) => vivo && setVehiculos(vs))
      .catch(() => vivo && setVehiculos([]))
      .finally(() => vivo && setCargando((c) => ({ ...c, vehiculos: false })))
    return () => {
      vivo = false
    }
  }, [esLaBatea, clienteId])

  // Comisionistas: se traen cuando la entrega es tercerizada.
  useEffect(() => {
    if (!esComisionista) return
    let vivo = true
    setCargando((c) => ({ ...c, comisionistas: true }))
    getComisionistas()
      .then((cs) => vivo && setComisionistas(cs))
      .catch(() => vivo && setComisionistas([]))
      .finally(() => vivo && setCargando((c) => ({ ...c, comisionistas: false })))
    return () => {
      vivo = false
    }
  }, [esComisionista])

  if (!cliente) return null

  /* Cada selección guarda, además del id, los datos que se muestran acá y en el resumen/PDF. */
  const elegirComisionista = (id: string) => {
    const c = comisionistas.find((x) => x.id === id)
    dispatch({
      type: 'setRemitoEnvio',
      patch: { comisionistaId: id, comisionistaNombre: c?.name ?? '', comisionistaCuit: c?.cuit ?? '' },
    })
  }
  const elegirDestino = (id: string) => {
    const d = destinos.find((x) => x.id === id)
    dispatch({
      type: 'setRemitoEnvio',
      patch: { destinoId: id, destinoNombre: d?.nombre ?? '', destinoDireccion: d?.direccion ?? '' },
    })
  }
  const elegirChofer = (id: string) => {
    const c = choferes.find((x) => x.id === id)
    dispatch({
      type: 'setRemitoEnvio',
      patch: { choferId: id, choferNombre: c?.name ?? '', choferCuit: c?.cuit ?? '' },
    })
  }
  const elegirVehiculo = (id: string) => {
    const v = vehiculos.find((x) => x.id === id)
    dispatch({
      type: 'setRemitoEnvio',
      patch: { vehiculoId: id, vehiculoNombre: v?.name ?? '', vehiculoPatente: v?.patente ?? '' },
    })
  }

  // La entrega compromete mercadería: no se avanza con el cliente bloqueado.
  const bloqueo = useBloqueoCredito(0)

  /* Datos que faltan según el responsable elegido. "Cliente Responsable" no pide ninguno: lo
     retira el propio cliente y con elegirlo alcanza. */
  const faltantes: string[] = []
  if (envio.responsable === 'LA_BATEA') {
    if (!envio.destinoId) faltantes.push('Destino del cliente')
    if (!envio.choferId) faltantes.push('Chofer asignado')
    if (!envio.vehiculoId) faltantes.push('Vehículo')
  } else if (envio.responsable === 'COMISIONISTA') {
    if (!envio.comisionistaId) faltantes.push('Comisionista responsable')
  }

  /* El responsable se puede cambiar cuantas veces haga falta: vale la ÚLTIMA opción que quede
     elegida, y cambiarla limpia los datos de la anterior. */
  const elegir = (id: ResponsableEntrega) => {
    if (envio.responsable === id) return
    dispatch({ type: 'setEnvioResponsable', value: id })
    setAviso(null)
  }

  /**
   * Avanzar a la emisión del remito es una transición local y silenciosa: el remito NO se crea
   * acá, nace al hacer click en "Emitir Remito". Antes se valida que la entrega esté definida:
   * sin responsable, o con sus datos incompletos, no se pasa de etapa.
   */
  const continuar = () => {
    if (!envio.responsable) {
      setAviso('sin-responsable')
      return
    }
    if (faltantes.length > 0) {
      setAviso('incompleto')
      return
    }
    if (bloqueo.frenar()) return
    dispatch({ type: 'goto', paso: 'remito-emision' })
  }

  return (
    <section className="view paso-layout remito-envio-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={2}
      />
      <PasoTitulo
        numero={3}
        titulo="Entrega de Mercadería"
        descripcion="Indicá quién entrega la mercadería y completá los datos del transporte para generar el remito."
      />

      {/* Bloque estático sobre fondo blanco: sin acordeón ni confirmación. La entrega se define
          eligiendo una opción, y se puede cambiar todas las veces que haga falta. */}
      <div className="entrega-panel">
        <div className="entrega-panel-head">
          <span className="font-b">
            <i className="fas fa-truck" /> ¿Quién entrega la mercadería?
          </span>
        </div>

        <div className="entrega-panel-body">
          <div className="entrega-opts" role="radiogroup" aria-label="¿Quién entrega la mercadería?">
              {OPCIONES.map((opt) => {
                const activa = envio.responsable === opt.id
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

            {/* LA BATEA: destino + transporte en un solo formulario, con generación del COT. */}
            {envio.responsable === 'LA_BATEA' && (
              <div className="card card--config card--flush entrega-form">
                <h3 className="ctitle">
                  <i className="fas fa-truck-fast" /> Destino y transporte
                </h3>

                <div className="igp">
                  <label htmlFor="destino">Destino del cliente</label>
                  <select
                    id="destino"
                    className="full"
                    style={{ cursor: 'pointer' }}
                    value={envio.destinoId ?? ''}
                    onChange={(e) => elegirDestino(e.target.value)}
                  >
                    <option value="" disabled>
                      {cargando.destinos
                        ? 'Buscando destinos del cliente…'
                        : destinos.length === 0
                          ? 'El cliente no tiene destinos cargados'
                          : 'Seleccionar destino...'}
                    </option>
                    {destinos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.direccion ? `${d.nombre} — ${d.direccion}` : d.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="divi" />

                <div className="envio-transp">
                  <span className="envio-transp-l">Empresa transportista</span>
                  <span className="envio-transp-v">{TRANSPORTISTA}</span>
                </div>

                {/* Chofer + CUIT y Vehículo + Patente, en una sola fila. El chofer ocupa la
                    mitad de su lado para dejar lugar al CUIT; el grupo del vehículo va después
                    con 20px de separación, y la patente al lado del vehículo. */}
                <div className="transporte-row">
                  <div className="igp transporte-chofer">
                    <label htmlFor="chofer">Chofer asignado</label>
                    <select
                      id="chofer"
                      className="full"
                      style={{ cursor: 'pointer' }}
                      value={envio.choferId ?? ''}
                      onChange={(e) => elegirChofer(e.target.value)}
                    >
                      <option value="" disabled>
                        {cargando.choferes ? 'Buscando transportistas…' : 'Seleccionar chofer...'}
                      </option>
                      {choferes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="igp transporte-dato">
                    <label>CUIT/CUIL</label>
                    {/* No editable por ahora: refleja el CUIT del chofer elegido. */}
                    {envio.choferId && !envio.choferCuit ? (
                      <div className="dato-vacio">SIN CUIT</div>
                    ) : (
                      <input className="full" readOnly value={envio.choferCuit ?? ''} placeholder="—" />
                    )}
                  </div>

                  <div className="igp transporte-vehiculo">
                    <label htmlFor="vehiculo">Vehículo</label>
                    <select
                      id="vehiculo"
                      className="full"
                      style={{ cursor: 'pointer' }}
                      value={envio.vehiculoId ?? ''}
                      onChange={(e) => elegirVehiculo(e.target.value)}
                    >
                      <option value="" disabled>
                        {cargando.vehiculos ? 'Buscando vehículos…' : 'Seleccionar vehículo...'}
                      </option>
                      {vehiculos.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="igp transporte-dato">
                    <label>Patente</label>
                    {/* No editable por ahora: refleja la patente del vehículo elegido. */}
                    {envio.vehiculoId && !envio.vehiculoPatente ? (
                      <div className="dato-vacio">sin patente</div>
                    ) : (
                      <input
                        className="full"
                        readOnly
                        value={envio.vehiculoPatente ?? ''}
                        placeholder="—"
                      />
                    )}
                  </div>
                </div>

                <div className="divi" />

                <div className="igp">
                  <label htmlFor="cot">COT (Código de Operación de Traslado)</label>
                  <div className="cot-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() =>
                        dispatch({ type: 'setRemitoEnvio', patch: { cot: generarCotNro() } })
                      }
                    >
                      <i className="fas fa-file-lines" /> Generación del COT
                    </button>
                    <input
                      id="cot"
                      className="full"
                      readOnly
                      value={envio.cot ?? ''}
                      placeholder="Se genera automáticamente al presionar el botón"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* COMISIONISTA: seleccionar de los cargados en el sistema. */}
            {envio.responsable === 'COMISIONISTA' && (
              <div className="card card--config card--flush entrega-form">
                <h3 className="ctitle">
                  <i className="fas fa-people-carry-box" /> Comisionista responsable
                </h3>
                <div className="igp">
                  <label htmlFor="comisionista">Seleccionar comisionista responsable</label>
                  <select
                    id="comisionista"
                    className="full"
                    style={{ cursor: 'pointer' }}
                    value={envio.comisionistaId ?? ''}
                    onChange={(e) => elegirComisionista(e.target.value)}
                  >
                    <option value="" disabled>
                      {cargando.comisionistas
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
                {envio.comisionistaId && (
                  <div className="envio-dest-card">
                    <i className="fas fa-people-carry-box" />
                    <div>
                      <div className="envio-dest-name">{envio.comisionistaNombre}</div>
                      <div className="envio-dest-dir">
                        {envio.comisionistaCuit ? `CUIT ${envio.comisionistaCuit}` : 'SIN CUIT'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* CLIENTE RESPONSABLE: no pide NADA. Lo retira el propio cliente, así que con elegir la
              opción alcanza para poder avanzar. */}
        </div>
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          onClick={() => dispatch({ type: 'goto', paso: 'remito-productos' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
        {/* Queda clickeable: si falta algo, la ventana explica QUÉ, en vez de un botón muerto. */}
        <button type="button" className="btn btn-primary" onClick={continuar}>
          Continuar a emisión del remito <i className="fas fa-arrow-right" />
        </button>
      </div>

      {aviso === 'sin-responsable' && (
        <AvisoModal titulo="Falta definir la entrega" onClose={() => setAviso(null)}>
          Para continuar se debe especificar quién entrega la mercadería
        </AvisoModal>
      )}

      {aviso === 'incompleto' && (
        <AvisoModal
          titulo="Faltan datos de la entrega"
          faltantes={faltantes}
          onClose={() => setAviso(null)}
        >
          Completá los datos del responsable elegido para poder continuar.
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
