import { useState } from 'react'
import { descuentoCompuesto, descuentoUnitario } from '@/lib/descuentos'
import { formatearImporteAR, importeATexto, money, moneyU, pctDec, round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { puedeEditarPrecio, topesDescuentoDe, usuarioDeLaOperacion } from '@/lib/permisos'
import { productoConPrecio } from '@/lib/precios'
import {
  aceptaRentabForzada,
  costoDe,
  precioNetoDe,
  rentabilidadConDescuento,
} from '@/lib/selectors'
import { aplicarTecleoDescuento, BONIFICACION_TOTAL, validarDescuento } from '@/lib/validaciones'
import { useApp } from '@/state/hooks'
import type { Producto } from '@/types'
import { DetalleDescuentos } from './DetalleDescuentos'
import { ProveedorLinea, StockPanel } from './StockPanel'

interface CargaLineaProps {
  producto: Producto | null
  /** Aviso de la búsqueda (sin resultados / error): ocupa el lugar del producto elegido. */
  aviso?: string
  /** `precio` sólo viaja cuando un administrador pisó el precio de lista del producto. */
  onAdd: (cantidad: number, descuento: number, precio?: number) => void
  /** Sólo en la venta con crédito excedido: deshabilita "Agregar" hasta bajar el importe. */
  bloqueado?: boolean
  /**
   * Muestra los datos financieros (precio, descuento y rentabilidad). Con `false` sólo queda la
   * cantidad: es un documento logístico (remito), no financiero. Por defecto se muestran.
   */
  showFinancialData?: boolean
  /** Se está trayendo la cotización del dólar para convertir el precio: input en carga y "Agregar" off. */
  convirtiendo?: boolean
  /**
   * Descuento por forma de pago (pronto pago), en puntos porcentuales. Se aplica ANTES del
   * descuento manual: define el "Precio Actual" sobre el que muerde el % que teclea el vendedor,
   * igual que en la tabla. 0 = sin forma de pago que descuente.
   */
  descFormaPago?: number
}

/**
 * Producto elegido, en dos filas de dos columnas:
 *
 *   · ARRIBA — a la izquierda, la ficha del producto (precio de lista, rentabilidad y el "Precio
 *     Actual" con el descuento por forma de pago ya aplicado); a la derecha, los campos de la
 *     operación, planteados como una cuenta (precio actual − descuento, tecleado indistintamente
 *     en % o en $, = precio unitario final) y, debajo, el resumen de lo que se va a cargar con
 *     el botón "Agregar".
 *   · ABAJO  — el desglose del descuento (mismo componente "Detalle" que la tabla) y, a la
 *     derecha, el stock del proveedor con su barra de cobertura.
 *
 * Vive dentro de la card de búsqueda y sólo se completa cuando hay un producto seleccionado.
 * El padre la remonta al cambiar de producto (`key`), así los campos arrancan limpios.
 */
export function CargaLinea({
  producto,
  aviso,
  onAdd,
  bloqueado = false,
  showFinancialData = true,
  convirtiendo = false,
  descFormaPago = 0,
}: CargaLineaProps) {
  const { topesDescuento: topesTablero, usuarioActual, vendedor, paso, operacion, rentabForzadaActiva, rentabForzadaPctActiva } = useApp()
  const [cantidad, setCantidad] = useState(1)
  const [descuento, setDescuento] = useState('')
  // Aviso de la tecla rechazada por pasarse del máximo; se limpia al corregir.
  const [rechazado, setRechazado] = useState('')
  /* Precio unitario pisado a mano por un administrador (null = el de la lista). Lo que se teclea
     se guarda aparte para poder escribir con comas y miles sin saltos. */
  const [precioOverride, setPrecioOverride] = useState<number | null>(null)
  /* El input arranca con el precio de lista, pero el administrador PUEDE dejarlo vacío (nulo). No se
     cae al precio de lista al vaciarlo: si lo deja sin precio, se valida al intentar agregar. */
  const [precioTexto, setPrecioTexto] = useState(() =>
    producto ? importeATexto(producto.precio) : '',
  )
  /* Se intentó agregar el producto con el precio vacío o en 0: dispara el borde rojo y el mensaje. */
  const [precioSinAsignar, setPrecioSinAsignar] = useState(false)

  /* RBAC: el administrador puede pisar el precio de lista y pasarse del tope de descuento; el
     vendedor ve el precio como dato y tiene el máximo del tablero. */
  /* Manda el VENDEDOR de la operación, no quien está usando la app: lo que se emite queda a su
     nombre y con sus topes. Ver `usuarioDeLaOperacion`. */
  const responsable = usuarioDeLaOperacion(usuarioActual, vendedor)
  const precioEditable = showFinancialData && puedeEditarPrecio(responsable, paso, operacion)
  const topesDescuento = topesDescuentoDe(topesTablero, responsable, paso, operacion)

  const cambiarCantidad = (delta: number) => setCantidad((c) => Math.max(1, c + delta))

  /**
   * Admite decimales (1,5 % / 1.5 %): coma o punto como separador. Lo que se pasa del tope no
   * entra, y sólo se explica cuando el primer dígito ya se pasaba: agregarle un dígito a un
   * valor que ya era válido se rechaza sin ruido. El 100% es la única excepción al máximo.
   */
  const cambiarDescuento = (valor: string) => {
    const tecleo = aplicarTecleoDescuento(descuento, valor, topesDescuento)
    setRechazado(tecleo.mensaje)
    setDescuento(tecleo.texto)
  }

  /**
   * Al salir del campo NUNCA queda vacío: sin número (o con algo que no llega a serlo, como un
   * "." suelto) se asienta un 0 explícito, el mismo criterio que el "Dto. por Precio" del
   * detalle. Así el descuento con el que se carga la línea siempre es un número.
   */
  const salirDescuento = () => {
    const n = Number(descuento.trim().replace(',', '.'))
    if (descuento.trim() !== '' && Number.isFinite(n)) return
    setDescuento('0')
    setRechazado('')
  }

  const validacion = validarDescuento(descuento, topesDescuento)
  const descuentoOk = { ...validacion, mensaje: rechazado || validacion.mensaje }
  const pctManual = Number(descuento) || 0

  /* Producto con el que se hacen las cuentas: el del catálogo o, si un administrador pisó el
     precio, el mismo con el precio nuevo y la rentabilidad recalculada a costo constante. */
  const prod = producto && precioOverride ? productoConPrecio(producto, precioOverride) : producto

  /** Tecleo del precio: con un importe válido lo pisa; vacío o en cero deja el override en null y no
   *  se agrega hasta corregir. Un valor válido limpia el aviso de "precio sin asignar". */
  const cambiarPrecio = (valor: string) => {
    const { texto, valor: n } = formatearImporteAR(valor)
    setPrecioTexto(texto)
    setPrecioOverride(n > 0 ? n : null)
    if (n > 0) setPrecioSinAsignar(false)
  }
  const precioOk = !precioEditable || precioTexto === '' || formatearImporteAR(precioTexto).valor > 0
  /* Error visible del precio (borde rojo + mensaje): un valor tecleado que no supera 0, o el intento
     de agregar con el input vacío/0. Sólo el administrador edita el precio. */
  const errorPrecio = precioEditable && (!precioOk || precioSinAsignar)

  /* Precio de lista, descuento por forma de pago y descuento manual, con las mismas fórmulas en
     cascada que la tabla: el % manual muerde el PRECIO ACTUAL (el de lista ya rebajado por la
     forma de pago), no el de lista. */
  const precio = prod?.precio ?? 0
  const soloFormaPago = descuentoUnitario(precio, 0, descFormaPago)
  /** Precio Actual: precio de lista − descuento por forma de pago. Es la base del descuento manual. */
  const precioActual = soloFormaPago.precioFinal
  const dto = descuentoUnitario(precio, pctManual, descFormaPago)

  /* El descuento en pesos NO se teclea: es el mismo descuento del %, mostrado en su importe. */
  const montoMostrado = descuento ? importeATexto(dto.manual) : ''

  /* Rentabilidad Forzada en la PREVISUALIZACIÓN: si el interruptor está encendido y el producto la
     acepta —lo habilita el maestro, o su precio quedó por debajo del costo—, el % forzado va a ser
     la rentabilidad FINAL. Usa `aceptaRentabForzada`, la MISMA regla que aplica el reducer, así que
     lo que se ve acá antes de agregar es lo que después se aplica.
     El Nuevo Precio de Costo y la Nota de Crédito x Comisión se siguen calculando —los arma el
     reducer al agregar la línea, y de ahí viajan a Monday—, pero ya no se muestran acá. */
  const forzarRentab = rentabForzadaActiva && prod != null && aceptaRentabForzada(prod)
  /* Rentabilidad BASE: el "Margen" del maestro para la lista del cliente, TAL CUAL. Es el punto de
     partida y no se recalcula nunca —ni por descuentos, ni por el override del precio, ni por la
     rentabilidad forzada—: es el dato de referencia que acompaña al precio y al costo en la ficha. */
  const rentabilidadLista = round2(prod?.rentabilidad ?? 0)
  /* Rentabilidad FINAL de la línea: con la forzada encendida es estrictamente el % forzado; si no, la
     de catálogo bajada por el descuento TOTAL (forma de pago + manual, compuesto). Es la métrica
     "Rentabilidad Final" del resumen. */
  const rentabilidadPrevista = forzarRentab
    ? rentabForzadaPctActiva
    : prod
      ? rentabilidadConDescuento(
          precioNetoDe(prod),
          costoDe(prod),
          descuentoCompuesto(pctManual, descFormaPago),
        )
      : 0

  /** Subtotal de la configuración, SIN IVA: precio final por unidad × cantidad. */
  const subtotal = round2(dto.precioFinal * cantidad)

  /* Producto en dólares (presupuesto bimonetario): el precio y el importe se muestran en su moneda
     original, con prefijo `$u` y en verde. En la venta el producto ya llega convertido a pesos. */
  const dolar = esDolar(producto?.moneda)
  const fmtMonto = dolar ? moneyU : money
  const unidades = `${cantidad} ${cantidad === 1 ? 'unidad' : 'unidades'}`
  // El precio todavía se está convirtiendo a pesos: no hay importe que mostrar.
  const enEspera = !producto || convirtiendo

  /* El precio inválido NO deshabilita el botón: se deja clickear para que la validación explique el
     problema (borde rojo + mensaje), en vez de un botón muerto sin motivo. */
  const puedeAgregar = Boolean(producto) && descuentoOk.ok && !bloqueado && !convirtiendo

  /* Agregar el producto: primero valida el precio (el administrador no puede dejarlo vacío ni en 0).
     Si falta, marca el error y no agrega; si está, dispara el alta con el override (o el de lista). */
  const intentarAgregar = () => {
    if (!puedeAgregar) return
    if (precioEditable && !(formatearImporteAR(precioTexto).valor > 0)) {
      setPrecioSinAsignar(true)
      return
    }
    onAdd(cantidad, pctManual, precioOverride ?? undefined)
  }

  const botonAgregar = (
    <button
      type="button"
      className="btn-primary"
      disabled={!puedeAgregar}
      aria-busy={convirtiendo}
      title={
        convirtiendo
          ? 'Convirtiendo el precio a pesos con la cotización del dólar…'
          : bloqueado
            ? 'Se alcanzó el límite de crédito: quitá productos para poder cargar más.'
            : descuentoOk.ok
              ? ''
              : descuentoOk.mensaje
      }
      onClick={intentarAgregar}
    >
      {convirtiendo ? (
        <>
          <i className="fas fa-circle-notch spin" /> Convirtiendo…
        </>
      ) : (
        <>
          <i className="fas fa-plus" /> Agregar
        </>
      )}
    </button>
  )

  return (
    <div
      className={`selected-product-box ${producto ? '' : 'selected-product-box--vacio'} ${
        !producto && aviso ? 'selected-product-box--aviso' : ''
      }`}
    >
      {/* ===== FILA 1: ficha del producto | campos de la operación y resumen ===== */}
      <div className="cl-top">
        <div className="cl-info">
          {/* Sin producto, este lugar informa: o invita a buscar, o explica por qué no hubo match. */}
          <span className="product-name">
            {producto ? (
              producto.nombre
            ) : aviso ? (
              <>
                <i className="fas fa-triangle-exclamation" /> {aviso}
              </>
            ) : (
              'Ningún producto seleccionado'
            )}
          </span>
          <span className="product-meta">
            {producto ? (
              `Código ${producto.codigo}`
            ) : aviso ? (
              'Probá con otro nombre o código, o revisá los filtros aplicados.'
            ) : (
              'Buscá por nombre o código y elegí un producto para cargarlo.'
            )}
          </span>

          {showFinancialData && producto && (
            <>
              {/* El Precio de Costo y el Nuevo Precio de Costo ya NO se muestran: son datos internos
                  del cálculo de la rentabilidad forzada, no algo que el vendedor tenga que leer al
                  cargar el producto. Se siguen calculando y escribiendo en Monday igual. */}
              <div className="cl-kpis">
                <div className="cl-kpi">
                  <label className="cl-kpi-l" htmlFor={precioEditable ? 'pprecio' : undefined}>
                    Precio Unitario
                  </label>
                  {/* RBAC: el administrador lo pisa a mano (override del precio de lista) y todo
                      lo que deriva —rentabilidad, descuentos, subtotal— se recalcula solo. */}
                  {precioEditable ? (
                    <>
                      <span className={`pbox ${errorPrecio ? 'pbox--error' : ''}`}>
                        <span className="pbox-pre">{dolar ? '$U' : '$'}</span>
                        <input
                          id="pprecio"
                          type="text"
                          inputMode="decimal"
                          aria-label={`Precio unitario de ${producto.nombre}`}
                          aria-invalid={errorPrecio}
                          placeholder="Asigná un precio"
                          value={precioTexto}
                          disabled={convirtiendo}
                          onChange={(e) => cambiarPrecio(e.target.value)}
                        />
                      </span>
                      {errorPrecio && (
                        <span className="cl-precio-err" role="alert">
                          Asigná un precio de venta al producto.
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      className="cl-kpi-v"
                      style={dolar ? { color: 'var(--green-dark)' } : undefined}
                    >
                      {convirtiendo ? 'Convirtiendo…' : fmtMonto(precio)}
                    </span>
                  )}
                </div>
                <div className="cl-kpi">
                  <span className="cl-kpi-l">Rentabilidad</span>
                  {/* Dato de CATÁLOGO: el margen del producto al precio que se está por cobrar,
                      SIN descuentos. No se mueve al bonificar; la que baja con el descuento es
                      "Rentabilidad Final", en el resumen. Mostraba la bonificada, y por eso las
                      dos métricas decían siempre lo mismo. */}
                  <span
                    className="cl-kpi-v"
                    style={{
                      color: rentabilidadLista < 0 ? 'var(--red)' : 'var(--green-dark)',
                    }}
                  >
                    {pctDec(rentabilidadLista)}
                  </span>
                </div>
              </div>

            </>
          )}
        </div>

        {/* Columna derecha: los campos de la operación y, debajo, el resumen de lo que se carga. */}
        <div className="cl-oper">
          {/* Datos financieros: sólo en presupuesto/venta. El remito (documento logístico) los
              oculta con `showFinancialData={false}` y deja únicamente la cantidad.

              La fila se lee como la cuenta que hace el vendedor: al precio de partida se le
              restan los descuentos —el mismo, en % o en $— y da el precio final por unidad. */}
          {showFinancialData && (
            <div className="cl-mid">
              {/* Precio de partida real de la operación: el de lista menos el pronto pago. NO se
                  edita, para ningún rol: el override del precio de lista vive en la tabla de
                  productos y es exclusivo de los administradores. */}
              <div className="cl-subcard">
                <div className="cl-subcard-txt">
                  <span className="cl-subcard-l">Precio Actual</span>
                  <span className="cl-subcard-note">[Con Desc x Forma de Pago incluido]</span>
                </div>
                <span className="cl-subcard-v">
                  {convirtiendo ? 'Convirtiendo…' : enEspera ? '—' : fmtMonto(precioActual)}
                </span>
              </div>

              <div className="control-item">
                <label htmlFor="pdesc">Descuento (%)</label>
                <div className={`desc-wrapper ${descuentoOk.ok ? '' : 'desc-wrapper--tope'}`}>
                  <input
                    id="pdesc"
                    type="text"
                    inputMode="decimal"
                    className="std-input small"
                    placeholder="0"
                    autoComplete="off"
                    aria-label={`Descuento en porcentaje: de 0 a ${topesDescuento.max}, o ${BONIFICACION_TOTAL} de bonificación total`}
                    aria-invalid={!descuentoOk.ok}
                    value={descuento}
                    disabled={!producto}
                    onChange={(e) => cambiarDescuento(e.target.value)}
                    onBlur={salirDescuento}
                    aria-describedby="pdesc-aviso"
                  />
                  <span className="desc-suffix">%</span>
                  <span id="pdesc-aviso" className={`desc-tope ${descuentoOk.mensaje ? 'on' : ''}`}>
                    {descuentoOk.mensaje}
                  </span>
                </div>
              </div>

              {/* El mismo descuento, en pesos. NO se teclea: se deriva del %, que es el único
                  campo editable, así los dos no pueden decir cosas distintas. */}
              <div className="control-item">
                <label htmlFor="pdescm">Descuento ($)</label>
                <div className="desc-wrapper">
                  <input
                    id="pdescm"
                    type="text"
                    className="std-input"
                    placeholder="0"
                    aria-label="Descuento en pesos sobre el precio actual, calculado a partir del porcentaje"
                    value={montoMostrado}
                    readOnly
                    disabled
                    title="Se calcula con el porcentaje de descuento"
                  />
                </div>
              </div>

              <span className="cl-igual" aria-hidden="true">
                =
              </span>

              {/* Resultado de la cuenta: lo que se cobra por unidad. */}
              <div className="cl-cardfin">
                <span className="cl-cardfin-l">Precio Unitario Final</span>
                <span className="cl-cardfin-v">{enEspera ? '—' : fmtMonto(dto.precioFinal)}</span>
              </div>
            </div>
          )}

          <div className="cl-resumen">
            <div className="control-item">
              <label htmlFor="pqty">Cantidad</label>
              <div className="qty-input-group">
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => cambiarCantidad(-1)}
                  disabled={!producto}
                  aria-label="Restar"
                >
                  -
                </button>
                <input
                  id="pqty"
                  type="number"
                  className="qty-val"
                  min={1}
                  value={cantidad}
                  disabled={!producto}
                  onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
                />
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => cambiarCantidad(1)}
                  disabled={!producto}
                  aria-label="Sumar"
                >
                  +
                </button>
              </div>
            </div>

            {showFinancialData && (
              <>
                <div className="cl-metric">
                  <span className="cl-metric-l">Descuento Total</span>
                  <span className="cl-metric-v">{enEspera ? '—' : fmtMonto(dto.total)}</span>
                </div>
                {/* Rentabilidad ya con el descuento total aplicado: es la que queda si se carga
                    la línea así, no la de lista. */}
                <div className="cl-metric">
                  <span className="cl-metric-l">Rentabilidad Final</span>
                  <span
                    className="cl-metric-v cl-metric-v--pct"
                    style={{ color: rentabilidadPrevista < 0 ? 'var(--red)' : 'var(--green-dark)' }}
                  >
                    {enEspera ? '—' : pctDec(rentabilidadPrevista)}
                  </span>
                </div>
                <div className="cl-metric cl-metric--sep">
                  <span className="cl-metric-l">Subtotal</span>
                  <span className="cl-metric-v cl-metric-v--azul cl-metric-v--sub">
                    {enEspera ? '—' : fmtMonto(subtotal)}
                  </span>
                  <span className="cl-metric-note">Equivale a {unidades}</span>
                </div>
              </>
            )}
            {botonAgregar}
          </div>
        </div>
      </div>

      {/* ===== FILA 2: desglose del descuento | stock del producto ===== */}
      <div className={`cl-bottom ${showFinancialData ? '' : 'cl-bottom--solo-stock'}`}>
        {showFinancialData && (
          <DetalleDescuentos
            descFormaPago={descFormaPago}
            dtoPago={dto.formaPago}
            descuentoManual={pctManual}
            dtoPrecio={dto.manual}
            dtoTotal={dto.total}
            fmt={fmtMonto}
          />
        )}

        <div className="cl-stock">
          {producto ? (
            <>
              {/* El proveedor y el tipo de mercadería acompañan al título, contra el margen
                  derecho: misma disposición que el detalle de la tabla. */}
              <div className="lindet-hrow">
                <h4 className="lindet-h">
                  <i className="fas fa-cube lindet-h-ic" /> Stock
                </h4>
                <ProveedorLinea producto={producto} />
              </div>
              <StockPanel producto={producto} cantidad={cantidad} conProveedor={false} />
            </>
          ) : (
            <div className="stock-placeholder">
              <i className="fas fa-boxes-stacked" />
              El stock del proveedor y la barra de cobertura se muestran acá al elegir un producto.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
