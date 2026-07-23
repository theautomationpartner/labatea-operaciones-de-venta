import { useMemo } from 'react'
import { VENTAS_ENTREGA } from '@/data/mock'
import { money } from '@/lib/format'
import type { EstadoEntrega } from '@/types'

/** Sólo se remite lo que falta entregar: ventas pendientes o entregadas en parte. */
const REMITIBLES: readonly EstadoEntrega[] = ['Pend. de Entregar', 'Parcialmente entregada']

const BADGE: Record<EstadoEntrega, string> = {
  'Pend. de Entregar': 'venc',
  'Parcialmente entregada': 'parc',
  Entregada: 'comp',
}

interface ResumenVentasEntregaProps {
  clienteId: string
  /** Venta elegida como filtro; null = todas. */
  seleccionado: string | null
  onSelect: (id: string) => void
}

/** Resumen de las ventas con entrega pendiente del cliente. Cada card filtra la lista. */
export function ResumenVentasEntrega({
  clienteId,
  seleccionado,
  onSelect,
}: ResumenVentasEntregaProps) {
  const { remitibles, total } = useMemo(() => {
    const delCliente = VENTAS_ENTREGA.filter((v) => v.clienteId === clienteId)
    return {
      remitibles: delCliente.filter((v) => REMITIBLES.includes(v.estado)),
      total: delCliente.length,
    }
  }, [clienteId])

  return (
    <div className="presup-panel">
      <div className="presup-head">Ventas pendientes de entregar</div>
      <div className="presup-list">
        {remitibles.length === 0 && (
          <div className="presup-vacio">Este cliente no tiene ventas pendientes de entregar.</div>
        )}
        {remitibles.map((v) => {
          const pendientes = v.productos.reduce((acc, p) => acc + p.pendiente, 0)
          return (
            <button
              type="button"
              key={v.id}
              className={`pcard ${seleccionado === v.id ? 'sel' : ''}`}
              aria-pressed={seleccionado === v.id}
              onClick={() => onSelect(v.id)}
            >
              <div className="pcard-top">
                <span className="pcard-id">{v.id}</span>
                <span className={`pbadge ${BADGE[v.estado]}`}>{v.estado}</span>
              </div>
              <div className="pcard-row">
                <div>
                  <div className="pcol-l">Fecha</div>
                  <div className="pcol-v">{v.fecha}</div>
                </div>
                <div>
                  <div className="pcol-l">Ítems</div>
                  <div className="pcol-v">{v.productos.length}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="pcol-l">U. pendientes</div>
                  <div className="pcol-v" style={{ color: 'var(--orange)' }}>
                    {pendientes}
                  </div>
                </div>
              </div>

              {/* Factura anidada: la venta ya está facturada, esto la respalda. */}
              <div className="fac-nest">
                <i className="fas fa-file-invoice-dollar" />
                <div className="fac-nest-main">
                  <span className="fac-nest-nro">{v.factura.nro}</span>
                  <span className="fac-nest-sub">Emitida {v.factura.fecha}</span>
                </div>
                <span className="fac-nest-tot">{money(v.factura.total)}</span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="presup-foot">
        Mostrando {remitibles.length} de {total} ventas
      </div>
    </div>
  )
}
