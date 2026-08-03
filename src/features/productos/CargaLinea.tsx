import { useState } from 'react'
import { money, moneyU, pctDec, round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { rentabilidadEfectiva } from '@/lib/selectors'
import { aplicarTecleoDescuento, BONIFICACION_TOTAL, validarDescuento } from '@/lib/validaciones'
import { useApp } from '@/state/hooks'
import type { Producto } from '@/types'
import { StockPanel } from './StockPanel'

interface CargaLineaProps {
  producto: Producto | null
  /** Aviso de la búsqueda (sin resultados / error): ocupa el lugar del producto elegido. */
  aviso?: string
  onAdd: (cantidad: number, descuento: number) => void
  /** Sólo en la venta con crédito excedido: deshabilita "Agregar" hasta bajar el importe. */
  bloqueado?: boolean
  /**
   * Muestra los datos financieros (precio, descuento y rentabilidad). Con `false` sólo queda la
   * cantidad: es un documento logístico (remito), no financiero. Por defecto se muestran.
   */
  showFinancialData?: boolean
  /** Se está trayendo la cotización del dólar para convertir el precio: input en carga y "Agregar" off. */
  convirtiendo?: boolean
}

/**
 * Producto elegido: cantidad, precio y descuento, con el detalle de stock debajo. Vive dentro
 * de la card de búsqueda y sólo aparece cuando hay un producto seleccionado.
 * El padre la remonta al cambiar de producto (`key`), así los campos arrancan limpios.
 */
export function CargaLinea({
  producto,
  aviso,
  onAdd,
  bloqueado = false,
  showFinancialData = true,
  convirtiendo = false,
}: CargaLineaProps) {
  const { topesDescuento } = useApp()
  const [cantidad, setCantidad] = useState(1)
  const [descuento, setDescuento] = useState('')
  // Aviso de la tecla rechazada por pasarse del máximo; se limpia al corregir.
  const [rechazado, setRechazado] = useState('')

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

  const validacion = validarDescuento(descuento, topesDescuento)
  const descuentoOk = { ...validacion, mensaje: rechazado || validacion.mensaje }

  /* Rentabilidad que quedaría si se cargara la línea así: el margen de lista, ya bajado por el
     descuento tecleado. Se usa el mismo `Number(descuento) || 0` que al agregar, así el valor
     previsto coincide con el que termina en la lista. Se recalcula en cada tecleo/cambio. */
  const rentabilidadPrevista = producto
    ? rentabilidadEfectiva(producto.rentabilidad, Number(descuento) || 0)
    : 0

  /* Importe total de esta configuración, recalculado en vivo con cada cambio de cantidad o
     descuento (ambos son estado → re-render):
       Paso 1: precio unitario con su descuento = precio − (precio × desc%/100)
       Paso 2: × cantidad */
  const importeTotal = producto
    ? round2(producto.precio * (1 - (Number(descuento) || 0) / 100) * cantidad)
    : 0

  /* Producto en dólares (presupuesto bimonetario): el precio y el importe se muestran en su moneda
     original, con prefijo `$u` y en verde. En la venta el producto ya llega convertido a pesos. */
  const dolar = esDolar(producto?.moneda)
  const fmtMonto = dolar ? moneyU : money

  return (
    <div
      className={`selected-product-box ${producto ? '' : 'selected-product-box--vacio'} ${
        !producto && aviso ? 'selected-product-box--aviso' : ''
      }`}
    >
      <div className="product-actions-row">
        <div className="product-info">
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
              <>
                Código {producto.codigo}
                {/* El proveedor no siempre viene cargado en el maestro. */}
                {producto.provCod && <> &nbsp;•&nbsp; Proveedor {producto.provCod}</>}
              </>
            ) : aviso ? (
              'Probá con otro nombre o código, o revisá los filtros aplicados.'
            ) : (
              'Buscá por nombre o código y elegí un producto para cargarlo.'
            )}
          </span>
        </div>

        <div className="controls-group">
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

          {/* Datos financieros: sólo en presupuesto/venta. El remito (documento logístico) los
              oculta con `showFinancialData={false}` y deja únicamente la cantidad. */}
          {showFinancialData && (
            <>
              <div className="control-item">
                <label htmlFor="pprice">Precio</label>
                {/* El precio sale de la lista del cliente en Monday: se muestra, no se edita. Si el
                    producto está en dólares, mientras llega la cotización se muestra "Convirtiendo…";
                    al resolverse, el input ya trae el precio convertido a pesos. */}
                <input
                  id="pprice"
                  type="text"
                  className="std-input"
                  placeholder="$ 0"
                  value={convirtiendo ? 'Convirtiendo…' : producto ? fmtMonto(producto.precio) : ''}
                  readOnly
                  style={dolar ? { color: 'var(--green-dark)', fontWeight: 700 } : undefined}
                />
              </div>

              <div className="control-item">
                <label htmlFor="pdesc">Descuento</label>
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
                    aria-describedby="pdesc-aviso"
                  />
                  <span className="desc-suffix">%</span>
                  <span id="pdesc-aviso" className={`desc-tope ${descuentoOk.mensaje ? 'on' : ''}`}>
                    {descuentoOk.mensaje}
                  </span>
                </div>
              </div>

              <div className="control-item">
                <label htmlFor="prent">Rentabilidad</label>
                {/* No editable: es el margen que queda tras el descuento, recalculado en vivo. Verde
                    si suma; rojo si el descuento se comió el margen (negativa). */}
                <input
                  id="prent"
                  type="text"
                  className="std-input"
                  readOnly
                  placeholder="—"
                  value={producto ? pctDec(rentabilidadPrevista) : ''}
                  style={{
                    color: rentabilidadPrevista < 0 ? 'var(--red)' : 'var(--green-dark)',
                    fontWeight: 700,
                  }}
                  aria-label="Rentabilidad prevista del producto con el descuento aplicado"
                />
              </div>

              {/* Importe total de la configuración: reacciona en vivo a la cantidad y el descuento. */}
              <div className="control-item control-item--total">
                <label htmlFor="ptotal">Importe Total</label>
                <input
                  id="ptotal"
                  type="text"
                  className="std-input"
                  readOnly
                  placeholder="$ 0"
                  value={producto ? fmtMonto(importeTotal) : ''}
                  style={{ color: dolar ? 'var(--green-dark)' : 'var(--primary-blue)', fontWeight: 800 }}
                  aria-label="Importe total del producto con el descuento y la cantidad aplicados"
                />
              </div>
            </>
          )}

          <div className="control-item">
            {/* No se carga con un descuento fuera de rango, ni en la venta si se excedió el
                crédito: primero hay que bajar el importe quitando productos. */}
            <button
              type="button"
              className="btn-primary"
              disabled={!producto || !descuentoOk.ok || bloqueado || convirtiendo}
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
              onClick={() =>
                producto &&
                descuentoOk.ok &&
                !bloqueado &&
                !convirtiendo &&
                onAdd(cantidad, Number(descuento) || 0)
              }
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
          </div>
        </div>
      </div>

      {/* El stock y la cobertura quedan en el mismo box: sin producto, sólo se anuncian. */}
      {producto ? (
        <StockPanel producto={producto} cantidad={cantidad} />
      ) : (
        <div className="stock-placeholder">
          <i className="fas fa-boxes-stacked" />
          El stock del proveedor y la barra de cobertura se muestran acá al elegir un producto.
        </div>
      )}
    </div>
  )
}
