import { useEffect, useRef, useState } from 'react'
import { FORMAS_PAGO } from '@/lib/cobros'
import { aIso, desdeIso, parseDate } from '@/lib/dates'
import { getCuentasBancariasPropias } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { CuentaPropia, FormaPago, FormatoCheque, MovimientoPago, TarjetaTipo } from '@/types'

type Borrador = Omit<MovimientoPago, 'id'>

const BORRADOR_VACIO: Borrador = {
  formaPago: 'Efectivo',
  importe: 0,
  referencia: '',
  chequeVencimiento: '',
  numeroCheque: '',
  fechaEmisionCheque: '',
  bancoEmisor: '',
  formatoCheque: 'FISICO',
  cuentaPropia: null,
  comprobanteNombre: '',
  bancoTarjeta: '',
  tipoTarjeta: null,
  cuotas: 0,
}

const TIPOS_TARJETA: TarjetaTipo[] = ['VISA', 'MASTERCARD']
const FORMATOS_CHEQUE: FormatoCheque[] = ['FISICO', 'eCheq']

/** Estado de la consulta de cuentas propias: gobierna el spinner y qué se puede elegir. */
type EstadoCuentas = 'idle' | 'cargando' | 'listo' | 'error'

/** El cheque tiene que vencer después de la emisión de la factura. */
function chequeMal(b: Borrador, fechaFactura: string): boolean {
  if (b.formaPago !== 'Cheque') return false
  const venc = parseDate(b.chequeVencimiento)
  const factura = parseDate(fechaFactura)
  return !venc || !factura || venc.getTime() <= factura.getTime()
}

/** Asterisco rojo que marca un campo obligatorio. */
const Req = () => <span className="cobro-req"> *</span>

interface FormularioCobroProps {
  fechaFactura: string
  /** Cobro ya registrado en Monday: se muestra, no se edita. */
  bloqueado?: boolean
}

/**
 * Carga de un pago: al agregarlo pasa a la tabla de cobros registrados. Según el medio de cobro
 * pide datos distintos (cheque, transferencia o tarjeta), que aparecen en una fila condicional
 * debajo de la principal y bloquean el "+ Agregar" hasta estar completos.
 */
