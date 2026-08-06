import type { ReactNode } from 'react'
import { pctDec } from '@/lib/format'

interface DetalleDescuentosProps {
  /** % de descuento de la forma de pago de la operación (0 cuando no aplica). */
  descFormaPago: number
  /** Descuento por forma de pago, en $ por unidad. */
  dtoPago: number
  /** % de descuento manual del vendedor. Se muestra si no hay `editorManual`. */
  descuentoManual: number
  /** Descuento manual por precio, en $ por unidad (sobre el precio ya rebajado). */
  dtoPrecio: number
  /** Suma de los dos anteriores: lo descontado por unidad. */
  dtoTotal: number
  /** Formato de importes: pesos, o dólares en el presupuesto bimonetario. */
  fmt: (n: number) => string
  /**
   * Control para editar el % manual desde acá (la fila desplegable de la tabla lo usa). Sin él,
   * el % va como chip de lectura: es el caso de la carga de producto, donde el campo editable
   * vive en la fila de inputs de arriba.
   */
  editorManual?: ReactNode
}

/**
 * "Detalle": cómo se compone el descuento de UNA unidad. Los dos orígenes con su % y su importe,
 * y el total consolidado. Lo comparten la fila desplegable de la tabla y la carga de producto,
 * así el desglose se lee igual en los dos lugares.
 */
export function DetalleDescuentos({
  descFormaPago,
  dtoPago,
  descuentoManual,
  dtoPrecio,
  dtoTotal,
  fmt,
  editorManual,
}: DetalleDescuentosProps) {
  return (
    <section className="lindet-fin">
      <h4 className="lindet-h">
        <i className="fas fa-file-invoice-dollar lindet-h-ic" /> Detalle
      </h4>
      <div className="lindet-rows">
        {/* Descuento por pronto pago: el % lo define la forma de pago elegida en la operación. */}
        <div className="lindet-row">
          <span className="lindet-lbl">Dto. Forma de Pago</span>
          <span className="lindet-mid">
            <span className="lindet-pct">{pctDec(descFormaPago)}</span>
          </span>
          <span className="lindet-val">{fmt(dtoPago)}</span>
        </div>

        {/* Descuento por precio: el % lo pone el vendedor a mano. */}
        <div className="lindet-row">
          <span className="lindet-lbl">Dto. por Precio</span>
          <span className="lindet-mid">
            {editorManual ?? <span className="lindet-pct">{pctDec(descuentoManual)}</span>}
          </span>
          <span className="lindet-val">{fmt(dtoPrecio)}</span>
        </div>

        <div className="lindet-sep" />

        {/* Cierra el bloque: el IVA no va acá, se liquida en el resumen de la operación. */}
        <div className="lindet-row lindet-row--fuerte">
          <span className="lindet-lbl">Descuento Total</span>
          <span className="lindet-mid" />
          <span className="lindet-val">{fmt(dtoTotal)}</span>
        </div>
      </div>
    </section>
  )
}
