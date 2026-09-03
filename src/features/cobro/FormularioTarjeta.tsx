import { useState } from 'react'
import { PAGOS_TARJETA, formaPagoTarjeta } from '@/lib/cobros'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto, money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { MovimientoPago, TipoTarjetaCobro } from '@/types'
import { AdjuntoComprobante } from './AdjuntoComprobante'
import { BancoEmisorSelect } from './BancoEmisorSelect'
import { TipoTarjetaSelect } from './TipoTarjetaSelect'
import { textoCuentasVacio, useCuentasPropias } from './useCuentasPropias'

type Borrador = Omit<MovimientoPago, 'id'>

/** Asterisco rojo que marca un campo obligatorio. */
const Req = () => <span className="cobro-req"> *</span>

/** Un renglón del formulario: agrupa los campos de esa línea. */
const Fila = ({ children }: { children: React.ReactNode }) => (
  <div className="cobro-fila">{children}</div>
)

const borradorVacio = (tipo: TipoTarjetaCobro): Borrador => ({
  formaPago: formaPagoTarjeta(tipo),
  importe: 0,
  referencia: '',
  chequeFechaPago: '',
  cuentaPropia: null,
  cuentaPropiaId: null,
  comprobanteNombre: '',
  comprobanteArchivo: null,
  bancoTarjeta: '',
  tipoTarjeta: null,
  vencimientoTarjeta: '',
  numeroCupon: '',
})

interface FormularioTarjetaProps {
  /** Débito o crédito: lo define la forma de pago elegida en la etapa anterior. */
  tipo: TipoTarjetaCobro
  /** Cuántas tarjetas ya se cargaron: gobierna la precarga del importe. */
  cargadas: number
  /** Lo que falta cobrar en este momento. Es lo que se precarga en el importe. */
  diferencia: number
  /** Cobro ya registrado en Monday: se muestra, no se edita. */
  bloqueado?: boolean
}

/**
 * Carga de un cobro con tarjeta. El orden de los campos es el del circuito: primero cuántos pagos
 * y por cuánto, después los datos del plástico, y al final dónde se acredita.
 *
 * La validación NO deshabilita el "+ Agregar": se corre al hacer click y marca en rojo lo que falta
 * —en particular los 16 dígitos de la tarjeta—, así el vendedor ve POR QUÉ no se agrega en lugar de
 * toparse con un botón muerto. Nada entra a la tabla hasta que todo esté completo.
 */
