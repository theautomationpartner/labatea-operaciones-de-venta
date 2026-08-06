import { Fragment, useRef, useState } from 'react'
import {
  CUIT_TRAMOS,
  FORMAS_PAGO,
  MSG_CHEQUE_VENCIMIENTO,
  MSG_CLIENTE_SIN_CHEQUE,
  cuitCompleto,
  esRetencion,
  partesCuit,
  soloDigitos,
  tramoCuitIncompleto,
  vencimientoChequeInvalido,
} from '@/lib/cobros'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { FormaPago, FormatoCheque, MovimientoPago } from '@/types'
import { AdjuntoComprobante } from './AdjuntoComprobante'
import { BancoEmisorSelect } from './BancoEmisorSelect'
import { textoCuentasVacio, useCuentasPropias } from './useCuentasPropias'

type Borrador = Omit<MovimientoPago, 'id'>

const BORRADOR_VACIO: Borrador = {
  formaPago: 'Efectivo',
  importe: 0,
  referencia: '',
  chequeVencimiento: '',
  numeroCheque: '',
  fechaEmisionCheque: '',
  bancoEmisor: '',
  cuitEmisor: '',
  formatoCheque: 'FISICO',
  cuentaPropia: null,
  cuentaPropiaId: null,
  comprobanteNombre: '',
  comprobanteArchivo: null,
  bancoTarjeta: '',
  tipoTarjeta: null,
  cuotas: 0,
}

/** Formato del cheque: el valor es el del sistema, el rótulo es el que ve el vendedor. */
const FORMATOS_CHEQUE: { valor: FormatoCheque; rotulo: string }[] = [
  { valor: 'FISICO', rotulo: 'Papel' },
  { valor: 'eCheq', rotulo: 'eCheq' },
]

/** Asterisco rojo que marca un campo obligatorio. */
const Req = () => <span className="cobro-req"> *</span>

/** Un renglón del formulario: agrupa los campos de esa línea. */
const Fila = ({ children }: { children: React.ReactNode }) => (
  <div className="cobro-fila">{children}</div>
)

/**
 * CUIT del emisor del cheque en tres tramos (XX-XXXXXXXX-X). Los campos NO dejan escribir nada que
 * no sea un número ni pasarse del tope de dígitos: la tecla se descarta en silencio, sin mensaje.
 *
 * El cursor AVANZA solo: apenas un tramo se completa (2 dígitos el prefijo, 8 el DNI) el foco salta
 * al siguiente, para cargar el CUIT de corrido sin tocar el mouse ni el tabulador.
 *
 * El tramo corto se avisa cuando el vendedor lo dejó (blur) o cuando intentó agregar el movimiento.
 */
