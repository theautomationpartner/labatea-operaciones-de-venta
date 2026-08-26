/** Estado único del flujo de operaciones y su reducer. Sin dependencias de React. */
import { DIAS_VENC_FACTURA_MOCK, DIAS_VIGENCIA_INICIAL } from '@/data/mock'
import { hoy } from '@/lib/dates'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { pasoDeProductos, pasosKeysDe } from '@/lib/pasos'
import { productoConPrecio } from '@/lib/precios'
import { aceptaRentabForzada } from '@/lib/selectors'
import { DESCUENTO_PAGO_DEFAULT, type DescuentosPago } from '@/lib/cobros'
import { TOPES_DESCUENTO_DEFAULT, type TopesDescuento } from '@/lib/validaciones'
import type {
  Cliente,
  CobroState,
  ComisionesVenta,
  ComprobanteEmitido,
  Contacto,
  EntregaVentaState,
  EnvioState,
  FacturaItem,
  FacturaState,
  Filtro,
  FormaPagoVenta,
  LineaPresupuesto,
  LogEntry,
  MedioEnvio,
  Moneda,
  MovimientoPago,
  Operacion,
  Paso,
  PresupuestoProducto,
  Producto,
  RemitoProducto,
  RemitoState,
  ResponsableEntrega,
  TipoEmisionRemito,
  TipoEntrega,
  TipoVenta,
  UsuarioActual,
  Vendedor,
  VentaEntregaProducto,
  VentaItem,
} from '@/types'

export interface AppState {
  paso: Paso
  /** Índice del paso MÁS AVANZADO alcanzado en la operación en curso: hasta ahí se puede navegar
   *  con el stepper (los pasos futuros quedan bloqueados). Se reinicia al empezar/cambiar la operación. */
  pasoMaxIdx: number
  /* Nada viene preseteado: el vendedor elige todo explícitamente. */
  operacion: Operacion | null
  vendedor: Vendedor | null
  cliente: Cliente | null
  /** Vendedores del equipo "Vendedores" (Monday), leídos al iniciar la app. */
  vendedores: Vendedor[]
  /** La consulta de vendedores está en curso: el selector se muestra deshabilitado. */
  vendedoresCargando: boolean
  /** Usuario logueado en Monday: vendedor por defecto y permisos del selector. null = sin sesión. */
  usuarioActual: UsuarioActual | null
  /** Tasa de cambio del dólar de HOY, leída al iniciar la app. null = todavía no hay dato. */
  tasaCambio: number | null
  /**
   * Fallo de la API de Monday: qué se estaba intentando hacer ("consultar el cliente"). Lo despacha
   * el `catch` de cualquier consulta o mutación y lo consume `ModalErrorMonday`, la ÚNICA forma en
   * que la app comunica estos errores. null = sin error pendiente.
   */
  errorMonday: string | null

  /* Configuración de la operación */
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  /* Forma de pago de la VENTA (elegida en la selección de productos): rige el ramal del cobro.
     Débito y crédito son formas independientes; no hay un tipo de tarjeta aparte. En el
     PRESUPUESTO no define ningún ramal: sólo aporta el descuento por pronto pago, y sólo cuando
     `descuentoPagoActivo` está encendido. */
  formaPago: FormaPagoVenta | null
  /**
   * PRESUPUESTO: el vendedor contestó que SÍ quiere aplicar descuentos por forma de pago. Es el
   * interruptor de la pregunta que acompaña al selector en la selección de productos: apagado
   * (por defecto) el selector queda bloqueado y el presupuesto no lleva ningún descuento por
   * pronto pago. En la VENTA no interviene: ahí la forma de pago siempre rige.
   */
  descuentoPagoActivo: boolean

  /* Presupuesto en curso */
  /** Derivada: la fecha del día. No se edita. */
  fechaEmision: string
  diasVigencia: number
  /** Moneda del presupuesto. En dólares, los importes salen al cambio del día. */
  moneda: Moneda
  /** Topes del descuento por producto, leídos del tablero de configuración. */
  topesDescuento: TopesDescuento
  /** Descuento por forma de pago ("Medios de Cobro" del tablero de configuración). */
  descuentosPago: DescuentosPago
  /**
   * Días que se le suman a la emisión para el vencimiento del pago de la factura ("Dias de
   * Vigencia Fact Vta" del tablero de configuración). No se edita desde la app.
   */
  diasVencFactura: number
  /** Tasas de comisión del vendedor ("Comision por Venta" del tablero de configuración). */
  comisiones: ComisionesVenta
  /** Porcentaje POR DEFECTO de rentabilidad forzada (config "Rentab Forzada"): precarga el input de
   *  la selección de productos. El usuario puede cambiarlo antes de activar. */
  rentabForzadaPct: number
  /** Rentabilidad Forzada ACTIVA: mientras está encendida, cada producto que la acepta ("Con Rentab
   *  Forzada") recibe el descuento —los ya cargados y los que se agreguen después— hasta apagarla. */
  rentabForzadaActiva: boolean
  /** Porcentaje con el que se activó la rentabilidad forzada: es el que se aplica a los productos que
   *  se agregan mientras está encendida. */
  rentabForzadaPctActiva: number
  /** Filtros de taxonomía aplicados a la búsqueda de productos (Rubro/Subrubro/Categoría). */
  filtros: Filtro[]
  lineas: LineaPresupuesto[]
  /** ID del ítem de presupuesto ya creado en Monday (borrador o emitido). null = todavía no. */
  presupuestoId: string | null
  /** ID del ítem de venta ya creado en "📈Ventas". Evita recrearla si se reintenta. */
  ventaId: string | null
  /** ID del ítem de proforma creado en el board de Proformas (18424580497). null = todavía no. */
  proformaId: string | null
  /** IMPORTE TOTAL de la proforma elegida en la VENTA PROFORMA (su "🤖TOTAL", numeric_mm5sw8n2). Se
   *  mapea tal cual al "Importe Total $" de la venta al registrarla. null fuera de la VENTA PROFORMA. */
  proformaImporte: number | null
  /** Tipo de venta de la proforma elegida (VENTA PROFORMA): define la tasa de comisión (Activa/
   *  Pasiva). null fuera de la VENTA PROFORMA. */
  proformaTipoVenta: TipoVenta | null
  /**
   * Éxito PERSISTENTE de la etapa de emisión: el documento (presupuesto/remito) ya se emitió con
   * éxito en esta operación. Evita re-disparar la mutación irreversible al volver con el stepper.
   * (La factura de venta usa `factura.comprobantes`, que ya persiste su emisión.)
   */
  documentoEmitido: boolean
  /** Éxito PERSISTENTE del envío ("Confirmar y Enviar"): el documento ya se despachó a los contactos. */
  documentoEnviado: boolean
  /** ID que va a llevar el presupuesto ("PRESUP-009"), leído del board al iniciar la operación. */
  nroPresupuesto: string | null

