import { useEffect, useRef, useState } from 'react'
import { FORMAS_PAGO } from '@/lib/cobros'
import { parseDate } from '@/lib/dates'
import { money } from '@/lib/format'
import { getCuentasBancarias } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { CuentaBancaria, FormaPago, MedioTransferencia, MovimientoPago } from '@/types'

type Borrador = Omit<MovimientoPago, 'id'>

const BORRADOR_VACIO: Borrador = {
  formaPago: 'Efectivo',
  importe: 0,
  referencia: '',
  chequeVencimiento: '',
  cuentaBancaria: null,
  medioTransferencia: null,
}

/** Cómo se nombra una cuenta en el selector: banco y número, que es lo que se reconoce. */
const rotuloCuenta = (c: CuentaBancaria): string =>
  `${c.banco || 'Sin banco'} - ${c.numeroCuenta || 'Sin número'}`

/** Estado de la consulta de cuentas: gobierna el spinner y qué se puede elegir. */
type EstadoCuentas = 'idle' | 'cargando' | 'listo' | 'error'

/** El cheque tiene que vencer después de la emisión de la factura. */
function chequeMal(b: Borrador, fechaFactura: string): boolean {
  if (b.formaPago !== 'Cheque') return false
  const venc = parseDate(b.chequeVencimiento)
  const factura = parseDate(fechaFactura)
  return !venc || !factura || venc.getTime() <= factura.getTime()
}

interface FormularioCobroProps {
  fechaFactura: string
  /** Cobro ya registrado en Monday: se muestra, no se edita. */
  bloqueado?: boolean
}

/**
 * Carga de un pago: al agregarlo pasa a la tabla de cobros registrados. La fecha no se pide
 * acá — es la del cobro, y se muestra en la primera columna de esa tabla.
 */
