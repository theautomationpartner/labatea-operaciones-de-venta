import { useState } from 'react'
import { BuscadorProducto } from '@/features/productos/BuscadorProducto'
import { CargaLinea } from '@/features/productos/CargaLinea'
import { FiltrosProductos } from '@/features/productos/FiltrosProductos'
import { useCotizacionProducto } from '@/features/productos/useCotizacionProducto'
import { clienteLlevaIva } from '@/lib/precios'
import { useApp, useDispatch } from '@/state/hooks'

/**
 * Carga de productos del remito POSTERIOR desde el catálogo. Reutiliza EXACTAMENTE la misma
 * búsqueda y carga de línea que Presupuestar y la venta Directa (`BuscadorProducto` + `FiltrosProductos`
 * + `CargaLinea`), así el buscador, el desplegable, el autocompletado y la selección son idénticos.
 *
 * El remito es un documento logístico, no financiero: se monta con `showFinancialData={false}` para
 * ocultar precio, descuento y rentabilidad. Sólo queda la cantidad a entregar (más el nombre/código
 * del producto y su stock).
 */
export function CargaProductoRemito() {
  const { cliente } = useApp()
  const dispatch = useDispatch()
  // Selección con conversión bimonetaria (aunque el remito no muestre el precio, la conversión
  // aplica: el precio convertido alimenta el importe pendiente de facturar).
  const { seleccionado, setSeleccionado, elegir, convirtiendo } = useCotizacionProducto()
  // Aviso de la búsqueda (sin resultados / error), mostrado donde iría el producto elegido.
  const [avisoBusqueda, setAvisoBusqueda] = useState('')

  const agregar = (cantidad: number) => {
    if (!seleccionado) return
    dispatch({ type: 'addRemitoItemCatalogo', producto: seleccionado, cantidad })
    setSeleccionado(null)
    setAvisoBusqueda('')
  }

  return (
    <div className="card">
      <div className="search-area">
        <BuscadorProducto
          lista={cliente?.list ?? 'L1'}
          conIva={clienteLlevaIva(cliente?.status ?? '')}
          onSelect={elegir}
          variante="v2"
          onAviso={setAvisoBusqueda}
        />
        <FiltrosProductos />
      </div>
      <CargaLinea
        key={seleccionado?.codigo ?? 'vacio'}
        producto={seleccionado}
        aviso={avisoBusqueda}
        onAdd={agregar}
        showFinancialData={false}
        convirtiendo={convirtiendo}
      />
    </div>
  )
}
