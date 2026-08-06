import { useMemo, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { round2 } from '@/lib/format'
import { useApp, useDispatch } from '@/state/hooks'

interface ResumenRemitoEmisionProps {
  /** El PDF se está generando (dispara loading en el visor y bloquea el botón). */
  generando: boolean
  /** El remito ya se emitió: el botón queda en verde, como el de envío. */
  emitido: boolean
  /** Emite el remito: escribe observaciones + estado "Emitir" y espera el PDF. */
  onEmitir: () => void
  /** Talonario activo con el que se numera el remito (ítem "En USO"). */
  talonarioNombre?: string
  /** Hoja/folio del talonario (subítem "Pend de Usar"). */
  hojaNombre?: string
  /** Bloquea "Emitir Remito": sin talonario/hoja disponibles o mientras se valida. */
  bloqueado?: boolean
}

interface FilaProps {
  label: string
  tono?: 'verde' | 'total'
  children: ReactNode
}

function Fila({ label, tono, children }: FilaProps) {
  const clase = tono === 'total' ? 'rvalue--total' : tono === 'verde' ? 'rvalue--green' : ''
  return (
    <div className="rrow">
      <span className="rlabel">{label}</span>
      <span className={`rvalue ${clase}`}>{children}</span>
    </div>
  )
}

/**
 * Resumen del remito antes de emitir. Mismo diseño que el del presupuesto: sólo lectura de los
 * pasos anteriores, más el campo de observaciones y el botón que emite. Muestra cuánto se remite
 * (líneas, peso y unidades de medida) y quién entrega la mercadería.
 */
export function ResumenRemitoEmision({
  generando,
  emitido,
  onEmitir,
  talonarioNombre,
  hojaNombre,
  bloqueado = false,
}: ResumenRemitoEmisionProps) {
  const { vendedor, cliente, remito } = useApp()
  const dispatch = useDispatch()
  const { envio, items } = remito

  // Peso total del remito: suma del peso de cada línea (cantidad × peso unitario).
  const pesoTotal = useMemo(
    () => round2(items.reduce((acc, it) => acc + it.cantidad * (it.peso ?? 0), 0)),
    [items],
  )
  // Unidades de medida presentes, sin repetir y concatenadas.
  const unidadesMedida = useMemo(() => {
    const ums = Array.from(new Set(items.map((it) => it.um).filter(Boolean)))
    return ums.length > 0 ? ums.join(', ') : '—'
  }, [items])

  return (
    <div className="card card--flush resumen-emision">
      <h3 className="resumen-title">Resumen del remito</h3>

      {/* Talonario y hoja con los que se numera el remito: dato de cabecera, prioritario. */}
      <div className="rgroup">
        <Fila label="Talonario">{talonarioNombre ?? '—'}</Fila>
        <Fila label="Hoja de Talonario" tono="verde">
          {hojaNombre ?? '—'}
        </Fila>
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label="Vendedor asignado">
          {vendedor && (
            <>
              <Avatar ini={vendedor.ini} color={vendedor.color} size="sm" /> {vendedor.name}
            </>
          )}
        </Fila>
        <Fila label="Cliente">{cliente?.name ?? '--'}</Fila>
        <Fila label="CUIT/CUIL">{cliente?.cuit ?? '--'}</Fila>
        <Fila label="Cantidad de productos">{items.length}</Fila>
        <Fila label="Peso total" tono="verde">
          {pesoTotal} kg
        </Fila>
        <Fila label="Unidades de medida">{unidadesMedida}</Fila>
      </div>

      <hr className="rsep" />

      {/* Quién entrega la mercadería, con los datos que correspondan según el responsable. */}
      <div className="rgroup">
        {envio.responsable === 'LA_BATEA' ? (
          <>
            <Fila label="Entrega">La Batea (flota propia)</Fila>
            <Fila label="Destino">
              {envio.destinoNombre
                ? `${envio.destinoNombre}${envio.destinoDireccion ? ` — ${envio.destinoDireccion}` : ''}`
                : '—'}
            </Fila>
            <Fila label="Transportista">
              {envio.choferNombre
                ? `${envio.choferNombre}${envio.choferCuit ? ` (CUIT ${envio.choferCuit})` : ' (SIN CUIT)'}`
                : '—'}
            </Fila>
            <Fila label="Vehículo">{envio.vehiculoNombre || '—'}</Fila>
            <Fila label="Patente">{envio.vehiculoPatente || 'sin patente'}</Fila>
          </>
        ) : envio.responsable === 'COMISIONISTA' ? (
          <>
            <Fila label="Entrega">Comisionista</Fila>
            <Fila label="Comisionista">
              {envio.comisionistaNombre
                ? `${envio.comisionistaNombre}${envio.comisionistaCuit ? ` (CUIT ${envio.comisionistaCuit})` : ''}`
                : '—'}
            </Fila>
          </>
        ) : envio.responsable === 'CLIENTE' ? (
          /* El cliente retira: no hay datos de transporte que informar. */
          <Fila label="Entrega">Cliente responsable (retira el cliente)</Fila>
        ) : (
          <Fila label="Entrega">—</Fila>
        )}
      </div>

      <hr className="rsep" />

      <div className="igp">
        <label htmlFor="remito-obs">Observaciones</label>
        <textarea
          id="remito-obs"
          className="full cobro-obs"
          placeholder="Ej.: Entregar en horario de mañana. Coordinar con depósito."
          value={remito.observaciones}
          onChange={(e) => dispatch({ type: 'setRemitoObservaciones', value: e.target.value })}
        />
      </div>

      <button
        type="button"
        className="btn-generar"
        onClick={onEmitir}
        disabled={generando || emitido || bloqueado}
        aria-busy={generando}
        // Emitido: el botón pasa a verde para confirmar, como el de "Enviado".
        style={emitido ? { backgroundColor: 'var(--green)', color: '#fff' } : undefined}
      >
        {generando ? (
          <>
            <i className="fas fa-circle-notch spin" /> Emitiendo...
          </>
        ) : emitido ? (
          <>
            <i className="fas fa-check" /> Remito emitido
          </>
        ) : (
          <>
            <i className="far fa-file-pdf" /> EMITIR REMITO
          </>
        )}
      </button>
    </div>
  )
}
