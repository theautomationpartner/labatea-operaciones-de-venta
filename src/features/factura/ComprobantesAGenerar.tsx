import { useState } from 'react'
import { TotalesDoc } from '@/features/shared/TotalesDoc'
import { addDays } from '@/lib/dates'
import { bonifLinea, netoLinea, type ComprobanteAGenerar } from '@/lib/facturacion'
import { money } from '@/lib/format'
import type { ComprobanteEmitido, LetraComprobante } from '@/types'

interface ComprobantesAGenerarProps {
  comprobantes: ComprobanteAGenerar[]
  /** Descuento por forma de pago de la operación, en %: compone el importe bonificado de cada línea. */
  descFormaPago: number
  /** Letra del comprobante, derivada de la condición fiscal del cliente. */
  letra: LetraComprobante
  /** Punto de venta con el que se emiten. */
  puntoVenta: string
  /** Fecha de emisión en dd/MM/yyyy: de ella se cuentan los días de vencimiento. */
  fechaEmision: string
  /**
   * La factura vence a plazo (cuenta corriente). Con `false` no hay días ni fecha: se cobra
   * al emitirse.
   */
  venceAPlazo: boolean
  /** Días de vencimiento por comprobante (fijos, sólo lectura). */
  dias: Record<string, number>
  /** Comprobantes ya escritos en el board, por la clave del grupo que los originó. */
  emitidos: Map<string, ComprobanteEmitido>
  emitiendo: boolean
}

/** Métrica de la cabecera: rótulo chico arriba y el dato debajo. */
function Dato({ rotulo, children, fuerte }: { rotulo: string; children: React.ReactNode; fuerte?: boolean }) {
  return (
    <div className="comp-head-dato">
      <span className="comp-head-lbl">{rotulo}</span>
      <span className={`comp-head-val ${fuerte ? 'comp-head-val--imp' : ''}`}>{children}</span>
    </div>
  )
}

/**
 * Un comprobante: cabecera siempre visible con la letra, el proveedor —si es consignada—, los
 * productos, el punto de venta y el importe; y el detalle plegable con sus líneas, el
 * vencimiento y los totales.
 */
