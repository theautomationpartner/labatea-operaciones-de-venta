import { useState } from 'react'
import type { BalancePago } from '@/lib/cobros'
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
    { label: 'Fecha de Venc.', valor: m.vencimientoTarjeta || '—' },
    { label: 'Nro Cupon', valor: m.numeroCupon?.trim() || '—' },
    { label: 'Comprobante', valor: m.comprobanteNombre || '—' },
    { label: 'Banco de Acreditación', valor: m.cuentaPropia || '—' },
  ]
}

function FilaTarjeta({
  balance,
  bloqueado,
  columnas,
  onQuitar,
  onImporte,
}: {
  balance: BalancePago
  bloqueado: boolean
  columnas: number
  onQuitar: () => void
  onImporte: (importe: number) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const { movimiento: m } = balance

  return (
    <>
      <tr className={abierto ? 'cobro-fila--abierta' : ''}>
        <td>
          <span className="cobro-fila-1a">
            <button
              type="button"
              className="cobro-fila-chev"
              aria-expanded={abierto}
              aria-label={`${abierto ? 'Ocultar' : 'Ver'} el detalle de la tarjeta ${
                m.bancoTarjeta || 'de la venta'
              }`}
              onClick={() => setAbierto((v) => !v)}
            >
              <i className={`fas fa-chevron-right ${abierto ? 'open' : ''}`} />
            </button>
            {m.bancoTarjeta || '—'}
          </span>
        </td>
        <td>{m.tipoTarjeta || '—'}</td>
        {/* Importe editable mientras el cobro no esté registrado: es la forma de llevar la
            DIFERENCIA a 0 sin quitar la tarjeta. */}
        <td>
          {bloqueado ? money(m.importe) : <ImporteEditable valor={m.importe} onCambio={onImporte} />}
        </td>
        {!bloqueado && (
          <td className="ta-r">
            <button
              type="button"
              className="cobro-tabla-del"
              aria-label={`Quitar la tarjeta ${m.bancoTarjeta || 'de la venta'}`}
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
  bloqueado?: boolean
}

/** Tarjetas ya cargadas al cobro. */
export function TablaTarjetas({ balances, bloqueado = false }: TablaTarjetasProps) {
  const dispatch = useDispatch()
  /* Banco emisor, tipo e importe. El débito y el crédito muestran lo MISMO: el plan de cuotas era
     lo único que los diferenciaba en la tabla. */
  const columnas = 3 + (bloqueado ? 0 : 1)

  return (
    <table className="cobro-tabla cobro-tabla--tarjetas">
      <thead>
        <tr>
          <th>Banco Emisor</th>
          <th>Tipo Tarjeta</th>
          <th>Importe</th>
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
