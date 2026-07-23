import { useState } from 'react'
import type { BalancePago } from '@/lib/cobros'
import { money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { MovimientoPago } from '@/types'

interface TablaMovimientosProps {
  balances: BalancePago[]
  /** Fecha del cobro: es una sola para toda la operación, se repite en cada fila. */
  fecha: string
  /** Cobro ya registrado en Monday: el registro queda a la vista, pero no se toca. */
  bloqueado?: boolean
}

/** Campo del detalle de un pago: rótulo y valor. */
interface Dato {
  label: string
  valor: string
}

/**
 * Detalle adicional de un pago, según su forma. El efectivo no tiene nada que agregar a lo
 * que ya muestra la fila, así que no se despliega; el resto sí.
 */
function detalleDe(m: MovimientoPago): Dato[] {
  if (m.formaPago === 'Transferencia') {
    const c = m.cuentaBancaria
    return [
      { label: 'Banco', valor: c?.banco || '—' },
      { label: 'Número de cuenta', valor: c?.numeroCuenta || '—' },
      { label: 'Medio de transferencia', valor: m.medioTransferencia || '—' },
      { label: 'Tipo de cuenta', valor: c?.tipoCuenta || '—' },
    ]
  }
  return []
}

/** Fila de un pago, con su detalle plegable debajo cuando la forma lo amerita. */
function FilaPago({
  balance,
  fecha,
  bloqueado,
  columnas,
  onQuitar,
}: {
  balance: BalancePago
  fecha: string
  bloqueado: boolean
  columnas: number
  onQuitar: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const { movimiento: m } = balance
  const detalle = detalleDe(m)
  const desplegable = detalle.length > 0

  return (
    <>
      <tr className={desplegable && abierto ? 'cobro-fila--abierta' : ''}>
        <td>
          <span className="cobro-fila-1a">
            {/* El efectivo no despliega nada: el hueco mantiene alineada la columna. */}
            {desplegable ? (
              <button
                type="button"
                className="cobro-fila-chev"
                aria-expanded={abierto}
                aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle del pago por ${m.formaPago}`}
                onClick={() => setAbierto((v) => !v)}
              >
                <i className={`fas fa-chevron-right ${abierto ? 'open' : ''}`} />
              </button>
            ) : (
              <span className="cobro-fila-chev cobro-fila-chev--vacio" />
            )}
            {fecha}
          </span>
        </td>
        <td>{m.formaPago}</td>
        <td>{money(m.importe)}</td>
        <td>{balance.descuentoPct}%</td>
        <td>{money(balance.montoCobrado)}</td>
        <td>{m.referencia || '-'}</td>
        {!bloqueado && (
          <td className="ta-r">
            <button
              type="button"
              className="cobro-tabla-del"
              aria-label={`Quitar pago de ${m.formaPago}`}
              onClick={onQuitar}
            >
              <i className="far fa-trash-alt" />
            </button>
          </td>
        )}
      </tr>

      {desplegable && abierto && (
        <tr className="cobro-fila-detalle">
          <td colSpan={columnas}>
            <dl className="cobro-detalle-grid">
              {detalle.map((d) => (
                <div key={d.label} className="cobro-detalle-item">
                  <dt>{d.label}</dt>
                  <dd>{d.valor}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  )
}

/** Pagos ya cargados al cobro. */
export function TablaMovimientos({ balances, fecha, bloqueado = false }: TablaMovimientosProps) {
  const dispatch = useDispatch()
  // Sin acciones posibles, la columna deja de tener sentido y se va.
  const columnas = bloqueado ? 6 : 7

  return (
    <table className="cobro-tabla">
      <thead>
        <tr>
          <th>Fecha del cobro</th>
          <th>Forma de pago</th>
          <th>Importe</th>
          <th>Descuento %</th>
          <th>Monto cobrado</th>
          <th>N° de referencia</th>
          {!bloqueado && <th className="ta-r">Acciones</th>}
        </tr>
      </thead>
      <tbody>
        {balances.length === 0 ? (
          <tr className="cobro-tabla-vacia">
            <td colSpan={columnas}>Todavía no cargaste ningún pago.</td>
          </tr>
        ) : (
          balances.map((b) => (
            <FilaPago
              key={b.movimiento.id}
              balance={b}
              fecha={fecha}
              bloqueado={bloqueado}
              columnas={columnas}
              onQuitar={() =>
                dispatch({ type: 'removeMovimientoPago', id: b.movimiento.id })
              }
            />
          ))
        )}
      </tbody>
      {/* Sin fila de total: el TOTAL COBRADO ya vive en la cabecera del panel. */}
    </table>
  )
}