  /* Emisión y envío */
  enviar: boolean
  medioEnvio: MedioEnvio
  contactos: Contacto[]
  log: LogEntry[] | null

  /* Carga de venta: líneas pendientes de los presupuestos del cliente llevadas a la venta */
  ventaItems: VentaItem[]
  conEnvio: boolean

  /* Venta directa con entrega anterior: líneas pendientes de facturar de los remitos */
  facturaItems: FacturaItem[]

  /* Paso 3 de la venta: cobro de la factura */
  cobro: CobroState

  /* Paso 3 de la venta: responsable logístico y ruta de entrega (Cierre de Venta) */
  entregaVenta: EntregaVentaState

  /* Paso 4 de la venta: emisión de la factura */
  factura: FacturaState

  /* Operación REMITO */
  remito: RemitoState
}

const envioInicial: EnvioState = {
  responsable: null,
  destinoId: null,
  choferId: null,
  vehiculoId: null,
  cot: null,
  comisionistaId: null,
  responsableNombre: '',
  confirmado: false,
}

const remitoInicial: RemitoState = {
  tipoEmision: null,
  items: [],
  observaciones: '',
  envio: envioInicial,
  remitoId: null,
  emitido: false,
  devolucionRegistrada: false,
}

const cobroInicial: CobroState = {
  fecha: hoy(),
  movimientos: [],
  confirmado: false,
}

const entregaVentaInicial: EntregaVentaState = {
  responsable: null,
  rutaId: null,
  rutaNombre: '',
  rutaConfirmada: false,
  comisionistaId: null,
  responsableNombre: '',
}

export const initialState: AppState = {
  paso: 'inicio',
  pasoMaxIdx: 0,
  operacion: null,
  vendedor: null,
  cliente: null,
  vendedores: [],
  usuarioActual: null,
  // Arranca en true: la carga se dispara al montar la app y el selector nace deshabilitado.
  vendedoresCargando: true,
  tasaCambio: null,
  errorMonday: null,

  tipoVenta: null,
  tipoEntrega: null,
  formaPago: null,
  // El presupuesto NO aplica descuentos por forma de pago hasta que el vendedor lo pida.
  descuentoPagoActivo: false,

  fechaEmision: hoy(),
  diasVigencia: DIAS_VIGENCIA_INICIAL,
  moneda: 'Pesos',
  topesDescuento: TOPES_DESCUENTO_DEFAULT,
  // Sin la configuración leída, los descuentos son 0: no se asume ninguna bonificación.
  descuentosPago: DESCUENTO_PAGO_DEFAULT,
  diasVencFactura: DIAS_VENC_FACTURA_MOCK,
  // Sin la configuración leída, la comisión es 0: no se asume ninguna tasa.
  comisiones: { activa: 0, pasiva: 0 },
  rentabForzadaPct: 0,
  rentabForzadaActiva: false,
  rentabForzadaPctActiva: 0,
  filtros: [],
  lineas: [],
  presupuestoId: null,
  ventaId: null,
  proformaId: null,
  proformaImporte: null,
  proformaTipoVenta: null,
  documentoEmitido: false,
  documentoEnviado: false,
  nroPresupuesto: null,

  enviar: false,
  medioEnvio: 'Email',
  // Sin contactos precargados: se traen del cliente en Monday al elegir enviar.
  contactos: [],
  log: null,

  ventaItems: [],
  conEnvio: false,

  facturaItems: [],

  cobro: cobroInicial,
  entregaVenta: entregaVentaInicial,

  factura: {
    moneda: 'Pesos (ARS)',
    puntoVenta: '0001',
    tipoCambio: 1,
    ivaReceptor: null,
    letra: null,
    servicioDesde: hoy(),
    observaciones: '',
    registrada: false,
    emitida: false,
    comprobantes: [],
  },

  remito: remitoInicial,
}

/**
 * Cada flujo aplana los productos pendientes de todos sus documentos en una sola lista;
 * al confirmar, la selección viaja con la línea resuelta y la cantidad ya elegida (que
 * nunca supera lo pendiente). El `uid` conserva el origen (`${documentoId}-${indice}`).
 */
export interface SeleccionVenta {
  uid: string
  prod: PresupuestoProducto
  cantidad: number
}
export interface SeleccionFactura {
  uid: string
  prod: RemitoProducto
  cantidad: number
}
export interface SeleccionRemito {
  uid: string
  prod: VentaEntregaProducto
  cantidad: number
}

