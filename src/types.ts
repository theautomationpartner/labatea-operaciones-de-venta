/** Modelo de dominio. La capa de servicio (v2) debe devolver exactamente estas formas. */

export type Operacion = 'PRESUPUESTAR' | 'CARGAR VENTA' | 'REMITO'

export type Paso =
  | 'inicio'
  | 'cliente'
  | 'productos'
  | 'emision'
  | 'venta'
  | 'remito'
  | 'cobro'
  | 'factura'
  | 'remito-productos'
  | 'remito-envio'
  | 'remito-emision'

export interface Vendedor {
  ini: string
  name: string
  color: string
}

export type ActividadCliente = 'Activo' | 'Inactivo'
export type SituacionCliente = 'Liberado con crédito' | 'Liberado sin crédito' | 'Bloqueado'

/** Labels de "✋️Cond Pago Habilitadas" (dropdown_mm54yq06) en el board de Personas. */
export type CondicionPago =
  | 'CONTADO'
  | 'CUENTA CORRIENTE'
  | 'PROVEED 45 DIAS'
  | 'PROVEED 90 DIAS'
  | 'PROVEED CONTADO'

export type ListaPrecio = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'

/** Cuenta bancaria activa del cliente ("💳Ctas Bancarias Personas"). */
export interface CuentaBancaria {
  /** ID del ítem en Monday. */
  id: string
  banco: string
  cbu: string
  alias: string
  tipoCuenta: string
  numeroCuenta: string
}

/** Por dónde se identificó la cuenta al transferir. */
export type MedioTransferencia = 'CBU' | 'ALIAS'

export interface Cliente {
  /** ID del ítem en Monday: se usa para linkear y consultar, no se muestra. */
  id: string
  name: string
  cuit: string
  /** Persona Física / Persona Jurídica */
  ptype: string
  /** Condición frente al IVA */
  status: string
  /** Lista de precios asignada. null = el cliente no tiene lista definida en el sistema. */
  list: ListaPrecio | null
  /** Retenciones aplicables */
  ret: string
  /** Si es agente, la factura exige retenciones calculadas antes de emitirse. */
  agenteRetencion: boolean
  /** Condición de pago pactada; encabeza el bloque financiero de la ficha. */
  condicionPago: CondicionPago
  limit: number
  /** Código del cliente en el sistema (columna text_mm542r9d). Es el que se muestra. */
  codigo: string
  /** ID del ítem de Cuenta Corriente conectado. Es donde se registran los movimientos. */
  ctaCteId?: string
  /** "🤖Saldo Cta Cte": la deuda real del cliente (ventas − cobros), sin esta operación. */
  saldoCtaCte: number
  /** "Linea Utilizada" de la Cta Cte: saldo + remitos pendientes de facturar. */
  lineaUtilizada: number
  /**
   * "🤖Remito Pends de Facturar" de la Cta Cte. Es informativo: se muestra junto al resto de
   * los valores de crédito, pero no entra en ningún cálculo de uso del límite.
   */
  remitosPendFacturar: number
  /** "Crédito Disponible" de la Cta Cte, ya calculado en el board (límite − línea utilizada). */
  disponible: number
  addr: string
  activity: ActividadCliente
  situation: SituacionCliente
}

export interface Producto {
  /** ID del ítem en el board de Productos de Monday. Necesario para linkear el subitem
   *  del presupuesto por board_relation. En modo mock queda `undefined`. */
  id?: string
  codigo: string
  nombre: string
  precio: number
  rentabilidad: number
  provCod: string
  provNombre: string
  /** ID del ítem del proveedor en el board de Personas. Agrupa la mercadería consignada. */
  provId?: string
  /** Tipo de mercadería: 'CO' (consignada) o 'COM' (común). Parte la venta en comprobantes. */
  tipo: string
  /**
   * Alícuota de IVA del producto, en % ("✋IVA" del maestro). Se lee al cargar el producto y
   * viaja con la línea: es la que se declara en cada línea del comprobante.
   */
  iva?: number
  /** Taxonomía del Maestro de Productos (columnas dropdown). Texto tal cual viene de Monday
   *  (puede traer varias etiquetas separadas por coma). Se usa para filtrar la búsqueda. */
  rubro?: string
  subrubro?: string
  categoria?: string
  /** Unidad de medida: la exige el remito, que documenta cantidades. */
  um: string
  fisico: number
  comercial: number
  disponible: number
}

