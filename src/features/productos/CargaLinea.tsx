import { useState } from 'react'
import { money } from '@/lib/format'
import { aplicarTecleoDescuento, BONIFICACION_TOTAL, validarDescuento } from '@/lib/validaciones'
import { useApp } from '@/state/hooks'
import type { Producto } from '@/types'
import { StockPanel } from './StockPanel'

interface CargaLineaProps {
  producto: Producto | null
  /** Aviso de la búsqueda (sin resultados / error): ocupa el lugar del producto elegido. */
  aviso?: string
  onAdd: (cantidad: number, descuento: number) => void
}

/**
 * Producto elegido: cantidad, precio y descuento, con el detalle de stock debajo. Vive dentro
 * de la card de búsqueda y sólo aparece cuando hay un producto seleccionado.
 * El padre la remonta al cambiar de producto (`key`), así los campos arrancan limpios.
 */
export function CargaLinea({ producto, aviso, onAdd }: CargaLineaProps) {
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

          <div className="control-item">
            <label htmlFor="pprice">Precio</label>
            {/* El precio sale de la lista del cliente en Monday: se muestra, no se edita. */}
            <input
              id="pprice"
              type="text"
              className="std-input"
              placeholder="$ 0"
              value={producto ? money(producto.precio) : ''}
              readOnly
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
            {/* Con un descuento fuera de rango no se puede cargar la línea. */}
            <button
              type="button"
              className="btn-primary"
              disabled={!producto || !descuentoOk.ok}
              title={descuentoOk.ok ? '' : descuentoOk.mensaje}
              onClick={() =>
                producto && descuentoOk.ok && onAdd(cantidad, Number(descuento) || 0)
              }
            >
              <i className="fas fa-plus" /> Agregar
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
