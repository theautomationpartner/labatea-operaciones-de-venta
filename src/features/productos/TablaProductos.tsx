import { Fragment, useState, type ReactNode } from 'react'
import { descuentoUnitario } from '@/lib/descuentos'
import {
  SIMBOLO_DOLAR,
  formatearImporteAR,
  importeATexto,
  money,
  moneyU,
  pctDec,
  round2,
} from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { rentabilidadEfectiva } from '@/lib/selectors'
import type { Producto } from '@/types'
import { LineaDetalle } from './LineaDetalle'

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
   *  bonificado por unidad y total de la línea, leídos de la proforma. */
  impBonif?: number
  totalLinea?: number
  /** Desglose del descuento leído de la proforma (venta CON PROFORMA): % de forma de pago y los
   *  montos $ por unidad de cada origen. Con esto el "Detalle" muestra lo guardado, sin recalcular. */
  descFormaPago?: number
  descProdMonto?: number
  descFpMonto?: number
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
   * Habilita pisar el PRECIO UNITARIO de la línea (override del precio de lista). Sólo lo pasa
   * la selección de productos cuando el usuario es administrador (ver `lib/permisos`); sin el
   * handler, la celda muestra el precio en lectura, como en el resto de los pasos.
   */
  onPrecio?: (id: string, precio: number) => void
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
  /**
   * Muestra la columna "Moneda" (antes de "Cant.") y, en las líneas en dólares, renderiza los
   * importes con el prefijo `$u` en verde. Sólo en el PRESUPUESTO, que es bimonetario.
   */
  mostrarMoneda?: boolean
  /** Se monta dentro de la misma card, debajo de la tabla. */
  footer?: ReactNode
}

/** Verde de los importes en dólares en la tabla del presupuesto bimonetario. */
const VERDE_USD = 'var(--green-dark)'

/**
 * Los tres valores de la fila, calculados en un solo lugar y con las fórmulas compartidas de
 * `lib/descuentos`:
 *
 *   · descuento total POR UNIDAD (forma de pago + manual, en cascada): no escala con la cantidad;
 *   · precio unitario final = precio de lista − descuento total;
 *   · subtotal = precio final × cantidad (SIN IVA): lo único que sí escala con la cantidad.
 *
 * El IVA no se liquida por línea en la tabla: va en el resumen de la operación.
 *
 * La venta CON PROFORMA trae los importes ya calculados en la fila (`impBonif`, `totalLinea`): se
 * respetan tal cual, y el desglose reparte ese descuento guardado entre sus dos orígenes con el
 * mismo criterio (primero la forma de pago sobre el precio de lista).
 */
function calculosDe(f: FilaProducto, descFormaPago: number) {
  const d = descuentoUnitario(f.precio, f.descuento, descFormaPago)
  const total = f.impBonif ?? d.total
  const formaPago = Math.min(d.formaPago, total)
  const precioFinal = f.impBonif === undefined ? d.precioFinal : round2(f.precio - total)
  const subtotal = f.totalLinea ?? round2(precioFinal * f.cantidad)
  /* Desglose por origen: la venta CON PROFORMA lo trae GUARDADO de la proforma (independiente por
     origen: Desc $ x Prod = numeric_mm5xxrkw, Desc $ x Forma de Pago = numeric_mm5x79vt) y se muestra
     tal cual. El resto de las ventas reparte el total calculado (forma de pago primero, luego el resto). */
  const guardado = f.descProdMonto !== undefined || f.descFpMonto !== undefined
  return {
    /** $ por unidad que aporta la forma de pago. */
    dtoPago: guardado ? f.descFpMonto ?? 0 : formaPago,
    /** $ por unidad que aporta el % manual, sobre el precio ya rebajado. */
    dtoPrecio: guardado ? f.descProdMonto ?? 0 : round2(total - formaPago),
    /** $ por unidad de descuento total. */
    dtoTotal: total,
    /** % compuesto: alimenta la rentabilidad efectiva de la línea. */
    descPct: d.pct,
    precioFinal,
    subtotal,
  }
}