export type Action =
  | { type: 'goto'; paso: Paso }
  | { type: 'setOperacion'; operacion: Operacion }
  | { type: 'cambiarOperacion'; operacion: Operacion }
  | { type: 'setVendedor'; vendedor: Vendedor }
  | { type: 'setVendedores'; vendedores: Vendedor[] }
  | { type: 'setUsuarioActual'; usuario: UsuarioActual | null }
  | { type: 'setTasaCambio'; value: number | null }
  /** `accion` describe lo que falló, en infinitivo: "traer los presupuestos del cliente". */
  | { type: 'errorMonday'; accion: string }
  | { type: 'limpiarErrorMonday' }
  | { type: 'setCliente'; cliente: Cliente }
  | { type: 'setTipoVenta'; value: TipoVenta }
  | { type: 'setTipoEntrega'; value: TipoEntrega }
  | { type: 'setFormaPago'; value: FormaPagoVenta }
  | { type: 'setDescuentoPagoActivo'; value: boolean }
  | { type: 'setDiasVigencia'; value: number }
  | { type: 'setMoneda'; value: Moneda }
  | { type: 'setTopesDescuento'; value: TopesDescuento }
  | { type: 'setDescuentosPago'; value: DescuentosPago }
  | { type: 'setDiasVencFactura'; value: number }
  | { type: 'setComisiones'; value: ComisionesVenta }
  | { type: 'setPresupuestoId'; value: string | null }
  | { type: 'setVentaId'; value: string | null }
  | { type: 'setProformaId'; value: string | null; importe?: number | null; tipoVenta?: TipoVenta | null }
  | { type: 'setDocumentoEmitido'; value: boolean }
  | { type: 'setDocumentoEnviado'; value: boolean }
  | { type: 'setNroPresupuesto'; value: string | null }
  | { type: 'reset' }
  | { type: 'addFiltro'; filtro: Filtro }
  | { type: 'removeFiltro'; filtro: Filtro }
  | { type: 'addLinea'; producto: Producto; cantidad: number; descuento: number }
  | { type: 'setCantidadLinea'; id: string; cantidad: number }
  | { type: 'setDescuentoLinea'; id: string; descuento: number }
  | { type: 'setPrecioLinea'; id: string; precio: number }
  | { type: 'setRentabForzada'; value: number }
  | { type: 'toggleRentabForzada'; porcentaje: number }
  | { type: 'removeLinea'; id: string }
  | { type: 'setEnviar'; value: boolean }
  | { type: 'setMedioEnvio'; value: MedioEnvio }
  | { type: 'addContacto'; contacto: Contacto }
  | { type: 'setContactos'; contactos: Contacto[] }
  | { type: 'removeContacto'; id: string }
  /** `null` limpia el log: es como se borra el aviso de un intento que ya no aplica. */
  | { type: 'setLog'; entries: LogEntry[] | null }
  | { type: 'agregarVentaSeleccion'; seleccion: SeleccionVenta[] }
  | { type: 'setVentaSeleccion'; seleccion: SeleccionVenta[] }
  | { type: 'setVentaCantidad'; uid: string; cantidad: number }
  | { type: 'setVentaDescuento'; uid: string; descuento: number }
  | { type: 'removeVentaItem'; uid: string }
  | { type: 'setConEnvio'; value: boolean }
  | { type: 'agregarFacturaSeleccion'; seleccion: SeleccionFactura[] }
  | { type: 'removeFacturaItem'; uid: string }
  | { type: 'agregarMovimientoPago'; movimiento: Omit<MovimientoPago, 'id'> }
  | { type: 'removeMovimientoPago'; id: string }
  | { type: 'setMovimientoImporte'; id: string; importe: number }
  | { type: 'confirmarCobro' }
  | { type: 'desconfirmarCobro' }
  | { type: 'setFactura'; patch: Partial<FacturaState> }
  | { type: 'registrarFactura' }
  | { type: 'emitirFactura'; comprobantes: ComprobanteEmitido[] }
  | { type: 'setTipoEmisionRemito'; value: TipoEmisionRemito }
  | { type: 'addRemitoItemCatalogo'; producto: Producto; cantidad: number }
  | { type: 'setRemitoItemCantidad'; uid: string; cantidad: number }
  | { type: 'removeRemitoItem'; uid: string }
  | { type: 'agregarRemitoSeleccion'; seleccion: SeleccionRemito[] }
  | { type: 'setRemitoObservaciones'; value: string }
  | { type: 'setEnvioResponsable'; value: ResponsableEntrega | null }
  | { type: 'setRemitoEnvio'; patch: Partial<EnvioState> }
  | { type: 'confirmarEntrega' }
  | { type: 'setEntregaVentaResponsable'; value: ResponsableEntrega | null }
  | { type: 'setEntregaVenta'; patch: Partial<EntregaVentaState> }
  | { type: 'confirmarRutaEntrega' }
  | { type: 'setRemitoCreado'; value: string | null }
  | { type: 'emitirRemito' }
  | { type: 'registrarDevolucion' }

const nuevoId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `l-${Math.random().toString(36).slice(2)}`

/** Lo presupuestado que queda por vender: es el tope de la línea en la venta. */
export const maxAVender = (prod: PresupuestoProducto): number => prod.pend

/** Vendedor por defecto: el que coincide con el usuario logueado (mismo id de Monday), si existe. */
const vendedorPorDefecto = (
  vendedores: Vendedor[],
  usuario: UsuarioActual | null,
): Vendedor | null => (usuario ? vendedores.find((v) => v.id === usuario.id) ?? null : null)

/**
 * VENTA CON PRESUPUESTO PREVIO: un producto presupuestado en DÓLARES no se mantiene en USD en la
 * venta. Se convierte a pesos con la tasa de cambio del día (precio × tasa) y se re-etiqueta como
 * "Pesos"; el resto de los importes de la línea —importe bonificado, IVA y total— derivan del precio
 * unitario, así que quedan automáticamente en pesos al renderizarse y al escribirse en la API. Un
 * producto en pesos (o si la tasa aún no está disponible) se devuelve sin tocar.
 */
export function convertirProductoAPesos(
  prod: PresupuestoProducto,
  tasa: number | null,
): PresupuestoProducto {
  if (!esDolar(prod.moneda) || !tasa || tasa <= 0) return prod
  return {
    ...prod,
    precio: round2(prod.precio * tasa),
    // El importe bonificado guardado (en dólares) se convierte con la misma tasa: es la base sobre
    // la que la venta aplica el descuento por forma de pago, ya en pesos.
    impBonificado:
      prod.impBonificado != null ? round2(prod.impBonificado * tasa) : prod.impBonificado,
    moneda: 'Pesos',
  }
}

