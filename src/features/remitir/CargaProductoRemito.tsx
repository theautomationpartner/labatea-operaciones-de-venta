import { useState } from 'react'
import { BuscadorProducto } from '@/features/productos/BuscadorProducto'
import { StockPanel } from '@/features/productos/StockPanel'
import { clienteLlevaIva } from '@/lib/precios'
import { useApp, useDispatch } from '@/state/hooks'
import type { Producto } from '@/types'

/**
 * Misma mecánica de carga que venta/presupuesto —búsqueda + cantidad—, pero sin
 * precio ni descuento: el remito documenta cuánto se entrega, no cuánto se cobra.
 */
export function CargaProductoRemito() {
  const { cliente } = useApp()
  const dispatch = useDispatch()
  const [producto, setProducto] = useState<Producto | null>(null)
  const [cantidad, setCantidad] = useState(1)

  const cambiar = (delta: number) => setCantidad((c) => Math.max(1, c + delta))

  const agregar = () => {
    if (!producto) return
    dispatch({ type: 'addRemitoItemCatalogo', producto, cantidad })
    setProducto(null)
    setCantidad(1)
  }

  return (
    <div className="card card--input">
      <BuscadorProducto
        lista={cliente?.list ?? 'L1'}
        conIva={clienteLlevaIva(cliente?.status ?? '')}
        onSelect={setProducto}
      />

      <div className="carga">
        <div className="selrow">
          <div className="ig" style={{ flex: '0 0 450px' }}>
            <label>Producto seleccionado</label>
            <div className={`prodbox ${producto ? 'has' : ''}`}>
              {producto ? (
                <>
                  <span className="prodbox-code">{producto.codigo}</span>
                  <span className="prodbox-name">{producto.nombre}</span>
                </>
              ) : (
                <span>Realiza una búsqueda y selecciona un producto...</span>
              )}
            </div>
          </div>

          <div className="ig">
            <label htmlFor="rqty">Cantidad entregada</label>
            <div className="qty">
              <button type="button" onClick={() => cambiar(-1)} aria-label="Restar">
                -
              </button>
              <input
                id="rqty"
                type="number"
                min={1}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
              />
              <button type="button" onClick={() => cambiar(1)} aria-label="Sumar">
                +
              </button>
            </div>
          </div>

          <div className="ig">
            <label htmlFor="rum">Unidad de medida</label>
            <input
              id="rum"
              type="text"
              className="ctrl"
              style={{ width: 130, fontWeight: 600 }}
              value={producto?.um ?? ''}
              placeholder="—"
              readOnly
            />
          </div>

          <div className="ig">
            <button
              type="button"
              className="btn btn-primary btn--h38"
              disabled={!producto}
              onClick={agregar}
            >
              <i className="fas fa-plus" /> Agregar
            </button>
          </div>
        </div>

        {producto && (
          <div className="stockprev">
            <StockPanel producto={producto} cantidad={cantidad} />
          </div>
        )}
      </div>
    </div>
  )
}