/**
 * Precio unitario editable: override del precio de lista, reservado a los administradores (ver
 * `lib/permisos`). Igual que el descuento, guarda lo tecleado —con formato argentino, miles y
 * coma decimal— y sólo avisa al padre con un importe válido; un precio vacío o en cero se marca
 * en rojo y no se aplica.
 */
function CeldaPrecio({
  fila,
  prefijo,
  onPrecio,
}: {
  fila: FilaProducto
  /** "$" en pesos, "U$" en el presupuesto bimonetario. */
  prefijo: string
  onPrecio: (id: string, precio: number) => void
}) {
  const [texto, setTexto] = useState(importeATexto(fila.precio))
  // Si el precio cambia desde afuera, el campo lo sigue.
  const [ultimo, setUltimo] = useState(fila.precio)
  if (ultimo !== fila.precio) {
    setUltimo(fila.precio)
    setTexto(importeATexto(fila.precio))
  }

  const cambiar = (valor: string) => {
    const { texto: fmt, valor: n } = formatearImporteAR(valor)
    setTexto(fmt)
    if (n > 0) {
      setUltimo(n)
      onPrecio(fila.id, n)
    }
  }

  const ok = formatearImporteAR(texto).valor > 0
  const mensaje = ok ? '' : 'El precio tiene que ser mayor a cero'

  /* Al salir, el campo no queda vacío ni en cero: vuelve al precio vigente de la línea (lo que
     se tecleó nunca se aplicó, así que mostrarlo sería mentir sobre lo que se está cobrando). */
  const alSalir = () => {
    if (!ok) setTexto(importeATexto(fila.precio))
  }

  return (
    <span className={`pbox ${ok ? '' : 'pbox--error'}`} title={mensaje}>
      <span className="pbox-pre">{prefijo}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Precio unitario de ${fila.nombre}`}
        aria-invalid={!ok}
        value={texto}
        onChange={(e) => cambiar(e.target.value)}
        onBlur={alSalir}
      />
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
  onPrecio,
  soloLectura = false,
  cantidadMin = 0,
  descFormaPago = 0,
  mostrarMoneda = false,
  footer,
}: TablaProductosProps) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set())
  /* Base 10: desplegable, N°, producto, cantidad, P. Unit, rentabilidad, descuento total,
     P. c/Dto. y subtotal (el IVA va dentro de esa misma celda), más acciones.
     +1 con Moneda; −1 sin acciones (sólo lectura). */
  const columnas = 10 + (mostrarMoneda ? 1 : 0) - (soloLectura ? 1 : 0)

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
            {mostrarMoneda && <th className="ta-c">Moneda</th>}
            <th className="ta-c">Cantidad</th>
            <th className="ta-r">P. Unit de Lista</th>
            <th className="ta-r">Descuento Total</th>
            {/* El único encabezado que envuelve en dos líneas: si no, roba todo el ancho. */}
            <th className="ta-r col-pcd">P. c/Dto. Total Aplicado</th>
            <th className="ta-r">Subtotal</th>
            {/* La rentabilidad cierra la fila: es la lectura del resultado, después del subtotal. */}
            <th className="ta-c col-rent">Rentab.</th>
            {!soloLectura && <th className="ta-c">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => {
            const abierta = expandidas.has(fila.id)
            const tope = fila.cantidadMax
            const excede = tope !== undefined && fila.cantidad > tope
            const calc = calculosDe(fila, descFormaPago)
            // La rentabilidad se mide con el % compuesto, no con la suma de los dos descuentos.
            const rentFila = rentabilidadEfectiva(fila.rentabilidad, calc.descPct)
            /* Línea en dólares (presupuesto bimonetario): sus importes van con prefijo `$u` y en
               verde. En la venta —mono-moneda— nunca se cumple, así que no altera esa tabla. */
            const dolar = esDolar(fila.producto?.moneda)
            const fmt = dolar ? moneyU : money
            const colUsd = dolar ? VERDE_USD : undefined
            return (
              <Fragment key={fila.id}>
                <tr>
                  {/* El desplegable ya no depende del stock: adentro va también el desglose del
                      descuento, que toda línea tiene. */}
                  <td style={{ width: 40 }}>
                    <i
                      className={`fas fa-chevron-right chev ${abierta ? 'open' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver detalle de ${fila.nombre}`}
                      aria-expanded={abierta}
                      onClick={() => toggle(fila.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggle(fila.id)
                        }
                      }}
                    />
                  </td>
                  <td style={{ width: 20, color: 'var(--text-gray)', fontWeight: 600 }}>{i + 1}</td>
                  <td>
                    <span style={{ color: 'var(--primary-blue)', fontWeight: 700 }}>
                      {fila.codigo}
                    </span>
                    <span style={{ marginLeft: 12, fontWeight: 600 }}>{fila.nombre}</span>
                  </td>

                  {/* Moneda del producto: "USD" (verde) para dólares, "ARS" para pesos. */}
                  {mostrarMoneda && (
                    <td className="ta-c" style={{ fontWeight: 700, color: colUsd }}>
                      {dolar ? 'USD' : 'ARS'}
                    </td>
                  )}

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

                  {/* P. Unit de Lista: editable sólo para el administrador (override del precio
                      de catálogo); en lectura para todos los demás. */}
                  <td className="ta-r" style={{ fontWeight: 600, color: colUsd }}>
                    {onPrecio ? (
                      <CeldaPrecio
                        fila={fila}
                        prefijo={dolar ? SIMBOLO_DOLAR : '$'}
                        onPrecio={onPrecio}
                      />
                    ) : (
                      fmt(fila.precio)
                    )}
                  </td>
                  {/* Descuento Total POR UNIDAD: no se mueve al cambiar la cantidad. Cómo se
                      compone (los dos porcentajes y sus importes) está en el detalle. */}
                  <td className="ta-r" style={{ fontWeight: 600, color: colUsd }}>
                    {fmt(calc.dtoTotal)}
                  </td>
                  {/* P. c/Dto. Total Aplicado: precio de lista − descuento total = lo que se cobra
                      por unidad. En dólares se mantiene en su moneda, con prefijo `$u` y en verde. */}
                  <td className="ta-r" style={{ fontWeight: 600, color: colUsd }}>
                    {fmt(calc.precioFinal)}
                  </td>
                  {/* Subtotal: precio final × cantidad, SIN IVA. Es el único valor de la fila que
                      escala con la cantidad. El IVA se liquida en el detalle y en el resumen. */}
                  <td className="ta-r" style={{ fontWeight: 700, color: colUsd }}>
                    {fmt(calc.subtotal)}
                  </td>
                  {/* La rentabilidad es la que queda después de bonificar. Ancho fijo: al
                      editar el descuento cambia de "99%" a "99,39%" y corría la fila entera. */}
                  <td
                    className="ta-c col-rent"
                    style={{ color: rentFila < 0 ? 'var(--red)' : 'var(--green-dark)', fontWeight: 700 }}
                  >
                    {pctDec(rentFila)}
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

                {abierta && (
                  <tr className="rexp">
                    <td colSpan={columnas} style={{ padding: 0 }}>
                      <div className="expd">
                        <LineaDetalle
                          fila={fila}
                          // El % de forma de pago sale de la proforma cuando la línea la trae (venta
                          // CON PROFORMA); si no, el de la operación.
                          descFormaPago={fila.descFormaPago ?? descFormaPago}
                          dtoPago={calc.dtoPago}
                          dtoPrecio={calc.dtoPrecio}
                          dtoTotal={calc.dtoTotal}
                          fmt={fmt}
                          onDescuento={onDescuento}
                        />
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