/**
 * Hay un documento oficial YA EMITIDO en el tablero en esta sesión: presupuesto o remito (PDF),
 * proforma o factura. La emisión hacia Monday es IRREVERSIBLE, así que mientras exista no puede
 * modificarse ningún dato de las etapas anteriores (selección de productos, cantidades, precios):
 * quedan en solo lectura para que la base de datos y la interfaz no queden desincronizadas.
 */
export const hayDocumentoEmitido = (s: AppState): boolean =>
  s.documentoEmitido ||
  Boolean(s.proformaId) ||
  s.factura.comprobantes.length > 0 ||
  s.remito.emitido ||
  /* La devolución no emite un PDF, pero sí escribe en el stock y en los remitos imputados: una vez
     registrada, cambiar productos o cantidades dejaría la pantalla mintiendo sobre el tablero. */
  s.remito.devolucionRegistrada

/**
 * Los selectores de operación viven en todos los pasos, así que el modo puede cambiar
 * en cualquier momento. 'inicio' y 'cliente' son comunes a ambos flujos; el resto
 * pertenece a una operación, y al cambiarla hay que caer en su paso equivalente.
 */
function pasoDelModo(
  paso: Paso,
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
): Paso {
  if (paso === 'inicio' || paso === 'cliente') return paso
  return pasoDeProductos(operacion, tipoVenta, tipoEntrega)
}

/**
 * Aplica la RENTABILIDAD FORZADA a una línea con el porcentaje dado, si su producto la acepta: o
 * porque el maestro lo habilita, o porque su precio quedó por debajo del costo (ver
 * `aceptaRentabForzada`). El porcentaje pasa a ser la rentabilidad FINAL de la línea (se guarda en
 * `rentabForzadaAplicada`); la rentabilidad BASE del producto (catálogo) y el PRECIO DE VENTA NO se
 * tocan. La "Nota de Crédito x Comisión" por unidad = Costo Original − Nuevo Precio de Costo, con
 * Nuevo Precio de Costo = Precio de Venta × (1 − %/100). Sin Costo Original conocido no hay monto.
 */
function aplicarRentabForzadaLinea(l: LineaPresupuesto, pct: number): LineaPresupuesto {
  if (!aceptaRentabForzada(l.producto)) return l
  const nuevoCosto = round2(l.producto.precio * (1 - pct / 100))
  const monto =
    l.producto.precioCosto != null ? round2(l.producto.precioCosto - nuevoCosto) : undefined
  return {
    ...l,
    montoDifNotaDeCreditoComision: monto,
    rentabForzadaAplicada: pct,
  }
}

/** Revierte la rentabilidad forzada de una línea: limpia el % forzado y el monto. El producto (base
 *  y precio) nunca se tocó, así que no hay nada que restaurar; las no forzadas quedan intactas. */
