import { useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { BuscadorProducto } from '@/features/productos/BuscadorProducto'
import { CargaLinea } from '@/features/productos/CargaLinea'
import { FiltrosProductos } from '@/features/productos/FiltrosProductos'
import { esBiologico, MOTIVO_BIOLOGICO } from '@/lib/devoluciones'
import { clienteLlevaIva } from '@/lib/precios'
import { useApp, useDispatch } from '@/state/hooks'
import type { Producto } from '@/types'

/**
 * Carga de los productos que el cliente devuelve. Es EXACTAMENTE el mismo buscador, los mismos
 * filtros de taxonomía y el mismo input de cantidad que Presupuestar, la venta Directa y el remito
 * POSTERIOR (`BuscadorProducto` + `FiltrosProductos` + `CargaLinea`): quien opera busca igual.
 *
 * La devolución es logística, no financiera —el precio lo define después la venta de cada remito
 * imputado, no la lista del cliente—, así que la línea se monta con `showFinancialData={false}` y
 * queda sólo la cantidad devuelta.
 *
 * Lo único propio es la VALIDACIÓN ESTRICTA de cadena de frío: un biológico no se carga. No se
 * bloquea el buscador ni se lo esconde de los resultados —el operador tiene que poder buscarlo y
 * entender por qué no se puede—, se lo frena al elegirlo, con el motivo.
 */
export function CargaProductoDevolucion() {
  const { cliente } = useApp()
  const dispatch = useDispatch()
  /* Sin conversión bimonetaria: la devolución no cotiza nada. El precio de la nota de crédito sale
     de la venta original, no de la lista de hoy. */
  const [seleccionado, setSeleccionado] = useState<Producto | null>(null)
  // Aviso de la búsqueda (sin resultados / error), mostrado donde iría el producto elegido.
  const [avisoBusqueda, setAvisoBusqueda] = useState('')
  // Producto rechazado por ser biológico: sostiene el cartel y abre la ventana con el motivo.
  const [rechazado, setRechazado] = useState<Producto | null>(null)

  const elegir = (p: Producto) => {
    if (esBiologico(p)) {
      /* El producto NO queda seleccionado: sin línea cargada no hay forma de agregarlo por error,
         ni siquiera si el cartel se cierra. */
      setSeleccionado(null)
      setRechazado(p)
      return
    }
    setRechazado(null)
    setSeleccionado(p)
  }

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
          onAviso={(a) => {
            setAvisoBusqueda(a)
            if (a) setRechazado(null)
          }}
        />
        <FiltrosProductos />
      </div>
      <CargaLinea
        key={seleccionado?.codigo ?? 'vacio'}
        producto={seleccionado}
        /* El rechazo por cadena de frío manda sobre el aviso de la búsqueda: es el motivo por el
           que el lugar del producto elegido quedó vacío. */
        aviso={rechazado ? `${rechazado.nombre}: ${MOTIVO_BIOLOGICO}` : avisoBusqueda}
        onAdd={agregar}
        showFinancialData={false}
        modoStock="ingreso"
      />

      {rechazado && (
        <AvisoModal titulo="Producto sin devolución posible" onClose={() => setRechazado(null)}>
          {MOTIVO_BIOLOGICO} «{rechazado.nombre}» ({rechazado.codigo}) está marcado como biológico
          en el catálogo, así que no se puede incluir en esta devolución.
        </AvisoModal>
      )}
    </div>
  )
}
