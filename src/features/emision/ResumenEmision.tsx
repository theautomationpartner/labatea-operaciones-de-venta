import { useMemo, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { NRO_PRESUPUESTO } from '@/data/mock'
import { money, pct, pctDec } from '@/lib/format'
import type { ResumenPresupuesto } from '@/lib/selectors'
import { useApp } from '@/state/hooks'

interface ResumenEmisionProps {
  resumen: ResumenPresupuesto
  vencimiento: string
  /** El PDF se está generando (dispara loading en el visor y bloquea el botón). */
  generando: boolean
  onGenerar: () => void
}

interface FilaProps {
  label: string
  /** Campo que viaja al documento: se marca con asterisco. */
  requerido?: boolean
  /** Verde para los datos favorables (importe total, rentabilidad, vencimiento). */
  tono?: 'verde' | 'total'
  children: ReactNode
}

function Fila({ label, requerido = true, tono, children }: FilaProps) {
  const clase = tono === 'total' ? 'rvalue--total' : tono === 'verde' ? 'rvalue--green' : ''
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
  onGenerar,
}: ResumenEmisionProps) {
  const { vendedor, cliente, lineas, fechaEmision, moneda, nroPresupuesto } = useApp()

  // Descuento general: cuánto se resignó sobre el bruto del presupuesto.
  const descuentoGeneral = useMemo(
    () => (resumen.subtotal > 0 ? (resumen.descuento / resumen.subtotal) * 100 : 0),
    [resumen.subtotal, resumen.descuento],
  )

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

      {/* El presupuesto no liquida IVA: el importe total es el neto de sus productos. */}
      <div className="rgroup">
        <Fila label="Subtotal">{money(resumen.subtotal)}</Fila>
        {resumen.descuento > 0 && (
          <Fila label="Descuento">− {money(resumen.descuento)}</Fila>
        )}
        <Fila label="Importe total" tono="total">
          {money(resumen.total)}
        </Fila>
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label="Rentabilidad general" tono="verde">
          {pct(resumen.rentabilidad)}
        </Fila>
        <Fila label="Descuento general" tono="verde">
          {pctDec(descuentoGeneral)}
        </Fila>
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label="Moneda">{moneda === 'Dólares' ? 'Dólares (USD)' : 'Pesos (ARS)'}</Fila>
        <Fila label="Fecha de emisión" requerido={false}>
          {fechaEmision}
        </Fila>
        <Fila label="Fecha de vencimiento" tono="verde">
          {vencimiento} 📅
        </Fila>
      </div>

      <button
        type="button"
        className="btn-generar"
        onClick={onGenerar}
        disabled={generando}
        aria-busy={generando}
      >
        {generando ? (
          <>
            <i className="fas fa-circle-notch spin" /> Generando...
          </>
        ) : (
          <>
            <i className="far fa-file-pdf" /> GENERAR PDF
          </>
        )}
      </button>
    </div>
  )
}
