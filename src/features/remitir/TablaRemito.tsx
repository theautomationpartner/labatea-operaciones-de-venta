import { Fragment, useState } from 'react'
import { ProveedorLinea, StockPanel, type ModoStock } from '@/features/productos/StockPanel'
import { money, round2 } from '@/lib/format'
import {
  AVANCE_COLOR,
  ESTADO_RESULTANTE_COMPLETO,
  estadoResultante,
  pendienteResultante,
} from '@/lib/selectors'
import type { RemitoItem } from '@/types'

interface TablaRemitoProps {
  items: RemitoItem[]
  onCantidad: (uid: string, cantidad: number) => void
  onRemove: (uid: string) => void
  /**
   * Remito POSTERIOR: además de las cantidades, muestra el precio unitario, el total por producto
   * (cantidad × precio) y, debajo, el importe pendiente de facturar. El remito ANTERIOR es un
   * documento de sólo cantidades y no expone importes.
   */
  mostrarImporte?: boolean
  /**
   * Remito ANTERIOR: agrega cómo queda la línea de la venta después de esta entrega —cuántas
   * unidades le siguen quedando pendientes y en qué estado—. En POSTERIOR no aplica: la mercadería
   * sale del catálogo y no hay un pendiente contra el cual medir.
   */
  mostrarResultante?: boolean
  /** Post-emisión: la tabla pasa a SOLO LECTURA (cantidades no editables, sin quitar líneas). */
  soloLectura?: boolean
  /**
   * Piso de la cantidad de una línea ya confirmada. 1 en el remito ANTERIOR (la línea sale de lo
   * pendiente de una venta: entregar cero unidades no es una entrega, se quita con la papelera);
   * 0 en el POSTERIOR, donde la mercadería viene del catálogo. El reducer aplica el mismo piso.
   */
  cantidadMin?: number
  /**
   * Rótulos de la tabla. Por defecto habla de REMITAR, que es lo que hace en los dos tipos de
   * emisión; la DEVOLUCION los cambia porque ahí la mercadería vuelve y nadie entrega nada.
   */
  titulo?: string
  colCantidad?: string
  vacio?: string
  /**
   * Cada línea se puede desplegar para ver el stock de su producto. Lo usa la DEVOLUCION, donde la
   * cantidad ENTRA al stock y conviene poder volver a mirar los ingresos sin rehacer la búsqueda.
   * Sólo aplica a las líneas que traen su ficha de catálogo (ver `RemitoItem.producto`).
   */
  mostrarStock?: boolean
  /** Sentido en que la cantidad de la línea mueve el stock. La devolución la hace ENTRAR. */
  modoStock?: ModoStock
}

/** Total de la línea: cantidad a entregar × precio unitario. */
const totalLinea = (it: RemitoItem): number => round2(it.cantidad * (it.precioUnitario ?? 0))

/**
 * Líneas a remitar. En ANTERIOR es un documento de cantidades (código, producto, cantidad y u.m.).
 * En POSTERIOR, además, muestra precio unitario, total por producto y el importe pendiente de
 * facturar, que es la suma de todos los totales.
 */
