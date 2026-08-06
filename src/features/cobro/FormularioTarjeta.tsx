import { useState } from 'react'
import {
  CUOTAS_CREDITO,
  MSG_NRO_TARJETA,
  PAGOS_DEBITO,
  formaPagoTarjeta,
  formatearNroTarjeta,
  nroTarjetaCompleto,
} from '@/lib/cobros'
import { aIso, desdeIso } from '@/lib/dates'
import { formatearImporteAR, importeATexto, money } from '@/lib/format'
import { useDispatch } from '@/state/hooks'
import type { MovimientoPago, TarjetaTipo, TipoTarjetaCobro } from '@/types'
import { AdjuntoComprobante } from './AdjuntoComprobante'
import { BancoEmisorSelect } from './BancoEmisorSelect'
import { textoCuentasVacio, useCuentasPropias } from './useCuentasPropias'

type Borrador = Omit<MovimientoPago, 'id'>

const TIPOS_TARJETA: TarjetaTipo[] = ['VISA', 'MASTERCARD']

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
  chequeVencimiento: '',
  cuentaPropia: null,
  cuentaPropiaId: null,
  comprobanteNombre: '',
  comprobanteArchivo: null,
  bancoTarjeta: '',
  tipoTarjeta: null,
  cuotas: 0,
  numeroTarjeta: '',
  titularTarjeta: '',
  vencimientoTarjeta: '',
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
  const esCredito = tipo === 'CREDITO'
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
  /* Débito: el pago se puede partir en una o dos tarjetas. En crédito no se pregunta (siempre es
     una), así que la precarga se comporta como el "1 pago". */
  const [cantPagos, setCantPagos] = useState<string>('1')
  // Recién al intentar agregar se muestran los errores: no se reta al vendedor mientras carga.
  const [intento, setIntento] = useState(false)
  // Banco de acreditación: mismas cuentas propias que usa la transferencia.
  const { cuentas, estado: estadoCuentas } = useCuentasPropias(true)

  /* Precarga del importe. Con un solo pago —o en crédito— el importe sugerido es TODA la diferencia,
     porque esa tarjeta tiene que cancelar la venta. Partido en dos, el primero lo escribe el
     vendedor y el segundo se precarga con lo que quedó pendiente.
     Se recalcula sólo cuando cambia la cantidad de pagos o entra una tarjeta nueva: si dependiera de
     la diferencia en vivo, pisaría el importe justo mientras se lo está tipeando. */
  const manual = !esCredito && cantPagos === '2' && cargadas === 0
  const claveDePrecarga = `${cantPagos}·${cargadas}`
  const [clavePrevia, setClavePrevia] = useState(claveDePrecarga)
  if (clavePrevia !== claveDePrecarga) {
    setClavePrevia(claveDePrecarga)
    const sugerido = manual ? 0 : Math.max(diferencia, 0)
    setBorrador((b) => ({ ...b, importe: sugerido }))
    setImporteTexto(sugerido > 0 ? importeATexto(sugerido) : '')
  }

  const nroMal = !nroTarjetaCompleto(borrador.numeroTarjeta)
  /* Campos obligatorios del movimiento. El número de tarjeta se valida aparte porque tiene su
     propio mensaje: no alcanza con que esté cargado, tiene que tener los 16 dígitos. */
  const faltantes: Record<string, boolean> = {
    importe: borrador.importe <= 0,
    banco: !borrador.bancoTarjeta?.trim(),
    tipoTarjeta: !borrador.tipoTarjeta,
    numero: nroMal,
    titular: !borrador.titularTarjeta?.trim(),
    vencimiento: !borrador.vencimientoTarjeta,
    comprobante: !borrador.comprobanteNombre,
    acreditacion: !borrador.cuentaPropia,
    cuotas: esCredito && !(borrador.cuotas && borrador.cuotas > 0),
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

  const nroTexto = formatearNroTarjeta(borrador.numeroTarjeta ?? '').texto

  return (
    <fieldset className="cobro-form cobro-form--tarjeta" disabled={bloqueado}>
      {/* FILA 1 · cuántos pagos y por cuánto. */}
      <Fila>
      {/* CANT. PAGOS — sólo débito: en crédito el cobro va en una sola tarjeta. */}
      {!esCredito && (
        <div className="cobro-form-campo cobro-campo--pagos">
          <label htmlFor="tarj-pagos">Cant. Pagos</label>
          <select
            id="tarj-pagos"
            className="cobro-in"
            value={cantPagos}
            onChange={(e) => setCantPagos(e.target.value)}
          >
            {PAGOS_DEBITO.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}

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

      {/* CANT. CUOTAS — sólo crédito. Va pegado al importe: el plan de cuotas se decide junto con
          el monto, no al final de la carga. */}
      {esCredito && (
        <div className="cobro-form-campo cobro-form-campo--val cobro-campo--cuotas">
          <label htmlFor="tarj-cuotas">
            Cant. Cuotas
            <Req />
          </label>
          <select
            id="tarj-cuotas"
            className={`cobro-in ${mal('cuotas') ? 'cobro-in--error' : ''}`}
            aria-invalid={mal('cuotas') || undefined}
            value={borrador.cuotas || ''}
            onChange={(e) => setBorrador({ ...borrador, cuotas: Number(e.target.value) || 0 })}
          >
            <option value="">Seleccionar…</option>
            {CUOTAS_CREDITO.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {mal('cuotas') && (
            <span className="cobro-in-err" role="alert">
              Elegí la cantidad de cuotas
            </span>
          )}
        </div>
      )}
      </Fila>

      {/* FILA 2 · los datos del plástico: titular, banco, tipo, número y vencimiento. */}
      <Fila>
      <div className="cobro-form-campo cobro-form-campo--val">
        <label htmlFor="tarj-titular">
          Titular Tarjeta
          <Req />
        </label>
        <input
          id="tarj-titular"
          className={`cobro-in ${mal('titular') ? 'cobro-in--error' : ''}`}
          placeholder="Como figura en la tarjeta"
          aria-invalid={mal('titular') || undefined}
          value={borrador.titularTarjeta ?? ''}
          onChange={(e) => setBorrador({ ...borrador, titularTarjeta: e.target.value })}
        />
        {mal('titular') && (
          <span className="cobro-in-err" role="alert">
            Ingresá el titular de la tarjeta
          </span>
        )}
      </div>

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
        <select
          id="tarj-tipo"
          className={`cobro-in ${mal('tipoTarjeta') ? 'cobro-in--error' : ''}`}
          aria-invalid={mal('tipoTarjeta') || undefined}
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
        {mal('tipoTarjeta') && (
          <span className="cobro-in-err" role="alert">
            Elegí el tipo de tarjeta
          </span>
        )}
      </div>

      {/* NRO. TARJETA — se agrupa de a 4 mientras se escribe y exige los 16 dígitos. */}
      <div className="cobro-form-campo cobro-form-campo--val cobro-campo--nrotarj">
        <label htmlFor="tarj-nro">
          Nro. Tarjeta
          <Req />
        </label>
        <input
          id="tarj-nro"
          className={`cobro-in ${mal('numero') ? 'cobro-in--error' : ''}`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="XXXX XXXX XXXX XXXX"
          aria-invalid={mal('numero') || undefined}
          value={nroTexto}
          onChange={(e) =>
            setBorrador({
              ...borrador,
              numeroTarjeta: formatearNroTarjeta(e.target.value).digitos,
            })
          }
        />
        {mal('numero') && (
          <span className="cobro-in-err" role="alert">
            {MSG_NRO_TARJETA}
          </span>
        )}
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

      {/* FILA 3 · el respaldo del cobro: cupón, dónde se acredita y —en crédito— el plan de cuotas. */}
      <Fila>
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