/** Columna de taxonomía del Maestro de Productos sobre la que se filtra. */
export type CampoFiltro = 'Rubro' | 'Subrubro' | 'Categoría'

/** Moneda del presupuesto. Se escribe en la columna "✋Moneda" del ítem en Monday. */
export type Moneda = 'Pesos' | 'Dólares'

/** Un filtro aplicado: la columna (campo) y el valor elegido. */
export interface Filtro {
  campo: CampoFiltro
  valor: string
}

/** Producto agregado al presupuesto en curso. */
export interface LineaPresupuesto {
  /** Identidad de la línea, independiente del código de producto. */
  id: string
  producto: Producto
  cantidad: number
  descuento: number
}

export type EstadoPresupuesto = 'En uso' | 'Vencido' | 'Completado'

export interface PresupuestoProducto {
  nombre: string
  codigo: string
  /** Cantidad presupuestada. */
  total: number
  /** Cantidad ya vendida. */
  vend: number
  /** Cantidad disponible = presupuestada − vendida. */
  pend: number
  precio: number
  rent: number
  /** Descuento con el que se presupuestó la línea (%). */
  descuento?: number
  /** Tipo de mercadería espejado del maestro: 'CO' (consignada) o 'COM'. */
  tipo?: string
  /** Alícuota de IVA del producto, en %. Se declara en la línea del comprobante. */
  iva?: number
  /** Proveedor del producto: la mercadería consignada se factura por proveedor. */
  proveedorId?: string
  proveedorNombre?: string
  /** "🤖Estado de Uso" del subelemento, tal como está en el board. */
  estadoUso?: string
  /** ID del subelemento del presupuesto en Monday. */
  subitemId?: string
  /** ID del producto conectado en el Maestro de Productos. */
  productoId?: string
}

export interface Presupuesto {
  id: string
  /** Cliente al que pertenece: la lista del paso 2 se filtra por acá. */
  clienteId: string
  estado: EstadoPresupuesto
  rent: number
  importe: number
  prodVend: number
  prodTot: number
  emis: string
  venc: string
  uso: number
  desc: number
  productos: PresupuestoProducto[]
}

/** Línea del presupuesto llevada a la venta en curso. */
export interface VentaItem extends PresupuestoProducto {
  uid: string
  /** Arranca en las unidades pendientes y sólo puede bajar de ahí. */
  aVender: number
  /** Descuento aplicado en la venta (%); arranca en el del presupuesto. */
  desc: number
}

/* ===== Remitos pendientes de facturar (venta DIRECTA con entrega ANTERIOR) ===== */

/** 'Facturado' existe en el ERP pero nunca se lista: no hay nada que facturar. */
export type EstadoRemito = 'Sin facturar' | 'Pend. de facturar' | 'Facturado'

export interface RemitoProducto {
  nombre: string
  codigo: string
  /** Unidades entregadas en el remito. */
  cantRemito: number
  cantFacturada: number
  /** Unidades entregadas que todavía no se facturaron. */
  pendiente: number
  precio: number
  rent: number
  /** Unidad de medida del subelemento del remito. */
  um?: string
  /** Tipo de mercadería del producto remitido: 'CO' (consignada) o 'COM'. */
  tipo?: string
  /** Alícuota de IVA del producto, en %. Se declara en la línea del comprobante. */
  iva?: number
  /** Proveedor del producto: la mercadería consignada se factura por proveedor. */
  proveedorId?: string
  proveedorNombre?: string
  /** "🤖 Estado Facturacion" del subelemento, tal como está en el board. */
  estadoFacturacion?: string
  /**
   * La línea se puede llevar a la factura. Es false para los productos en "Pend de Facturar":
   * se muestran con su estado, pero no se pueden elegir.
   */
  seleccionable?: boolean
  /** ID del subelemento del remito en Monday. */
  subitemId?: string
  /** ID del producto conectado en el Maestro de Productos. */
  productoId?: string
}

