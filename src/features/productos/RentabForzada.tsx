import { useEffect, useState } from 'react'
import { money } from '@/lib/format'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Rentabilidad Forzada de la selección de productos (PRESUPUESTO y VENTA DIRECTA, salvo entrega
 * ANTERIOR). Es un INTERRUPTOR, no una acción por producto: el botón la enciende o la apaga.
 *
 * Encendida (botón resaltado) descuenta el % —precargado del tablero de config "Rentab Forzada"— a
 * cada producto que la acepta ("Con Rentab Forzada" en el maestro), tanto a los ya cargados como a
 * los que se agreguen después, hasta que el usuario la apague. Apagada, revierte el descuento.
 *
 * A la derecha del botón: mientras está encendida, la aclaración de que se está aplicando; y el
 * acumulado "TOTAL Nota de Crédito x Comisión $" (monto por unidad × cantidad de los afectados).
 */
export function RentabForzada({ bloqueado = false }: { bloqueado?: boolean }) {
  const { rentabForzadaPct, rentabForzadaActiva, lineas } = useApp()
  const dispatch = useDispatch()
  const [pct, setPct] = useState(String(rentabForzadaPct || 0))

  /* El valor por defecto llega del tablero de config de forma asíncrona (al montar la app). Si todavía
     no había llegado cuando se montó el componente, se sincroniza el input cuando aparece. No pisa lo
     tipeado mientras está encendida (ahí el input está deshabilitado). */
  useEffect(() => {
    setPct(String(rentabForzadaPct || 0))
  }, [rentabForzadaPct])

  // Acumulado global: la suma de la Nota de Crédito x Comisión de cada producto (monto por unidad),
  // igual que el TOTAL que se escribe en Monday (sin multiplicar por cantidad).
  const totalNotaCredito = lineas.reduce(
    (acc, l) => acc + (l.montoDifNotaDeCreditoComision ?? 0),
    0,
  )
  const hayForzadas = lineas.some((l) => l.montoDifNotaDeCreditoComision != null)

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
