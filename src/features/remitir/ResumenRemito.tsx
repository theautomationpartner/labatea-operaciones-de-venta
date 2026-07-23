import { CHOFERES, COMISIONISTAS, DESTINOS, TRANSPORTISTA, VEHICULOS } from '@/data/mock'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { useApp, useDispatch } from '@/state/hooks'

interface Campo {
  label: string
  valor: string
}

/** Ficha con lo que va al remito. El remito documenta cantidades, no importes. */
export function ResumenRemito() {
  const { cliente, remito } = useApp()
  const dispatch = useDispatch()
  const { envio } = remito
  // Emitir el remito es una salida del sistema: no sale con el cliente bloqueado.
  const bloqueo = useBloqueoCredito(0)

  if (!cliente) return null

  const unidades = remito.items.reduce((acc, it) => acc + it.cantidad, 0)
  const destino = DESTINOS.find((d) => d.id === envio.destinoId)
  const chofer = CHOFERES.find((c) => c.id === envio.choferId)
  const vehiculo = VEHICULOS.find((v) => v.id === envio.vehiculoId)
  const comisionista = COMISIONISTAS.find((c) => c.id === envio.comisionistaId)

  const datos: Campo[] = [
    { label: 'Razón Social', valor: cliente.name },
    { label: 'CUIT', valor: cliente.cuit },
    { label: 'Tipo de emisión', valor: remito.tipoEmision ?? '—' },
    { label: 'Líneas a remitar', valor: String(remito.items.length) },
    { label: 'Unidades totales', valor: String(unidades) },
  ]

  // La entrega se detalla según quién es el responsable.
  const entrega: Campo[] =
    envio.responsable === 'LA_BATEA'
      ? [
          { label: 'Entrega', valor: 'La Batea (flota propia)' },
          { label: 'Destino', valor: destino ? `${destino.nombre} — ${destino.direccion}` : '—' },
          { label: 'Transportista', valor: TRANSPORTISTA },
          { label: 'Chofer', valor: chofer ? `${chofer.name} (CUIT ${chofer.cuit})` : '—' },
          { label: 'Vehículo', valor: vehiculo ? `${vehiculo.patente} — ${vehiculo.descripcion}` : '—' },
          { label: 'COT', valor: envio.cot ?? '—' },
        ]
      : envio.responsable === 'COMISIONISTA'
        ? [
            { label: 'Entrega', valor: 'Comisionista' },
            {
              label: 'Comisionista',
              valor: comisionista ? `${comisionista.name} (CUIT ${comisionista.cuit})` : '—',
            },
          ]
        : envio.responsable === 'CLIENTE'
          ? [
              { label: 'Entrega', valor: 'Cliente responsable' },
              { label: 'Responsable', valor: envio.responsableNombre || '—' },
            ]
          : [{ label: 'Entrega', valor: '—' }]

  return (
    <div className="card card--summary card--flush">
      <h3 className="ctitle">Resumen del remito</h3>

      {datos.map((c) => (
        <div className="fact-row" key={c.label}>
          <span className="fact-lbl">{c.label}</span>
          <span className="fact-val">{c.valor}</span>
        </div>
      ))}

      <div className="divi" />

      {entrega.map((c) => (
        <div className="fact-row" key={c.label}>
          <span className="fact-lbl">{c.label}</span>
          <span className="fact-val">{c.valor}</span>
        </div>
      ))}

      <div className="igp" style={{ marginTop: 14 }}>
        <label htmlFor="remito-obs">Observaciones</label>
        <textarea
          id="remito-obs"
          className="full cobro-obs"
          placeholder="Ej.: Entregar en horario de mañana. Coordinar con depósito."
          value={remito.observaciones}
          onChange={(e) => dispatch({ type: 'setRemitoObservaciones', value: e.target.value })}
        />
      </div>

      {/* Emitir el remito habilita su envío formal al cliente. */}
      <button
        type="button"
        className="btn-block"
        style={{ background: 'var(--primary-blue)', marginTop: 16 }}
        disabled={remito.emitido}
        onClick={() => {
          if (bloqueo.frenar()) return
          dispatch({ type: 'emitirRemito' })
        }}
      >
        {remito.emitido ? (
          <>
            <i className="fas fa-check" /> Remito emitido
          </>
        ) : (
          'Emitir remito'
        )}
      </button>

      {bloqueo.modal}
    </div>
  )
}
