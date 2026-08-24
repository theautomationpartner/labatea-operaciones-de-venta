import { useEffect, useRef } from 'react'
import {
  getComisionesVenta,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getRentabForzada,
  getTasaCambioHoy,
  getTopesDescuento,
  getUsuarioActual,
  getVendedores,
  limpiarCachesConsultas,
} from '@/services/monday'
import { ModalErrorMonday } from '@/components/ui/ModalErrorMonday'
import { ModalErrorSeguridad } from '@/components/ui/ModalErrorSeguridad'
import { useErrorSeguridad } from '@/hooks/useErrorSeguridad'
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
  const { paso, operacion } = useApp()
  const dispatch = useDispatch()
  const scrollRef = useRef<HTMLDivElement>(null)
  const errorSeguridad = useErrorSeguridad()
  const Vista = VISTAS[paso]

  /* Al cambiar de operación (y al resetear) se vacían las cachés de consultas: cada operación
     re-consulta datos frescos (documentos del cliente y catálogos), en vez de arrastrar un
     resultado viejo. Dentro de una misma operación la caché se mantiene, así navegar con el stepper
     no vuelve a pegarle a la API. La operación cambia en el inicio, cuando ninguna vista de datos
     está montada, así que no hay carrera con sus consultas. */
  useEffect(() => {
    limpiarCachesConsultas()
  }, [operacion])
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
    /* Descuentos por pronto pago de cada medio de cobro ("Medios de Cobro"). Se traen SIEMPRE y
       una sola vez, como el resto de la configuración: son la única fuente de esos porcentajes.
       Antes se pedían recién al elegir un cliente de contado o cuenta corriente, y con cualquier
       otra condición la app se quedaba con una tabla de valores escrita a mano que coincidía con
       el tablero por casualidad. Ante un error quedan en 0: no se bonifica lo que no se pudo leer. */
    getDescuentosPago()
      .then((d) => vivo && dispatch({ type: 'setDescuentosPago', value: d }))
      .catch(() => {})
    /* Días de vencimiento del pago de la factura ("Dias de Vigencia Fact Vta"). Ante un error se
       conserva el valor de arranque, que es el mismo que hoy tiene el tablero. */
    getDiasVencimientoFactura()
      .then((dias) => vivo && dispatch({ type: 'setDiasVencFactura', value: dias }))
      .catch(() => {})
    /* Tasas de comisión del vendedor ("Comision por Venta"): una para la venta con presupuesto
       previo (Activa) y otra para la directa (Pasiva). Ante un error quedan en 0: la comisión no
       se muestra, pero la operación sigue. */
    getComisionesVenta()
      .then((c) => vivo && dispatch({ type: 'setComisiones', value: c }))
      .catch(() => {})
    /* Rentabilidad forzada por defecto ("Rentab Forzada" del tablero de config): precarga el input de
       la selección de productos. Ante un error queda en 0 (no se fuerza nada hasta que se cargue). */
    getRentabForzada()
      .then((v) => vivo && dispatch({ type: 'setRentabForzada', value: v }))
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

  return (
    <div className="scroll" ref={scrollRef}>
      <Vista />
      {/* Un solo aviso a la vez, y el de seguridad manda: el otro invita a reintentar, y un
          rechazo del borde no se arregla reintentando. */}
      {errorSeguridad ? (
        <ModalErrorSeguridad error={errorSeguridad} />
      ) : (
        <ModalErrorMonday />
      )}
    </div>
  )
}