function CardComprobante({
  comprobante,
  descFormaPago,
  letra,
  puntoVenta,
  fechaEmision,
  venceAPlazo,
  dias,
  emitido,
  emitiendo,
}: {
  comprobante: ComprobanteAGenerar
  descFormaPago: number
  letra: LetraComprobante
  puntoVenta: string
  fechaEmision: string
  venceAPlazo: boolean
  dias: number
  emitido?: ComprobanteEmitido
  emitiendo: boolean
}) {
  const [abierta, setAbierta] = useState(true)
  const consignada = comprobante.tipo === 'CONSIGNADA'
  // Sin cabecera creada o con líneas faltantes, el comprobante no se da por emitido.
  const completo = Boolean(emitido?.id) && emitido!.lineasCreadas >= emitido!.lineasEsperadas
  const incompleto = Boolean(emitido) && !completo

  return (
    <div className={`comp-card ${consignada ? 'comp-card--co' : ''}`}>
      <div className="comp-head">
        <button
          type="button"
          className="comp-toggle"
          aria-expanded={abierta}
          onClick={() => setAbierta((v) => !v)}
        >
          <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
          <span className="comp-tit">
            Factura {letra}
            <span className={`pbadge ${consignada ? 'parc' : 'disp'}`}>
              {consignada ? 'Consignada' : 'Común'}
            </span>
            {consignada && <span className="comp-prov">{comprobante.proveedorNombre}</span>}
          </span>
        </button>

        <div className="comp-head-datos">
          <Dato rotulo="Productos">{comprobante.lineas.length}</Dato>
          <Dato rotulo="Pto de venta">{puntoVenta}</Dato>
          <Dato rotulo="Importe a facturar" fuerte>
            {money(comprobante.total)}
          </Dato>
        </div>

        {/* Se tilda cuando el comprobante terminó de escribirse en el board. */}
        <span className="comp-estado">
          {emitiendo && !emitido && <span className="comp-estado-txt">Emitiendo…</span>}
          {completo && <span className="comp-estado-txt comp-estado-txt--ok">Emitida</span>}
          {incompleto && (
            <span className="comp-estado-txt comp-estado-txt--err">
              {emitido!.lineasCreadas}/{emitido!.lineasEsperadas} líneas
            </span>
          )}
          <span
            className={`cobro-ok ${completo ? 'on' : ''} ${incompleto ? 'comp-ok--err' : ''}`}
            title={completo ? `Emitida · ${emitido!.id}` : 'Pendiente de emisión'}
          >
            <i className={`fas ${incompleto ? 'fa-triangle-exclamation' : 'fa-check'}`} />
          </span>
        </span>
      </div>

      {abierta && (
        <div className="comp-body">
          <table className="comp-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="ta-c">Cant.</th>
                <th className="ta-c">U.Medida</th>
                <th className="ta-r">Unitario</th>
                <th className="ta-r">Imp.Bonif</th>
                <th className="ta-r">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {comprobante.lineas.map((l, i) => (
                <tr key={`${comprobante.clave}-${l.codigo || l.nombre}-${i}`}>
                  <td>
                    {l.codigo && <span className="comp-cod">{l.codigo}</span>}
                    <span className="comp-nom">{l.nombre}</span>
                  </td>
                  <td className="ta-c">{l.cantidad}</td>
                  {/* Unidad de venta del producto, resuelta en el origen de la línea. */}
                  <td className="ta-c">{l.um?.trim() || '—'}</td>
                  {/* Precio unitario de LISTA: sin ningún descuento aplicado. */}
                  <td className="ta-r">{money(l.precioUnitario)}</td>
                  {/* Importe bonificado de la línea: descuento total por unidad × cantidad. */}
                  <td className="ta-r">{money(bonifLinea(l, descFormaPago))}</td>
                  {/* Subtotal: el mismo de la selección de productos —precio con descuento ×
                      cantidad, sin IVA—. Es lo que la fórmula del board deja en "Subtotal $". */}
                  <td className="ta-r comp-total-prod">{money(netoLinea(l, descFormaPago))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="comp-pie">
            {/* Vencimiento SÓLO cuando la forma de pago es CUENTA CORRIENTE: el plazo es fijo
                (el del tablero de configuración) y de sólo lectura. En cualquier otra forma la factura
                se cobra al emitirse: se muestra "Pago contado", sin fecha de vencimiento. */}
            <div className="comp-venc">
              {venceAPlazo ? (
                <>
                  <span className="comp-head-lbl">Vencimiento del pago</span>
                  <div className="comp-venc-campo">
                    <span className="comp-venc-fecha">{dias} días</span>
                    <span className="comp-venc-fecha">
                      <i className="fas fa-arrow-right" /> {addDays(fechaEmision, dias)}
                    </span>
                  </div>
                  <span className="comp-venc-nota">Fijo en {dias} días desde la emisión.</span>
                </>
              ) : (
                <span className="comp-head-lbl">Pago contado</span>
              )}
            </div>

            {/* Totales estándar (mismas clases/posición que proforma y presupuesto), con los
                mismos números que el resumen de la selección de productos: el "Subtotal" es el
                bruto sin bonificar, el "Descuento" la suma de la columna Imp.Bonif y el "Gravado"
                la resta de los dos. */}
            <TotalesDoc
              subtotal={comprobante.bruto}
              descuento={comprobante.descuento}
              gravado={comprobante.subtotal}
              iva={comprobante.iva}
              total={comprobante.total}
            />
          </div>

          {/* Lo consignado se factura por cuenta y orden de quien es dueño de la mercadería. */}
          {consignada && (
            <p className="comp-leyenda">
              <i className="fas fa-circle-info" /> Venta por cuenta y orden del proveedor{' '}
              <strong>{comprobante.proveedorNombre}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Los comprobantes en los que se parte la venta: uno para la mercadería común y uno por cada
 * proveedor de mercadería consignada. Cada uno se pliega, y muestra en la cabecera lo que hace
 * falta para decidir: qué factura es, de quién es la mercadería, cuántos productos lleva, con
 * qué punto de venta sale y cuánto se factura.
 */
export function ComprobantesAGenerar({
  comprobantes,
  descFormaPago,
  letra,
  puntoVenta,
  fechaEmision,
  venceAPlazo,
  dias,
  emitidos,
  emitiendo,
}: ComprobantesAGenerarProps) {
  return (
    <div className="comprobantes">
      <div className="comprobantes-head">
        <h3 className="resumen-title">
          {comprobantes.length === 1
            ? 'Comprobante a generar'
            : `Comprobantes a generar (${comprobantes.length})`}
        </h3>
      </div>

      {comprobantes.length === 0 && (
        <div className="card card--flush comp-vacio">La venta no tiene productos para facturar.</div>
      )}

      {comprobantes.map((c) => (
        <CardComprobante
          key={c.clave}
          comprobante={c}
          descFormaPago={descFormaPago}
          letra={letra}
          puntoVenta={puntoVenta}
          fechaEmision={fechaEmision}
          venceAPlazo={venceAPlazo}
          dias={dias[c.clave] ?? 0}
          emitido={emitidos.get(c.clave)}
          emitiendo={emitiendo}
        />
      ))}
    </div>
  )
}