export function FormularioTarjeta({
  tipo,
  cargadas,
  diferencia,
  bloqueado = false,
}: FormularioTarjetaProps) {
  const dispatch = useDispatch()
  /* Al entrar, el importe ya viene precargado con lo que falta cobrar: el caso normal es cerrar la
     venta con una sola tarjeta, y así el vendedor no tiene que copiar el número a mano. */
  const sugeridoInicial = Math.max(diferencia, 0)
  const [borrador, setBorrador] = useState<Borrador>(() => ({
    ...borradorVacio(tipo),
    importe: sugeridoInicial,
  }))
  const [importeTexto, setImporteTexto] = useState(() =>
    sugeridoInicial > 0 ? importeATexto(sugeridoInicial) : '',
  )
  /* El cobro se puede partir en una o dos tarjetas. Vale para los DOS tipos: el crédito se
     comportaba antes como un "1 pago" fijo, sin preguntar. */
  const [cantPagos, setCantPagos] = useState<string>('1')
  // Recién al intentar agregar se muestran los errores: no se reta al vendedor mientras carga.
  const [intento, setIntento] = useState(false)
  // Banco de acreditación: mismas cuentas propias que usa la transferencia.
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(true)

  /* Precarga del importe. Con un solo pago el importe sugerido es TODA la diferencia, porque esa
     tarjeta tiene que cancelar la venta. Partido en dos, el primero lo escribe el vendedor y el
     segundo se precarga con lo que quedó pendiente.
     Se recalcula sólo cuando cambia la cantidad de pagos o entra una tarjeta nueva: si dependiera de
     la diferencia en vivo, pisaría el importe justo mientras se lo está tipeando. */
  const manual = cantPagos === '2' && cargadas === 0
  const claveDePrecarga = `${cantPagos}·${cargadas}`
  const [clavePrevia, setClavePrevia] = useState(claveDePrecarga)
  if (clavePrevia !== claveDePrecarga) {
    setClavePrevia(claveDePrecarga)
    const sugerido = manual ? 0 : Math.max(diferencia, 0)
    setBorrador((b) => ({ ...b, importe: sugerido }))
    setImporteTexto(sugerido > 0 ? importeATexto(sugerido) : '')
  }

  /* Campos obligatorios del movimiento. El plástico se identifica por banco y tipo: ni el número
     de tarjeta ni el titular se piden —son datos sensibles que el recibo no necesita—. */
  const faltantes: Record<string, boolean> = {
    importe: borrador.importe <= 0,
    banco: !borrador.bancoTarjeta?.trim(),
    tipoTarjeta: !borrador.tipoTarjeta,
    vencimiento: !borrador.vencimientoTarjeta,
    comprobante: !borrador.comprobanteNombre,
    acreditacion: !borrador.cuentaPropia,
  }
  const completo = !Object.values(faltantes).some(Boolean)
  // Sólo se marca en rojo lo que falta DESPUÉS de haber intentado agregar.
  const mal = (campo: string) => intento && faltantes[campo]

  const agregar = () => {
    setIntento(true)
    if (!completo || bloqueado) return
    dispatch({ type: 'agregarMovimientoPago', movimiento: borrador })
    setBorrador(borradorVacio(tipo))
    setImporteTexto('')
    setIntento(false)
  }

  return (
    <fieldset className="cobro-form cobro-form--tarjeta" disabled={bloqueado}>
      {/* FILA 1 · cuántos pagos y por cuánto. */}
      <Fila>
      {/* CANT. PAGOS — para los DOS tipos de tarjeta: el cobro se puede partir en una o dos. */}
      <div className="cobro-form-campo cobro-campo--pagos">
        <label htmlFor="tarj-pagos">Cant. Pagos</label>
        <select
          id="tarj-pagos"
          className="cobro-in"
          value={cantPagos}
          onChange={(e) => setCantPagos(e.target.value)}
        >
          {PAGOS_TARJETA.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* IMPORTE — siempre editable, aunque venga precargado con la diferencia. */}
      <div className="cobro-form-campo cobro-form-campo--val cobro-campo--importe-tarj">
        <label htmlFor="tarj-importe">
          Importe $<Req />
        </label>
        <input
          id="tarj-importe"
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

      </Fila>

      {/* FILA 2 · los datos del plástico: banco, tipo y vencimiento. */}
      <Fila>
      <div className="cobro-form-campo cobro-form-campo--val">
        <label htmlFor="tarj-banco">
          Banco Emisor
          <Req />
        </label>
        <BancoEmisorSelect
          id="tarj-banco"
          value={borrador.bancoTarjeta ?? ''}
          onChange={(banco) => setBorrador({ ...borrador, bancoTarjeta: banco })}
          error={mal('banco')}
        />
      </div>

      <div className="cobro-form-campo cobro-form-campo--val">
        <label htmlFor="tarj-tipo">
          Tipo Tarjeta
          <Req />
        </label>
        <TipoTarjetaSelect
          id="tarj-tipo"
          /* El selector ofrece los tipos del medio: los de débito o los de crédito, no una lista
             común. El medio sale del tipo de tarjeta que eligió la etapa anterior. */
          formaPago={formaPagoTarjeta(tipo)}
          value={borrador.tipoTarjeta ?? ''}
          onChange={(tipo) => setBorrador({ ...borrador, tipoTarjeta: tipo || null })}
          error={mal('tipoTarjeta')}
        />
      </div>

      {/* FECHA DE VENCIMIENTO del plástico. */}
      <div className="cobro-form-campo cobro-form-campo--val cobro-campo--fecha">
        <label htmlFor="tarj-venc">
          Fecha de Venc.
          <Req />
        </label>
        <input
          id="tarj-venc"
          type="date"
          className={`cobro-in ${mal('vencimiento') ? 'cobro-in--error' : ''}`}
          aria-invalid={mal('vencimiento') || undefined}
          value={aIso(borrador.vencimientoTarjeta ?? '')}
          onChange={(e) =>
            setBorrador({ ...borrador, vencimientoTarjeta: desdeIso(e.target.value) })
          }
        />
        {mal('vencimiento') && (
          <span className="cobro-in-err" role="alert">
            Ingresá el vencimiento
          </span>
        )}
      </div>

      </Fila>

      {/* FILA 3 · el respaldo del cobro: cupón y dónde se acredita. */}
      <Fila>
      {/* NRO CUPÓN — el número que imprime el posnet. Va a la izquierda del comprobante: es el
          dato del mismo papel que se adjunta al lado. */}
      <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nrocupon">
        <label htmlFor="tarj-nrocupon">Nro Cupon</label>
        <input
          id="tarj-nrocupon"
          type="text"
          className="cobro-in"
          autoComplete="off"
          value={borrador.numeroCupon ?? ''}
          onChange={(e) => setBorrador({ ...borrador, numeroCupon: e.target.value })}
        />
      </div>

      <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--drop cobro-campo--cupon">
        <label htmlFor="tarj-file">
          Comprobante
          <Req />
        </label>
        <AdjuntoComprobante
          id="tarj-file"
          nombre={borrador.comprobanteNombre ?? ''}
          /* Se guarda el archivo además del nombre: el cupón es una columna `file` del recibo y
             sólo se completa subiendo el binario. */
          onArchivo={(f) =>
            setBorrador({ ...borrador, comprobanteNombre: f?.name ?? '', comprobanteArchivo: f })
          }
        />
        {mal('comprobante') && (
          <span className="cobro-in-err" role="alert">
            Adjuntá el comprobante
          </span>
        )}
      </div>

      {/* BANCO DE ACREDITACIÓN: dónde entra la plata (cuentas propias de La Batea). */}
      <div className="cobro-form-campo cobro-form-campo--val cobro-form-campo--cuenta">
        <label htmlFor="tarj-acreditacion">
          Banco de Acreditación
          <Req />
        </label>
        <select
          id="tarj-acreditacion"
          className={`cobro-in ${mal('acreditacion') ? 'cobro-in--error' : ''}`}
          disabled={estadoCuentas !== 'listo' || cuentas.length === 0}
          aria-invalid={mal('acreditacion') || undefined}
          /* El valor es el ID del ítem de la cuenta: es lo que necesita la relación "Banco de
             Acreditación" del recibo. El nombre se guarda aparte para mostrarlo en la tabla. */
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
        {mal('acreditacion') && (
          <span className="cobro-in-err" role="alert">
            Elegí el banco de acreditación
          </span>
        )}
      </div>

      <div className="cobro-form-campo cobro-form-campo--accion">
        <button type="button" className="cobro-btn cobro-btn--primary" onClick={agregar}>
          <i className="fas fa-plus" /> Agregar
        </button>
      </div>
      </Fila>

      {/* Ayuda en vivo del importe sugerido, para que se vea de dónde sale la precarga. */}
      {!bloqueado && diferencia > 0 && (
        <p className="cobro-form-hint">
          <i className="fas fa-circle-info" />{' '}
          {manual
            ? `Cargá el importe de la primera tarjeta; la segunda se precarga con lo que quede (hoy faltan ${money(diferencia)}).`
            : `Importe sugerido: ${money(diferencia)}, lo que falta para cerrar la venta.`}
        </p>
      )}
    </fieldset>
  )
}
