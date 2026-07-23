import { useMemo, useState } from 'react'
import { Stepper } from '@/components/ui/Stepper'
import { CHOFERES, COMISIONISTAS, DESTINOS, TRANSPORTISTA, VEHICULOS } from '@/data/mock'
import { SelectoresOperacion } from '@/features/shared/TopSelectors'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { pasosDe } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'
import type { ResponsableEntrega } from '@/types'

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
  const [abierto, setAbierto] = useState(true)

  const destinos = useMemo(
    () => (cliente ? DESTINOS.filter((d) => d.clienteId === cliente.id) : []),
    [cliente],
  )

  if (!cliente) return null

  const destino = destinos.find((d) => d.id === envio.destinoId)
  const comisionista = COMISIONISTAS.find((c) => c.id === envio.comisionistaId) ?? null

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
      ? `La Batea · ${destino?.nombre ?? '—'}`
      : envio.responsable === 'COMISIONISTA'
        ? `Comisionista · ${comisionista?.name ?? '—'}`
        : envio.responsable === 'CLIENTE'
          ? `Cliente · ${envio.responsableNombre || '—'}`
          : ''

  // Elegir el mismo responsable lo deselecciona; cambiarlo limpia los datos anteriores.
  const elegir = (id: ResponsableEntrega) =>
    dispatch({ type: 'setEnvioResponsable', value: envio.responsable === id ? null : id })

  return (
    <section className="view">
      <SelectoresOperacion />
      <Stepper
        steps={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        current={2}
        className="stepper--tight"
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
                    onChange={(e) =>
                      dispatch({ type: 'setRemitoEnvio', patch: { destinoId: e.target.value } })
                    }
                  >
                    <option value="" disabled>
                      Seleccionar destino...
                    </option>
                    {destinos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre} — {d.direccion}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="divi" />

                <div className="envio-transp">
                  <span className="envio-transp-l">Empresa transportista</span>
                  <span className="envio-transp-v">{TRANSPORTISTA}</span>
                </div>

                <div className="igp">
                  <label htmlFor="chofer">Chofer asignado</label>
                  <select
                    id="chofer"
                    className="full"
                    style={{ cursor: 'pointer' }}
                    value={envio.choferId ?? ''}
                    onChange={(e) =>
                      dispatch({ type: 'setRemitoEnvio', patch: { choferId: e.target.value } })
                    }
                  >
                    <option value="" disabled>
                      Seleccionar chofer...
                    </option>
                    {CHOFERES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — CUIT {c.cuit}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="igp">
                  <label htmlFor="vehiculo">Vehículo</label>
                  <select
                    id="vehiculo"
                    className="full"
                    style={{ cursor: 'pointer' }}
                    value={envio.vehiculoId ?? ''}
                    onChange={(e) =>
                      dispatch({ type: 'setRemitoEnvio', patch: { vehiculoId: e.target.value } })
                    }
                  >
                    <option value="" disabled>
                      Seleccionar vehículo...
                    </option>
                    {VEHICULOS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.patente} — {v.descripcion}
                      </option>
                    ))}
                  </select>
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
                    onChange={(e) =>
                      dispatch({ type: 'setRemitoEnvio', patch: { comisionistaId: e.target.value } })
                    }
                  >
                    <option value="" disabled>
                      Seleccionar comisionista...
                    </option>
                    {COMISIONISTAS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — CUIT {c.cuit} ({c.zona})
                      </option>
                    ))}
                  </select>
                </div>
                {comisionista && (
                  <div className="envio-dest-card">
                    <i className="fas fa-people-carry-box" />
                    <div>
                      <div className="envio-dest-name">{comisionista.name}</div>
                      <div className="envio-dest-dir">
                        CUIT {comisionista.cuit} · {comisionista.zona}
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
          disabled={!puedeContinuar}
          onClick={() => dispatch({ type: 'goto', paso: 'remito-emision' })}
        >
          Continuar a emisión del remito <i className="fas fa-arrow-right" />
        </button>
      </div>

      {bloqueo.modal}
    </section>
  )
}