export function FormularioCobro({ fechaFactura, bloqueado = false }: FormularioCobroProps) {
  const { descuentosPago, cliente } = useApp()
  const dispatch = useDispatch()
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  // Cuentas bancarias del cliente: se piden recién cuando hacen falta.
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([])
  const [estadoCuentas, setEstadoCuentas] = useState<EstadoCuentas>('idle')

  const esCheque = borrador.formaPago === 'Cheque'
  const esTransferencia = borrador.formaPago === 'Transferencia'
  const malCheque = chequeMal(borrador, fechaFactura)
  /* Una transferencia sin cuenta identificada no se puede conciliar después: hasta que no se
     elija una de las cuentas activas del cliente, el movimiento no se agrega. */
  const faltaCuenta = esTransferencia && !borrador.cuentaBancaria
  const puedeAgregar = borrador.importe > 0 && !malCheque && !faltaCuenta && !bloqueado

  /* Las cuentas se consultan al elegir "Transferencia", no antes: la mayoría de los cobros no
     las necesita. El ref recuerda de qué cliente ya se trajeron, así volver a Transferencia no
     dispara otra consulta. `estadoCuentas` NO puede ir en las deps: al setearlo, el efecto se
     re-ejecutaría y su cleanup cancelaría la consulta que acaba de lanzar. */
  const clienteId = cliente?.id
  const cuentasDe = useRef<string | null>(null)
  useEffect(() => {
    if (!esTransferencia || !clienteId || cuentasDe.current === clienteId) return
    let vivo = true
    setEstadoCuentas('cargando')
    getCuentasBancarias(clienteId)
      .then((cs) => {
        if (!vivo) return
        cuentasDe.current = clienteId
        setCuentas(cs)
        setEstadoCuentas('listo')
      })
      .catch(() => vivo && setEstadoCuentas('error'))
    return () => {
      vivo = false
    }
  }, [esTransferencia, clienteId])
  // Lo que realmente entra a caja por este pago: el importe menos su descuento.
  const descuentoPct = descuentosPago[borrador.formaPago] ?? 0
  const importeFinal = borrador.importe - (borrador.importe * descuentoPct) / 100

  const agregar = () => {
    dispatch({ type: 'agregarMovimientoPago', movimiento: borrador })
    setBorrador(BORRADOR_VACIO)
  }

  /** Cambiar de forma de pago descarta lo que sólo valía para la anterior. */
  const cambiarForma = (formaPago: FormaPago) =>
    setBorrador({
      ...borrador,
      formaPago,
      cuentaBancaria: null,
      medioTransferencia: null,
      chequeVencimiento: '',
    })

  return (
    <fieldset className="cobro-form" disabled={bloqueado}>
      <div className="cobro-form-campo cobro-form-campo--forma">
        <label htmlFor="cobro-forma">Forma de pago *</label>
        <select
          id="cobro-forma"
          className="cobro-in"
          value={borrador.formaPago}
          onChange={(e) => cambiarForma(e.target.value as FormaPago)}
        >
          {FORMAS_PAGO.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="cobro-form-campo cobro-form-campo--importe">
        <label htmlFor="cobro-importe">Importe *</label>
        <input
          id="cobro-importe"
          className="cobro-in"
          inputMode="numeric"
          placeholder="$ 0"
          value={borrador.importe || ''}
          onChange={(e) =>
            setBorrador({ ...borrador, importe: Number(e.target.value.replace(/\D/g, '')) || 0 })
          }
        />
      </div>

      {/* El descuento lo fija la forma de pago: se muestra, no se edita. */}
      <div className="cobro-form-campo cobro-form-campo--desc">
        <label htmlFor="cobro-desc">Desc. %</label>
        <div className="cobro-desc-box">
          <input id="cobro-desc" className="cobro-desc-in" value={descuentoPct} readOnly />
          <span className="cobro-desc-suf">%</span>
        </div>
      </div>

      {/* Resultado de aplicar el descuento: no se edita, se calcula. */}
      <div className="cobro-form-campo cobro-form-campo--final">
        <label htmlFor="cobro-final">Importe final</label>
        <input
          id="cobro-final"
          className="cobro-in cobro-in--calc"
          value={borrador.importe > 0 ? money(importeFinal) : ''}
          placeholder="$ 0"
          readOnly
          tabIndex={-1}
        />
      </div>

      <div className="cobro-form-campo cobro-form-campo--ref">
        <label htmlFor="cobro-ref">N° de referencia</label>
        <input
          id="cobro-ref"
          className="cobro-in"
          placeholder="Ej: TXF-00012589"
          value={borrador.referencia}
          onChange={(e) => setBorrador({ ...borrador, referencia: e.target.value })}
        />
      </div>

      {esCheque && (
        <div className="cobro-form-campo cobro-form-campo--cheque">
          <label htmlFor="cobro-cheque">Vencimiento del cheque *</label>
          <input
            id="cobro-cheque"
            className={`cobro-in ${malCheque ? 'cobro-in--error' : ''}`}
            placeholder="dd/mm/aaaa"
            value={borrador.chequeVencimiento}
            onChange={(e) => setBorrador({ ...borrador, chequeVencimiento: e.target.value })}
          />
          {malCheque && <span className="cobro-in-err">Posterior a {fechaFactura}</span>}
        </div>
      )}

      <div className="cobro-form-campo cobro-form-campo--accion">
        <button
          type="button"
          className="cobro-btn cobro-btn--primary"
          disabled={!puedeAgregar}
          onClick={agregar}
        >
          <i className="fas fa-plus" /> Agregar
        </button>
      </div>

      {/* Transferencia: a qué cuenta del cliente entró la plata y por dónde se identificó. */}
      {esTransferencia && (
        <div className="cobro-transf">
          {estadoCuentas === 'cargando' && (
            <span className="cobro-transf-cargando" role="status">
              <i className="fas fa-circle-notch spin" /> Buscando cuentas bancarias del cliente…
            </span>
          )}

          {estadoCuentas === 'error' && (
            <span className="cobro-in-err">
              No se pudieron traer las cuentas bancarias. Reintentá cambiando de forma de pago.
            </span>
          )}

          {estadoCuentas === 'listo' && cuentas.length === 0 && (
            <span className="cobro-in-err">
              {cliente?.name ?? 'El cliente'} no tiene cuentas bancarias activas cargadas: no se
              puede registrar una transferencia.
            </span>
          )}

          {estadoCuentas === 'listo' && cuentas.length > 0 && (
            <>
              <div className="cobro-form-campo cobro-form-campo--cuenta">
                <label htmlFor="cobro-cuenta">Cuenta bancaria *</label>
                <select
                  id="cobro-cuenta"
                  className="cobro-in"
                  value={borrador.cuentaBancaria?.id ?? ''}
                  onChange={(e) =>
                    setBorrador({
                      ...borrador,
                      cuentaBancaria: cuentas.find((c) => c.id === e.target.value) ?? null,
                      // Cambiar de cuenta invalida el medio elegido para la anterior.
                      medioTransferencia: null,
                    })
                  }
                >
                  <option value="">Seleccionar cuenta…</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {rotuloCuenta(c)}
                    </option>
                  ))}
                </select>
              </div>

              {/* El medio sólo tiene sentido con una cuenta ya elegida. */}
              {borrador.cuentaBancaria && (
                <div className="cobro-form-campo cobro-form-campo--medio">
                  <label htmlFor="cobro-medio">Medio de transferencia</label>
                  <select
                    id="cobro-medio"
                    className="cobro-in"
                    value={borrador.medioTransferencia ?? ''}
                    onChange={(e) =>
                      setBorrador({
                        ...borrador,
                        medioTransferencia: (e.target.value || null) as MedioTransferencia | null,
                      })
                    }
                  >
                    <option value="">Seleccionar…</option>
                    <option value="CBU">CBU</option>
                    <option value="ALIAS">ALIAS</option>
                  </select>
                </div>
              )}

              {faltaCuenta && (
                <span className="cobro-in-err">Elegí la cuenta para poder agregar el pago.</span>
              )}
            </>
          )}
        </div>
      )}
    </fieldset>
  )
}
