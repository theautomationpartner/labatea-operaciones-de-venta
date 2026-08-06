import { useState } from 'react'
import { formatearNroTarjeta, valorPorCuota, type BalancePago } from '@/lib/cobros'
import { money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { MovimientoPago } from '@/types'
import { ImporteEditable } from './ImporteEditable'

/** Campo del detalle desplegable de una tarjeta: rótulo y valor. */
interface Dato {
  label: string
  valor: string
}

/**
 * Lo que NO entra en las columnas principales y se ve al desplegar la fila: los datos del plástico
 * y el respaldo del cobro.
 */
function detalleDe(m: MovimientoPago): Dato[] {
  return [
    { label: 'Nro. Tarjeta', valor: formatearNroTarjeta(m.numeroTarjeta ?? '').texto || '—' },
    { label: 'Fecha de Venc.', valor: m.vencimientoTarjeta || '—' },
    { label: 'Nro Cupon', valor: m.numeroCupon?.trim() || '—' },
    { label: 'Comprobante', valor: m.comprobanteNombre || '—' },
    { label: 'Banco de Acreditación', valor: m.cuentaPropia || '—' },
  ]
}

function FilaTarjeta({
  balance,
  bloqueado,
  esCredito,
  columnas,
  onQuitar,
  onImporte,
}: {
  balance: BalancePago
  bloqueado: boolean
  esCredito: boolean
  columnas: number
  onQuitar: () => void
  onImporte: (importe: number) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const { movimiento: m } = balance
  /* Valor por cuota: se recalcula solo con el importe, así editarlo en la tabla actualiza el plan
     de cuotas en el momento. */
  const porCuota = valorPorCuota(m.importe, m.cuotas)

  return (
    <>
      <tr className={abierto ? 'cobro-fila--abierta' : ''}>
        <td>
          <span className="cobro-fila-1a">
            <button
              type="button"
              className="cobro-fila-chev"
              aria-expanded={abierto}
              aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle de la tarjeta de ${
                m.titularTarjeta || 'la venta'
              }`}
              onClick={() => setAbierto((v) => !v)}
            >
              <i className={`fas fa-chevron-right ${abierto ? 'open' : ''}`} />
            </button>
            {m.bancoTarjeta || '—'}
          </span>
        </td>
        <td>{m.tipoTarjeta || '—'}</td>
        <td>{m.titularTarjeta || '—'}</td>
        {/* Importe editable mientras el cobro no esté registrado: es la forma de llevar la
            DIFERENCIA a 0 sin quitar la tarjeta. */}
        <td>
          {bloqueado ? money(m.importe) : <ImporteEditable valor={m.importe} onCambio={onImporte} />}
        </td>
        {esCredito && <td>{m.cuotas || '—'}</td>}
        {esCredito && <td>{porCuota == null ? '—' : money(porCuota)}</td>}
        {!bloqueado && (
          <td className="ta-r">
            <button
              type="button"
              className="cobro-tabla-del"
              aria-label={`Quitar la tarjeta de ${m.titularTarjeta || m.bancoTarjeta || 'la venta'}`}
              onClick={onQuitar}
            >
              <i className="far fa-trash-alt" />
            </button>
          </td>
        )}
      </tr>

      {abierto && (
        <tr className="cobro-fila-detalle">
          <td colSpan={columnas}>
            <dl className="cobro-detalle-grid">
              {detalleDe(m).map((d) => (
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

interface TablaTarjetasProps {
  balances: BalancePago[]
  /** Crédito: agrega las columnas de cuotas y valor por cuota. */
  esCredito: boolean
  bloqueado?: boolean
}

/** Tarjetas ya cargadas al cobro. */
export function TablaTarjetas({ balances, esCredito, bloqueado = false }: TablaTarjetasProps) {
  const dispatch = useDispatch()
  // Banco emisor, tipo, titular e importe; el crédito suma cuotas y valor por cuota.
  const columnas = 4 + (esCredito ? 2 : 0) + (bloqueado ? 0 : 1)

  return (
    <table className="cobro-tabla cobro-tabla--tarjetas">
      <thead>
        <tr>
          <th>Banco Emisor</th>
          <th>Tipo Tarjeta</th>
          <th>Titular Tarjeta</th>
          <th>Importe</th>
          {esCredito && <th>Cant. Cuotas</th>}
          {esCredito && <th>Valor x Cuota</th>}
          {!bloqueado && <th className="ta-r">Acciones</th>}
        </tr>
      </thead>
      <tbody>
        {balances.length === 0 ? (
          <tr className="cobro-tabla-vacia">
            <td colSpan={columnas}>Todavía no cargaste ninguna tarjeta.</td>
          </tr>
        ) : (
          balances.map((b) => (
            <FilaTarjeta
              key={b.movimiento.id}
              balance={b}
              bloqueado={bloqueado}
              esCredito={esCredito}
              columnas={columnas}
              onQuitar={() => dispatch({ type: 'removeMovimientoPago', id: b.movimiento.id })}
              onImporte={(importe) =>
                dispatch({ type: 'setMovimientoImporte', id: b.movimiento.id, importe })
              }
            />
          ))
        )}
      </tbody>
    </table>
  )
}
