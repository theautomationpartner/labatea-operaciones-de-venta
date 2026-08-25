/** Modelo de dominio. La capa de servicio (v2) debe devolver exactamente estas formas. */

export type Operacion = 'PRESUPUESTAR' | 'VENTA' | 'VENTA PROFORMA' | 'REMITO'

export type Paso =
  | 'inicio'
  | 'cliente'
  | 'productos'
  | 'emision'
  | 'venta'
  | 'venta-proforma'
  | 'remito'
  | 'cobro'
  | 'entrega'
  | 'factura'
  | 'remito-productos'
  | 'remito-envio'
  | 'remito-emision'

export interface Vendedor {
  /** ID numérico del usuario de Monday. Se guarda para asignar la venta en las mutaciones. */
  id: string
  ini: string
  name: string
  color: string
}

/** Usuario logueado en Monday: define el vendedor por defecto y los permisos de la UI (RBAC). */
export interface UsuarioActual {
  /** ID numérico del usuario de Monday (query `me`). */
  id: string
  name: string
  /** Admin de la CUENTA de Monday (`is_admin`), distinto del equipo "Administradores". */
  isAdmin: boolean
  /**
   * IDs de los equipos de Monday a los que pertenece. De acá sale el rol: ver `lib/permisos`.
   *
   * Por ID y no por nombre: un equipo se renombra en dos clics y el ID no cambia nunca. Cuando
   * esto miraba nombres, renombrar "Vendedores" habría dejado a todo el equipo sin permisos sin
   * que nadie tocara una línea de código.
   */
  equiposIds: string[]
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

/**
 * Marca de la tarjeta, para los cobros con débito o crédito. Es texto libre y no una unión cerrada:
 * el selector ofrece VISA y MASTERCARD —las que trae el board— pero deja cargar cualquier otra
 * (AMEX, Cabal, Naranja…) con "➕ Otro tipo…". Ver `TIPOS_TARJETA_BASE`.
 */
export type TarjetaTipo = string

/** Formato de un cheque: papel (físico) o electrónico. */
/**
  * Formato del cheque. Los valores SON las etiquetas de "🤖Origen Cheque" (dropdown_mm5yveka),
  * verificadas contra el board: así lo que se elige en pantalla es exactamente lo que se escribe,
  * sin una tabla de traducción en el medio que pueda quedar desfasada.
  *
  * Antes el papel se llamaba 'FISICO' acá y se mandaba como "Papel", una etiqueta que NO existe en
  * la columna: como el bulk crea las que faltan, cada cheque de papel iba sumando una "Papel"
  * paralela a la "Cheque" del tablero.
  */
export type FormatoCheque = 'Cheque' | 'eCheq'

/**
 * Forma de pago elegida en la selección de productos de una VENTA: define el ramal del cobro.
 * Débito y crédito son formas de pago INDEPENDIENTES —no un subtipo de "tarjetas"—, así que se
 * eligen de una sola vez, sin un segundo selector.
 */
export type FormaPagoVenta =
  | 'CONTADO'
  | 'CUENTA CORRIENTE'
  | 'TARJETA DE DEBITO'
  | 'TARJETA DE CREDITO'

/** Qué tipo de tarjeta es una forma de pago con tarjeta. Lo usa el formulario del cobro. */
export type TipoTarjetaCobro = 'DEBITO' | 'CREDITO'

/**
 * Tasas de comisión del vendedor, en puntos porcentuales. Salen del tablero de configuración
 * (ítems "Comision por Venta") y son ÚNICAS para toda la operación: el producto sólo decide si
 * comisiona o no, ya no con cuánto.
 */
export interface ComisionesVenta {
  /** "Activa": la tasa de la venta CON PRESUPUESTO PREVIO. */
  activa: number
  /** "Pasiva": la tasa de la venta DIRECTA. */
  pasiva: number
}

/** Cuenta bancaria propia de La Batea (ítems "Ctas Bancarias Propias" del board de config). */
export interface CuentaPropia {
  id: string
  name: string
}

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
  /** Condición de pago pactada; encabeza el bloque financiero de la ficha. null = el cliente no
   *  la tiene asignada en el board, y sin ella no se puede armar la operación. */
  condicionPago: CondicionPago | null
  /**
   * "Recibimos CHEQUE" del CRM (color_mm5yb27h). En `false` el cliente NO acepta cheques y el
   * medio queda inhabilitado en el cobro. Sin la columna cargada se asume `true`: la restricción
   * la marca un "NO" explícito, no la ausencia del dato.
   */
  aceptaCheques: boolean
  limit: number
  /** Código del cliente en el sistema (columna text_mm542r9d). Es el que se muestra. */
  codigo: string
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
  /** Precio de lista en su moneda (con IVA si corresponde) SIN redondear. En productos en dólares
   *  se convierte a pesos con la tasa del día usando este valor de precisión completa, y recién el
   *  resultado en pesos se redondea (convertir el precio ya redondeado a 2 dec pierde el 3er
   *  decimal del dólar, que al cambio son ~1,5 pesos). */
  precioBase?: number
  rentabilidad: number
  /** "🤖Costo Final" del maestro (fórmula): precio de COSTO del producto, SIN IVA. Es la base de la
   *  rentabilidad y del contraste con el "Nuevo Precio de Costo" de la rentabilidad forzada. */
  precioCosto?: number
  /**
   * Precio de lista SIN IVA, en la misma moneda que `precio`. Es el que se compara contra el costo:
   * `precio` puede venir con la alícuota sumada (cuando el cliente paga IVA) y medir la ganancia
   * contra un costo neto la inflaría en esa alícuota.
   */
  precioSinIva?: number
  provCod: string
  provNombre: string
  /** ID del ítem del proveedor en el board de Personas. Agrupa la mercadería consignada. */
  provId?: string
  /** Tipo de mercadería: 'CO' (consignada) o 'COM' (común). Parte la venta en comprobantes. */
  tipo: string
  /** Moneda del producto ("Dolares" / "Pesos"). En dólares, el precio se convierte a pesos con la
   *  tasa de cambio del día antes de cargarlo. */
  moneda?: string
  /** Precio ORIGINAL en dólares, guardado antes de convertir a pesos. Sólo se setea cuando el
   *  producto estaba en "Dolares"; sirve de auditoría en la venta (numeric_mm5s58ej). */
  precioUsd?: number
  /**
   * Alícuota de IVA del producto, en % ("✋IVA" del maestro). Se lee al cargar el producto y
   * viaja con la línea: es la que se declara en cada línea del comprobante.
   */
  iva?: number
  /** Si el producto admite comisión ("✋️Comision" del maestro = "SI"). El PORCENTAJE no vive acá:
   *  es una tasa única por tipo de venta, configurada en el tablero del sistema. */
  comisionable?: boolean
  /** "🤖Rentabilidad Forzada" del maestro = "Con Rentab Forzada": habilita aplicarle la rentabilidad
   *  forzada (nota de crédito x comisión) en la selección de productos. */
  conRentabForzada?: boolean
  /** Taxonomía del Maestro de Productos (columnas dropdown). Texto tal cual viene de Monday
   *  (puede traer varias etiquetas separadas por coma). Se usa para filtrar la búsqueda. */
  rubro?: string
  subrubro?: string
  categoria?: string
  /** Unidad de medida: la exige el remito, que documenta cantidades. */
  um: string
  /** Peso unitario en kg ("✋Peso (kg)" del maestro). Alimenta el peso del remito. */
  peso?: number
  fisico: number
  comercial: number
  disponible: number
  /** ID del ítem de "Stock y Movimientos" del producto (Maestro board_relation_mm57jgks). Viaja a
   *  la venta para afectar el stock al cerrarla. */
  stockId?: string
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
  /** "Nota de Crédito x Comisión" por unidad = Costo Original − Nuevo Precio de Costo (con el Nuevo
   *  Precio de Costo = Precio de Venta × (1 − %forzado/100)). Sólo lo tienen los productos "Con Rentab
   *  Forzada" con el interruptor encendido; alimenta el feedback visual y las columnas de Monday. Sin
   *  forzar (o sin Costo Original conocido) queda undefined. */
  montoDifNotaDeCreditoComision?: number
  /** Rentabilidad FORZADA aplicada a la línea (%). Pasa a ser la rentabilidad FINAL del producto; la
   *  rentabilidad BASE (catálogo, junto al precio unitario y al costo) NO se toca. El precio de venta
   *  tampoco cambia. undefined = interruptor apagado / producto no habilitado. */
  rentabForzadaAplicada?: number
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
  /** Descuento por forma de pago con el que se armó la línea (%). Sólo lo trae la venta CON
   *  PROFORMA, leído del subelemento de la proforma (numeric_mm5svkh2). */
  descFormaPago?: number
  /** Monto $ por unidad del descuento por producto, guardado en la proforma (numeric_mm5xxrkw). */
  descProdMonto?: number
  /** Monto $ por unidad del descuento por forma de pago, guardado en la proforma (numeric_mm5x79vt). */
  descFpMonto?: number
  /** Moneda del producto presupuestado ("Pesos" / "Dolares"). Un producto en dólares se convierte
   *  a pesos al llevarlo a la venta CON PRESUPUESTO PREVIO (a la tasa del día). */
  moneda?: string
  /** Tipo de mercadería espejado del maestro: 'CO' (consignada) o 'COM'. */
  tipo?: string
  /** Si el producto admite comisión (mirror "🤖Comision" del subelemento del presupuesto = "SI"). */
  comisionable?: boolean
  /** Alícuota de IVA del producto, en %. Se declara en la línea del comprobante. */
  iva?: number
  /** Unidad de medida del producto. La venta CON PROFORMA la mapea del subelemento (lookup). */
  um?: string
  /** Valores YA calculados leídos del subelemento de la proforma (venta CON PROFORMA), para
   *  mostrarlos tal cual en la tabla en vez de recalcularlos: importe bonificado por unidad, IVA en
   *  $ de la línea y total de la línea. */
  impBonificado?: number
  ivaMonto?: number
  totalLinea?: number
  /** Subtotal en pesos del subelemento del presupuesto ("🤖TOTAL $", numeric_mm5w3qtg). En productos
   *  dolarizados viene vacío: el subtotal en pesos se calcula con la tasa del día en la vista. */
  subtotalPesos?: number
  /** Proveedor del producto: la mercadería consignada se factura por proveedor. */
  proveedorId?: string
  proveedorNombre?: string
  /** "🤖Estado de Uso" del subelemento, tal como está en el board. */
  estadoUso?: string
  /** ID del subelemento del presupuesto en Monday. */
  subitemId?: string
  /** ID del producto conectado en el Maestro de Productos. */
  productoId?: string
  /** ID del ítem de "Stock y Movimientos" (subitem board_relation_mm5pzc9y). Viaja a la venta
   *  CON PRESUPUESTO PREVIO para afectar el stock al cerrarla. */
  stockId?: string
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
  /** El producto comisiona ("Comision" = SI en el Maestro, espejada en el subelemento). Habilita la
   *  comisión al facturar la venta DIRECTA con entrega ANTERIOR. */
  comisionable?: boolean
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
  /** Subtotal de la línea (precio × cantidad), cuando la fuente lo trae calculado. */
  subtotal?: number
  /** ID del ítem padre en "Vtas Pends de Facturar" (18421033947): trazabilidad del linaje. */
  ventaPendId?: string
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

/**
 * Medios de cobro. Los que arrancan con "Retencion" comparten un mismo ramal de carga (importe +
 * comprobante obligatorio): se detectan por el prefijo del nombre, no enumerándolos uno por uno,
 * así sumar una retención nueva al catálogo no obliga a tocar la lógica (ver `esRetencion`).
 */
export type FormaPago =
  | 'Efectivo'
  | 'Cheque'
  | 'Transferencia'
  | 'Retencion IVA'
  | 'Retencion IIBB'
  | 'Retencion GAN'
  | 'Retencion CCSS'
  | 'Tarjeta de débito'
  | 'Tarjeta de crédito'
  /**
   * ANTICIPO: no es plata que entra sino plata que se PARKEA. Se elige cuando el cliente entregó de
   * más y ese excedente queda a su favor para imputarlo a una factura futura, en vez de retocar los
   * importes hasta que la diferencia cierre en cero. Por eso suma del lado de lo que hay que
   * cancelar y no del de lo recibido (ver `resumenCobro`).
   */
  | 'Anticipo'

/** Un pago concreto del cobro. La forma de pago define su descuento y qué datos extra pide. */
export interface MovimientoPago {
  id: string
  formaPago: FormaPago
  importe: number
  /**
   * Texto libre de referencia del movimiento. Quedó SIN uso: no se muestra ni se escribe en ningún
   * tablero. Es opcional para que el formulario no tenga que inventarle un valor a cada borrador.
   */
  referencia?: string
  /** Sólo cheque: no puede vencer después del día de hoy (ver `chequeInvalido`). */
  chequeVencimiento: string
  /** Cheque: número, fecha de emisión (dd/mm/aaaa) y banco emisor. */
  numeroCheque?: string
  fechaEmisionCheque?: string
  bancoEmisor?: string
  /**
   * Cheque: CUIT del emisor, guardado como los tres tramos separados por guiones ("XX-XXXXXXXX-X").
   * Mientras se carga puede estar incompleto ("20-1234-"): los guiones son fijos, así que el valor
   * siempre se parte en exactamente tres tramos (ver `partesCuit`).
   */
  cuitEmisor?: string
  /** Cheque: formato del documento, físico o electrónico (eCheq). */
  formatoCheque?: FormatoCheque
  /**
   * Cuenta bancaria PROPIA sobre la que impacta el pago, elegida del tablero de cuentas: en la
   * transferencia es la cuenta de destino; en la tarjeta, el "Banco de Acreditación".
   */
  cuentaPropia?: string | null
  /**
   * ID del ítem de esa cuenta propia en el tablero de configuración. Es lo que necesitan las
   * columnas de relación del recibo ("Banco de Acreditación"); el nombre sólo sirve para mostrar.
   */
  cuentaPropiaId?: string | null
  /**
   * Retenciones (IVA, IIBB, GAN…): año del certificado y número del comprobante que lo respalda.
   * Son de TODAS las retenciones, no de una en particular: el ramal se reconoce por el prefijo del
   * medio de cobro (ver `esRetencion`), así que una retención nueva los pide sola.
   */
  anioRetencion?: string
  nroComprobanteRetencion?: string
  /**
   * Transferencia: número de la operación que figura en el comprobante bancario. Es la referencia
   * con la que se concilia el movimiento contra el extracto, y viaja a la misma columna
   * "🤖Nro Comprobante" que el número del cheque, el del cupón y el del certificado.
   */
  nroComprobanteTransferencia?: string
  /** Nombre del archivo de comprobante adjunto. Obligatorio en transferencia, retenciones y tarjeta. */
  comprobanteNombre?: string
  /**
   * El archivo en sí. Se conserva porque las columnas `file` de Monday sólo se completan subiendo
   * el binario (`add_file_to_column`), no por `column_values`. Vive únicamente en memoria: no se
   * persiste ni viaja en ningún payload JSON.
   */
  comprobanteArchivo?: File | null
  /** Tarjeta (débito/crédito): banco emisor y tipo de tarjeta. */
  bancoTarjeta?: string
  tipoTarjeta?: TarjetaTipo | null
  /** Tarjeta: vencimiento del plástico (dd/mm/aaaa). */
  vencimientoTarjeta?: string
  /** Tarjeta: número de cupón que imprime el posnet. Es la referencia de la acreditación. */
  numeroCupon?: string
}

/**
 * SIMULTANEO: el pago se registra junto con la factura (clientes de contado).
 * POSTERIOR: la factura se cobra después; registrar un pago ahora es opcional.
 * Se deriva de la condición de pago del cliente y no se puede cambiar a mano.
 */
export type TipoPago = 'SIMULTANEO' | 'POSTERIOR'

/**
 * El cobro en curso. Sólo existe para la venta que se cobra EN EL ACTO: la venta a CUENTA
 * CORRIENTE no carga movimientos —queda pendiente y su deuda se escribe al finalizar—.
 */
export interface CobroState {
  fecha: string
  movimientos: MovimientoPago[]
  /** Se confirma a mano; cualquier cambio en los movimientos lo vuelve a abrir. */
  confirmado: boolean
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
  /** Ruta de entrega asignada al pendiente (board_relation_mm5pa9v3), para verla al remitar. */
  ruta?: string
  /** "🤖Estado de Entrega" de la línea, tal como está en el board. */
  estadoEntrega?: string
  /** La línea se puede remitar. Es false para los productos "100% Entregada". */
  seleccionable?: boolean
  /** ID del subelemento de la venta en Monday. */
  subitemId?: string
  /** ID del producto conectado en el Maestro de Productos. */
  productoId?: string
  /** ID del ítem de la venta a la que pertenece la línea. Se linkea en el remito. */
  ventaId?: string
  /** Peso unitario del producto en kg. Alimenta el peso de la línea del remito. */
  peso?: number
  /** ID del ítem de "Pends de Entrega" (board_relation_mm5psr2k): afectado al emitir el remito. */
  pendienteEntregaId?: string
  /** ID del ítem de "Stock y Movimientos" (board_relation_mm5pz6kz): afectado al emitir el remito. */
  stockId?: string
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

/**
 * Venta del cliente con entrega POSTERIOR todavía pendiente, leída del board de Ventas. Es el
 * origen del remito de emisión ANTERIOR: su mercadería es lo que falta entregar.
 */
export interface VentaEntregaPendiente {
  /** ID del ítem de la venta en Monday. */
  id: string
  /** "🤖ID VTA" del board ("VTA-016"): es el que se ve en la card. */
  nro: string
  /** "🤖Estado de Entrega" a nivel venta, tal cual el board. */
  estadoEntrega: string
  /** Fecha de la venta (dd/MM/yyyy). */
  fecha: string
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
  /** ANTERIOR: subelemento de la venta del que sale la línea. Es donde se asienta lo entregado. */
  subitemId?: string
  /** Id del producto en el Maestro (del subelemento de la venta o del catálogo). Se linkea
   *  en la línea del remito. */
  productoId?: string
  /** ANTERIOR: unidades ya entregadas de la venta al momento de armar el remito. La cant
   *  entregada nueva se calcula sobre este valor, así reemitir no la duplica. */
  entregadaPrevia?: number
  /** ANTERIOR: id de la venta de la que sale la línea. Se linkea en la cabecera del remito. */
  ventaId?: string
  /** Peso unitario del producto en kg. Con la cantidad, da el peso de la línea. */
  peso?: number
  /** Precio unitario del producto (lista del cliente). Sólo se usa en el remito POSTERIOR, para
   *  el importe pendiente de facturar (cantidad × precio). */
  precioUnitario?: number
  /** Tipo de mercadería del producto: 'CO' (consignada) o 'COM' (común). POSTERIOR: viaja a la
   *  "Vta Pend de Facturar" para etiquetar el tipo de producto en el subelemento. */
  tipo?: string
  /** Rentabilidad del producto según la lista del cliente, en %. POSTERIOR: viaja a la "Vta Pend de
   *  Facturar" para reusarla en la rentabilidad general al facturar la venta DIRECTA con entrega ANTERIOR. */
  rentabilidad?: number
  /** ANTERIOR: ítem de "Pends de Entrega" de la línea. Se afecta al emitir el remito. */
  pendienteEntregaId?: string
  /** ANTERIOR: ítem de "Stock y Movimientos" del producto. Se afecta al emitir el remito. */
  stockId?: string
}

/** Destino de entrega asociado a un cliente. */
export interface Destino {
  id: string
  /** Cliente dueño del destino. Opcional: el servicio ya los trae filtrados por cliente. */
  clienteId?: string
  nombre: string
  direccion: string
}

/** Chofer/transportista asignable al transporte (persona con categoría "Transportista"). */
export interface Chofer {
  id: string
  name: string
  /** CUIT/CUIL del transportista; puede venir vacío. */
  cuit: string
}

export interface Vehiculo {
  id: string
  /** Nombre del ítem: es lo que se muestra al elegir el vehículo. */
  name: string
  /** Patente/chasis; puede venir vacío. */
  patente: string
  descripcion?: string
}

/** Comisionista de transporte cargado en el sistema (persona categoría "Comisionista"). */
export interface Comisionista {
  id: string
  name: string
  cuit: string
  /** Zona: sólo existe en el mock; el board de Personas no la tiene. */
  zona?: string
}

/** Quién se hace responsable de entregar la mercadería remitida. */
export type ResponsableEntrega = 'LA_BATEA' | 'COMISIONISTA' | 'CLIENTE'

/**
 * Responsable logístico y ruta de la venta, elegidos en el Cierre de Venta. Es una variante
 * reducida de `EnvioState`: cuando entrega La Batea no se piden destino/transporte, sólo una
 * "Ruta de Entrega" que se confirma y bloquea.
 */
export interface EntregaVentaState {
  /** null hasta que se elige quién entrega. Al cambiarlo se limpian los datos de las otras. */
  responsable: ResponsableEntrega | null
  /** La Batea: ruta de transporte elegida (board 18421708745). */
  rutaId: string | null
  rutaNombre: string
  /** La ruta se confirmó a mano: bloquea el select y habilita avanzar de etapa. */
  rutaConfirmada: boolean
  /** Comisionista responsable del traslado. */
  comisionistaId: string | null
  comisionistaNombre?: string
  comisionistaCuit?: string
  /** Cliente responsable que retira. */
  responsableNombre: string
}

/** Especificación de la entrega de la mercadería remitida. */
export interface EnvioState {
  /** null hasta que se elige quién entrega. Al cambiarlo se limpian los datos de las otras. */
  responsable: ResponsableEntrega | null

  /* La Batea (flota propia): destino, transporte y COT generado. Se guardan los datos que se
     muestran (nombre, dirección, CUIT, patente) junto al id, porque el resumen y el PDF los
     leen de acá y no vuelven a consultar Monday. */
  destinoId: string | null
  destinoNombre?: string
  destinoDireccion?: string
  choferId: string | null
  choferNombre?: string
  choferCuit?: string
  vehiculoId: string | null
  vehiculoNombre?: string
  vehiculoPatente?: string
  /** Código de Operación de Traslado; se genera automáticamente. null = sin generar. */
  cot: string | null

  /* Comisionista responsable del traslado. Se guardan sus datos para el resumen y el PDF. */
  comisionistaId: string | null
  comisionistaNombre?: string
  comisionistaCuit?: string

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
  /** ID del ítem del remito ya creado en Monday. null = todavía no se creó. Evita recrearlo. */
  remitoId: string | null
  /** Emitido: habilita el cierre del proceso. */
  emitido: boolean
}
