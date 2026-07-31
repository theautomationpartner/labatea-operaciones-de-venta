import { useState } from 'react'
import type { TarjetaTipo, TipoTarjetaCobro } from '@/types'

const MARCAS: TarjetaTipo[] = ['VISA', 'MASTERCARD']

interface CobroTarjetaProps {
  /** Débito o crédito, según lo elegido en "Forma de Pago". */
  tipo: TipoTarjetaCobro
  /** Ya confirmado: el botón queda en verde y el formulario no se vuelve a tocar. */
  confirmada: boolean
  onConfirmar: () => void
}

/**
 * Formulario de cobro con tarjeta. DÉBITO pide Banco y Tipo; CRÉDITO agrega Cuotas. Termina
 * siempre con un botón primario "Confirmar cobro" que se habilita al completar los datos.
 */
export function CobroTarjeta({ tipo, confirmada, onConfirmar }: CobroTarjetaProps) {
  const esCredito = tipo === 'CREDITO'
  const [banco, setBanco] = useState('')
  const [marca, setMarca] = useState<TarjetaTipo | ''>('')
  const [cuotas, setCuotas] = useState('')

  const valido =
    banco.trim().length > 0 && marca !== '' && (!esCredito || Number(cuotas) > 0)

  return (
    <div className="card card--config tarjeta-cobro">
      <h3 className="ctitle">
        <i className="fas fa-credit-card" /> Cobro con tarjeta de {esCredito ? 'crédito' : 'débito'}
      </h3>

      <div className="tarjeta-grid">
        <div className="tarjeta-campo">
          <label htmlFor="tarj-banco">Banco</label>
          <input
            id="tarj-banco"
            className="cobro-in"
            placeholder="Ej: Banco Galicia"
            value={banco}
            disabled={confirmada}
            onChange={(e) => setBanco(e.target.value)}
          />
        </div>

        <div className="tarjeta-campo">
          <label htmlFor="tarj-tipo">Tipo</label>
          <select
            id="tarj-tipo"
            className="cobro-in"
            value={marca}
            disabled={confirmada}
            onChange={(e) => setMarca(e.target.value as TarjetaTipo)}
          >
            <option value="" disabled>
              Seleccionar...
            </option>
            {MARCAS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Sólo CRÉDITO: cantidad de cuotas. */}
        {esCredito && (
          <div className="tarjeta-campo">
            <label htmlFor="tarj-cuotas">Cuotas</label>
            <input
              id="tarj-cuotas"
              className="cobro-in"
              inputMode="numeric"
              placeholder="Ej: 3"
              value={cuotas}
              disabled={confirmada}
              onChange={(e) => setCuotas(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}
      </div>

      <div className="tarjeta-acts">
        <button
          type="button"
          className="cobro-btn cobro-btn--primary"
          disabled={!valido || confirmada}
          onClick={onConfirmar}
        >
          {confirmada ? (
            <>
              <i className="fas fa-check" /> Cobro confirmado
            </>
          ) : (
            'Confirmar cobro'
          )}
        </button>
      </div>
    </div>
  )
}
