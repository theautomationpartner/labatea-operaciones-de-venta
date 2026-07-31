import { Fragment, useState, type ReactNode } from 'react'
import { money, pctDec, round2 } from '@/lib/format'
import { rentabilidadEfectiva } from '@/lib/selectors'
import { aplicarTecleoDescuento, BONIFICACION_TOTAL, validarDescuento } from '@/lib/validaciones'
import { useApp } from '@/state/hooks'
import type { Producto } from '@/types'
import { StockPanel } from './StockPanel'

/** Fila de la tabla, común al presupuesto y a la venta. */
export interface FilaProducto {
  id: string
  codigo: string
  nombre: string
  cantidad: number
  precio: number
  descuento: number
  rentabilidad: number
  /** Ficha de catálogo, para el desplegable de stock. */
  producto?: Producto
  /** Tope de unidades. Los botones no lo pasan; escrito a mano, marca la celda en rojo. */
  cantidadMax?: number
  /** Valores YA calculados (venta CON PROFORMA): se muestran tal cual, sin recalcular. Importe
   *  bonificado por unidad, IVA en $ de la línea y total de la línea, leídos de la proforma. */
  impBonif?: number
  ivaMonto?: number
  totalLinea?: number
}

interface TablaProductosProps {
  titulo: string
  filas: FilaProducto[]
  /** Quitar una línea. Se omite en modo sólo lectura (la columna de acciones no se muestra). */
  onRemove?: (id: string) => void
  /** Habilita editar la cantidad desde la tabla (el tope lo pone el reducer). */
  onCantidad?: (id: string, cantidad: number) => void
  /** Habilita editar el descuento desde la tabla. Sólo se avisa con un valor válido. */
  onDescuento?: (id: string, descuento: number) => void
  /**
   * Sólo lectura estricta: sin edición de cantidad/descuento (no se pasan los handlers) y sin
   * columna de acciones (no se puede quitar una línea). La venta CON PROFORMA la usa: todo o nada.
   */
  soloLectura?: boolean
  /** Piso de la cantidad: 1 en el presupuesto (una línea en cero no existe), 0 en la venta. */
  cantidadMin?: number
  /**
   * Descuento por forma de pago (pronto pago), en puntos porcentuales. Se compone con el
   * descuento manual de cada fila para la bonificación, el total y el IVA. 0 = sin forma de pago.
   */
  descFormaPago?: number
  /** Muestra la columna "IVA ($)" antes del total. Sólo en la VENTA, que sí liquida IVA. */
  mostrarIva?: boolean
  /** Se monta dentro de la misma card, debajo de la tabla. */
  footer?: ReactNode
}

/** Alícuota de IVA por defecto cuando el producto no trae la suya. */
const IVA_DEFECTO = 21

/** Descuento total de la fila: el manual más el de la forma de pago, topeado en 100%. */
const descTotalDe = (f: FilaProducto, descFormaPago: number) =>
  Math.min(f.descuento + descFormaPago, 100)

/**
 * Importe bonificado de UNA unidad, en pesos: precio × (%desc manual + %desc forma de pago).
 * Es lo que se descuenta por unidad, no el precio resultante. Si la fila ya trae el valor calculado
 * (venta CON PROFORMA), se usa ése tal cual.
 */
const bonifUnitDe = (f: FilaProducto, descFormaPago: number) =>
  f.impBonif ?? round2(f.precio * (descTotalDe(f, descFormaPago) / 100))

/** Importe total de la línea: (precio unitario − bonificación por unidad) × cantidad (o el guardado). */
const subtotalDe = (f: FilaProducto, descFormaPago: number) =>
  f.totalLinea ?? round2((f.precio - bonifUnitDe(f, descFormaPago)) * f.cantidad)

/** IVA en pesos de la línea, sobre el importe ya bonificado (o el guardado). */
const ivaDe = (f: FilaProducto, descFormaPago: number) =>
  f.ivaMonto ?? round2((subtotalDe(f, descFormaPago) * (f.producto?.iva ?? IVA_DEFECTO)) / 100)

