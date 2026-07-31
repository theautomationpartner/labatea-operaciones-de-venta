import { type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { NRO_PRESUPUESTO } from '@/data/mock'
import { money, pct } from '@/lib/format'
import type { ResumenPresupuesto } from '@/lib/selectors'
import { useApp } from '@/state/hooks'

interface ResumenEmisionProps {
  resumen: ResumenPresupuesto
  vencimiento: string
  /** El PDF se está generando (dispara loading en el visor y bloquea el botón). */
  generando: boolean
  /** El presupuesto ya se emitió: el botón queda en verde, como el de envío. */
  emitido: boolean
  onGenerar: () => void
}

interface FilaProps {
  label: string
  /** Campo que viaja al documento: se marca con asterisco. */
  requerido?: boolean
  /** Color del valor: verde (favorable), rojo (alerta) o "total" (destacado). */
  tono?: 'verde' | 'total' | 'rojo'
  children: ReactNode
}

function Fila({ label, requerido = true, tono, children }: FilaProps) {
  const clase =
    tono === 'total'
      ? 'rvalue--total'
      : tono === 'verde'
        ? 'rvalue--green'
        : tono === 'rojo'
          ? 'rvalue--red'
          : ''
  return (
    <div className="rrow">
      <span className="rlabel">
        {label}
        {requerido && <span className="rreq">*</span>}
      </span>
      <span className={`rvalue ${clase}`}>{children}</span>
    </div>
  )
}

/** Resumen final antes de emitir. Sólo lectura: todo viene de los pasos anteriores. */
export function ResumenEmision({
  resumen,
  vencimiento,
  generando,
  emitido,
  onGenerar,
}: ResumenEmisionProps) {
  const { vendedor, cliente, lineas, fechaEmision, nroPresupuesto } = useApp()

  return (
    <div className="card card--flush resumen-emision">
      <h3 className="resumen-title">Resumen del presupuesto</h3>

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
        {/* Sale del board al iniciar la operación; el mock queda de respaldo en modo local. */}
        <Fila label="N° de presupuesto">{nroPresupuesto ?? NRO_PRESUPUESTO}</Fila>
        <Fila label="Cantidad de productos">{lineas.length}</Fila>
      </div>

      <hr className="rsep" />

      {/* El presupuesto no liquida IVA: se muestra únicamente el importe total. */}
      <div className="rgroup">
        <Fila label="Importe total" tono="total">
          {money(resumen.total)}
        </Fila>
        <Fila label="Rentabilidad general" tono="verde">
          {pct(resumen.rentabilidad)}
        </Fila>
        {/* Descuento general: por ahora fijo en 0%. */}
        <Fila label="Descuento general" tono="verde">
          0%
        </Fila>
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label="Fecha de emisión" requerido={false}>
          {fechaEmision}
        </Fila>
        <Fila label="Fecha de vencimiento" tono="rojo">
          {vencimiento} 📅
        </Fila>
      </div>

      <button
        type="button"
        className="btn-generar"
        onClick={onGenerar}
        disabled={generando || emitido}
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
            <i className="fas fa-check" /> Presupuesto emitido
          </>
        ) : (
          <>
            <i className="far fa-file-pdf" /> Emitir Presupuesto
          </>
        )}
      </button>
    </div>
  )
}
