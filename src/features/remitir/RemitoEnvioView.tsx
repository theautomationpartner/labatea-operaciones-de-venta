import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { TRANSPORTISTA } from '@/data/mock'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { round2 } from '@/lib/format'
import { pasosDe } from '@/lib/pasos'
import {
  crearRemito,
  crearVtaPendienteFacturar,
  getComisionistas,
  getDestinosCliente,
  getTransportistas,
  getVehiculos,
  sumarRemitoPendienteFacturar,
  type LineaRemito,
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
  const [abierto, setAbierto] = useState(true)
  // Creación del remito en Monday al confirmar (con overlay que tapa la pantalla).
  const [creando, setCreando] = useState(false)
  const [errorCreacion, setErrorCreacion] = useState<string | null>(null)

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

  // Qué hace falta cargar para poder confirmar, según el responsable elegido.
  // La entrega compromete mercadería: no se confirma con el cliente bloqueado.
  const bloqueo = useBloqueoCredito(0)
  const confirmable =
    envio.responsable === 'LA_BATEA'
      ? !!envio.destinoId && !!envio.choferId && !!envio.vehiculoId
      : envio.responsable === 'COMISIONISTA'
        ? !!envio.comisionistaId
        : envio.responsable === 'CLIENTE'
          ? envio.responsableNombre.trim().length > 0
          : false

  const colapsable = envio.confirmado
  const cuerpoVisible = abierto || !colapsable
  const puedeContinuar = envio.confirmado

  // Resumen corto para la cabecera cuando el item queda plegado.
  const resumenEntrega =
    envio.responsable === 'LA_BATEA'
      ? `La Batea · ${envio.destinoNombre || '—'}`
      : envio.responsable === 'COMISIONISTA'
        ? `Comisionista · ${envio.comisionistaNombre || '—'}`
        : envio.responsable === 'CLIENTE'
          ? `Cliente · ${envio.responsableNombre || '—'}`
          : ''

  // Elegir el mismo responsable lo deselecciona; cambiarlo limpia los datos anteriores.
  const elegir = (id: ResponsableEntrega) =>
    dispatch({ type: 'setEnvioResponsable', value: envio.responsable === id ? null : id })

  /**
   * Confirma el remito: lo crea en Monday (cabecera + un subelemento por producto) y recién ahí
   * avanza a la emisión. Si ya se creó (mismo remito), no se recrea: sólo continúa. Un remito a
   * medias —menos subelementos que líneas— no avanza: se avisa y se puede reintentar.
   */
  const confirmarRemito = async () => {
    if (creando) return
    if (remito.remitoId) {
      dispatch({ type: 'goto', paso: 'remito-emision' })
      return
    }
    setCreando(true)
    setErrorCreacion(null)
    try {
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
        setErrorCreacion(
          'El remito se creó pero quedaron productos sin asentar. Revisá en Monday antes de continuar.',
        )
        return
      }
      dispatch({ type: 'setRemitoCreado', value: creado.id })

      /* POSTERIOR: la mercadería entregada queda pendiente de facturar. Con el remito ya creado
         (Σ cantidad × precio unitario = importe pendiente), se: (1) acumula ese importe en el
         "🤖Remito Pends de Facturar" de la cuenta corriente, y (2) abre el registro en "Vtas Pends
         de Facturar" (ítem + subítems) enlazado al remito y a la cuenta. Ambos pasos son best-effort:
         un fallo posterior no revierte el remito ni frena la operación. */
      if ((remito.tipoEmision ?? 'POSTERIOR') === 'POSTERIOR') {
        const importePendFacturar = round2(
          remito.items.reduce((acc, it) => acc + round2(it.cantidad * (it.precioUnitario ?? 0)), 0),
        )
        if (cliente.ctaCteId) {
          try {
            await sumarRemitoPendienteFacturar(cliente.ctaCteId, importePendFacturar)
          } catch {
            /* La cuenta corriente se actualiza de forma best-effort. */
          }
        }
        try {
          await crearVtaPendienteFacturar({
            nombre: cliente.name,
            clienteId: cliente.id,
            ctaCteId: cliente.ctaCteId,
            remitoId: creado.id,
            importeTotal: importePendFacturar,
            lineas: remito.items.map((it) => ({
              productoId: it.productoId,
              precioUnitario: it.precioUnitario ?? 0,
              cantidad: it.cantidad,
              // Tipo de producto (CO / COM) del Maestro: se etiqueta en el subelemento pendiente.
              tipoMercaderia: it.tipo,
              // Rentabilidad según la lista del cliente: se guarda para reusarla al facturar.
              rentabilidad: it.rentabilidad,
            })),
          })
        } catch {
          /* El registro de "Vtas Pends de Facturar" se crea best-effort. */
        }
      }

      dispatch({ type: 'goto', paso: 'remito-emision' })
    } catch {
      setErrorCreacion('No se pudo crear el remito en Monday. Reintentá en unos segundos.')
    } finally {
      setCreando(false)
    }
  }

  return (
    <section className="view paso-layout remito-envio-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={2}
      />
      <PasoTitulo
        numero={3}
        titulo="Especificación del envío"
        descripcion="Indicá quién entrega la mercadería y completá los datos del transporte para generar el remito."
      />

      <div className="cobro-acc">
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

          <span className="font-b">
            <i className="fas fa-truck" /> ¿Quién entrega la mercadería?
          </span>

          {colapsable && !abierto && <span className="entrega-resumen">{resumenEntrega}</span>}

          <span
            className={`cobro-ok ${envio.confirmado ? 'on' : ''}`}
            title={envio.confirmado ? 'Entrega confirmada' : 'Entrega sin confirmar'}
          >
            <i className="fas fa-check" />
          </span>
        </div>

        {cuerpoVisible && (
          <div className="cobro-acc-body">
            {/* Al elegir una, las otras dos quedan anuladas (deshabilitadas). */}
            <div className="entrega-opts">
              {OPCIONES.map((opt) => {
                const activa = envio.responsable === opt.id
                return (
                  <button
                    type="button"
                    key={opt.id}
                    className={`entrega-opt ${activa ? 'active' : ''}`}
                    disabled={envio.responsable !== null && !activa}
                    aria-pressed={activa}
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

            {/* CLIENTE RESPONSABLE: nombre de quien retira. */}
            {envio.responsable === 'CLIENTE' && (
              <div className="card card--config card--flush entrega-form">
                <h3 className="ctitle">
                  <i className="fas fa-user-check" /> Cliente responsable
                </h3>
                <div className="igp">
                  <label htmlFor="resp-nombre">Nombre del responsable</label>
                  <input
                    id="resp-nombre"
                    className="full"
                    placeholder="Ingresá el nombre del responsable"
                    value={envio.responsableNombre}
                    onChange={(e) =>
                      dispatch({
                        type: 'setRemitoEnvio',
                        patch: { responsableNombre: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            )}

            {envio.responsable && (
              <div className="entrega-confirmar">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!confirmable || envio.confirmado}
                  onClick={() => {
                    if (bloqueo.frenar()) return
                    dispatch({ type: 'confirmarEntrega' })
                    setAbierto(false)
                  }}
                >
                  {envio.confirmado ? (
                    <>
                      <i className="fas fa-check" /> Entrega confirmada
                    </>
                  ) : (
                    'Confirmar entrega'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          onClick={() => dispatch({ type: 'goto', paso: 'remito-productos' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
        <button
          type="button"
          className="btn btn-green"
          disabled={!puedeContinuar || creando}
          aria-busy={creando}
          onClick={confirmarRemito}
        >
          Continuar a emisión del remito <i className="fas fa-arrow-right" />
        </button>
      </div>

      {creando && (
        <ModalCargando
          titulo="Registrando remito"
          detalle="Estamos registrando el remito en el sistema. Espera unos segundos"
        />
      )}

      {errorCreacion && (
        <AvisoModal titulo="No se pudo confirmar el remito" onClose={() => setErrorCreacion(null)}>
          {errorCreacion}
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
