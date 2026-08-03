/** Estado único del flujo de operaciones y su reducer. Sin dependencias de React. */
import { DIAS_VIGENCIA_INICIAL } from '@/data/mock'
import { hoy } from '@/lib/dates'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { pasoDeProductos, pasosKeysDe } from '@/lib/pasos'
import { DESCUENTO_PAGO_DEFAULT, type DescuentosPago } from '@/lib/cobros'
import { TOPES_DESCUENTO_DEFAULT, type TopesDescuento } from '@/lib/validaciones'
import type {
  Cliente,
  CobroState,
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

  /* Configuración de la operación */
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  /* Forma de pago de la VENTA (elegida en la selección de productos): rige el ramal del cobro.
     Débito y crédito son formas independientes; no hay un tipo de tarjeta aparte. */
  formaPago: FormaPagoVenta | null

  /* Presupuesto en curso */
  /** Derivada: la fecha del día. No se edita. */
  fechaEmision: string
  diasVigencia: number
  /** Moneda del presupuesto. En dólares, los importes salen al cambio del día. */
  moneda: Moneda
  /** Topes del descuento por producto, leídos del tablero de configuración. */
  topesDescuento: TopesDescuento
  /** Descuento por forma de pago ("Medios de Pago" del tablero de configuración). */
  descuentosPago: DescuentosPago
  /** Filtros de taxonomía aplicados a la búsqueda de productos (Rubro/Subrubro/Categoría). */
  filtros: Filtro[]
  lineas: LineaPresupuesto[]
  /** ID del ítem de presupuesto ya creado en Monday (borrador o emitido). null = todavía no. */
  presupuestoId: string | null
  /** ID del ítem de venta ya creado en "📈Ventas". Evita recrearla si se reintenta. */
  ventaId: string | null
  /** ID del ítem de proforma creado en el board de Proformas (18424580497). null = todavía no. */
  proformaId: string | null
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
}

const cobroInicial: CobroState = {
  registrar: false,
  fecha: hoy(),
  movimientos: [],
  confirmado: false,
  cobroId: null,
  deudaId: null,
  saldoAnterior: null,
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

  tipoVenta: null,
  tipoEntrega: null,
  formaPago: null,

  fechaEmision: hoy(),
  diasVigencia: DIAS_VIGENCIA_INICIAL,
  moneda: 'Pesos',
  topesDescuento: TOPES_DESCUENTO_DEFAULT,
  descuentosPago: DESCUENTO_PAGO_DEFAULT,
  filtros: [],
  lineas: [],
  presupuestoId: null,
  ventaId: null,
  proformaId: null,
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
  | { type: 'setCliente'; cliente: Cliente }
  | { type: 'setTipoVenta'; value: TipoVenta }
  | { type: 'setTipoEntrega'; value: TipoEntrega }
  | { type: 'setFormaPago'; value: FormaPagoVenta }
  | { type: 'setDiasVigencia'; value: number }
  | { type: 'setMoneda'; value: Moneda }
  | { type: 'setTopesDescuento'; value: TopesDescuento }
  | { type: 'setDescuentosPago'; value: DescuentosPago }
  | { type: 'setPresupuestoId'; value: string | null }
  | { type: 'setVentaId'; value: string | null }
  | { type: 'setProformaId'; value: string | null }
  | { type: 'setDocumentoEmitido'; value: boolean }
  | { type: 'setDocumentoEnviado'; value: boolean }
  | { type: 'setNroPresupuesto'; value: string | null }
  | { type: 'reset' }
  | { type: 'addFiltro'; filtro: Filtro }
  | { type: 'removeFiltro'; filtro: Filtro }
  | { type: 'addLinea'; producto: Producto; cantidad: number; descuento: number }
  | { type: 'setCantidadLinea'; id: string; cantidad: number }
  | { type: 'setDescuentoLinea'; id: string; descuento: number }
  | { type: 'removeLinea'; id: string }
  | { type: 'setEnviar'; value: boolean }
  | { type: 'setMedioEnvio'; value: MedioEnvio }
  | { type: 'addContacto'; contacto: Contacto }
  | { type: 'setContactos'; contactos: Contacto[] }
  | { type: 'removeContacto'; id: string }
  | { type: 'setLog'; entries: LogEntry[] }
  | { type: 'agregarVentaSeleccion'; seleccion: SeleccionVenta[] }
  | { type: 'setVentaSeleccion'; seleccion: SeleccionVenta[] }
  | { type: 'setVentaCantidad'; uid: string; cantidad: number }
  | { type: 'setVentaDescuento'; uid: string; descuento: number }
  | { type: 'removeVentaItem'; uid: string }
  | { type: 'setConEnvio'; value: boolean }
  | { type: 'agregarFacturaSeleccion'; seleccion: SeleccionFactura[] }
  | { type: 'removeFacturaItem'; uid: string }
  | { type: 'setRegistrarCobro'; value: boolean }
  | { type: 'agregarMovimientoPago'; movimiento: Omit<MovimientoPago, 'id'> }
  | { type: 'removeMovimientoPago'; id: string }
  | { type: 'setMovimientoImporte'; id: string; importe: number }
  | { type: 'confirmarCobro'; cobroId?: string; deudaId?: string; saldoAnterior?: number }
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
  s.remito.emitido

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
        presupuestoId: null,
        // La venta creada pertenece al cliente anterior: no puede arrastrarse.
        ventaId: null,
        // La proforma emitida también es del cliente anterior.
        proformaId: null,
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
      return { ...state, formaPago: action.value }

    case 'setDiasVigencia':
      return { ...state, diasVigencia: action.value }

    case 'setMoneda':
      return { ...state, moneda: action.value }

    case 'setTopesDescuento':
      return { ...state, topesDescuento: action.value }

    case 'setDescuentosPago':
      return { ...state, descuentosPago: action.value }

    case 'setPresupuestoId':
      return { ...state, presupuestoId: action.value }

    case 'setVentaId':
      return { ...state, ventaId: action.value }

    case 'setProformaId':
      return { ...state, proformaId: action.value }

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
    case 'addLinea':
      return {
        ...state,
        presupuestoId: null,
        lineas: [
          ...state.lineas,
          {
            id: nuevoId(),
            producto: action.producto,
            cantidad: action.cantidad,
            descuento: action.descuento,
          },
        ],
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

    case 'setRegistrarCobro':
      return { ...state, cobro: { ...state.cobro, registrar: action.value, confirmado: false } }

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
        cobro: {
          ...state.cobro,
          confirmado: true,
          cobroId: action.cobroId ?? state.cobro.cobroId,
          deudaId: action.deudaId ?? state.cobro.deudaId,
          saldoAnterior: action.saldoAnterior ?? state.cobro.saldoAnterior,
        },
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
              // El precio de lista (ya con/sin IVA según el cliente) alimenta el importe a facturar.
              precioUnitario: action.producto.precio,
              // Tipo de mercadería (CO / COM): viaja a la "Vta Pend de Facturar" del remito POSTERIOR.
              tipo: action.producto.tipo,
              // Rentabilidad según la lista del cliente: se guarda en la "Vta Pend de Facturar".
              rentabilidad: action.producto.rentabilidad,
            },
          ],
        },
      }

    // Sin tope duro: pasarse de lo pendiente se puede, y la tabla lo marca en rojo.
    case 'setRemitoItemCantidad':
      return {
        ...state,
        remito: {
          ...state.remito,
          remitoId: null,
          items: state.remito.items.map((it) =>
            it.uid === action.uid ? { ...it, cantidad: Math.max(0, action.cantidad) } : it,
          ),
        },
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

    default:
      return state
  }
}