function CampoCuit({
  valor,
  forzarError,
  onCambio,
}: {
  valor: string
  /** Se intentó agregar el movimiento: el CUIT incompleto ya no espera al blur para avisar. */
  forzarError: boolean
  onCambio: (cuit: string) => void
}) {
  const [tocados, setTocados] = useState([false, false, false])
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const partes = partesCuit(valor)

  const escribir = (i: number, entrada: string) => {
    const nuevas = [...partes]
    nuevas[i] = soloDigitos(entrada, CUIT_TRAMOS[i].digitos)
    onCambio(nuevas.join('-'))
    // Tramo completo: el foco pasa al siguiente bloque (el último no tiene a dónde saltar).
    if (nuevas[i].length === CUIT_TRAMOS[i].digitos && i < CUIT_TRAMOS.length - 1) {
      refs.current[i + 1]?.focus()
    }
  }

  /* Primer tramo con menos dígitos de los que pide. Al intentar agregar se marca aunque esté vacío;
     mientras se carga, sólo si ya se lo visitó y tiene algo escrito. */
  const iMal = forzarError
    ? tramoCuitIncompleto(valor)
    : partes.findIndex((p, i) => tocados[i] && p.length > 0 && p.length < CUIT_TRAMOS[i].digitos)

  return (
    <div className="cobro-form-campo cobro-form-campo--val cobro-campo--cuit">
      <label htmlFor="cobro-cheque-cuit-0">
        CUIT del emisor
        <Req />
      </label>
      <div className="cobro-cuit">
        {CUIT_TRAMOS.map((t, i) => (
          <Fragment key={t.clave}>
            {/* Separador fijo del formato: es texto, no un carácter que se tipee. */}
            {i > 0 && <span className="cobro-cuit-sep">-</span>}
            <input
              id={`cobro-cheque-cuit-${i}`}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={`cobro-in cobro-cuit-in cobro-cuit-in--${t.digitos} ${
                iMal === i ? 'cobro-in--error' : ''
              }`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={t.digitos}
              placeholder={'0'.repeat(t.digitos)}
              aria-label={t.aria}
              aria-invalid={iMal === i || undefined}
              value={partes[i]}
              onChange={(e) => escribir(i, e.target.value)}
              onBlur={() => setTocados((prev) => prev.map((v, j) => (j === i ? true : v)))}
            />
          </Fragment>
        ))}
      </div>
      {iMal >= 0 && (
        <span className="cobro-in-err" role="alert">
          {CUIT_TRAMOS[iMal].error}
        </span>
      )}
    </div>
  )
}

interface FormularioCobroProps {
  /** El CRM del cliente no habilita el cheque para esta venta: el medio se ofrece inhabilitado. */
  chequeBloqueado?: boolean
  /** Cobro ya registrado en Monday: se muestra, no se edita. */
  bloqueado?: boolean
}

/**
 * Carga de un pago: al agregarlo pasa a la tabla de cobros registrados. Según el medio de cobro
 * pide datos distintos (cheque, transferencia o retención), que aparecen en una fila condicional
 * debajo de la principal, y el "+ Agregar" queda a la derecha del último campo de esa fila.
 *
 * La validación corre al hacer CLICK en "+ Agregar": marca en rojo cada campo que falte y muestra
 * su mensaje debajo, sin agregar nada. Es el mismo tratamiento que el cobro con tarjeta.
 */
export function FormularioCobro({
  chequeBloqueado = false,
  bloqueado = false,
}: FormularioCobroProps) {
  const dispatch = useDispatch()
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO)
  // Texto formateado (miles con punto, coma decimal) del importe del borrador.
  const [importeTexto, setImporteTexto] = useState('')
  // Recién al intentar agregar se muestran los errores: no se reta al vendedor mientras carga.
  const [intento, setIntento] = useState(false)

  const esCheque = borrador.formaPago === 'Cheque'
  const esTransferencia = borrador.formaPago === 'Transferencia'
  /* Cualquier medio que empiece con "Retencion" (IVA, IIBB, GAN…) comparte el mismo ramal:
     importe + comprobante adjunto, los dos obligatorios para poder agregar el movimiento. */
  const esRet = esRetencion(borrador.formaPago)

  // Cuentas propias de destino: se piden recién al entrar a "Transferencia".
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(esTransferencia)

  const vencMal = esCheque && vencimientoChequeInvalido(borrador.chequeVencimiento)
  /* El vencimiento avisa apenas se carga una fecha que incumple la regla; vacío, recién al intentar
     agregar (que es cuando pasa de "falta cargarlo" a error). */
  const mostrarErrorVenc = vencMal && (!!borrador.chequeVencimiento || intento)
  /* Campos obligatorios del movimiento, por medio de cobro. Cada clave enciende el borde rojo y el
     mensaje de su campo cuando se intenta agregar. */
  const faltantes: Record<string, boolean> = {
    importe: borrador.importe <= 0,
    // CHEQUE
    bancoEmisor: esCheque && !borrador.bancoEmisor?.trim(),
    cuit: esCheque && !cuitCompleto(borrador.cuitEmisor),
    numeroCheque: esCheque && !borrador.numeroCheque?.trim(),
    fechaEmision: esCheque && !borrador.fechaEmisionCheque?.trim(),
    vencimiento: esCheque && vencMal,
    // TRANSFERENCIA
    cuenta: esTransferencia && !borrador.cuentaPropiaId,
    comprobanteTransf: esTransferencia && !borrador.comprobanteNombre,
    // RETENCIÓN
    comprobanteRet: esRet && !borrador.comprobanteNombre,
  }
  const completo = !Object.values(faltantes).some(Boolean)
  const mal = (campo: string) => intento && faltantes[campo]

  const agregar = () => {
    setIntento(true)
    if (!completo || bloqueado) return
    dispatch({ type: 'agregarMovimientoPago', movimiento: borrador })
    setBorrador(BORRADOR_VACIO)
    setImporteTexto('')
    setIntento(false)
  }

  /** Cambiar de forma de pago descarta lo que sólo valía para la anterior. */
  const cambiarForma = (formaPago: FormaPago) => {
    setIntento(false)
    setBorrador({
      ...BORRADOR_VACIO,
      formaPago,
      importe: borrador.importe,
      referencia: borrador.referencia,
    })
  }

  /* Se guarda el archivo además del nombre: el nombre es lo que se muestra, pero la columna `file`
     del recibo sólo se completa subiendo el binario. */
  const tomarArchivo = (f: File | null) =>
    setBorrador({ ...borrador, comprobanteNombre: f?.name ?? '', comprobanteArchivo: f })

  /* "+ Agregar", siempre a la derecha del último campo de la fila. Valida al hacer click.
     Es una FUNCIÓN que devuelve JSX, no un componente declarado acá adentro: así React reusa el
     mismo botón entre renders en lugar de recrearlo (y perderle el foco). */
  const botonAgregar = () => (
    <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--accion">
      <button type="button" className="cobro-btn cobro-btn--primary" onClick={agregar}>
        <i className="fas fa-plus" /> Agregar
      </button>
    </div>
  )

  return (
    <fieldset className="cobro-form" disabled={bloqueado}>
      <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--forma">
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
          ).map((f) => {
            /* El cheque que el CRM no habilita se sigue VIENDO, pero no se puede elegir: queda
               tachado en rojo y el motivo aparece al pasarle el mouse por encima. */
            const vedado = f === 'Cheque' && chequeBloqueado
            return (
              <option
                key={f}
                value={f}
                disabled={vedado}
                title={vedado ? MSG_CLIENTE_SIN_CHEQUE : undefined}
                className={vedado ? 'cobro-op--vedada' : undefined}
              >
                {f}
              </option>
            )
          })}
        </select>
      </div>

      <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--importe">
        <label htmlFor="cobro-importe">
          Importe
          <Req />
        </label>
        {/* Importe como número con separador de miles (formato AR): "30409" → "30.409"; la coma
            agrega centavos. Se guarda el número en el borrador. */}
        <input
          id="cobro-importe"
          className={`cobro-in ${mal('importe') ? 'cobro-in--error' : ''}`}
          inputMode="decimal"
          placeholder="$ 0"
          aria-invalid={mal('importe') || undefined}
          value={importeTexto}
          onChange={(e) => {
            const { texto, valor } = formatearImporteAR(e.target.value)
            setImporteTexto(texto)
            setBorrador({ ...borrador, importe: valor })
          }}
        />
        {mal('importe') && (
          <span className="cobro-in-err" role="alert">
            Ingresá el importe a cobrar
          </span>
        )}
      </div>

      {/* EFECTIVO: no pide nada más, así que el "+ Agregar" cierra la fila principal. */}
      {!esCheque && !esTransferencia && !esRet && botonAgregar()}

      {/* CHEQUE · fila 1: datos del emisor y del documento. */}
      {esCheque && (
        <div className="cobro-cond" key="cheque">
          <Fila>
          <div className="cobro-form-campo cobro-form-campo--val cobro-campo--banco">
            <label htmlFor="cobro-cheque-banco">
              Banco Emisor
              <Req />
            </label>
            <BancoEmisorSelect
              id="cobro-cheque-banco"
              value={borrador.bancoEmisor ?? ''}
              onChange={(banco) => setBorrador({ ...borrador, bancoEmisor: banco })}
              error={mal('bancoEmisor')}
            />
          </div>

          <CampoCuit
            valor={borrador.cuitEmisor ?? ''}
            forzarError={intento && faltantes.cuit}
            onCambio={(cuitEmisor) => setBorrador({ ...borrador, cuitEmisor })}
          />

          <div className="cobro-form-campo cobro-form-campo--val cobro-campo--formato">
            <label htmlFor="cobro-cheque-formato">
              Tipo
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
                <option key={f.valor} value={f.valor}>
                  {f.rotulo}
                </option>
              ))}
            </select>
          </div>

          <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nro">
            <label htmlFor="cobro-cheque-nro">
              Nro. de Cheque
              <Req />
            </label>
            <input
              id="cobro-cheque-nro"
              className={`cobro-in ${mal('numeroCheque') ? 'cobro-in--error' : ''}`}
              placeholder="Ej: 00123456"
              aria-invalid={mal('numeroCheque') || undefined}
              value={borrador.numeroCheque ?? ''}
              onChange={(e) => setBorrador({ ...borrador, numeroCheque: e.target.value })}
            />
            {mal('numeroCheque') && (
              <span className="cobro-in-err" role="alert">
                Ingresá el número de cheque
              </span>
            )}
          </div>

          </Fila>

          {/* CHEQUE · fila 2: las fechas y, a su derecha, el "+ Agregar". */}
          <Fila>
          <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
            <label htmlFor="cobro-cheque-emision">
              Fecha de Emisión
              <Req />
            </label>
            <input
              id="cobro-cheque-emision"
              type="date"
              className={`cobro-in ${mal('fechaEmision') ? 'cobro-in--error' : ''}`}
              aria-invalid={mal('fechaEmision') || undefined}
              value={aIso(borrador.fechaEmisionCheque ?? '')}
              onChange={(e) =>
                setBorrador({ ...borrador, fechaEmisionCheque: desdeIso(e.target.value) })
              }
            />
            {mal('fechaEmision') && (
              <span className="cobro-in-err" role="alert">
                Ingresá la fecha de emisión
              </span>
            )}
          </div>

          <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
            <label htmlFor="cobro-cheque-venc">
              Fecha de Vencimiento
              <Req />
            </label>
            {/* Regla: el vencimiento no puede ser posterior a hoy. En error, el campo se pinta de
                rojo y el mensaje se muestra ABAJO en posición absoluta, dentro del espacio que el
                campo ya reserva (`--val`): aparecer o desaparecer no mueve ni redimensiona nada. */}
            <input
              id="cobro-cheque-venc"
              type="date"
              className={`cobro-in ${mostrarErrorVenc ? 'cobro-in--error' : ''}`}
              aria-invalid={mostrarErrorVenc || undefined}
              aria-describedby={mostrarErrorVenc ? 'cobro-cheque-venc-err' : undefined}
              value={aIso(borrador.chequeVencimiento)}
              onChange={(e) =>
                setBorrador({ ...borrador, chequeVencimiento: desdeIso(e.target.value) })
              }
            />
            {mostrarErrorVenc && (
              <span className="cobro-in-err" id="cobro-cheque-venc-err" role="alert">
                {borrador.chequeVencimiento
                  ? MSG_CHEQUE_VENCIMIENTO
                  : 'Ingresá la fecha de vencimiento'}
              </span>
            )}
          </div>

          {botonAgregar()}
          </Fila>
        </div>
      )}

      {/* TRANSFERENCIA: cuenta propia de destino + comprobante (drag & drop). */}
      {esTransferencia && (
        <div className="cobro-cond" key="transferencia">
          <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--cuenta">
            <label htmlFor="cobro-cuenta">
              Cuenta bancaria
              <Req />
            </label>
            <select
              id="cobro-cuenta"
              className={`cobro-in ${mal('cuenta') ? 'cobro-in--error' : ''}`}
              disabled={estadoCuentas !== 'listo' || cuentas.length === 0}
              aria-invalid={mal('cuenta') || undefined}
              /* El valor del selector es el ID del ítem: es lo que necesita la relación del recibo.
                 El nombre se guarda aparte, que es lo que se muestra en la tabla. */
              value={borrador.cuentaPropiaId ?? ''}
              onChange={(e) => {
                const elegida = cuentas.find((c) => c.id === e.target.value)
                setBorrador({
                  ...borrador,
                  cuentaPropiaId: elegida?.id ?? null,
                  cuentaPropia: elegida?.name ?? null,
                })
              }}
            >
              <option value="">{textoCuentasVacio(estadoCuentas, cuentas.length)}</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {mal('cuenta') && (
              <span className="cobro-in-err" role="alert">
                Elegí la cuenta bancaria
              </span>
            )}
          </div>

          <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--drop">
            <label htmlFor="cobro-transf-file">
              Comprobante de transferencia
              <Req />
            </label>
            <AdjuntoComprobante
              id="cobro-transf-file"
              nombre={borrador.comprobanteNombre ?? ''}
              onArchivo={tomarArchivo}
            />
            {mal('comprobanteTransf') && (
              <span className="cobro-in-err" role="alert">
                Adjuntá el comprobante
              </span>
            )}
          </div>

          {botonAgregar()}
        </div>
      )}

      {/* RETENCIÓN (IVA / IIBB / GAN / la que se sume): comprobante adjunto obligatorio. El importe
          se carga en la fila principal; sin archivo, el movimiento no se agrega. */}
      {esRet && (
        <div className="cobro-cond" key="retencion">
          <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--drop">
            <label htmlFor="cobro-ret-file">
              Comprobante de la retención
              <Req />
            </label>
            <AdjuntoComprobante
              id="cobro-ret-file"
              nombre={borrador.comprobanteNombre ?? ''}
              onArchivo={tomarArchivo}
            />
            {mal('comprobanteRet') && (
              <span className="cobro-in-err" role="alert">
                Adjuntá el comprobante
              </span>
            )}
          </div>

          {botonAgregar()}
        </div>
      )}
    </fieldset>
  )
}
