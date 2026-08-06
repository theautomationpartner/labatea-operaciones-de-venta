import { useEffect, useRef } from 'react'
import {
  getComisionesVenta,
  getDescuentosPago,
  getDiasVigencia,
  getTasaCambioHoy,
  getTopesDescuento,
  getUsuarioActual,
  getVendedores,
  limpiarCachesConsultas,
} from '@/services/monday'
import { ClienteView } from '@/features/cliente/ClienteView'
import { EmisionView } from '@/features/emision/EmisionView'
import { InicioView } from '@/features/inicio/InicioView'
import { CobroView } from '@/features/cobro/CobroView'
import { EntregaView } from '@/features/cobro/EntregaView'
import { FacturaView } from '@/features/factura/FacturaView'
import { ProductosView } from '@/features/productos/ProductosView'
import { RemitoView } from '@/features/remito/RemitoView'
import { RemitoEmisionView } from '@/features/remitir/RemitoEmisionView'
import { RemitoEnvioView } from '@/features/remitir/RemitoEnvioView'
import { RemitoProductosView } from '@/features/remitir/RemitoProductosView'
import { VentaView } from '@/features/venta/VentaView'
import { VentaProformaView } from '@/features/venta/VentaProformaView'
import { useApp, useDispatch } from '@/state/hooks'
import type { Paso } from '@/types'

const VISTAS: Record<Paso, () => JSX.Element | null> = {
  inicio: InicioView,
  cliente: ClienteView,
  productos: ProductosView,
  emision: EmisionView,
  venta: VentaView,
  'venta-proforma': VentaProformaView,
  remito: RemitoView,
  cobro: CobroView,
  entrega: EntregaView,
  factura: FacturaView,
  'remito-productos': RemitoProductosView,
  'remito-envio': RemitoEnvioView,
  'remito-emision': RemitoEmisionView,
}

export function App() {
  const { paso, cliente, operacion } = useApp()
  const dispatch = useDispatch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const Vista = VISTAS[paso]

  /* Al cambiar de operación (y al resetear) se vacían las cachés de consultas: cada operación
     re-consulta datos frescos (documentos del cliente y catálogos), en vez de arrastrar un
     resultado viejo. Dentro de una misma operación la caché se mantiene, así navegar con el stepper
     no vuelve a pegarle a la API. La operación cambia en el inicio, cuando ninguna vista de datos
     está montada, así que no hay carrera con sus consultas. */
  useEffect(() => {
    limpiarCachesConsultas()
  }, [operacion])
  /* El cobro simultáneo es el único camino que aplica descuentos por forma de pago. Puede
     llegar por dos lados: el cliente de contado, o el de cuenta corriente que en el cierre
     elige cobrar en el acto ("SI"). Esa elección se toma en el paso 3, así que los descuentos
     se traen para los dos casos: si no, el cobro en el acto se cargaría sin ellos. */
  const clienteId = cliente?.id ?? null
  const clientePuedeCobrarEnElActo =
    cliente?.condicionPago === 'CONTADO' || cliente?.condicionPago === 'CUENTA CORRIENTE'

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
    /* Tasas de comisión del vendedor ("Comision por Venta"): una para la venta con presupuesto
       previo (Activa) y otra para la directa (Pasiva). Ante un error quedan en 0: la comisión no
       se muestra, pero la operación sigue. */
    getComisionesVenta()
      .then((c) => vivo && dispatch({ type: 'setComisiones', value: c }))
      .catch(() => {})
    /* Vendedores del equipo "Vendedores" (Monday): pueblan el selector de vendedor. Se piden una
       sola vez, al montar la app. Ante un error se deja la lista vacía (y el selector deja de
       estar "Cargando…") para no bloquear la operación. */
    getVendedores()
      .then((vs) => vivo && dispatch({ type: 'setVendedores', vendedores: vs }))
      .catch(() => vivo && dispatch({ type: 'setVendedores', vendedores: [] }))
    /* Usuario logueado en Monday (query `me`): define el vendedor por defecto y los permisos del
       selector (RBAC). Ante un error queda sin sesión (no bloquea el selector). */
    getUsuarioActual()
      .then((u) => vivo && dispatch({ type: 'setUsuarioActual', usuario: u }))
      .catch(() => vivo && dispatch({ type: 'setUsuarioActual', usuario: null }))
    /* Tasa de cambio del dólar de HOY: se lee del board de Cotizaciones al iniciar y se guarda en
       el estado global. Es el valor que se usa para convertir precios en dólares y como auditoría
       en la venta. Ante un error queda en null (la UI lo refleja). */
    getTasaCambioHoy()
      .then((tasa) => vivo && dispatch({ type: 'setTasaCambio', value: tasa }))
      .catch(() => vivo && dispatch({ type: 'setTasaCambio', value: null }))
    return () => {
      vivo = false
    }
  }, [dispatch])

  /* Los descuentos por forma de pago se releen en cada venta que se vaya a cobrar en el acto:
     los define el tablero de configuración y pueden haber cambiado desde el arranque. Se
     dispara al quedar elegido el cliente (paso 1), así llegan cargados al cierre (paso 3). */
  useEffect(() => {
    if (!clientePuedeCobrarEnElActo) return
    let vivo = true
    getDescuentosPago()
      .then((descuentos) => vivo && dispatch({ type: 'setDescuentosPago', value: descuentos }))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [clientePuedeCobrarEnElActo, clienteId, dispatch])

  return (
    <div className="scroll" ref={scrollRef}>
      <Vista />
    </div>
  )
}