export function FormularioCobro({ fechaFactura, bloqueado = false }: FormularioCobroProps) {
  const dispatch = useDispatch()
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  // Cuentas bancarias propias de La Batea: se piden recién al elegir "Transferencia".
  const [cuentas, setCuentas] = useState<CuentaPropia[]>([])
  const [estadoCuentas, setEstadoCuentas] = useState<EstadoCuentas>('idle')
  // Feedback del drag & drop del comprobante de transferencia.
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const esCheque = borrador.formaPago === 'Cheque'
  const esTransferencia = borrador.formaPago === 'Transferencia'
  const esDebito = borrador.formaPago === 'Tarjeta de débito'
  const esCredito = borrador.formaPago === 'Tarjeta de crédito'
  const esTarjeta = esDebito || esCredito
  const malCheque = chequeMal(borrador, fechaFactura)

  /* Las cuentas propias se consultan una sola vez, al entrar por primera vez a "Transferencia":
     el ref evita re-consultar al volver. `estadoCuentas` NO puede ir en las deps (su set
     re-ejecutaría el efecto y cancelaría la consulta recién lanzada). */
  const cuentasCargadas = useRef(false)
  useEffect(() => {
    if (!esTransferencia || cuentasCargadas.current) return
    let vivo = true
    setEstadoCuentas('cargando')
    getCuentasBancariasPropias()
      .then((cs) => {
        if (!vivo) return
        cuentasCargadas.current = true
        setCuentas(cs)
        setEstadoCuentas('listo')
      })
      .catch(() => vivo && setEstadoCuentas('error'))
    return () => {
      vivo = false
    }
  }, [esTransferencia])

  /* Cada medio de cobro exige sus datos: hasta que estén completos y válidos, no se agrega. */
  const chequeCompleto =
    !!borrador.numeroCheque?.trim() &&
    !!borrador.fechaEmisionCheque?.trim() &&
    !!borrador.chequeVencimiento?.trim() &&
    !malCheque &&
    !!borrador.bancoEmisor?.trim()
  const transfCompleta = !!borrador.cuentaPropia && !!borrador.comprobanteNombre
  const tarjetaCompleta =
    !!borrador.bancoTarjeta?.trim() && !!borrador.tipoTarjeta && (!esCredito || (borrador.cuotas ?? 0) > 0)
  const extrasCompletos = esCheque
    ? chequeCompleto
    : esTransferencia
      ? transfCompleta
      : esTarjeta
        ? tarjetaCompleta
        : true
  const puedeAgregar = borrador.importe > 0 && extrasCompletos && !bloqueado

  const agregar = () => {
    dispatch({ type: 'agregarMovimientoPago', movimiento: borrador })
    setBorrador(BORRADOR_VACIO)
  }

  /** Cambiar de forma de pago descarta lo que sólo valía para la anterior. */
  const cambiarForma = (formaPago: FormaPago) =>
    setBorrador({ ...BORRADOR_VACIO, formaPago, importe: borrador.importe, referencia: borrador.referencia })

  const tomarArchivo = (f: File | null) =>
    setBorrador({ ...borrador, comprobanteNombre: f?.name ?? '' })

  return (
    <fieldset className="cobro-form" disabled={bloqueado}>
      <div className="cobro-form-campo cobro-form-campo--forma">
        <label htmlFor="cobro-forma">Seleccionar Medio de Cobro</label>
        <select
          id="cobro-forma"
          className="cobro-in"
          value={borrador.formaPago}
          onChange={(e) => cambiarForma(e.target.value as FormaPago)}
        >
          {/* En el cobro de contado no se ofrecen tarjetas: son formas de pago de la venta y
              tienen su propio ramal (TARJETA DE DEBITO / TARJETA DE CREDITO). */}
          {FORMAS_PAGO.filter(
            (f) => f !== 'Tarjeta de débito' && f !== 'Tarjeta de crédito',
          ).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="cobro-form-campo cobro-form-campo--importe">
        <label htmlFor="cobro-importe">
          Importe
          <Req />
        </label>
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

      {/* CHEQUE: número, fechas y banco emisor (fila condicional con animación de entrada). */}
      {esCheque && (
        <div className="cobro-cond" key="cheque">
          <div className="cobro-form-campo cobro-campo--nro">
            <label htmlFor="cobro-cheque-nro">
              Número de cheque
              <Req />
            </label>
            <input
              id="cobro-cheque-nro"
              className="cobro-in"
              placeholder="Ej: 00123456"
              value={borrador.numeroCheque ?? ''}
              onChange={(e) => setBorrador({ ...borrador, numeroCheque: e.target.value })}
            />
          </div>
          <div className="cobro-form-campo cobro-campo--fecha">
            <label htmlFor="cobro-cheque-emision">
              Fecha de emisión
              <Req />
            </label>
            <input
              id="cobro-cheque-emision"
              type="date"
              className="cobro-in"
              value={aIso(borrador.fechaEmisionCheque ?? '')}
              onChange={(e) =>
                setBorrador({ ...borrador, fechaEmisionCheque: desdeIso(e.target.value) })
              }
            />
          </div>
          <div className="cobro-form-campo cobro-campo--fecha">
            <label htmlFor="cobro-cheque-venc">
              Fecha de vencimiento
              <Req />
            </label>
            <input
              id="cobro-cheque-venc"
              type="date"
              className={`cobro-in ${malCheque && borrador.chequeVencimiento ? 'cobro-in--error' : ''}`}
              value={aIso(borrador.chequeVencimiento)}
              onChange={(e) =>
                setBorrador({ ...borrador, chequeVencimiento: desdeIso(e.target.value) })
              }
            />
            {malCheque && borrador.chequeVencimiento && (
              <span className="cobro-in-err">Posterior a {fechaFactura}</span>
            )}
          </div>
          <div className="cobro-form-campo cobro-campo--formato">
            <label htmlFor="cobro-cheque-formato">
              Formato
              <Req />
            </label>
            <select
              id="cobro-cheque-formato"
              className="cobro-in"
              value={borrador.formatoCheque ?? 'FISICO'}
              onChange={(e) =>
                setBorrador({ ...borrador, formatoCheque: e.target.value as FormatoCheque })
              }
            >
              {FORMATOS_CHEQUE.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="cobro-form-campo">
            <label htmlFor="cobro-cheque-banco">
              Banco emisor
              <Req />
            </label>
            <input
              id="cobro-cheque-banco"
              className="cobro-in"
              placeholder="Ej: Banco Nación"
              value={borrador.bancoEmisor ?? ''}
              onChange={(e) => setBorrador({ ...borrador, bancoEmisor: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* TRANSFERENCIA: cuenta propia de destino + comprobante (drag & drop). */}
      {esTransferencia && (
        <div className="cobro-cond" key="transferencia">
          <div className="cobro-form-campo cobro-form-campo--cuenta">
            <label htmlFor="cobro-cuenta">
              Cuenta bancaria
              <Req />
            </label>
            <select
              id="cobro-cuenta"
              className="cobro-in"
              value={borrador.cuentaPropia ?? ''}
              disabled={estadoCuentas !== 'listo' || cuentas.length === 0}
              onChange={(e) => setBorrador({ ...borrador, cuentaPropia: e.target.value || null })}
            >
              <option value="">
                {estadoCuentas === 'cargando' || estadoCuentas === 'idle'
                  ? 'Buscando cuentas…'
                  : estadoCuentas === 'error'
                    ? 'No se pudieron traer las cuentas'
                    : cuentas.length === 0
                      ? 'No hay cuentas propias cargadas'
                      : 'Seleccionar cuenta…'}
              </option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="cobro-form-campo cobro-form-campo--drop">
            <label>
              Comprobante de transferencia
              <Req />
            </label>
            <div
              className={`cobro-drop ${dragOver ? 'is-over' : ''} ${
                borrador.comprobanteNombre ? 'has-file' : ''
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                tomarArchivo(e.dataTransfer.files?.[0] ?? null)
              }}
            >
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => tomarArchivo(e.target.files?.[0] ?? null)}
              />
              {borrador.comprobanteNombre ? (
                <span className="cobro-drop-file">
                  <i className="fas fa-file-lines" /> {borrador.comprobanteNombre}
                  <button
                    type="button"
                    className="cobro-drop-x"
                    aria-label="Quitar el comprobante"
                    onClick={(e) => {
                      e.stopPropagation()
                      tomarArchivo(null)
                    }}
                  >
                    <i className="fas fa-xmark" />
                  </button>
                </span>
              ) : (
                <span className="cobro-drop-hint">
                  <i className="fas fa-cloud-arrow-up" /> Arrastrá y soltá el comprobante, o hacé
                  click para elegirlo
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TARJETA (débito/crédito): banco + marca; las cuotas sólo en crédito. */}
      {esTarjeta && (
        <div className="cobro-cond cobro-cond--tarjeta" key="tarjeta">
          <div className="cobro-form-campo">
            <label htmlFor="cobro-tarj-banco">
              Banco
              <Req />
            </label>
            <input
              id="cobro-tarj-banco"
              className="cobro-in"
              placeholder="Ej: Banco Galicia"
              value={borrador.bancoTarjeta ?? ''}
              onChange={(e) => setBorrador({ ...borrador, bancoTarjeta: e.target.value })}
            />
          </div>
          <div className="cobro-form-campo">
            <label htmlFor="cobro-tarj-tipo">
              Tipo
              <Req />
            </label>
            <select
              id="cobro-tarj-tipo"
              className="cobro-in"
              value={borrador.tipoTarjeta ?? ''}
              onChange={(e) =>
                setBorrador({ ...borrador, tipoTarjeta: (e.target.value || null) as TarjetaTipo | null })
              }
            >
              <option value="">Seleccionar…</option>
              {TIPOS_TARJETA.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {esCredito && (
            <div className="cobro-form-campo">
              <label htmlFor="cobro-tarj-cuotas">
                Cantidad de cuotas
                <Req />
              </label>
              <input
                id="cobro-tarj-cuotas"
                className="cobro-in"
                inputMode="numeric"
                placeholder="Ej: 3"
                value={borrador.cuotas || ''}
                onChange={(e) =>
                  setBorrador({ ...borrador, cuotas: Number(e.target.value.replace(/\D/g, '')) || 0 })
                }
              />
            </div>
          )}
        </div>
      )}
    </fieldset>
  )
}