export function TablaRemito({
  items,
  onCantidad,
  onRemove,
  mostrarImporte = false,
  mostrarResultante = false,
  soloLectura = false,
  cantidadMin = 0,
  titulo = 'Productos a remitar',
  colCantidad = 'Cantidad a entregar',
  vacio = 'Todavía no cargaste productos para remitar.',
  mostrarStock = false,
  modoStock = 'consumo',
}: TablaRemitoProps) {
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(new Set())
  const toggle = (uid: string) =>
    setExpandidas((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })

  /* Base: 6 columnas. Los importes (POSTERIOR) suman 2 y el resultante (ANTERIOR) otras 2;
     el desplegable del stock suma la suya, y sin la de acciones (sólo lectura) se resta una. */
  const colSpanVacio =
    6 +
    (mostrarImporte ? 2 : 0) +
    (mostrarResultante ? 2 : 0) +
    (mostrarStock ? 1 : 0) -
    (soloLectura ? 1 : 0)
  const importePendFacturar = round2(items.reduce((acc, it) => acc + totalLinea(it), 0))

  const tabla = (
    <div className="tablec">
      <div className="thtitle">
        {titulo} ({items.length})
      </div>
      <table>
        <thead>
          <tr>
            {mostrarStock && <th style={{ width: 40 }} />}
            <th style={{ width: 20 }} />
            <th colSpan={2}>Producto</th>
            <th className="ta-c">{colCantidad}</th>
            <th className="ta-c">Unidad de medida</th>
            {mostrarResultante && <th className="ta-c">Cant. Pend. de entregar Resultante</th>}
            {mostrarResultante && <th className="ta-c">Estado Resultante</th>}
            {mostrarImporte && <th className="ta-c">Precio unitario</th>}
            {mostrarImporte && <th className="ta-c">Total por producto</th>}
            {!soloLectura && <th className="ta-c">Acc.</th>}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={colSpanVacio} className="tablec-empty">
                {vacio}
              </td>
            </tr>
          )}
          {items.map((it, i) => {
            const tope = it.max
            const excede = tope !== undefined && it.cantidad > tope
            /* Cómo queda la línea de la venta con esta entrega. Se deriva en el render, así que
               sigue en vivo cada tecla del input de cantidad. */
            const resultante = pendienteResultante(tope ?? 0, it.cantidad)
            const estado = estadoResultante(resultante)
            /* Sólo se despliega lo que tiene ficha de catálogo: sin ella no hay stock que mostrar
               y una flecha que no abre nada es peor que no tenerla. */
            const conStock = mostrarStock && it.producto != null
            const abierta = conStock && expandidas.has(it.uid)
            return (
              <Fragment key={it.uid}>
              <tr>
                {mostrarStock && (
                  <td style={{ width: 40 }}>
                    {conStock && (
                      <i
                        className={`fas fa-chevron-right chev ${abierta ? 'open' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Ver el stock de ${it.nombre}`}
                        aria-expanded={abierta}
                        onClick={() => toggle(it.uid)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggle(it.uid)
                          }
                        }}
                      />
                    )}
                  </td>
                )}
                <td style={{ width: 20, color: 'var(--text-gray)', fontWeight: 600 }}>{i + 1}</td>
                <td style={{ width: 90 }}>
                  <span style={{ color: 'var(--primary-blue)', fontWeight: 700 }}>{it.codigo}</span>
                </td>
                <td style={{ fontWeight: 600 }}>{it.nombre}</td>

                <td className="ta-c" style={{ fontWeight: 600 }}>
                  {soloLectura ? (
                    it.cantidad
                  ) : (
                    <span className={`qbox ${excede ? 'qbox--error' : ''}`}>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${colCantidad} de ${it.nombre}`}
                        aria-invalid={excede}
                        title={excede ? `No se puede remitar más de ${tope} pendientes` : ''}
                        value={it.cantidad}
                        onChange={(e) =>
                          onCantidad(it.uid, Number(e.target.value.replace(/\D/g, '')) || 0)
                        }
                      />
                      <span className="qbtns">
                        <button
                          type="button"
                          aria-label={`Sumar una unidad de ${it.nombre}`}
                          disabled={tope !== undefined && it.cantidad >= tope}
                          onClick={() => onCantidad(it.uid, it.cantidad + 1)}
                        >
                          <i className="fas fa-angle-up" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Restar una unidad de ${it.nombre}`}
                          disabled={it.cantidad <= cantidadMin}
                          onClick={() => onCantidad(it.uid, it.cantidad - 1)}
                        >
                          <i className="fas fa-angle-down" />
                        </button>
                      </span>
                    </span>
                  )}
                </td>

                <td className="ta-c" style={{ fontWeight: 600 }}>
                  {it.um}
                </td>

                {mostrarResultante && (
                  <td className="ta-c" style={{ fontWeight: 700 }}>
                    {resultante}
                  </td>
                )}
                {mostrarResultante && (
                  <td className="ta-c" style={{ fontWeight: 600 }}>
                    {estado ? (
                      <span
                        style={{
                          color:
                            estado === ESTADO_RESULTANTE_COMPLETO
                              ? AVANCE_COLOR.completo
                              : AVANCE_COLOR.parcial,
                        }}
                      >
                        {estado}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                )}

                {mostrarImporte && <td className="ta-c">{money(it.precioUnitario ?? 0)}</td>}
                {mostrarImporte && (
                  <td className="ta-c" style={{ fontWeight: 700 }}>
                    {money(totalLinea(it))}
                  </td>
                )}

                {!soloLectura && (
                  <td className="ta-c">
                    <i
                      className="far fa-trash-alt trash"
                      role="button"
                      aria-label={`Quitar ${it.nombre}`}
                      onClick={() => onRemove(it.uid)}
                    />
                  </td>
                )}
              </tr>

              {/* Mismo desplegable que la tabla de productos: la ficha de stock del producto, con
                  la cantidad de ESTA línea, para poder mirar los ingresos sin rehacer la búsqueda. */}
              {abierta && it.producto && (
                <tr className="rexp">
                  <td colSpan={colSpanVacio} style={{ padding: 0 }}>
                    <div className="expd">
                      <section className="lindet-stock">
                        <div className="lindet-hrow">
                          <h4 className="lindet-h">
                            <i className="fas fa-cube lindet-h-ic" /> Stock
                          </h4>
                          <ProveedorLinea producto={it.producto} />
                        </div>
                        <StockPanel
                          producto={it.producto}
                          cantidad={it.cantidad}
                          conProveedor={false}
                          modo={modoStock}
                        />
                      </section>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      {tabla}

      {/* Resumen financiero del remito POSTERIOR: misma tarjeta de importes que el resto de la app
          (Subtotal + total destacado), ubicada a la izquierda. */}
      {mostrarImporte && items.length > 0 && (
        <div className="remito-importe-wrap">
          <div className="kpi-card">
            <div className="subtotal-lines">
              <div className="sub-row">
                <span>Subtotal</span>
                <span>{money(importePendFacturar)}</span>
              </div>
              <div className="total-row">
                <span>IMPORTE PEND DE FACTURAR</span>
                <span>{money(importePendFacturar)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
