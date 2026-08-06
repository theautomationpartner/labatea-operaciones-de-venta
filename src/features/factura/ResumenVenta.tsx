import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { money } from '@/lib/format'
import { useApp, useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

interface ResumenVentaProps {
  cliente: Cliente
  /** Productos vendidos, contando las líneas de la venta. */
  cantidadProductos: number
  /** Comprobantes que salieron de evaluar la mercadería. */
  cantidadFacturas: number
  /** Total (en pesos) que se va a facturar: la suma de los comprobantes de la operación. */
  totalAFacturar: number
  /** Comisión del vendedor por esta venta, en pesos. Es la misma que se registra en el board. */
  comision: number
  /** Comprobantes ya escritos en el board: con alguno, no se vuelve a emitir. */
  emitidos: number
  emitiendo: boolean
  onEmitir: () => void
}

interface FilaProps {
  label: string
  /** Campo que viaja al comprobante: se marca con asterisco. */
  requerido?: boolean
  tono?: 'verde' | 'total'
  children: ReactNode
}

function Fila({ label, requerido = true, tono, children }: FilaProps) {
  const clase = tono === 'total' ? 'rvalue--total' : tono === 'verde' ? 'rvalue--green' : ''
  return (
    <div className="rrow">
      <span className="rlabel">
        {label}
        {requerido && <span className="rreq">*</span>}
      </span>
      <span className={`rvalue ${clase}`}>{children}</span>
    </div>
  )
}

/** El cliente no es agente de retención, o el board no lo tiene cargado. */
const sinRetencion = (ret: string) => !ret.trim() || /^ninguna$/i.test(ret.trim())

/**
 * Resumen de la venta antes de facturarla. Misma ficha que el resumen del presupuesto —mismos
 * grupos, mismos rótulos, mismo botón al pie— pero con los datos de la venta.
 *
 * El botón dice cuántos comprobantes se van a emitir, que es el resultado de evaluar la
 * mercadería: uno para la común y uno por cada proveedor de mercadería consignada.
 */
export function ResumenVenta({
  cliente,
  cantidadProductos,
  cantidadFacturas,
  totalAFacturar,
  comision,
  emitidos,
  emitiendo,
  onEmitir,
}: ResumenVentaProps) {
  const { vendedor, fechaEmision, factura } = useApp()
  const dispatch = useDispatch()
  const yaEmitido = emitidos > 0
  const rotuloFacturas = cantidadFacturas === 1 ? 'una factura' : `${cantidadFacturas} facturas`

  return (
    <div className="card card--flush resumen-venta">
      <h3 className="resumen-title">Resumen de la venta</h3>

      <div className="rgroup">
        <Fila label="Vendedor asignado">
          {vendedor && (
            <>
              <Avatar ini={vendedor.ini} color={vendedor.color} size="sm" /> {vendedor.name}
            </>
          )}
        </Fila>
        <Fila label="Razón social">{cliente.name}</Fila>
        <Fila label="CUIT/CUIL">{cliente.cuit || '--'}</Fila>
        <Fila label="Lista de precio">{cliente.list ?? '--'}</Fila>
        {/* Sólo si el cliente tiene retenciones cargadas: si no, el campo ni aparece. */}
        {!sinRetencion(cliente.ret) && (
          <Fila label="Agente de retención">{cliente.ret}</Fila>
        )}
      </div>

      <hr className="rsep" />

      <div className="rgroup">
        <Fila label="Cantidad de productos">{cantidadProductos}</Fila>
        <Fila label="Moneda">
          {factura.moneda === 'Dólares (USD)' ? 'Dólares (USD)' : 'Pesos (ARS)'}
        </Fila>
        <Fila label="Fecha de cierre" requerido={false}>
          {fechaEmision}
        </Fila>
        {/* Total (en pesos) que se va a facturar en esta operación: destacado. */}
        <Fila label="Total a Facturar" requerido={false} tono="total">
          {money(totalAFacturar)}
        </Fila>
      </div>

      {/* Comisión del vendedor por esta venta: cierra los números de la operación, antes de las
          observaciones. Es el mismo importe que se registra en "💲Registro de Comisiones". */}
      <div className="rgroup resumen-comision">
        <Fila label="Comision x Venta" requerido={false} tono="verde">
          {money(comision)}
        </Fila>
      </div>

      <div className="igp resumen-obs">
        <label htmlFor="fact-obs">Observaciones</label>
        <textarea
          id="fact-obs"
          className="full cobro-obs"
          placeholder="Ej.: Venta de mercadería según remito."
          value={factura.observaciones}
          disabled={yaEmitido || emitiendo}
          onChange={(e) => dispatch({ type: 'setFactura', patch: { observaciones: e.target.value } })}
        />
      </div>

      {/* Con comprobantes ya creados no se vuelve a emitir: se duplicarían los ítems. */}
      <button
        type="button"
        className="btn-generar"
        disabled={emitiendo || yaEmitido || cantidadFacturas === 0}
        aria-busy={emitiendo}
        onClick={onEmitir}
        // Emitido: el botón pasa a verde para confirmar, como el de "Enviado".
        style={yaEmitido ? { backgroundColor: 'var(--green)', color: '#fff' } : undefined}
      >
        {emitiendo ? (
          <>
            <i className="fas fa-circle-notch spin" /> Emitiendo...
          </>
        ) : yaEmitido ? (
          <>
            <i className="fas fa-check" /> {emitidos === 1 ? 'Factura emitida' : 'Facturas emitidas'}
          </>
        ) : (
          <>
            <i className="far fa-file-lines" /> Emitir {rotuloFacturas}
          </>
        )}
      </button>
    </div>
  )
}
