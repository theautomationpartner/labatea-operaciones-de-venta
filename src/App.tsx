import { useEffect, useRef, useState } from 'react'
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
import { ModalCargando } from '@/components/ui/ModalCargando'
import { ModalErrorMonday } from '@/components/ui/ModalErrorMonday'
import { ModalErrorSeguridad } from '@/components/ui/ModalErrorSeguridad'
import { useErrorSeguridad } from '@/hooks/useErrorSeguridad'
import { bloqueaLaApp, notificarErrorSeguridad } from '@/lib/errorSeguridad'
import { enMonday } from '@/lib/mondayAuth'
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
  const { error: errorSeguridad, visible: avisoVisible } = useErrorSeguridad()
  /* Tapada mientras el rechazo siga en pie, aunque se cierre el aviso: el "Entendido" baja el
     cartel, no abre la puerta. De un rechazo del borde se sale recargando, no insistiendo. */
  const bloqueada = errorSeguridad !== null && bloqueaLaApp(errorSeguridad.clase)

  /*
   * Lo PRIMERO es de dónde viene el pedido; recién después se dibuja algo.
   *
   * El estado arranca resuelto —no en un `useEffect`— para que el primer pintado ya sepa la
   * respuesta. Con un efecto habría un cuadro con el header a la vista antes de que el rechazo
   * llegue, y ese destello es justamente lo que no puede pasar: a alguien que abrió el enlace
   * fuera de Monday no se le muestra ni por un instante lo que hay del otro lado.
   *
   * Estar fuera del iframe se sabe en el acto y sin preguntarle a nadie; lo demás —firma y lista
   * blanca— sólo lo puede contestar el servidor, y hasta que conteste no se dibuja la operación.
   */
  const [acceso, setAcceso] = useState<'verificando' | 'permitido' | 'rechazado'>(() =>
    import.meta.env.DEV || enMonday() ? 'verificando' : 'rechazado',
  )

  useEffect(() => {
    if (acceso === 'rechazado') {
      /* Afuera del iframe no hay a quién preguntarle: el rechazo es la respuesta. Se publica acá
         —y no durante el render— porque avisar es un efecto, no parte de dibujar. */
      notificarErrorSeguridad('fueraDeMonday', 401)
      return
    }
    if (acceso !== 'verificando') return

    let vivo = true
    /* Una sola consulta contesta las dos preguntas: si el borde deja pasar y quién es el usuario.
       Su resultado queda cacheado, así que la carga de configuración de abajo no lo vuelve a pedir. */
    getUsuarioActual()
      .then((usuario) => {
        if (!vivo) return
        dispatch({ type: 'setUsuarioActual', usuario })
        setAcceso('permitido')
      })
      /* En desarrollo no hay borde que consultar —ni funciones serverless ni iframe—, así que un
         fallo acá no significa "no autorizado": significa que ese control no existe en localhost. */
      .catch(() => vivo && setAcceso(import.meta.env.DEV ? 'permitido' : 'rechazado'))
    return () => {
      vivo = false
    }
  }, [acceso, dispatch])
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
    // Nada de esto sale a la red antes de saber si el pedido tiene derecho a estar acá.
    if (acceso !== 'permitido') return
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
    /* Tasa de cambio del dólar de HOY: se lee del board de Cotizaciones al iniciar y se guarda en
       el estado global. Es el valor que se usa para convertir precios en dólares y como auditoría
       en la venta. Ante un error queda en null (la UI lo refleja). */
    getTasaCambioHoy()
      .then((tasa) => vivo && dispatch({ type: 'setTasaCambio', value: tasa }))
      .catch(() => vivo && dispatch({ type: 'setTasaCambio', value: null }))
    return () => {
      vivo = false
    }
  }, [acceso, dispatch])

  return (
    <div className="scroll" ref={scrollRef}>
      {/* El header con los selectores y el resto de la operación se dibujan SÓLO con el acceso
          ya confirmado. Ver el estado `acceso` y `bloqueaLaApp`. */}
      {acceso === 'permitido' && !bloqueada && <Vista />}
      {acceso === 'verificando' && (
        <ModalCargando titulo="Verificando acceso" detalle="Un momento, por favor." />
      )}
      {/* Un solo aviso a la vez, y el de seguridad manda: el otro invita a reintentar, y un
          rechazo del borde no se arregla reintentando. */}
      {errorSeguridad && avisoVisible ? (
        <ModalErrorSeguridad error={errorSeguridad} />
      ) : (
        <ModalErrorMonday />
      )}
    </div>
  )
}