export interface Remito {
  id: string
  fecha: string
  estado: EstadoRemito
  prodFacturados: number
  prodTotal: number
  /** Descuento del remito, en pesos, sobre el importe a facturar. */
  descuento: number
  productos: RemitoProducto[]
}

/** Línea del remito llevada a la facturación en curso. */
export interface FacturaItem extends RemitoProducto {
  uid: string
  /** Arranca en las unidades pendientes y sólo puede bajar de ahí. */
  aFacturar: number
}

/* ===== Cobro de la factura ===== */

export type FormaPago =
  | 'Efectivo'
  | 'Cheque'
  | 'Transferencia'
  | 'Tarjeta de débito'
  | 'Tarjeta de crédito'

/** Un pago concreto del cobro. La forma de pago define su descuento. */
export interface MovimientoPago {
  id: string
  formaPago: FormaPago
  importe: number
  referencia: string
  /** Sólo cheque: debe vencer después de la emisión de la factura. */
  chequeVencimiento: string
  /** Sólo transferencia: a qué cuenta del cliente entró el dinero. */
  cuentaBancaria?: CuentaBancaria | null
  /** Sólo transferencia: si la cuenta se identificó por CBU o por alias. */
  medioTransferencia?: MedioTransferencia | null
}

/**
 * SIMULTANEO: el pago se registra junto con la factura (clientes de contado).
 * POSTERIOR: la factura se cobra después; registrar un pago ahora es opcional.
 * Se deriva de la condición de pago del cliente y no se puede cambiar a mano.
 */
export type TipoPago = 'SIMULTANEO' | 'POSTERIOR'

export interface CobroState {
  /** Sólo en pago POSTERIOR: si el vendedor eligió registrar un pago ahora (SI/NO). */
  registrar: boolean
  fecha: string
  movimientos: MovimientoPago[]
  /** Se confirma a mano; cualquier cambio en los movimientos lo vuelve a abrir. */
  confirmado: boolean
  /** SIMULTÁNEO: ítem del recibo creado en el tablero de Cobros. */
  cobroId: string | null
  /** POSTERIOR: ítem de la factura pendiente de cobro (la deuda generada). */
  deudaId: string | null
  /** POSTERIOR: saldo que traía la cuenta corriente antes de este movimiento. */
  saldoAnterior: number | null
}

/* ===== Emisión de la factura ===== */

export type MonedaFactura = 'Pesos (ARS)' | 'Dólares (USD)'
/** Condición del receptor frente al IVA. */
export type CondicionIVA = 'Responsable Inscripto' | 'Monotributo' | 'Consumidor Final'
export type LetraComprobante = 'A' | 'B' | 'C'
/** Canal por el que se le manda el PDF al contacto. */
export type MedioEnvio = 'Email' | 'WhatsApp' | 'Ambos'

export interface FacturaState {
  moneda: MonedaFactura
  puntoVenta: string
  tipoCambio: number
  /** null = se toma la condición del cliente. */
  ivaReceptor: CondicionIVA | null
  letra: LetraComprobante | null
  servicioDesde: string
  observaciones: string
  /** Se registra a mano; recién ahí se habilita emitirla en AFIP. */
  registrada: boolean
  /** Emitida en AFIP: es lo último que falta para poder cerrar la venta. */
  emitida: boolean
  /**
   * Comprobantes ya escritos en el board de Facturación. Una venta puede generar varios: uno
   * por la mercadería común y uno por cada proveedor de mercadería consignada. Mientras la
   * lista tenga algo, no se vuelve a emitir: se estarían duplicando los ítems.
   */
  comprobantes: ComprobanteEmitido[]
}

/** Resultado de crear un comprobante en el board, tal como lo muestra la vista. */
export interface ComprobanteEmitido {
  /** Grupo de mercadería que lo originó ('COMUN' o 'CO:<proveedor>'). */
  clave: string
  titulo: string
  /** ID del ítem en Monday; vacío si la cabecera no llegó a crearse. */
  id: string
  lineasCreadas: number
  lineasEsperadas: number
}

