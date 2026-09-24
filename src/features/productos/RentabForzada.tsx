import { useEffect, useState } from 'react'
import { money } from '@/lib/format'
import { notaCreditoTotal, rentabForzadaLinea } from '@/lib/selectors'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Rentabilidad Forzada de la selección de productos (PRESUPUESTO y VENTA DIRECTA, salvo entrega
 * ANTERIOR). Es un INTERRUPTOR, no una acción por producto: el botón la enciende o la apaga.
 *
 * Encendida (botón resaltado) le fija el % —precargado del tablero de config "Rentab Forzada"— a
 * cada producto que la acepta ("Con Rentab Forzada" en el maestro, o precio por debajo de Costo +
 * Flete), tanto a los ya cargados como a los que se agreguen después, hasta que el usuario la
 * apague. El precio de venta no cambia: lo que cambia es el costo, con la nota de crédito del
 * proveedor (ver `rentabForzadaDe`). Apagada, se revierte.
 *
 * A la derecha del botón: mientras está encendida, la aclaración de que se está aplicando; y el
 * acumulado "TOTAL Nota de Crédito x Comisión $" (nota de crédito por unidad × cantidad, sumado sobre
 * los productos afectados).
 */
export function RentabForzada({
  bloqueado = false,
  descFormaPago = 0,
}: {
  bloqueado?: boolean
  /** Descuento por forma de pago de la operación: baja el precio y con él el Nuevo Costo. */
  descFormaPago?: number
}) {
  const { rentabForzadaPct, rentabForzadaActiva, lineas } = useApp()
  const dispatch = useDispatch()
  const [pct, setPct] = useState(String(rentabForzadaPct || 0))

  /* El valor por defecto llega del tablero de config de forma asíncrona (al montar la app). Si todavía
     no había llegado cuando se montó el componente, se sincroniza el input cuando aparece. No pisa lo
     tipeado mientras está encendida (ahí el input está deshabilitado). */
  useEffect(() => {
    setPct(String(rentabForzadaPct || 0))
  }, [rentabForzadaPct])

  /* Acumulado global: la Nota de Crédito x Comisión por unidad de cada producto MULTIPLICADA POR SU
     CANTIDAD, igual que el TOTAL que se escribe en Monday (`notaCreditoTotal`). */
  const totalNotaCredito = notaCreditoTotal(lineas, descFormaPago)
  const hayForzadas = lineas.some((l) => rentabForzadaLinea(l, descFormaPago) != null)

  const alternar = () => {
    const valor = Number(pct.replace(',', '.'))
    if (!Number.isFinite(valor) || valor < 0) return
    dispatch({ type: 'toggleRentabForzada', porcentaje: valor })
  }

  return (
    <div className="rentab-forzada">
      <div className="rentab-forzada-fila">
        <label className="rentab-forzada-lbl" htmlFor="rentab-forzada-input">
          Rentabilidad Forzada (%)
        </label>
        <input
          id="rentab-forzada-input"
          type="number"
          className="rentab-forzada-in"
          min={0}
          step="0.01"
          value={pct}
          /* Encendida, el % queda fijo (es el que se está aplicando): para cambiarlo, se apaga primero. */
          disabled={bloqueado || rentabForzadaActiva}
          onChange={(e) => setPct(e.target.value)}
        />
        <button
          type="button"
          className={`btn-primary rentab-forzada-btn ${
            rentabForzadaActiva ? 'rentab-forzada-btn--activa' : ''
          }`}
          disabled={bloqueado}
          aria-pressed={rentabForzadaActiva}
          onClick={alternar}
        >
          {rentabForzadaActiva ? (
            <>
              <i className="fas fa-check" /> Rentabilidad Forzada Activada
            </>
          ) : (
            'Aplicar Rentabilidad Forzada'
          )}
        </button>

        {/* A la derecha del botón, sólo cuando está encendida: la aclaración de que se está aplicando. */}
        {rentabForzadaActiva && (
          <span className="rentab-forzada-aviso">
            Se aplicará el % de Rentab. Forzada por cada producto que acepta la condición
          </span>
        )}

        {/* Acumulado al extremo derecho: sólo con productos ya afectados por la rentabilidad forzada. */}
        {hayForzadas && (
          <div className="rentab-forzada-total">
            <span className="rentab-forzada-total-lbl">TOTAL Nota de Crédito x Comisión</span>
            <span className="rentab-forzada-total-val">{money(totalNotaCredito)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
