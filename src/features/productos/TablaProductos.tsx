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
}

interface TablaProductosProps {
  titulo: string
  filas: FilaProducto[]
  onRemove: (id: string) => void
  /** Habilita editar la cantidad desde la tabla (el tope lo pone el reducer). */
  onCantidad?: (id: string, cantidad: number) => void
  /** Habilita editar el descuento desde la tabla. Sólo se avisa con un valor válido. */
  onDescuento?: (id: string, descuento: number) => void
  /** Piso de la cantidad: 1 en el presupuesto (una línea en cero no existe), 0 en la venta. */
  cantidadMin?: number
  /** Presente sólo en la venta: agrega la columna de comisión. */
  comisionPct?: number
  /** Se monta dentro de la misma card, debajo de la tabla. */
  footer?: ReactNode
}

const subtotalDe = (f: FilaProducto) => round2(f.precio * f.cantidad)
const totalDe = (f: FilaProducto) => round2(subtotalDe(f) * (1 - f.descuento / 100))

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
 * Tabla de líneas de la operación. La comparten PRESUPUESTAR y CARGAR VENTA: misma
 * estructura y mismo comportamiento, salvo la cantidad editable y la comisión.
 */
export function TablaProductos({
  titulo,
  filas,
  onRemove,
  onCantidad,
  onDescuento,
  cantidadMin = 0,
  comisionPct,
  footer,
}: TablaProductosProps) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set())
  const conComision = comisionPct !== undefined
  const columnas = conComision ? 11 : 10

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
            <th className="ta-r">P. unit.</th>
            <th className="ta-r">Subtotal</th>
            <th className="ta-c">Desc.</th>
            <th className="ta-c col-rent">Rentab.</th>
            {conComision && <th className="ta-c">Comis.</th>}
            <th className="ta-r">Total</th>
            <th className="ta-c">Acc.</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => {
            const abierta = expandidas.has(fila.id)
            const tope = fila.cantidadMax
            const excede = tope !== undefined && fila.cantidad > tope
            const rentFila = rentabilidadEfectiva(fila.rentabilidad, fila.descuento)
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
                  <td className="ta-r" style={{ fontWeight: 600 }}>
                    {money(subtotalDe(fila))}
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
                  {conComision && (
                    <td className="ta-c" style={{ fontWeight: 600 }}>
                      {comisionPct}%
                    </td>
                  )}
                  <td className="ta-r" style={{ fontWeight: 700 }}>
                    {money(totalDe(fila))}
                  </td>
                  <td className="ta-c">
                    <i
                      className="far fa-trash-alt trash"
                      role="button"
                      aria-label={`Quitar ${fila.nombre}`}
                      onClick={() => onRemove(fila.id)}
                    />
                  </td>
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