function revertirRentabForzadaLinea(l: LineaPresupuesto): LineaPresupuesto {
  if (l.rentabForzadaAplicada == null) return l
  const { montoDifNotaDeCreditoComision: _m, rentabForzadaAplicada: _r, ...resto } = l
  return resto
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'goto': {
      /* Al ir a un paso se recuerda el índice MÁS AVANZADO alcanzado: volver atrás no lo baja, así
         el stepper deja volver a saltar hacia adelante a las etapas ya completadas. */
      const keys = pasosKeysDe(
        state.operacion,
        state.tipoVenta,
        state.tipoEntrega,
        state.remito.tipoEmision,
      )
      const idx = keys.indexOf(action.paso)
      const pasoMaxIdx = idx >= 0 ? Math.max(state.pasoMaxIdx, idx) : state.pasoMaxIdx
      return { ...state, paso: action.paso, pasoMaxIdx }
    }

    case 'setOperacion': {
      if (state.operacion === action.operacion) return state
      return {
        ...state,
        operacion: action.operacion,
        // Nueva operación: se reinicia el progreso navegable del stepper y las banderas de éxito.
        pasoMaxIdx: 0,
        documentoEmitido: false,
        documentoEnviado: false,
        paso: pasoDelModo(state.paso, action.operacion, state.tipoVenta, state.tipoEntrega),
      }
    }

    /* Deep reset al cambiar de operación con datos ya cargados: se descarta TODO lo de la
       transacción (cliente, ítems, cobros, totales, ids) y la nueva operación arranca desde cero
       en la etapa de "Selección de Cliente". Sólo se conservan la configuración del sistema y el
       vendedor, que no dependen de la operación. */
    case 'cambiarOperacion':
      return {
        ...initialState,
        diasVigencia: state.diasVigencia,
        fechaEmision: state.fechaEmision,
        topesDescuento: state.topesDescuento,
        descuentosPago: state.descuentosPago,
        comisiones: state.comisiones,
        vendedor: state.vendedor,
        // Los vendedores y la tasa de cambio se leen una sola vez al iniciar: no se vuelven a pedir.
        vendedores: state.vendedores,
        vendedoresCargando: state.vendedoresCargando,
        // La sesión de Monday no depende de la operación: se conserva.
        usuarioActual: state.usuarioActual,
        tasaCambio: state.tasaCambio,
        operacion: action.operacion,
        paso: 'cliente',
      }

    case 'setVendedor':
      return { ...state, vendedor: action.vendedor }

    /* Llegaron los vendedores del board: se guardan y el selector deja de estar "Cargando…". Si
       todavía no hay vendedor elegido, se preselecciona el que coincide con el usuario logueado. */
    case 'setVendedores':
      return {
        ...state,
        vendedores: action.vendedores,
        vendedoresCargando: false,
        vendedor: state.vendedor ?? vendedorPorDefecto(action.vendedores, state.usuarioActual),
      }

    /* Llegó la sesión de Monday: se guarda y, si no hay vendedor elegido, se preselecciona el
       vendedor que coincide con el usuario logueado (default por RBAC). */
    case 'setUsuarioActual':
      return {
        ...state,
        usuarioActual: action.usuario,
        vendedor: state.vendedor ?? vendedorPorDefecto(state.vendedores, action.usuario),
      }

    case 'setTasaCambio':
      return { ...state, tasaCambio: action.value }

    case 'setCliente':
      // Cambiar de cliente invalida el presupuesto y la venta en curso.
      if (state.cliente?.id === action.cliente.id) return { ...state, cliente: action.cliente }
      return {
        ...state,
        cliente: action.cliente,
        // Otro cliente reinicia la transacción: progreso del stepper y banderas de éxito.
        pasoMaxIdx: 0,
        documentoEmitido: false,
        documentoEnviado: false,
        lineas: [],
        // Otro cliente arranca de cero: la rentabilidad forzada vuelve a estar apagada.
        rentabForzadaActiva: false,
        rentabForzadaPctActiva: 0,
        presupuestoId: null,
        // La venta creada pertenece al cliente anterior: no puede arrastrarse.
        ventaId: null,
        // La proforma emitida también es del cliente anterior.
        proformaId: null,
        proformaImporte: null,
        proformaTipoVenta: null,
        log: null,
        ventaItems: [],
        facturaItems: [],
        // Los contactos y el envío son del cliente anterior: se reinician.
        enviar: false,
        contactos: [],
        // El cobro pertenece a la venta del cliente anterior: se reinicia por completo.
        cobro: cobroInicial,
        // El responsable logístico y la ruta también son de la venta anterior: se reinician.
        entregaVenta: entregaVentaInicial,
        // El remito también parte de datos del cliente: se reinicia salvo el tipo de emisión.
        remito: { ...remitoInicial, tipoEmision: state.remito.tipoEmision },
      }

    // Tipo de venta y de entrega reordenan el flujo de VENTA: hay que reubicar el paso.
    case 'setTipoVenta': {
      if (state.tipoVenta === action.value) return state
      // La entrega ANTERIOR es exclusiva de la venta DIRECTA: al pasar a CON PRESUPUESTO PREVIO se
      // descarta la entrega anterior que hubiera quedado elegida (el resto de las entregas se conserva).
      const tipoEntrega =
        action.value === 'CON PRESUPUESTO PREVIO' && state.tipoEntrega === 'ANTERIOR'
          ? null
          : state.tipoEntrega
      const paso =
        state.operacion === 'VENTA'
          ? pasoDelModo(state.paso, state.operacion, action.value, tipoEntrega)
          : state.paso
      // Cambia el orden/las etapas del flujo: se reinician progreso y banderas de éxito.
      return {
        ...state,
        tipoVenta: action.value,
        tipoEntrega,
        paso,
        pasoMaxIdx: 0,
        documentoEmitido: false,
        documentoEnviado: false,
      }
    }

    case 'setTipoEntrega': {
      if (state.tipoEntrega === action.value) return state
      const paso =
        state.operacion === 'VENTA'
          ? pasoDelModo(state.paso, state.operacion, state.tipoVenta, action.value)
          : state.paso
      // Cambia el orden/las etapas del flujo: se reinician progreso y banderas de éxito.
      return {
        ...state,
        tipoEntrega: action.value,
        paso,
        pasoMaxIdx: 0,
        documentoEmitido: false,
        documentoEnviado: false,
      }
    }

    case 'setFormaPago':
      /* Cambiar la forma de pago invalida cualquier cobro ya cargado: sus movimientos pertenecen al
         medio anterior (p. ej. Tarjeta de Débito → Crédito). Si el usuario retrocede al paso de
         productos y cambia el medio, el cobro se reinicia POR COMPLETO para que la etapa de cobro
         arranque en blanco y lo obligue a cargar los datos del nuevo medio desde cero. Si el valor
         no cambia (misma forma de pago), no se toca nada: no se pisan movimientos válidos. */
      if (action.value === state.formaPago) return state
      return { ...state, formaPago: action.value, cobro: cobroInicial }

    case 'setDescuentoPagoActivo':
      if (action.value === state.descuentoPagoActivo) return state
      /* Apagar la pregunta descarta la forma de pago elegida: el presupuesto vuelve a los precios
         de lista y, si se la vuelve a encender, el selector arranca en blanco. Así no queda una
         forma de pago "escondida" detrás de un check apagado que después se escriba en Monday. */
      return {
        ...state,
        descuentoPagoActivo: action.value,
        formaPago: action.value ? state.formaPago : null,
      }

    case 'setDiasVigencia':
      return { ...state, diasVigencia: action.value }

    case 'setMoneda':
      return { ...state, moneda: action.value }

    case 'setTopesDescuento':
      return { ...state, topesDescuento: action.value }

    case 'setDescuentosPago':
      return { ...state, descuentosPago: action.value }

    case 'errorMonday':
      return { ...state, errorMonday: action.accion }

    case 'limpiarErrorMonday':
      return { ...state, errorMonday: null }

    case 'setRentabForzada':
      return { ...state, rentabForzadaPct: action.value }

    case 'setDiasVencFactura':
      return { ...state, diasVencFactura: action.value }

    case 'setComisiones':
      return { ...state, comisiones: action.value }

    case 'setPresupuestoId':
      return { ...state, presupuestoId: action.value }

    case 'setVentaId':
      return { ...state, ventaId: action.value }

    case 'setProformaId':
      // La VENTA PROFORMA manda el importe total y el tipo de venta de la proforma elegida (para el
      // "Importe Total $" y la tasa de comisión); el resto de los flujos no los pasan y quedan null.
      return {
        ...state,
        proformaId: action.value,
        proformaImporte: action.importe ?? null,
        proformaTipoVenta: action.tipoVenta ?? null,
      }

    case 'setDocumentoEmitido':
      return { ...state, documentoEmitido: action.value }

    case 'setDocumentoEnviado':
      return { ...state, documentoEnviado: action.value }

    case 'setNroPresupuesto':
      return { ...state, nroPresupuesto: action.value }

    /* Cancelar la operación: se descarta todo y se vuelve al inicio, conservando la
       configuración del sistema que no depende de la transacción. */
    case 'reset':
      return {
        ...initialState,
        diasVigencia: state.diasVigencia,
        // El % por defecto de rentabilidad forzada es config del sistema: se conserva entre operaciones.
        rentabForzadaPct: state.rentabForzadaPct,
        fechaEmision: state.fechaEmision,
        // Los vendedores, la sesión y la tasa de cambio ya se cargaron al iniciar: se conservan.
        vendedores: state.vendedores,
        vendedoresCargando: state.vendedoresCargando,
        usuarioActual: state.usuarioActual,
        tasaCambio: state.tasaCambio,
        // Nueva operación: el vendedor vuelve al del usuario logueado (default por RBAC).
        vendedor: vendedorPorDefecto(state.vendedores, state.usuarioActual),
      }

    case 'addFiltro': {
      const { campo, valor } = action.filtro
      if (!valor || state.filtros.some((f) => f.campo === campo && f.valor === valor)) return state
      return { ...state, filtros: [...state.filtros, action.filtro] }
    }

    case 'removeFiltro':
      return {
        ...state,
        filtros: state.filtros.filter(
          (f) => !(f.campo === action.filtro.campo && f.valor === action.filtro.valor),
        ),
      }

    // Editar la lista invalida un borrador ya creado en Monday: se vuelve a crear al guardar/emitir.
    case 'addLinea': {
      const nueva: LineaPresupuesto = {
        id: nuevoId(),
        producto: action.producto,
        cantidad: action.cantidad,
        descuento: action.descuento,
      }
      return {
        ...state,
        presupuestoId: null,
        // Con la rentabilidad forzada ENCENDIDA, el producto nuevo también la recibe (si la acepta).
        lineas: [
          ...state.lineas,
          state.rentabForzadaActiva
            ? aplicarRentabForzadaLinea(nueva, state.rentabForzadaPctActiva)
            : nueva,
        ],
      }
    }

    // Editar la cantidad desde la tabla. Mínimo 1: una línea en cero no es una línea.
    case 'setCantidadLinea': {
      const cantidad = Math.max(1, Math.trunc(action.cantidad) || 1)
      return {
        ...state,
        // El borrador guardado deja de reflejar la lista: se vuelve a crear al confirmar.
        presupuestoId: null,
        lineas: state.lineas.map((l) => (l.id === action.id ? { ...l, cantidad } : l)),
      }
    }

    // Editar el descuento desde la tabla. El rango lo valida la celda antes de despachar.
    case 'setDescuentoLinea':
      return {
        ...state,
        presupuestoId: null,
        lineas: state.lineas.map((l) =>
          l.id === action.id ? { ...l, descuento: action.descuento } : l,
        ),
      }

    /* Override del PRECIO UNITARIO de una línea (sólo lo despacha un administrador, ver
       `lib/permisos`). El precio se guarda en la copia del producto de la línea, así todo lo que
       deriva de él —descuentos, subtotal, IVA, resumen y lo que se escribe en Monday— se recalcula
       solo, sin tocar el catálogo ni el resto de las líneas.

       La RENTABILIDAD se reajusta en el mismo paso: el COSTO del producto no cambia porque se
       venda más barato, así que se conserva (costo = precio × (1 − rent/100)) y el margen se mide
       contra el precio nuevo. Al conservarse el costo, pisar el precio dos veces seguidas da el
       mismo resultado que pisarlo una sola vez con el valor final. */
    case 'setPrecioLinea': {
      const precio = round2(action.precio)
      // Un precio de 0 o negativo no es un precio: se ignora y la celda queda marcada en rojo.
      if (!(precio > 0)) return state
      return {
        ...state,
        presupuestoId: null,
        lineas: state.lineas.map((l) =>
          l.id === action.id ? { ...l, producto: productoConPrecio(l.producto, precio) } : l,
        ),
      }
    }

    /* Enciende/apaga la RENTABILIDAD FORZADA (no es por producto: es un modo global de la etapa).
       Al ENCENDERLA, se le aplica el descuento a todas las líneas habilitadas ("Con Rentab Forzada")
       con el `porcentaje` recibido, y queda activa: los productos que se agreguen después también lo
       reciben (ver `addLinea`). Al APAGARLA, se revierte en todas las líneas (precio y rentabilidad
       vuelven a su base). Los productos no habilitados nunca se tocan. */
    case 'toggleRentabForzada': {
      const activar = !state.rentabForzadaActiva
      if (activar) {
        return {
          ...state,
          presupuestoId: null,
          rentabForzadaActiva: true,
          rentabForzadaPctActiva: action.porcentaje,
          lineas: state.lineas.map((l) => aplicarRentabForzadaLinea(l, action.porcentaje)),
        }
      }
      return {
        ...state,
        presupuestoId: null,
        rentabForzadaActiva: false,
        rentabForzadaPctActiva: 0,
        lineas: state.lineas.map(revertirRentabForzadaLinea),
      }
    }

    case 'removeLinea':
      return {
        ...state,
        presupuestoId: null,
        lineas: state.lineas.filter((l) => l.id !== action.id),
      }

    case 'setEnviar':
      return { ...state, enviar: action.value }

    case 'setMedioEnvio':
      return { ...state, medioEnvio: action.value }

    case 'addContacto':
      if (state.contactos.some((c) => c.id === action.contacto.id)) return state
      return { ...state, contactos: [...state.contactos, action.contacto] }

    /* Precarga de la selección al traer los contactos del cliente: reemplaza la lista. */
    case 'setContactos':
      return { ...state, contactos: action.contactos }

    case 'removeContacto':
      return { ...state, contactos: state.contactos.filter((c) => c.id !== action.id) }

    case 'setLog':
      return { ...state, log: action.entries }

    // Entran las líneas pendientes elegidas en la lista, ya con la cantidad ajustada.
    case 'agregarVentaSeleccion': {
      const existentes = new Set(state.ventaItems.map((it) => it.uid))
      const nuevos = action.seleccion
        .filter((s) => !existentes.has(s.uid))
        // El descuento arranca en el que traía la línea del presupuesto y se puede editar. Un
        // producto presupuestado en dólares se convierte a pesos con la tasa del día antes de entrar.
        .map((s): VentaItem => {
          const prod = convertirProductoAPesos(s.prod, state.tasaCambio)
          return { ...prod, uid: s.uid, aVender: s.cantidad, desc: prod.descuento ?? 0 }
        })
      if (nuevos.length === 0) return state
      return { ...state, ventaItems: [...state.ventaItems, ...nuevos] }
    }

    /* Reemplaza por completo la venta con la selección dada. La venta CON PROFORMA es "todo o
       nada" y exclusiva: al elegir una proforma entran todos sus productos y se descartan los de
       la anterior. El descuento arranca en el de la línea (0 en la proforma). */
    case 'setVentaSeleccion': {
      const items = action.seleccion.map((s): VentaItem => ({
        ...s.prod,
        uid: s.uid,
        aVender: s.cantidad,
        desc: s.prod.descuento ?? 0,
      }))
      return { ...state, ventaItems: items }
    }

    // Sin tope: pasarse de lo presupuestado se puede escribir, y la tabla lo marca en rojo.
    case 'setVentaCantidad':
      return {
        ...state,
        ventaItems: state.ventaItems.map((it) =>
          it.uid === action.uid ? { ...it, aVender: Math.max(0, action.cantidad) } : it,
        ),
      }

    // El rango lo valida la celda antes de despachar (topes del tablero de configuración).
    case 'setVentaDescuento':
      return {
        ...state,
        ventaItems: state.ventaItems.map((it) =>
          it.uid === action.uid ? { ...it, desc: action.descuento } : it,
        ),
      }

    case 'removeVentaItem':
      return { ...state, ventaItems: state.ventaItems.filter((it) => it.uid !== action.uid) }

    case 'setConEnvio':
      return { ...state, conEnvio: action.value }

    // Entran las líneas pendientes de facturar elegidas en la lista, con su cantidad.
    case 'agregarFacturaSeleccion': {
      const existentes = new Set(state.facturaItems.map((it) => it.uid))
      const nuevos = action.seleccion
        .filter((s) => !existentes.has(s.uid))
        .map((s): FacturaItem => ({ ...s.prod, uid: s.uid, aFacturar: s.cantidad }))
      if (nuevos.length === 0) return state
      return { ...state, facturaItems: [...state.facturaItems, ...nuevos] }
    }

    case 'removeFacturaItem':
      return { ...state, facturaItems: state.facturaItems.filter((it) => it.uid !== action.uid) }

    // Tocar los movimientos invalida la confirmación: hay que volver a registrarlo.
    case 'agregarMovimientoPago':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: [...state.cobro.movimientos, { ...action.movimiento, id: nuevoId() }],
        },
      }

    case 'removeMovimientoPago':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: state.cobro.movimientos.filter((m) => m.id !== action.id),
        },
      }

    /* Editar el importe de un pago ya cargado (para ajustar la DIFERENCIA a 0): reabre la
       confirmación, igual que agregar o quitar un movimiento. */
    case 'setMovimientoImporte':
      return {
        ...state,
        cobro: {
          ...state.cobro,
          confirmado: false,
          movimientos: state.cobro.movimientos.map((m) =>
            m.id === action.id ? { ...m, importe: action.importe } : m,
          ),
        },
      }

    /* Se confirma con lo que devolvió Monday: el recibo (simultáneo) o la deuda y el saldo
       que traía la cuenta corriente (posterior). */
    case 'confirmarCobro':
      return {
        ...state,
        cobro: { ...state.cobro, confirmado: true },
      }

    /* Reabre el cobro: la venta cambió (se editaron productos) y el total ya no coincide con lo
       cobrado. Se limpia la confirmación para exigir registrar la diferencia antes de avanzar. */
    case 'desconfirmarCobro':
      if (!state.cobro.confirmado) return state
      return { ...state, cobro: { ...state.cobro, confirmado: false } }

    /* Editar la ficha invalida el registro y, con él, la emisión. Los comprobantes ya creados
       NO se borran: existen en el board, y son los que impiden volver a emitir por duplicado. */
    case 'setFactura':
      return {
        ...state,
        factura: { ...state.factura, ...action.patch, registrada: false, emitida: false },
      }

    case 'registrarFactura':
      return { ...state, factura: { ...state.factura, registrada: true } }

    // La emisión llega con los comprobantes que efectivamente se escribieron en el board.
    case 'emitirFactura':
      return {
        ...state,
        factura: { ...state.factura, emitida: true, comprobantes: action.comprobantes },
      }

    // El origen de los productos cambia con el tipo de emisión: se reinicia lo cargado.
    case 'setTipoEmisionRemito': {
      if (state.remito.tipoEmision === action.value) return state
      const remito: RemitoState = { ...remitoInicial, tipoEmision: action.value }
      const paso =
        state.operacion === 'REMITO'
          ? pasoDelModo(state.paso, state.operacion, state.tipoVenta, state.tipoEntrega)
          : state.paso
      return { ...state, remito, paso }
    }

    // POSTERIOR: cada alta desde el catálogo es una línea nueva del remito. Editar la lista
    // invalida un remito ya creado en Monday: se vuelve a crear al confirmar la entrega.
    case 'addRemitoItemCatalogo':
      return {
        ...state,
        remito: {
          ...state.remito,
          remitoId: null,
          items: [
            ...state.remito.items,
            {
              uid: nuevoId(),
              codigo: action.producto.codigo,
              nombre: action.producto.nombre,
              um: action.producto.um,
              cantidad: action.cantidad,
              // Del catálogo salen el id del producto (para linkearlo), su peso y su precio unitario.
              productoId: action.producto.id,
              peso: action.producto.peso,
              /* Ítem de "Stock y Movimientos" del producto: es donde la DEVOLUCION asienta el
                 movimiento de ingreso. Viene del maestro, así no hay que ir a buscarlo por nombre. */
              stockId: action.producto.stockId,
              // El precio de lista (ya con/sin IVA según el cliente) alimenta el importe a facturar.
              precioUnitario: action.producto.precio,
              // Tipo de mercadería (CO / COM): viaja a la "Vta Pend de Facturar" del remito POSTERIOR.
              tipo: action.producto.tipo,
              // Rentabilidad según la lista del cliente: se guarda en la "Vta Pend de Facturar".
              rentabilidad: action.producto.rentabilidad,
              /* La ficha entera acompaña a la línea: con ella la tabla puede volver a mostrar el
                 stock del producto (y sus ingresos) sin salir a buscarlo de nuevo. */
              producto: action.producto,
            },
          ],
        },
      }

    /* Sin tope duro por arriba: pasarse de lo pendiente se puede, y la tabla lo marca en rojo.
       Por abajo sí hay piso, y depende del tipo de emisión:
         · ANTERIOR: la línea se confirmó contra lo pendiente de una venta, así que no puede
           quedar en 0 —una entrega de cero unidades no existe—. Para sacarla está la papelera.
         · POSTERIOR: la mercadería sale del catálogo y la línea sí puede ir a 0. */
    case 'setRemitoItemCantidad': {
      const minimo = state.remito.tipoEmision === 'ANTERIOR' ? 1 : 0
      return {
        ...state,
        remito: {
          ...state.remito,
          remitoId: null,
          items: state.remito.items.map((it) =>
            it.uid === action.uid ? { ...it, cantidad: Math.max(minimo, action.cantidad) } : it,
          ),
        },
      }
    }

    case 'removeRemitoItem':
      return {
        ...state,
        remito: {
          ...state.remito,
          remitoId: null,
          items: state.remito.items.filter((it) => it.uid !== action.uid),
        },
      }

    // ANTERIOR: entran las líneas pendientes de entregar elegidas en la lista, con su cantidad.
    case 'agregarRemitoSeleccion': {
      const existentes = new Set(state.remito.items.map((it) => it.uid))
      const nuevos = action.seleccion
        .filter((s) => !existentes.has(s.uid))
        .map((s) => ({
          uid: s.uid,
          codigo: s.prod.codigo,
          nombre: s.prod.nombre,
          um: s.prod.um,
          cantidad: s.cantidad,
          max: s.prod.pendiente,
          // Del subelemento de la venta salen el id donde se asienta lo entregado y su producto.
          subitemId: s.prod.subitemId,
          productoId: s.prod.productoId,
          entregadaPrevia: s.prod.entregada,
          // La venta de origen se linkea en la cabecera del remito; el peso, en la línea.
          ventaId: s.prod.ventaId,
          peso: s.prod.peso,
          // Relacionales para afectar pendiente de entrega y stock al emitir el remito.
          pendienteEntregaId: s.prod.pendienteEntregaId,
          stockId: s.prod.stockId,
        }))
      if (nuevos.length === 0) return state
      return {
        ...state,
        remito: { ...state.remito, remitoId: null, items: [...state.remito.items, ...nuevos] },
      }
    }

    case 'setRemitoObservaciones':
      return { ...state, remito: { ...state.remito, observaciones: action.value } }

    // Cambiar (o anular) el responsable limpia los datos de las otras opciones y la confirmación.
    // Cambia la cabecera del remito: un remito ya creado deja de reflejarla y se recrea.
    case 'setEnvioResponsable':
      return {
        ...state,
        remito: {
          ...state.remito,
          remitoId: null,
          envio: { ...envioInicial, responsable: action.value },
        },
      }

    // Cualquier cambio en los datos de la entrega vuelve a abrir la confirmación.
    case 'setRemitoEnvio':
      return {
        ...state,
        remito: {
          ...state.remito,
          remitoId: null,
          envio: { ...state.remito.envio, ...action.patch, confirmado: false },
        },
      }

    case 'confirmarEntrega':
      return {
        ...state,
        remito: { ...state.remito, envio: { ...state.remito.envio, confirmado: true } },
      }

    // Cierre de Venta: elegir el responsable logístico limpia los datos de las otras opciones.
    case 'setEntregaVentaResponsable':
      return {
        ...state,
        entregaVenta: { ...entregaVentaInicial, responsable: action.value },
      }

    // Cambiar la ruta (u otro dato) reabre la confirmación: la ruta hay que volver a confirmarla.
    case 'setEntregaVenta':
      return {
        ...state,
        entregaVenta: {
          ...state.entregaVenta,
          ...action.patch,
          rutaConfirmada:
            'rutaId' in action.patch ? false : state.entregaVenta.rutaConfirmada,
        },
      }

    case 'confirmarRutaEntrega':
      return { ...state, entregaVenta: { ...state.entregaVenta, rutaConfirmada: true } }

    // El remito quedó creado en Monday: se guarda su id para no recrearlo al volver a entrar.
    case 'setRemitoCreado':
      return { ...state, remito: { ...state.remito, remitoId: action.value } }

    case 'emitirRemito':
      return { ...state, remito: { ...state.remito, emitido: true } }

    /* La devolución ya impactó el stock y los remitos imputados. Es irreversible, así que a partir
       de acá la operación entera queda en solo lectura (ver `hayDocumentoEmitido`). */
    case 'registrarDevolucion':
      return { ...state, remito: { ...state.remito, devolucionRegistrada: true } }

    default:
      return state
  }
}
