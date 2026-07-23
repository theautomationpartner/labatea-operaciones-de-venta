import { useEffect, useRef } from 'react'
import { pagoSimultaneo } from '@/lib/cobros'
import { getDescuentosPago, getDiasVigencia, getTopesDescuento } from '@/services/monday'
import { ClienteView } from '@/features/cliente/ClienteView'
import { EmisionView } from '@/features/emision/EmisionView'
import { InicioView } from '@/features/inicio/InicioView'
import { CobroView } from '@/features/cobro/CobroView'
import { FacturaView } from '@/features/factura/FacturaView'
import { ProductosView } from '@/features/productos/ProductosView'
import { RemitoView } from '@/features/remito/RemitoView'
import { RemitoEmisionView } from '@/features/remitir/RemitoEmisionView'
import { RemitoEnvioView } from '@/features/remitir/RemitoEnvioView'
import { RemitoProductosView } from '@/features/remitir/RemitoProductosView'
import { VentaView } from '@/features/venta/VentaView'
import { useApp, useDispatch } from '@/state/hooks'
import type { Paso } from '@/types'

const VISTAS: Record<Paso, () => JSX.Element | null> = {
  inicio: InicioView,
  cliente: ClienteView,
  productos: ProductosView,
  emision: EmisionView,
  venta: VentaView,
  remito: RemitoView,
  cobro: CobroView,
  factura: FacturaView,
  'remito-productos': RemitoProductosView,
  'remito-envio': RemitoEnvioView,
  'remito-emision': RemitoEmisionView,
}

export function App() {
  const { paso, cliente } = useApp()
  const dispatch = useDispatch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const Vista = VISTAS[paso]
  // El cobro simultáneo es el único camino que aplica descuentos por forma de pago.
  const clienteId = cliente?.id ?? null
  const clienteCobraSimultaneo = cliente ? pagoSimultaneo(cliente) : false

  // Cada paso arranca desde arriba, como en una navegación real.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [paso])

  // Configuración del sistema (vigencia y topes de descuento): se lee una vez, al arrancar.
  useEffect(() => {
    let vivo = true
    getDiasVigencia()
      .then((dias) => vivo && dispatch({ type: 'setDiasVigencia', value: dias }))
      .catch(() => {})
    getTopesDescuento()
      .then((topes) => vivo && dispatch({ type: 'setTopesDescuento', value: topes }))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [dispatch])

  /* Los descuentos por forma de pago se releen en cada venta que se vaya a cobrar en el acto:
     los define el tablero de configuración y pueden haber cambiado desde el arranque. Se
     dispara al quedar elegido el cliente (paso 1), así llegan cargados al cierre (paso 3). */
  useEffect(() => {
    if (!clienteCobraSimultaneo) return
    let vivo = true
    getDescuentosPago()
      .then((descuentos) => vivo && dispatch({ type: 'setDescuentosPago', value: descuentos }))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [clienteCobraSimultaneo, clienteId, dispatch])

  return (
    <div className="scroll" ref={scrollRef}>
      <Vista />
    </div>
  )
}