export interface Contacto {
  /** Código del board ("CONTACT-009"): es el que se muestra. */
  id: string
  /** ID del ítem en Monday: el que se linkea en la columna conectada del presupuesto. */
  itemId?: string
  name: string
  phone: string
  email: string
  ini: string
  color: string
  status: string
  /** Acepta recibir presupuestos. */
  ok: boolean
}

export type LogTipo = 'ok' | 'err' | 'info'

export interface LogEntry {
  id: string
  tipo: LogTipo
  titulo: string
  detalle: string
}

export type TipoVenta = 'CON PRESUPUESTO PREVIO' | 'DIRECTA'
/** La entrega ocurre antes, junto con, o después de la facturación. */
export type TipoEntrega = 'POSTERIOR' | 'ANTERIOR' | 'SIMULTANEA'

/* ===== Operación REMITO ===== */

/**
 * POSTERIOR: se remite mercadería que se facturará luego (queda pend. de facturar).
 * ANTERIOR: se remite mercadería de una venta ya facturada, pendiente de entregar.
 */
export type TipoEmisionRemito = 'ANTERIOR' | 'POSTERIOR'

/** Estado de entrega de una venta ya facturada. Sólo las dos primeras se remiten. */
export type EstadoEntrega = 'Pend. de Entregar' | 'Parcialmente entregada' | 'Entregada'

/** Factura ya emitida de una venta, que se muestra anidada a su entrega pendiente. */
export interface FacturaAsociada {
  nro: string
  fecha: string
  total: number
}

export interface VentaEntregaProducto {
  nombre: string
  codigo: string
  um: string
  /** Unidades vendidas / ya entregadas / que faltan entregar. */
  vendida: number
  entregada: number
  pendiente: number
}

/** Venta facturada con entrega pendiente: origen del remito de emisión ANTERIOR. */
export interface VentaEntrega {
  id: string
  clienteId: string
  fecha: string
  estado: EstadoEntrega
  factura: FacturaAsociada
  productos: VentaEntregaProducto[]
}

/** Línea de mercadería a remitar. El remito documenta cantidades, no importes. */
export interface RemitoItem {
  uid: string
  codigo: string
  nombre: string
  um: string
  cantidad: number
  /** ANTERIOR: tope = unidades pendientes de entregar. POSTERIOR: sin tope. */
  max?: number
}

/** Destino de entrega asociado a un cliente. */
export interface Destino {
  id: string
  clienteId: string
  nombre: string
  direccion: string
}

/** Chofer de La Batea S.A. asignable al transporte. */
export interface Chofer {
  id: string
  name: string
  cuit: string
}

export interface Vehiculo {
  id: string
  patente: string
  descripcion: string
}

/** Comisionista de transporte cargado en el sistema. */
export interface Comisionista {
  id: string
  name: string
  cuit: string
  zona: string
}

/** Quién se hace responsable de entregar la mercadería remitida. */
export type ResponsableEntrega = 'LA_BATEA' | 'COMISIONISTA' | 'CLIENTE'

/** Especificación de la entrega de la mercadería remitida. */
export interface EnvioState {
  /** null hasta que se elige quién entrega. Al cambiarlo se limpian los datos de las otras. */
  responsable: ResponsableEntrega | null

  /* La Batea (flota propia): destino, transporte y COT generado. */
  destinoId: string | null
  choferId: string | null
  vehiculoId: string | null
  /** Código de Operación de Traslado; se genera automáticamente. null = sin generar. */
  cot: string | null

  /* Comisionista responsable del traslado. */
  comisionistaId: string | null

  /* Cliente responsable que retira. */
  responsableNombre: string

  /** La entrega se confirmó a mano; cualquier cambio en los datos la vuelve a abrir. */
  confirmado: boolean
}

/** Todo el estado de la operación REMITO, agrupado como CobroState / FacturaState. */
export interface RemitoState {
  tipoEmision: TipoEmisionRemito | null
  items: RemitoItem[]
  observaciones: string
  envio: EnvioState
  /** Emitido: habilita el cierre del proceso. */
  emitido: boolean
}