/**
 * Descuento editable en la fila. Guarda lo tipeado para poder escribir "1," o "1.5" sin
 * saltos, y sólo avisa al padre cuando el valor es válido; si no, se marca en rojo.
 */
function CeldaDescuento({
  fila,
  onDescuento,
}: {
  fila: FilaProducto
  onDescuento: (id: string, descuento: number) => void
}) {
  const { topesDescuento } = useApp()
  const [texto, setTexto] = useState(String(fila.descuento))
  // Aviso de la tecla rechazada por pasarse del máximo.
  const [rechazado, setRechazado] = useState('')
  // Si la fila cambia desde afuera (otra edición), el campo la sigue.
  const [ultimo, setUltimo] = useState(fila.descuento)
  if (ultimo !== fila.descuento) {
    setUltimo(fila.descuento)
    setTexto(String(fila.descuento))
  }

  const validacion = validarDescuento(texto, topesDescuento)
  const mensaje = rechazado || validacion.mensaje
  const ok = !rechazado && validacion.ok

  const cambiar = (valor: string) => {
    /* La tecla se resuelve en `aplicarTecleoDescuento`: lo que se pasa del tope no entra, y
       sólo se explica cuando el primer dígito ya se pasaba. */
    const tecleo = aplicarTecleoDescuento(texto, valor, topesDescuento)
    setRechazado(tecleo.mensaje)
    if (tecleo.texto === texto) return

    setTexto(tecleo.texto)
    const v = validarDescuento(tecleo.texto, topesDescuento)
    if (v.ok) {
      const n = Number(tecleo.texto) || 0
      setUltimo(n)
      onDescuento(fila.id, n)
    }
  }

  return (
    <span className={`dbox ${ok ? '' : 'dbox--error'}`} title={mensaje}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Descuento de ${fila.nombre}: de 0 a ${topesDescuento.max}, o ${BONIFICACION_TOTAL} de bonificación total`}
        aria-invalid={!ok}
        value={texto}
        onChange={(e) => cambiar(e.target.value)}
      />
      <span className="dbox-suf">%</span>
      {mensaje && <span className="dbox-aviso">{mensaje}</span>}
    </span>
  )
}

/**
 * Tabla de líneas de la operación. La comparten PRESUPUESTAR y VENTA: misma
 * estructura y mismo comportamiento, salvo la cantidad editable.
 */
export function TablaProductos({
  titulo,
  filas,
  onRemove,
  onCantidad,
  onDescuento,
  soloLectura = false,
  cantidadMin = 0,
  descFormaPago = 0,
  mostrarIva = false,
  footer,
}: TablaProductosProps) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set())
  // Base 10; +1 con la columna de IVA ($); −1 sin la columna de acciones (sólo lectura).
  const columnas = 10 + (mostrarIva ? 1 : 0) - (soloLectura ? 1 : 0)

  const toggle = (id: string) =>
    setExpandidas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="tablec">
      <div className="thtitle">
        {titulo} ({filas.length})
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th colSpan={2}>Producto</th>
            <th className="ta-c">Cant.</th>
            <th className="ta-r">P. Unit</th>
            <th className="ta-c">Desc.</th>
            <th className="ta-c col-rent">Rentab.</th>
            <th className="ta-r">Importe Bonif.</th>
            {mostrarIva && <th className="ta-r">IVA ($)</th>}
            <th className="ta-r">Importe Total</th>
            {!soloLectura && <th className="ta-c">Acc.</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => {
            const abierta = expandidas.has(fila.id)
            const tope = fila.cantidadMax
            const excede = tope !== undefined && fila.cantidad > tope
            const rentFila = rentabilidadEfectiva(fila.rentabilidad, descTotalDe(fila, descFormaPago))
            return (
              <Fragment key={fila.id}>
                <tr>
                  <td style={{ width: 40 }}>
                    {fila.producto && (
                      <i
                        className={`fas fa-chevron-right chev ${abierta ? 'open' : ''}`}
                        role="button"
                        aria-label="Ver detalle de stock"
                        aria-expanded={abierta}
                        onClick={() => toggle(fila.id)}
                      />
                    )}
                  </td>
                  <td style={{ width: 20, color: 'var(--text-gray)', fontWeight: 600 }}>{i + 1}</td>
                  <td>
                    <span style={{ color: 'var(--primary-blue)', fontWeight: 700 }}>
                      {fila.codigo}
                    </span>
                    <span style={{ marginLeft: 12, fontWeight: 600 }}>{fila.nombre}</span>
                  </td>

                  <td className="ta-c" style={{ fontWeight: 600 }}>
                    {onCantidad ? (
                      <span className={`qbox ${excede ? 'qbox--error' : ''}`}>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Cantidad a vender de ${fila.nombre}`}
                          aria-invalid={excede}
                          title={excede ? `No se puede vender más de ${tope} presupuestadas` : ''}
                          value={fila.cantidad}
                          onChange={(e) =>
                            onCantidad(fila.id, Number(e.target.value.replace(/\D/g, '')) || 0)
                          }
                        />
                        <span className="qbtns">
                          <button
                            type="button"
                            aria-label={`Sumar una unidad de ${fila.nombre}`}
                            disabled={tope !== undefined && fila.cantidad >= tope}
                            onClick={() => onCantidad(fila.id, fila.cantidad + 1)}
                          >
                            <i className="fas fa-angle-up" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Restar una unidad de ${fila.nombre}`}
                            disabled={fila.cantidad <= cantidadMin}
                            onClick={() => onCantidad(fila.id, fila.cantidad - 1)}
                          >
                            <i className="fas fa-angle-down" />
                          </button>
                        </span>
                      </span>
                    ) : (
                      fila.cantidad
                    )}
                  </td>

                  <td className="ta-r" style={{ fontWeight: 600 }}>
                    {money(fila.precio)}
                  </td>
                  <td className="ta-c" style={{ fontWeight: 600 }}>
                    {onDescuento ? (
                      <CeldaDescuento fila={fila} onDescuento={onDescuento} />
                    ) : (
                      pctDec(fila.descuento)
                    )}
                  </td>
                  {/* La rentabilidad es la que queda después de bonificar. Ancho fijo: al
                      editar el descuento cambia de "99%" a "99,39%" y corría la fila entera. */}
                  <td
                    className="ta-c col-rent"
                    style={{ color: rentFila < 0 ? 'var(--red)' : 'var(--green-dark)', fontWeight: 700 }}
                  >
                    {pctDec(rentFila)}
                  </td>
                  {/* Importe Bonif.: lo bonificado por unidad en $ (desc manual + forma de pago). */}
                  <td className="ta-r" style={{ fontWeight: 600 }}>
                    {money(bonifUnitDe(fila, descFormaPago))}
                  </td>
                  {/* IVA ($): sobre el importe ya bonificado de la línea. Sólo en la venta. */}
                  {mostrarIva && (
                    <td className="ta-r" style={{ fontWeight: 600 }}>
                      {money(ivaDe(fila, descFormaPago))}
                    </td>
                  )}
                  <td className="ta-r" style={{ fontWeight: 700 }}>
                    {money(subtotalDe(fila, descFormaPago))}
                  </td>
                  {!soloLectura && (
                    <td className="ta-c">
                      <i
                        className="far fa-trash-alt trash"
                        role="button"
                        aria-label={`Quitar ${fila.nombre}`}
                        onClick={() => onRemove?.(fila.id)}
                      />
                    </td>
                  )}
                </tr>

                {abierta && fila.producto && (
                  <tr className="rexp">
                    <td colSpan={columnas} style={{ padding: 0 }}>
                      <div className="expd">
                        <StockPanel producto={fila.producto} cantidad={fila.cantidad} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {footer}
    </div>
  )
}
