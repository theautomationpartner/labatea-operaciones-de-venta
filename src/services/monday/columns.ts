/**
 * IDs de tableros y columnas de la cuenta de La Batea, validados uno por uno contra la API
 * real (get_board_info / queries). Único punto a tocar si el board cambia.
 */
import type { CondicionIVA, ListaPrecio } from '@/types'

/**
 * Valor de una columna Person para la API de Monday: asigna un único usuario por su id
 * (`{ personsAndTeams: [{ id, kind: 'person' }] }`, el mismo formato con el que Monday devuelve la
 * columna). Devuelve `null` si el id no es válido, para poder omitir la columna sin romper la
 * mutación. El `kind` es obligatorio: sin él (o con el shape `{ persons: [...] }`) la API rechaza el
 * valor con `ColumnValueException` y falla el `create_item`.
 */
export const personCol = (
  id: string | number | null | undefined,
): { personsAndTeams: { id: number; kind: 'person' }[] } | null => {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? { personsAndTeams: [{ id: n, kind: 'person' }] } : null
}

export const BOARDS = {
  personas: 18420688238,
  productos: 18421035535,
  contactos: 18420688239,
  presupuestos: 18421035513,
  /** Board de subelementos del presupuesto (uno por producto). */
  presupuestosSub: 18421035575,
  /** "Proformas": origen de la venta CON PROFORMA. Un ítem por proforma, con un subítem por producto. */
  proformas: 18424580497,
  config: 18421035530,
  /* La Cuenta Corriente del cliente (18421858736) y sus movimientos (18421858762) NO se escriben
     desde la app: ese requerimiento se descartó. Sus columnas se siguen LEYENDO —para el crédito
     disponible— a través de la relación del cliente, que no necesita el id del tablero. */
  /** "➡️Recibos y Cobros": cabecera del cobro. Se crea SIEMPRE, sea simultáneo o posterior. */
  cobros: 18421035524,
  /** Subelementos del recibo: un movimiento de pago cada uno. */
  cobrosSub: 18421035599,
  /** "💰Fact Vtas Pends de Cobro": la deuda que deja el pago POSTERIOR. */
  factPendientes: 18421035508,
  /** "💳Ctas Bancarias Personas": las cuentas a las que el cliente transfiere. */
  ctasBancarias: 18421723667,
  /** "📈Ventas": la venta cerrada, con un subelemento por producto. */
  ventas: 18421035510,
  /** "Subelementos de 📈Ventas": un producto de la venta cada uno. */
  ventasSub: 18421035581,
  /** "🧾🚚 Remitos Ventas": la mercadería ya entregada, pendiente o no de facturar. */
  remitos: 18421035529,
  /** Subelementos del remito: un movimiento de mercadería por producto. */
  remitosSub: 18421035607,
  /** "Vtas Pends de Facturar": un ítem por remito POSTERIOR que quedó pendiente de facturar. */
  vtasPendFacturar: 18421033947,
  /** Subelementos de "Vtas Pends de Facturar": un producto por línea del remito. */
  vtasPendFacturarSub: 18421034035,
  /** "Talonarios Remito": cada ítem es un talonario; su estado marca cuál está "En USO". */
  talonarios: 18423468398,
  /** Subelementos del talonario: una hoja/folio cada uno, con su estado "Pend de Usar". */
  talonariosSub: 18423468575,
  /** "🚚Pends de Entrega": un ítem por producto vendido pendiente de entregar. */
  pendientesEntrega: 18421035527,
  /** Subelementos de "Pends de Entrega": un movimiento de entrega (RTO) cada uno. */
  pendientesEntregaSub: 18421035605,
  /** "🧮Stock y Movimientos": un ítem por producto, con su saldo y sus movimientos. */
  stockMovimientos: 18421752251,
  /** Subelementos de "Stock y Movimientos": un movimiento de stock (entrada/salida) cada uno. */
  stockMovimientosSub: 18421752360,
  /** "Facturación": un ítem por comprobante a emitir. */
  facturacion: 18422405731,
  /** Subelementos del comprobante: una línea de facturación por producto. */
  facturacionSub: 18422405734,
  /** "📍Destinos": los puntos de entrega, cada uno conectado a uno o más clientes. */
  destinos: 18421035523,
  /** "🚛Vehículos": la flota propia de La Batea. */
  vehiculos: 18421035528,
  /** "Cotizaciones": el último ítem trae la cotización del dólar del momento. */
  cotizaciones: 18422367325,
  /** "🛣️Rutas de Transporte": las rutas de entrega que se asignan a la venta. */
  rutasEntrega: 18421708745,
  /** "Pend Venta de Liq CYO": un ítem por producto consignado (cuenta y orden) facturado. */
  consignacionesCYO: 18421465215,
  /** "💲Registro de Comisiones": un ítem por venta comisionable, con un subítem por producto. */
  comisiones: 18421035548,
  /** Subelementos de "💲Registro de Comisiones": un producto comisionable de la venta cada uno. */
  comisionesSub: 18421035638,
} as const

/** Item de config donde vive el valor de "Días de Vigencia de Presupuesto". */
export const CONFIG_DIAS_VIGENCIA_ITEM = 12564005039
/** Item de config con el tope máximo y mínimo del descuento por producto. */
export const CONFIG_DESCUENTO_ITEM = 12592496747
/**
 * Índice de "Medios de Pago" en la columna "Tipo de Config" (color_mm4emv5g). Se filtra por
 * índice y no por label: es lo que aguanta que a la etiqueta le cambien el texto.
 */
export const CONFIG_TIPO_MEDIOS_PAGO_INDEX = 1

/**
 * Índice de "Comision por Venta" en la misma "Tipo de Config". Son los ítems que definen la tasa
 * de comisión del vendedor. OJO con el label: en el board va en SINGULAR ("Comision por Venta").
 */
export const CONFIG_TIPO_COMISION_INDEX = 0

/**
 * "Tipo de Gestion" (color_mm4ewj21) del ítem de comisión → tipo de venta al que aplica su tasa.
 * Se filtra por índice, que aguanta que le reescriban el texto a la etiqueta.
 */
export const CONFIG_GESTION_INDEX = {
  /** "Pasiva": la tasa de la venta DIRECTA. */
  pasiva: 0,
  /** "Activa": la tasa de la venta CON PRESUPUESTO PREVIO. */
  activa: 1,
} as const

/**
 * Estado con el que nace la comisión en "🤖Estado de Comision" (color_mm5by36r). El texto es
 * EXACTAMENTE el del board: "Pend de Liquidar". Antes se mandaba "Pend de Cobro", que no existe
 * como etiqueta, y eso hacía que Monday rechazara el `create_item` entero: la comisión no se
 * creaba nunca. Etiquetas válidas: "Parcialmente Liq", "100% Liquidada", "No Existe Com Disp" y
 * "Pend de Liquidar".
 */
export const COMISION_ESTADO_PENDIENTE_LABEL = 'Pend de Liquidar'

/** Índice de "Activa" en "✋Estado" (color_mm57wxbx) del board de cuentas bancarias. */
export const CTA_BANCARIA_ACTIVA_INDEX = 1

/**
 * Índice de "Transportista" en "✋Categoria" (dropdown_mm54e5ag) del board de Personas. Los
 * choferes son personas cuya categoría —multi-valor— contiene esta etiqueta. Se filtra por
 * índice, que aguanta que le reescriban el texto. Validado: "Transportista" es el id 3.
 */
export const CATEGORIA_TRANSPORTISTA_INDEX = 3

/** Índice de "Comisionista" en la misma "✋Categoria". Validado: es el id 6. */
export const CATEGORIA_COMISIONISTA_INDEX = 6

/**
 * Índices de "🤖Estado" (color_mkwb727e) en "💰Fact Vtas Pends de Cobro". No siguen el orden
 * en que se ven en el board: "Pend de Cobrar 100%" figura primera pero es el índice 2.
 */
export const FACT_PENDIENTE_ESTADO_INDEX = {
  canceladaParcialmente: 0,
  cancelada: 1,
  pendienteDeCobro: 2,
} as const

/* Índices de las columnas status del board de Ventas (18421035510). Se leyeron del board:
   las etiquetas son "Directa"/"C/ Presup Previo", "Anterior"/"Posterior"/"Simultánea" y
   "Posterior"/"Simultaneo", y los índices NO son correlativos. */
export const VENTA_TIPO_INDEX = {
  directa: 2,
  conPresupuestoPrevio: 3,
} as const

export const VENTA_ENTREGA_INDEX = {
  anterior: 0,
  posterior: 1,
  simultanea: 2,
} as const

/**
 * Índices de "🤖Estado de Entrega" (color_mm58xjgj) a nivel venta, y de la misma columna a
 * nivel producto (color_mm5bhha): en las dos, "100% Entregada" es el índice 1. Verificado
 * contra el board. Se filtra/lee por índice, no por el texto.
 */
export const VENTA_ENTREGA_ESTADO_INDEX = {
  entregadoParcialmente: 0,
  totalmenteEntregada: 1,
  sinEntregar: 2,
} as const

export const VENTA_COBRO_INDEX = {
  posterior: 0,
  simultaneo: 1,
} as const

/* Índices de las columnas status de "🧾🚚 Remitos Ventas" (18421035529). Como en el resto de
   la app se filtra por índice y no por el texto de la etiqueta.

   Ojo: el índice es el que devuelve `... on StatusValue { index }` y el que aceptan las reglas
   de `query_params`, NO el campo "index" que muestran los settings de la columna —ése es el
   orden en que se ven las etiquetas en el board—. Los tres se verificaron contra la API. */

/**
 * Índices de "✋Venta" (color_mkwbrkg6): cuándo se hace la venta respecto de la entrega.
 * "Posterior" = la mercadería salió antes de facturarse, así que el remito todavía tiene
 * algo que facturar.
 */
export const REMITO_VENTA_INDEX = {
  posterior: 0,
  anterior: 1,
} as const

/**
 * Labels de "🤖Estado Emision Remito" (color_mkwb12n1) y "🤖Estado Envio Remito"
 * (color_mm5gpcbj). Al emitir/enviar se escribe por ÍNDICE —el índice se resuelve leyendo la
 * columna, no se mapea por el texto—: acá sólo viven los nombres que se buscan y los que marcan
 * que el proceso ya terminó. Verificado: "Emitir" y "Enviar" son ambos el índice 3.
 */
export const REMITO_EMISION_ESTADO = {
  emitir: 'Emitir',
  emitiendo: 'Emitiendo',
  emitido: 'Emitido',
  error: 'Error Emision',
} as const
export const REMITO_ENVIO_ESTADO = {
  enviar: 'Enviar',
  enviando: 'Enviando',
  enviado: 'Enviado',
  error: 'Error - Ver Update',
} as const

/**
 * Índices de "✋️Situacion Cliente" (color_mm58nd7b) en el board de Personas. La situación se
 * lee por índice y no por el texto de la etiqueta ("0-Liberado Con Credito", "1-Bloqueado"…),
 * que puede reescribirse en el board sin avisar.
 */
/**
 * Índices de "🤖Estado de Vta Gnral" (color_mm54y5vc) en el board de Presupuestos.
 * 0 = Parcialmente Vendido · 1 = 100% Vendido · 2 = 0% Vendido. Verificado contra el board.
 */
export const PRESUP_ESTADO_VENTA_INDEX = {
  parcialmenteVendido: 0,
  totalmenteVendido: 1,
  sinVender: 2,
} as const

/**
 * Índices de "🤖Estado de Uso" (color_mm54j58z) del subelemento del presupuesto.
 * 0 = Vendido Parcialmente · 1 = 100% Vendido · 2 = 0% Vendido. Verificado contra el board.
 */
export const PRESUP_SUB_ESTADO_USO_INDEX = {
  vendidoParcialmente: 0,
  totalmenteVendido: 1,
  sinVender: 2,
} as const

export const SITUACION_CLIENTE_INDEX = {
  liberadoConCredito: 0,
  liberadoSinCredito: 1,
  bloqueado: 2,
} as const

export const COL = {
  cliente: {
    categoria: 'dropdown_mm54e5ag', // multi-valor: se filtra por "contiene Cliente"
    codigo: 'text_mm542r9d',
    cuit: 'text_mm54btnd',
    dirFiscal: 'location_mm54jt1g',
    tipoPersona: 'color_mm54k8hr',
    condFiscal: 'color_mm54yakw',
    listaPrecio: 'dropdown_mm582vqy',
    agenteRet: 'dropdown_mm54fnwn',
    situacion: 'color_mm58nd7b',
    estado: 'color_mm588vd6',
    condPago: 'dropdown_mm54yq06',
    /** "Recibimos CHEQUE" (status): "SI" o "NO". Un "NO" impide cobrarle con cheque. */
    aceptaCheques: 'color_mm5yb27h',
    limite: 'numeric_mm57tw48',
    ctaCte: 'board_relation_mm5ep5qd',
    contactos: 'account_contact',
  },
  /* Board de Cta Cte. El crédito se arma con las columnas BASE, no con las fórmulas del
     tablero: `saldo`, `lineaUtilizada` y `disponible` existen como fórmula, pero la app las
     recalcula para no depender de que el board las tenga al día. Las mirror se leen por
     `display_value` (con el fragmento `... on MirrorValue`); `text` viene siempre vacío. */
  ctaCte: {
    /** "🤖Total Ventas": todo lo facturado a la cuenta. */
    totalVentas: 'lookup_mm5g2exg',
    /** "🤖Total Cobros": todo lo cobrado. Vacío = 0. */
    totalCobros: 'lookup_mm5gx0d5',
    /** "🤖Remito Pends de Facturar": entregado y todavía sin facturar. */
    remitosPendFacturar: 'numeric_mm5f2npa',
    /** "🤖Limite de credito": el límite del cliente, espejado en su cuenta. */
    limite: 'lookup_mm585jgv',
  },
  producto: {
    /** "✋Codigo Interno": el código del producto que ve el usuario (1 a 4 dígitos), único por
     *  producto. Es por el que se busca directo, sin aplicar los filtros de taxonomía. */
    codigo: 'text_mm5ghnv7',
    rubro: 'dropdown_mm509v8g',
    subrubro: 'dropdown_mm51jz35',
    categoria: 'dropdown_mm50pcb8',
    /** "✋Unidad de Venta" del maestro: la etiqueta de U.M. que documenta el remito. El id anterior
     *  (dropdown_mm5fh71h) no existe en el board, por eso la U.M. venía vacía. */
    unidadMedida: 'dropdown_mm4vhc0h',
    /** "✋Peso (kg)": peso unitario del producto. Alimenta el peso del remito. */
    peso: 'numeric_mm4d54r6',
    /* El STOCK no vive en el maestro: son tres fórmulas del ítem conectado en "🧮Stock y
       Movimientos" (ver `COL.stockItem`), al que se llega por la relación `stock` de abajo. */
    proveedor: 'board_relation_mm4812az',
    /** "🤖Código Sistema Prov": espeja el código del proveedor conectado. */
    proveedorCodigo: 'lookup_mm5fh97p',
    tipoMercaderia: 'color_mm48hm74',
    /** "Moneda" del producto (status): "Dolares" / "Pesos". En dólares el precio se convierte a
     *  pesos con la cotización antes de cargarlo. */
    moneda: 'color_mm4kwdj6',
    /**
     * "✋️Comision" (status "SI"/"NO"): indica si el producto es comisionable. Es la fuente de la
     * venta DIRECTA, que arma la mercadería desde el catálogo.
     * El PORCENTAJE ya no vive en el producto: es una tasa única por tipo de venta, en el tablero
     * de configuración (ver `getComisionesVenta`).
     */
    comisionable: 'color_mm51p0wn',
    /** "✋IVA": alícuota del producto, en %. Se suma al precio de lista si el cliente la paga. */
    iva: 'numeric_mm5gyrnb',
    /** "🧮Stock y Movimientos": ítem de stock del producto (board 18421752251). Venta DIRECTA. */
    stock: 'board_relation_mm57jgks',
  },
  /* Precio unitario por lista de precio (L1..L8). Es el precio del Maestro de Productos, sin
     IVA: la alícuota se agrega después, según la condición fiscal del cliente. Son columnas
     fórmula, así que el valor viene en `display_value`. */
  precioLista: {
    L1: 'formula_mm51ch66',
    L2: 'formula_mm51yc26',
    L3: 'formula_mm51jtgz',
    L4: 'formula_mm515gb3',
    L5: 'formula_mm51s99p',
    L6: 'formula_mm51vaca',
    L7: 'formula_mm512bhw',
    L8: 'formula_mm513rvw',
  } as Record<ListaPrecio, string>,
  // Rentabilidad (margen) por lista. Por ahora sólo L1–L3 existen en el board.
  margen: {
    L1: 'numeric_mm58135k',
    L2: 'formula_mm51nqvz',
    L3: 'formula_mm51fjf5',
  } as Partial<Record<ListaPrecio, string>>,
  contacto: {
    codigo: 'pulse_id_mm572ncq',
    /** El nombre se arma con estas dos columnas, no con el `name` del ítem. */
    nombre: 'text_mm5848zg',
    apellido: 'text_mm58q0bx',
    email: 'contact_email',
    /** La columna se llama "Whatsapp" en el board: es el teléfono del contacto. */
    telefono: 'contact_phone',
    paraEnviar: 'dropdown_mm57p8ja',
    cliente: 'contact_account',
  },
  // El board de presupuesto tiene TRES columnas de estado paralelas (validado contra el board
  // real 18421035513), no una sola que cambia de valor:
  presupuesto: {
    /** Vigencia del presupuesto: se setea "Vigente" al crearlo. */
    vigencia: 'color_mm57cmkt',
    /** Estado del PDF: al ponerlo en "Emitir" se dispara la automatización → Make.com genera el PDF. */
    estadoPdf: 'color_mkw81a0d',
    /** Medio de envío ("🤖Enviar por:"): dropdown multi-valor con Whatsapp / Email. */
    medioEnvio: 'dropdown_mm5f5rhv',
    /** Estado de envío: al ponerlo en "A Enviar" se dispara el envío. */
    estadoEnvio: 'color_mm48mc2p',
    pdf: 'file_mkse56g9',
    /** ID del ítem (custom key "PRESUP##"); el ítem se renombra con este valor. */
    pulseId: 'pulse_id_mkwb5sj3',
    vendedor: 'person',
    cliente: 'board_relation_mm58ebhj',
    contactos: 'board_relation_mm54hpns',
    fechaEmision: 'date_mm4832z6',
    diasVigencia: 'numeric_mm52v40w',
    fechaVencimiento: 'date_mkw8rbvn',
    rentabilidad: 'numeric_mm524676',
    /** "🤖Estado de Vta Gnral": cuánto del presupuesto ya se llevó a una venta. */
    estadoVenta: 'color_mm54y5vc',
    /** Moneda del presupuesto ("✋Moneda"): de ella dependen las fórmulas de subtotal $ / $u. */
    moneda: 'color_mkwgfyv1',
    /** "🤖TOTAL EN PESOS $": neto en pesos del presupuesto (columna numérica, se escribe al crear). */
    totalPesos: 'numeric_mm5w1sm5',
    /** "🤖TOTAL EN DOLARES $u": neto en dólares del presupuesto (columna numérica, se escribe al crear). */
    totalUsd: 'numeric_mm5wfyfe',
  },
  // Columnas del subelemento (un producto de la lista):
  presupuestoSub: {
    producto: 'board_relation_mm57gxye',
    /**
     * "🤖Unidad de Venta": mirror de "✋Unidad de Venta" del Maestro. Es la fuente de la U.M. en la
     * venta CON PRESUPUESTO PREVIO, que arma la mercadería desde estos subelementos.
     */
    unidadVenta: 'lookup_mm5z6x43',
    cantidad: 'numeric_mksesd2',
    rentabilidad: 'numeric_mm4cmpa6',
    /** "🤖Precio Unit $": precio unitario en pesos (productos en pesos). */
    precioUnit: 'numeric_mkw85hdw',
    /** "🤖Precio Unit $u": precio unitario en dólares (productos en dólares). */
    precioUnitUsd: 'numeric_mm5wpag',
    /** "🤖Importe Bonif.": monto bonificado por unidad (precio × desc%/100), en la moneda del producto. */
    importeBonif: 'numeric_mm5rddvm',
    /** "🤖Precio Bonif": precio unitario ya bonificado (precio − importe bonif.), en la moneda del producto. */
    precioBonif: 'numeric_mm5w6h1x',
    /** "🤖TOTAL $": total de la línea en pesos (productos en pesos). */
    totalPesos: 'numeric_mm5w3qtg',
    /** "🤖TOTAL $u": total de la línea en dólares (productos en dólares). */
    totalUsd: 'numeric_mm5wrcvx',
    /** "🤖 Moneda" (mirror del producto): "Pesos" / "Dolares". */
    moneda: 'lookup_mm5e3e8f',
    /** "🤖IVA (%)": alícuota de IVA del producto (del Maestro). Se guarda para la venta; el
     *  presupuesto no la liquida. */
    iva: 'numeric_mm5wt7hg',
    descuento: 'numeric_mm472cqy',
    /** "🤖Desc $ x Prod": monto del descuento por producto por unidad (precio × %desc/100), en la
     *  moneda del producto. A diferencia de "Importe Bonif.", sin descuento vale 0 (no el precio). */
    descProdMonto: 'numeric_mm5x3wee',
    /** "🤖 Cant Vendida": unidades del producto ya llevadas a una venta. */
    cantVendida: 'numeric_mm54546t',
    /** "🤖Estado de Uso": 0% / Parcialmente / 100% Vendido. */
    estadoUso: 'color_mm54j58z',
    /** "Reflejo" del Tipo de Mercadería del producto conectado: CO / COM. */
    tipoMercaderia: 'lookup_mm5gym7g',
    /**
     * "🤖Comision": mirror de "✋️Comision" del producto ("SI" / "NO"). Es la fuente de la venta
     * CON PRESUPUESTO PREVIO, que arma la mercadería desde los subelementos del presupuesto.
     */
    comisionable: 'lookup_mm5yvmdh',
    /** "🧮Stock y Movimientos": ítem de stock del producto. Se hereda del Maestro al presupuestar
     *  y viaja a la venta (CON PRESUPUESTO PREVIO). */
    stock: 'board_relation_mm5pzc9y',
    /** ID del subelemento; se usa para renombrarlo. */
    pulseId: 'pulse_id_mkw8mfdg',
  },
  // Board "Proformas" (18424580497): origen de la venta CON PROFORMA y destino al emitir una proforma.
  proforma: {
    /** "🤖Vendedor" (people): el vendedor de la operación. */
    vendedor: 'person',
    /** "Connect Boards" al cliente (Personas): filtra las proformas del cliente elegido. */
    cliente: 'board_relation_mm582k6v',
    /** "🤖Importe Total" (lookup): total de la proforma. */
    importe: 'lookup_mm5qxprp',
    /** "🤖Rentabilidad % GENERAL" (numérico): rentabilidad general de la proforma. */
    rentabilidad: 'numeric_mm52rk7t',
    /** "🤖Tasa de Cambio": tasa del dólar usada al armar la proforma (auditoría a nivel ítem). */
    tasaCambio: 'numeric_mm5w6j5s',
    /** Descuento total de la venta (suma de los importes bonificados de todas las líneas). */
    descuentoTotal: 'numeric_mm5s8vjg',
    /** IVA total de la venta (en $). */
    ivaTotal: 'numeric_mm5ssfpm',
    /** TOTAL de la venta (neto bonificado + IVA). También es el importe que se muestra por proforma. */
    total: 'numeric_mm5sw8n2',
    /** Tipo de venta (status): "CON PRESUPUESTO PREVIO" / "DIRECTA". */
    tipoVenta: 'color_mm5142e4',
    /** Tipo de entrega (status): POSTERIOR / ANTERIOR / SIMULTANEA. */
    tipoEntrega: 'color_mm489k2j',
    /** Tipo de cobro (status): la proforma exige contado → siempre "SIMULTANEO". */
    tipoCobro: 'color_mm5b7t0d',
    /** "✋Estado Proforma": ciclo de vida de la proforma. Nace "Pendiente de Venta" y pasa a
     *  "Usada" cuando se factura. Sólo las "Pendiente de Venta" se listan para facturar. */
    estadoVenta: 'color_mm5smnqe',
    /** Estado de emisión del PDF: ponerlo en "Emitir" dispara la generación del documento. */
    estadoPdf: 'color_mm4dqxq3',
    /** "Contactos" (board_relation): destinatarios del envío de la proforma. */
    contactos: 'board_relation_mm5njnad',
    /** Medio de envío (dropdown): Whatsapp / Email. */
    medioEnvio: 'dropdown_mm5njprp',
    /** Acción de envío (status): ponerlo en "Enviar" dispara el despacho. */
    estadoEnvio: 'color_mm5spfvt',
  },
  // Columnas del subelemento de la Proforma (un producto cada uno):
  proformaSub: {
    /** Producto conectado en el Maestro (id + nombre del ítem vinculado). */
    producto: 'board_relation_mkwctrv6',
    /** "🤖Comision" (mirror del Maestro, "SI"/"NO"): define si el producto comisiona en la venta. */
    comisionable: 'lookup_mm5zgkdr',
    /** "U.M." (lookup): unidad de medida del producto. */
    unidadMedida: 'lookup_mm5hr4p9',
    /** Cantidad vendida (numérico). */
    cantidad: 'numeric_mksesd2',
    /** "🤖Precio Unit $": precio unitario convertido a PESOS (numérico). */
    precioUnit: 'numeric_mkw85hdw',
    /** "🤖Precio Unit u$": precio unitario en DÓLARES; sólo si el producto estaba en dólares. */
    precioUnitUsd: 'numeric_mm5stwa2',
    /** "🤖Desc % x Prod": descuento manual del producto, en %. 0 si no se aplicó ninguno. */
    descuento: 'numeric_mm472cqy',
    /** "🤖Desc % x Forma de Pago": descuento por pronto pago (CONTADO), en %. */
    descFormaPago: 'numeric_mm5svkh2',
    /* Desglose INDEPENDIENTE de cada descuento por unidad: cada monto sobre el precio de LISTA por
       separado (no en cascada), con su "precio con dto" = precio − ese monto. Informativas. */
    /** "🤖Desc $ x Prod": monto del descuento por producto por unidad (precio × %prod/100). */
    descProdMonto: 'numeric_mm5xxrkw',
    /** "🤖Precio Unit C/Desc x Prod": precio unitario con el descuento por producto (precio − Desc $ x Prod). */
    precioConDescProd: 'numeric_mm5xgg0j',
    /** "🤖Desc $ x Forma de Pago": monto del descuento por forma de pago por unidad (precio × %fp/100). */
    descFpMonto: 'numeric_mm5x79vt',
    /** "🤖Precio Unit C/Desc x Forma de Pago": precio unitario con el descuento por forma de pago (precio − Desc $ x Forma de Pago). */
    precioConDescFp: 'numeric_mm5xxvcv',
    /** "🤖Imp. Bonificado": monto bonificado POR UNIDAD = precio × (desc prod + desc forma de pago)/100. */
    impBonificado: 'numeric_mm5sh5y',
    /** "🤖Precio Bonif $": precio unitario ya bonificado (precio − imp. bonificado), en pesos. */
    precioBonif: 'numeric_mm5wv840',
    /** "🤖IVA ($)": IVA en pesos de la línea, sobre el total ya bonificado. */
    iva: 'numeric_mm5sdnjb',
    /** "🤖Total": total de la línea = (precio − Imp. Bonificado) × cantidad. */
    total: 'numeric_mm5sb969',
    /** Rentabilidad de la línea (numérico). */
    rentabilidad: 'numeric_mm4cmpa6',
    /** Subtotal de la línea (fórmula del board). */
    subtotal: 'formula_mm47w359',
    /** "🧮Stock y Movimientos": ítem de stock del producto asociado. */
    stock: 'board_relation_mm5pz6kz',
  },
  /* Cabecera del recibo (board 18421035524). Se crea SIEMPRE, sea el cobro simultáneo o posterior;
     lo que cambia es qué columnas se completan y si lleva subelementos. */
  cobro: {
    /** "🤖Vendedor" (people): el vendedor de la operación. */
    vendedor: 'multiple_person_mm5s28s6',
    /** "🤖Persona": el cliente de la venta. La relación acepta Personas y Cta Cte; va el cliente. */
    cliente: 'board_relation_mkwb7fmp',
    /** "🤖Tipo de Cobro" (status): "Simultaneo" o "Posterior". */
    tipoCobro: 'color_mm5yh0gs',
    /** "📈Ventas": la venta que este recibo cobra. Sólo en el SIMULTÁNEO. */
    venta: 'board_relation_mm4kwppn',
    /** "💰Fact Vtas Pends de Cobro": la deuda que respalda el cobro. Sólo en el POSTERIOR. */
    vtaPendiente: 'board_relation_mm58ycfw',
    /** "🤖 TOTAL $ Vta": el total de la venta que se está cobrando. */
    totalVenta: 'numeric_mm5xbjkm',
    /** "🤖TOTAL $ Cobrado": lo efectivamente cobrado. */
    totalCobrado: 'numeric_mm5xbkj',
    /** "🤖TOTAL $ Diferencia": total de la venta − total cobrado. */
    diferencia: 'numeric_mm5xfznj',
    /** ID del recibo ("RECIBO-01"); el ítem se renombra con este valor. */
    pulseId: 'pulse_id_mkwb9111',
  },
  /* Un movimiento de pago del recibo (board 18421035599). Sólo el SIMULTÁNEO crea subelementos.
     Cada medio de cobro completa su propio juego de columnas; las dos primeras son de todos. */
  cobroSub: {
    /** "✋Caja": el medio de cobro. Es una columna status, con sus propias etiquetas. */
    formaPago: 'status',
    importe: 'numeric_mm4e61yk',
    /**
     * "🤖Banco de Acreditacion": la cuenta propia donde impacta el pago (ítem del board de config).
     * Es UNA sola columna para todos los medios: la usan tanto la transferencia (cuenta de destino)
     * como las tarjetas (banco de acreditación).
     */
    bancoAcreditacion: 'board_relation_mm5y22zv',
    // TRANSFERENCIA
    /** "🤖Comp Transf" (file): el comprobante de la transferencia. */
    compTransferencia: 'file_mm5rtssw',
    /** "🤖Comp Retencion" (file): el comprobante de cualquier retención (IVA, IIBB, GAN…). */
    compRetencion: 'file_mm5yzcnk',
    // CHEQUE
    nroCheque: 'numeric_mm5rrwjg',
    /** "🤖CUIT" del emisor del cheque. Es de TEXTO, así que va con guiones: "20-45037195-6". */
    cuit: 'text_mm5ydwp2',
    fechaEmisionCheque: 'date_mm5rxdpk',
    vencimientoCheque: 'date_mm5r3m2h',
    /** "🤖Origen" del cheque (dropdown): "Papel" o "eCheq". */
    origenCheque: 'dropdown_mm5yveka',
    /** "🤖Banco Emisor" del cheque (dropdown de texto libre). */
    bancoEmisorCheque: 'dropdown_mm5yfd8n',
    // TARJETA (débito y crédito)
    nroTarjeta: 'text_mm5ybw7q',
    titularTarjeta: 'text_mm5yr164',
    /** "🤖Tipo Tarjeta" (dropdown): VISA o MASTERCARD. */
    tipoTarjeta: 'dropdown_mm5rx800',
    vencimientoTarjeta: 'date_mm5y4zxa',
    /** "🤖Cupon" (file): el comprobante del cobro con tarjeta. */
    cupon: 'file_mm5yy4je',
    // Sólo TARJETA DE CRÉDITO
    cuotas: 'numeric_mm5ydy8',
    valorCuota: 'numeric_mm5yx0ec',
    pulseId: 'pulse_id_mkwbrvf5',
  },
  // Factura de venta pendiente de cobro (board 18421035508): la deuda del pago POSTERIOR.
  factPendiente: {
    /**
     * "📈Ventas": la venta que dejó esta deuda. Es lo único que la app conecta; el vínculo con
     * "💵Cta Cte Cliente" (board_relation_mkwbweqx) lo resuelve el tablero desde acá.
     */
    venta: 'board_relation_mm4d3nn0',
    /** "🤖Vta $": el importe total a cobrar que queda pendiente. */
    total: 'numeric_mkwbck5d',
    /** "🤖Estado": cuánto de esta factura ya se cobró. Nace pendiente al 100%. */
    estado: 'color_mkwb727e',
  },
  // Cuenta bancaria del cliente (board 18421723667).
  ctaBancaria: {
    /** Persona dueña de la cuenta: es por donde se filtra. */
    cliente: 'board_relation_mm57zmmq',
    estado: 'color_mm57wxbx',
    banco: 'dropdown_mm58qkqn',
    cbu: 'text_mm57tjvj',
    alias: 'text_mm588stk',
    tipoCuenta: 'dropdown_mm5777v1',
    numeroCuenta: 'text_mm5794bz',
  },
  // Cabecera de la venta (board 18421035510).
  venta: {
    /** "✋Vendedor" (people): el vendedor de la operación. */
    vendedor: 'person',
    cliente: 'board_relation_mm582k6v',
    /** "✋️Tipo De Vta": Directa / C-Presup Previo. */
    tipoVenta: 'color_mm5142e4',
    /** "✋Tipo de Entrega": Anterior / Posterior / Simultánea. */
    tipoEntrega: 'color_mm489k2j',
    /** "✋Tipo de Cobro": Posterior / Simultaneo. */
    tipoCobro: 'color_mm5b7t0d',
    /** "✋Entrega": Envio / Sin Envio. Leída del board; todavía sin mapeo definido. */
    entrega: 'color_mm52jx3d',
    /** "✋Entrega" (dropdown): responsable logístico de la venta ("La Batea" / "Comisionista
     *  Responsable" / "Cliente Responsable"). Se escribe por label. */
    responsableEntrega: 'dropdown_mm5p34k6',
    /** "✋🛣️Rutas de Transporte": ruta de entrega asignada a la venta (board 18421708745). */
    ruta: 'board_relation_mm5nr3d5',
    rentabilidad: 'numeric_mm52rk7t',
    /** "🤖Tasa de Cambio": tasa del dólar usada en la venta, registrada como auditoría inmutable. */
    tasaCambio: 'numeric_mm5s5n54',
    /** Descuento total de la venta (suma de los importes bonificados de las líneas). */
    descuentoTotal: 'numeric_mm5s9czk',
    /** IVA total de la venta (en $). */
    ivaTotal: 'numeric_mm5skvne',
    /** TOTAL de la venta = subtotal − descuento total + IVA total (neto bonificado + IVA). */
    total: 'numeric_mm5s9zx5',
    /** "🤖Importe Total $": total en pesos de la venta. Se envía como número. */
    importeTotalPesos: 'numeric_mm5qbwer',
    /** "🤖Estado de Entrega": cuánto de la venta ya se entregó (a nivel venta). */
    estadoEntrega: 'color_mm58xjgj',
    /** "🤖ID VTA": el número de venta ("VTA-016"), el que se muestra en la card. */
    idVta: 'pulse_id_mkw8wzn1',
    /** "Facturación": los comprobantes que factura esta venta. De acá cuelga el PDF espejado. */
    facturacion: 'board_relation_mm5bvew3',
    /** "🤖Comprobante PDF": mirror del PDF de los comprobantes conectados. Se lee para validar
     *  que el documento existe antes de enviarlo. */
    comprobantePdf: 'lookup_mm5bf76j',
    /** "🤖Estado de Envio Fact": al ponerlo en "Enviar" se dispara el envío de la factura. */
    estadoEnvioFactura: 'color_mm5bc1xy',
    /** "👤Contactos": destinatarios del envío de la factura. */
    contactos: 'board_relation_mm5gq7z7',
    /** "🤖Enviar por:": dropdown Whatsapp / Email para el envío de la factura. */
    medioEnvio: 'dropdown_mm5gkf4f',
    /* ===== Flujo Proforma y Retenciones (cliente agente de retención) ===== */
    /** Estado de emisión de la factura proforma: ponerlo en "Emitir" dispara la generación. */
    estadoProforma: 'color_mm4dqxq3',
    /** "👤Contactos" del envío de la proforma. */
    contactosProforma: 'board_relation_mm5njnad',
    /** "🤖Enviar por:" de la proforma (dropdown Whatsapp / Email). */
    medioEnvioProforma: 'dropdown_mm5njprp',
    /** Estado de envío de la proforma: ponerlo en "Enviar" dispara la distribución. */
    estadoEnvioProforma: 'color_mm5n6zrn',
  },
  // Un producto de la venta (subelemento de 📈Ventas).
  ventaSub: {
    producto: 'board_relation_mkwctrv6',
    cantidad: 'numeric_mksesd2',
    precioUnit: 'numeric_mkw85hdw',
    /** "🤖Precio Unit u$": precio original en dólares del producto, antes de convertir a pesos.
     *  Sólo se escribe para productos cuya moneda era "Dolares" (auditoría). */
    precioUnitUsd: 'numeric_mm5s58ej',
    /** "🤖Desc % x Prod": descuento manual del producto, en %. */
    descuento: 'numeric_mm472cqy',
    /** "🤖Desc % x Forma de Pago": descuento por forma de pago (pronto pago), en %. */
    descFormaPago: 'numeric_mm5sm8na',
    /* Desglose INDEPENDIENTE de cada descuento por unidad: cada monto se calcula sobre el precio de
       LISTA por separado (no en cascada), y su "precio con dto" es precio − ese monto. Son columnas
       informativas, distintas del Imp. Bonificado / Precio Bonif (que sí van en cascada). */
    /** "🤖Desc $ x Prod": monto del descuento por producto por unidad (precio × %prod/100). */
    descProdMonto: 'numeric_mm5x74b0',
    /** "🤖Precio Unit C/Desc x Prod": precio unitario con el descuento por producto (precio − Desc $ x Prod). */
    precioConDescProd: 'numeric_mm5xfseb',
    /** "🤖Desc $ x Forma de Pago": monto del descuento por forma de pago por unidad (precio × %fp/100). */
    descFpMonto: 'numeric_mm5xq5sg',
    /** "🤖Precio Unit C/Desc x Forma de Pago": precio unitario con el descuento por forma de pago (precio − Desc $ x Forma de Pago). */
    precioConDescFp: 'numeric_mm5xpwd9',
    /** "🤖Imp. Bonificado": monto bonificado de la línea = precio × cantidad × (desc prod + desc forma de pago)/100. */
    impBonificado: 'numeric_mm5swn31',
    /** "🤖Precio Bonif": precio unitario ya bonificado (precio − imp. bonificado por unidad), en pesos. */
    precioBonif: 'numeric_mm5wm552',
    /** "🤖IVA $": IVA en pesos de la línea, sobre el total ya bonificado. */
    iva: 'numeric_mm5sbr3m',
    /** "🤖Subtotal $": el "Importe Total" de la línea, ya bonificado y SIN IVA (no se le suma IVA). */
    subtotal: 'numeric_mm5sqgp',
    rentabilidad: 'numeric_mm4cmpa6',
    /** "🤖Cant Entregada Simult": sólo se llena si la entrega es simultánea a la venta. */
    cantEntregadaSimult: 'numeric_mm54fxxh',
    /** "🤖Cant Entregada Posterior": unidades ya remitidas de una venta con entrega posterior. */
    cantEntregadaPosterior: 'numeric_mm54v0jd',
    /** "🤖Cant Entregada Anterior": en la venta con entrega ANTERIOR la mercadería ya salió por
     *  remito, así que lo vendido = lo entregado antes de facturar. */
    cantEntregadaAnterior: 'numeric_mm54vcmr',
    /** "🤖Estado de Entrega" de la línea: 0% / Parcialmente / 100% Entregada. */
    estadoEntrega: 'color_mm5bhha',
    /** "🤖Unidad de Medida": mirror de la U.M. del producto conectado. Se lee por display_value. */
    unidadMedida: 'lookup_mm5hr4p9',
    /** "🤖Peso": mirror del peso del producto conectado (kg). Se lee por display_value. */
    peso: 'lookup_mm5h7byp',
    /** "🚚Pends de Entrega": ítem del pendiente de entrega de esta línea (board 18421035527). */
    pendienteEntrega: 'board_relation_mm5psr2k',
    /** "🧮Stock y Movimientos": ítem de stock del producto de esta línea (board 18421752251). */
    stock: 'board_relation_mm5pz6kz',
  },
  // Cabecera del remito de venta (board 18421035529).
  remito: {
    /** "🤖Vendedor" (people): el vendedor de la operación. */
    vendedor: 'multiple_person_mm51xr9f',
    /** "Cliente": es por donde se acotan los remitos al cliente elegido. */
    cliente: 'board_relation_mm5act3k',
    /** "✋Venta": Anterior / Posterior, según cuándo se factura lo entregado. */
    venta: 'color_mkwbrkg6',
    /** "🤖Nro Rto": el número impreso del remito. */
    nroRemito: 'text_mm516d4q',
    fechaEmision: 'date_mm5144rt',
    /** ID del ítem ("RTOVTA-04"); es con lo que se renombra y lo que ve el usuario. */
    pulseId: 'pulse_id_mkwbze0n',
    /* Entrega por La Batea: destino, transportista (chofer) y vehículo, cada uno conectado a
       su board. Se completan con el id del ítem elegido en el paso de envío. */
    destino: 'board_relation_mm51t0b3',
    transportista: 'board_relation_mm5fa6em',
    vehiculo: 'board_relation_mm59s77d',
    /** "🤖Chofer/Comisionista": acá va el comisionista cuando la entrega es tercerizada. */
    comisionista: 'board_relation_mm59sbre',
    /** "🤖 Cliente Responsable": texto libre con el nombre de quien retira. */
    clienteResponsable: 'text_mm5h9gg0',
    /** "🤖 Peso Total": suma del peso de la mercadería remitada. */
    pesoTotal: 'numeric_mm59hcwc',
    /** "📈Ventas": las ventas de las que salen los productos remitados (emisión ANTERIOR). */
    ventas: 'board_relation_mm54xs7v',
    /** "🤖Observaciones": texto libre que se escribe al emitir el remito. */
    observaciones: 'long_text_mm51vcrj',
    /** "🤖Estado Emision Remito": ponerlo en "Emitir" dispara la generación del PDF. */
    estadoEmision: 'color_mkwb12n1',
    /** "🤖RTO PDF": el archivo que sube la automatización al emitir. */
    pdf: 'file_mkwbmr11',
    /** "👤Contactos": destinatarios del envío del remito (conectada a Contactos). */
    contactos: 'board_relation_mm5g8hdv',
    /** "🤖Enviar por:": dropdown Whatsapp / Email, igual que el presupuesto. */
    medioEnvio: 'dropdown_mm5gqs51',
    /** "🤖Estado Envio Remito": ponerlo en "Enviar" dispara el envío. */
    estadoEnvio: 'color_mm5gpcbj',
    /** "🤖Num Remito Talonario": la hoja del talonario (subítem) que numera este remito. */
    numRemitoTalonario: 'board_relation_mm5jy3ke',
  },
  // Un producto entregado en el remito (subelemento de 🧾🚚 Remitos Ventas).
  remitoSub: {
    producto: 'board_relation_mkwca4wb',
    /** "✋Cant a Entregar": las unidades que salieron en el remito. */
    cantEntregada: 'numeric_mm54mbjx',
    unidadMedida: 'dropdown_mm5g9mp',
    /** "🤖Peso": peso de la línea remitada (cantidad × peso unitario del producto). */
    peso: 'numeric_mm5ga7bw',
    /** "🤖Total $": importe de la línea (cantidad × precio unitario). Sólo remito POSTERIOR. */
    totalProducto: 'numeric_mm5nhdjk',
    /** ID del subelemento ("RTOVMOV-03"). */
    pulseId: 'pulse_id_mkwcxgza',
  },
  // Cabecera de "Vtas Pends de Facturar" (board 18421033947): un remito POSTERIOR pendiente de facturar.
  vtaPendFacturar: {
    /* La conexión con la Cta Cte del cliente (💵Cta Cte Cliente- PENDIENTE, board 18421858736) se
       descartó: la app no la registra. La cuenta se sigue LEYENDO por la relación del cliente. */
    /** "🤖Cliente": el cliente (Personas, 18420688238). Filtra las ventas pendientes por cliente. */
    cliente: 'board_relation_mm5pd79g',
    /** "🧾🚚 Remitos Ventas": el remito POSTERIOR que originó el pendiente. */
    remito: 'board_relation_mkwbvma5',
    /** "📈Ventas": la venta que factura este pendiente. Se enlaza al cerrar la facturación. */
    venta: 'board_relation_mkwbb4w4',
    /** "🤖Importe a Facturar $": el importe total del remito. */
    importeAFacturar: 'numeric_mm5np70x',
    /** "🤖Importe Facturado $": arranca en 0; se acumula al facturar. */
    importeFacturado: 'numeric_mm5n938k',
    /** "🤖Estado de Facturacion": nace "0% Facturada" (por índice dinámico). */
    estadoFacturacion: 'color_mm5ndgd5',
  },
  // Subelemento de "Vtas Pends de Facturar" (board 18421034035): un producto del remito.
  vtaPendFacturarSub: {
    /** "📦Productos": conecta con el Maestro de Productos (18421035535). */
    producto: 'board_relation_mm5nndxm',
    /**
     * "🤖Unidad de Venta": la misma U.M. que se asienta en el subelemento del remito
     * (dropdown_mm5g9mp). De acá la toma la factura en la venta DIRECTA con entrega ANTERIOR.
     */
    unidadVenta: 'dropdown_mm5zrsbb',
    /** "🤖Precio Unit $": precio unitario del producto según la lista del cliente. */
    precioUnit: 'numeric_mm5ncc8m',
    /** "🤖Subtotal x Prod $": fórmula (precio × cantidad). Se lee por display_value. */
    subtotal: 'formula_mm5nc530',
    /** "🤖Cant Entregada": unidades entregadas del producto. */
    cantEntregada: 'numeric_mm5nf0t6',
    /** "🤖Cant Facturada": unidades ya facturadas; se acumula al facturar. */
    cantFacturada: 'numeric_mm5nadmz',
    /** "🤖Estado de Facturacion": nace "0% Facturado" (por índice dinámico). */
    estadoFacturacion: 'color_mm5ny2y9',
    /** "🤖Tipo": tipo de mercadería del producto (CO / COM), heredado del Maestro (color_mm48hm74).
     *  Los índices NO coinciden con los del Maestro: se resuelve por label contra este board. */
    tipoMercaderia: 'color_mm5preby',
    /** "🤖Rentab %": rentabilidad del producto según la lista del cliente, guardada al remitir para
     *  reutilizarla al facturar la venta DIRECTA con entrega ANTERIOR (rentabilidad general). */
    rentabilidad: 'numeric_mm5p80xs',
    /** "🤖Comision" (mirror del Maestro): "SI" / "NO". Define si el producto comisiona al facturar. */
    comisionable: 'lookup_mm5z5hsc',
  },
  // Cabecera del talonario de remitos (board 18423468398).
  talonario: {
    /** "🤖Estado Talonario": marca cuál está "En USO". */
    estado: 'color_mm5hmyaj',
  },
  // Subelemento del talonario (board 18423468575): una hoja/folio de remito.
  talonarioSub: {
    /** "🤖Estado Rto": "Pend de Usar" hasta que se consume la hoja. */
    estado: 'status',
  },
  // Ítem de "Pends de Entrega" (board 18421035527): un producto vendido pendiente de entregar.
  pendienteEntregaItem: {
    /** "🤖Personas": el cliente de la venta. Por acá se filtra la fuente del remito ANTERIOR. */
    cliente: 'board_relation_mm5p8hpc',
    /** "🤖Maestro de Productos": el producto pendiente. */
    producto: 'board_relation_mkwbxjqx',
    /** "🤖Venta": la venta que originó el pendiente (nivel ítem). */
    venta: 'board_relation_mkwbb4w4',
    /** "📈Subelementos de Ventas": el subelemento de venta del que sale esta línea (18421035581). */
    ventaSubelemento: 'board_relation_mm5pcdfj',
    /** "🤖Q VTA": cantidad vendida. */
    cantidad: 'numeric_mkwb862t',
    /** "🤖U.Medida": mirror de la U.M. del producto (refleja el Maestro vía board_relation_mkwbxjqx). */
    unidadMedida: 'lookup_mm5pggg9',
    /** "🛣️Rutas de Transporte": ruta de entrega del pendiente (board 18421708745). Se hereda de la
     *  venta al crearlo y se muestra al remitar (venta ANTERIOR). */
    ruta: 'board_relation_mm5pa9v3',
    /** "🧾🚚 Remitos Ventas": el remito que entregó lo pendiente. Se linkea al emitir el remito ANTERIOR. */
    remito: 'board_relation_mkwbvma5',
    /** "🧮Stock y Movimientos": ítem de stock del producto. Se linkea al crear el pendiente (venta POSTERIOR). */
    stockMovimiento: 'board_relation_mm5qqera',
    /** "🤖Q RTO Neto": cantidad ya entregada (mirror de los subítems de entrega). */
    entregada: 'lookup_mkwb1xhh',
    /** "🤖Pend de Entrega": lo que falta entregar (fórmula = Q VTA − Q RTO Neto). */
    pendiente: 'formula_mkwbf3ax',
    /** "🤖Estado de Entrega": nace "Pend de Entregar 100%" (por índice dinámico). */
    estado: 'color_mm48wnvf',
  },
  // Subelemento de "Pends de Entrega" (board 18421035605): un movimiento de entrega del producto.
  pendienteEntregaSub: {
    /** "🤖Q RTO": cantidad remitada en este movimiento. */
    cantRto: 'numeric_mkwbzd9j',
    /** "🤖Tipo RTO": nace "RTO Entrega A Cliente" (por índice dinámico). */
    tipoRto: 'color_mkwbzrx2',
  },
  /* Ítem de "Stock y Movimientos" (board 18421752251): un ítem por producto, conectado al maestro.
     Las tres cantidades de stock que muestra la app SALEN DE ACÁ (son fórmulas del board, no
     columnas del producto), y se leen a través de la relación `COL.producto.stock`. */
  stockItem: {
    /** "🤖Pend de Entrega Vta": saldo pendiente de entregar; se decrementa al remitir. */
    pendEntregaVta: 'numeric_mm5nscx',
    /** "🤖Stock Fisico": ingresos − egresos registrados. */
    fisico: 'formula_mm57f9pn',
    /** "🤖Stock Comercial": el físico menos lo pendiente de entregar por ventas. */
    comercial: 'formula_mm57sk64',
    /** "🤖Stock Disponible": el comercial más lo pendiente de recibir por compras. */
    disponible: 'formula_mm5nntd2',
  },
  // Subelemento de "Stock y Movimientos" (board 18421752360): un movimiento de stock.
  stockMovSub: {
    /** "🤖Estado": tipo de movimiento; la entrega de remito nace "RTO Venta Entrega" (índice dinámico). */
    estado: 'status',
    /** "🤖Egreso": cantidad que sale del stock. */
    egreso: 'numeric_mm57fs41',
    /** "🤖Fecha Mov": fecha del movimiento (YYYY-MM-DD). */
    fecha: 'date0',
    /** "Numero Comprobante": el número de hoja del remito. */
    comprobante: 'text_mm5nmtat',
  },
  // Cabecera del comprobante (board 18422405731). Una venta puede generar varios.
  facturacion: {
    /** "Tipo Comprobante": Factura / Nota De Credito / Nota De Debito. */
    tipoComprobante: 'dropdown_mm3hbhc0',
    moneda: 'dropdown_mm34pzg0',
    tipoCambio: 'numeric_mm34pwcj',
    razonSocial: 'text_mm48w6tm',
    /** "Cuit / Dni Receptor": es una columna numérica, así que va sin guiones. */
    cuit: 'numeric_mm0yadnb',
    /** "Sit Iva": la condición del receptor frente al IVA. */
    sitIva: 'dropdown_mm48dfba',
    puntoVenta: 'dropdown_mm3skjcc',
    fechaEmision: 'date',
    condicionVenta: 'dropdown_mm2ged22',
    fechaVtoPago: 'date_mm2gp00f',
    observaciones: 'text_mm345tzb',
    letra: 'dropdown_mm3kzmy5',
    /** "📈Ventas": la venta que este comprobante factura. */
    venta: 'board_relation_mm5bve7q',
    /** "✋Comprobante": al ponerlo en "Crear Comprobante" se dispara la emisión electrónica. */
    estadoComprobante: 'status',
    /** "Comprobante PDF": el archivo que genera la emisión. Es el que espeja el mirror de la
     *  venta (lookup_mm5bf76j) y el que se valida que exista antes de enviar. */
    pdf: 'file_mm1tg5w5',
  },
  // Una línea del comprobante (subelemento de Facturación).
  facturacionSub: {
    unidadMedida: 'dropdown_mm2gk2mv',
    /** "Unidad de Venta": la U.M. del producto, resuelta según el tipo de venta. */
    unidadVenta: 'dropdown_mm5zj2t0',
    /** "Importe Bonif $": el "Descuento Total" por unidad de la selección de productos. */
    importeBonif: 'numeric_mm5x7747',
    cantidad: 'numeric_mm1srkr2',
    /** "Precio Unitario $": de él dependen Subtotal/IVA/Total en pesos. */
    precioUnit: 'numeric_mm1swnhz',
    /** "Precio Unitario u$": la otra mitad de las fórmulas, para comprobantes en dólares. */
    precioUnitUsd: 'numeric_mm344c83',
    prodServ: 'dropdown_mm2fyez4',
    /** "Alícuota IVA %": la tasa del producto. La usan las fórmulas de IVA del board. */
    alicuotaIva: 'dropdown_mm2g198w',
  },
  // Ítem de "💲Registro de Comisiones" (board 18421035548): la comisión de una venta.
  comision: {
    /** "🤖Vendedor" (people): el vendedor de la operación. */
    vendedor: 'multiple_person_mm5r4xx7',
    /** "🤖Fecha Emision Vta": fecha de emisión de la factura (YYYY-MM-DD). */
    fecha: 'date_mm4dxd48',
    /** "🤖Cliente": el cliente de la venta que originó la comisión (board_relation a Personas). */
    cliente: 'board_relation_mm5s28j3',
    /** "📈Ventas": la venta que originó la comisión. */
    venta: 'board_relation_mm4d72qt',
    /** "💰Vtas Pend de Cobro": la deuda del cobro POSTERIOR. Se omite en el cobro SIMULTANEO. */
    cobroPendiente: 'board_relation_mm4dzhr1',
    /** "🤖Pend de Cobro(TRAER)": monto pendiente de cobro (total de la venta si POSTERIOR; 0 si
     *  SIMULTANEO). Se envía como número. */
    pendienteCobro: 'numeric_mm5p3bqc',
    /**
     * "🤖$ Comision TOTAL": la comisión FINAL en pesos de la venta. Es una columna numérica común,
     * no una fórmula: la calcula y la escribe la app, igual que la ve el vendedor en el resumen.
     */
    total: 'numeric_mm5r54y6',
    /** "🤖Estado de Comision": nace en "Pend de Cobro". */
    estado: 'color_mm5by36r',
  },
  // Subelemento de "💲Registro de Comisiones" (board 18421035638): un producto comisionable.
  comisionSub: {
    /** "📦Maestro de Productos": el producto comisionable. */
    producto: 'board_relation_mm5bmztw',
    /** "🤖Cantidad": unidades vendidas/facturadas del producto. */
    cantidad: 'numeric_mm5b62j5',
    /** "🤖Precio unit": precio unitario al que se vendió. */
    precioUnit: 'numeric_mm5bk04f',
    /** "🤖Comision": % de comisión resuelto del Maestro según el tipo de venta. */
    comision: 'numeric_mm5bn9f9',
  },
  // Ítem de "Pend Venta de Liq CYO" (board 18421465215): un producto consignado facturado.
  consignacionCYO: {
    /** "📦Productos": el producto consignado del Maestro. */
    producto: 'board_relation_mm5p5kma',
    /** "Date fact": fecha de emisión de la factura (YYYY-MM-DD). */
    fecha: 'date4',
    /** "Cant": cantidad facturada del producto. */
    cantidad: 'numeric_mm5nds65',
    /** "Precio de Vta": precio unitario al que se facturó. */
    precio: 'numeric_mm5n13wv',
    /** "Archivo": PDF de la factura. NUNCA se escribe en el create_item (columna file); se adjunta
     *  aparte referenciando el asset del comprobante (asset_ids). */
    pdf: 'file_mm5pb2vh',
  },
  // Ítem de "Cotizaciones" (board 18422367325): un ítem por día con la tasa de cambio.
  cotizacion: {
    /** Tasa de cambio del dólar (numérico). */
    dolar: 'numeric_mm5at943',
    /** Fecha de la cotización (columna date). Se busca el ítem cuya fecha es HOY. */
    fecha: 'date_mm5qc046',
  },
  // Destino de entrega (board 18421035523).
  destino: {
    /** "Cliente": conecta el destino con uno o más clientes (multi-valor). */
    cliente: 'board_relation_mm57cgxx',
    direccion: 'text_mm51s5ab',
  },
  // Vehículo de la flota (board 18421035528).
  vehiculo: {
    patente: 'text_mm51zhca',
  },
  config: {
    valor: 'numeric_mm5bgy5p',
    /** Topes del descuento por producto, en el ítem "Descuento de Producto". */
    descuentoMax: 'numeric_mm5fxdjv',
    descuentoMin: 'numeric_mm5f6k1v',
    /** "Tipo de Config": clasifica cada ítem del tablero de configuración. */
    tipo: 'color_mm4emv5g',
    /** "Valor %": el porcentaje del ítem. En los medios de pago, su descuento; en las comisiones,
     *  la tasa que se le paga al vendedor. */
    valorPct: 'numeric_mm4e5cta',
    /** "Tipo de Gestion": distingue la comisión "Activa" de la "Pasiva". */
    tipoGestion: 'color_mm4ewj21',
  },
} as const

/** Moneda de la app → label de la columna "✋Moneda" (color_mkwgfyv1), que va sin tilde. */
export const MONEDA_LABEL: Record<'Pesos' | 'Dólares', string> = {
  Pesos: 'Pesos',
  Dólares: 'Dolares',
}

/** Label de "Emitir" en la columna de estado del PDF (color_mkw81a0d). */
export const PRESUP_ESTADO_EMITIR_LABEL = 'Emitir'
/** Label de vigencia al crear el presupuesto (color_mm57cmkt). */
export const PRESUP_VIGENCIA_LABEL = 'Vigente'
/** Índice de "A Enviar" en la columna de estado de envío (color_mm48mc2p). Se usa el índice
 *  y no el label porque en el board el texto tiene un doble espacio ("A  Enviar"). */
export const PRESUP_ENVIO_INDEX = 3

/**
 * Medio de la app → labels de la columna dropdown "🤖Enviar por:" (dropdown_mm5f5rhv), que
 * sólo tiene "Whatsapp" y "Email": "Ambos" se manda como los dos valores a la vez.
 */
export const MEDIO_ENVIO_LABELS: Record<'Email' | 'WhatsApp' | 'Ambos', string[]> = {
  Email: ['Email'],
  WhatsApp: ['Whatsapp'],
  Ambos: ['Whatsapp', 'Email'],
}

/**
 * Responsable logístico de la app → etiqueta de la columna dropdown "✋Entrega" (dropdown_mm5p34k6)
 * del board de Ventas. Los textos son EXACTAMENTE los del board: "La Batea" (no "Responsable La
 * Batea"), "Comisionista Responsable" y "Cliente Responsable".
 */
export const ENTREGA_RESPONSABLE_LABEL: Record<'LA_BATEA' | 'COMISIONISTA' | 'CLIENTE', string> = {
  LA_BATEA: 'La Batea',
  COMISIONISTA: 'Comisionista Responsable',
  CLIENTE: 'Cliente Responsable',
}

/**
 * Forma de pago de la app → etiqueta de la columna "✋Caja" del subelemento del recibo. Los textos
 * son EXACTAMENTE los del board: las tarjetas van con mayúscula inicial en las dos palabras y la
 * retención de ganancias se llama "Retencion IG" allá, aunque la app la muestre como "Retencion GAN".
 */
export const FORMA_PAGO_LABEL: Record<string, string> = {
  Efectivo: 'Efectivo',
  Cheque: 'Cheque',
  Transferencia: 'Transferencia',
  'Retencion IVA': 'Retencion IVA',
  'Retencion IIBB': 'Retencion IIBB',
  'Retencion GAN': 'Retencion IG',
  'Tarjeta de débito': 'Tarjeta de Débito',
  'Tarjeta de crédito': 'Tarjeta de Crédito',
}

/** Tipo de cobro de la app → etiqueta de "🤖Tipo de Cobro" (color_mm5yh0gs) del recibo. */
export const TIPO_COBRO_LABEL: Record<'SIMULTANEO' | 'POSTERIOR', string> = {
  SIMULTANEO: 'Simultaneo',
  POSTERIOR: 'Posterior',
}

/** Formato del cheque en la app → etiqueta de "🤖Origen" (dropdown_mm5yveka) del subelemento. */
export const CHEQUE_ORIGEN_LABEL: Record<'FISICO' | 'eCheq', string> = {
  FISICO: 'Papel',
  eCheq: 'eCheq',
}

/* ===== Labels del tablero de Facturación (18422405731) =====
   Todas las columnas del comprobante son `dropdown`, así que se escriben por LABEL y el texto
   tiene que coincidir exactamente con el del board. Están tal cual se leyeron de la columna,
   incluidas las diferencias con el lenguaje de la app: "Unidades" (no "Unidad"), "producto"
   en minúscula y "Dolares" sin tilde. */

/** "Tipo Comprobante": la app sólo emite facturas; las notas de crédito/débito no pasan por acá. */
export const FACT_TIPO_COMPROBANTE = 'Factura'

/** Moneda de la factura → label de "Moneda" (dropdown_mm34pzg0). */
export const FACT_MONEDA_LABEL: Record<'Pesos (ARS)' | 'Dólares (USD)', string> = {
  'Pesos (ARS)': 'Pesos',
  'Dólares (USD)': 'Dolares',
}

/** Punto de venta por defecto. El board sólo tiene "5", "6" y "7". */
export const FACT_PUNTO_VENTA_DEFAULT = '5'

/** Condición del receptor frente al IVA → label de "Sit Iva" (dropdown_mm48dfba). */
export const FACT_SIT_IVA_LABEL: Record<CondicionIVA, string> = {
  'Responsable Inscripto': 'Responsable Inscripto',
  Monotributo: 'Responsable Monotributo',
  'Consumidor Final': 'Consumidor Final',
}

/**
 * Labels de "Condición de Venta" (dropdown_mm2ged22). El board tiene tres; la condición de
 * pago del cliente tiene cinco, así que las de proveedor se resuelven por su forma: las que
 * dicen CONTADO van a "Contado" y el resto, a "Cuenta Corriente".
 */
export const FACT_CONDICION_VENTA = {
  contado: 'Contado',
  cuentaCorriente: 'Cuenta Corriente',
  tarjeta: 'Tarjeta',
} as const

/** Días que se le suman a la emisión para la "Fecha Vto. Pago", mientras no se configure. */
export const FACT_VENCIMIENTO_DIAS = 30

/** "Unidad de Medida" del subelemento. En el board la etiqueta es "Unidades", en plural. */
export const FACT_SUB_UNIDAD_MEDIDA = 'Unidades'

/** "Prod / Serv" del subelemento. En el board la etiqueta va en minúscula. */
export const FACT_SUB_PROD_SERV = 'producto'

/**
 * Alícuotas que acepta "Alícuota IVA %" (dropdown_mm2g198w). La tasa del producto se escribe
 * con el label exacto, así que si viniera una que el board no tiene hay que resolverla contra
 * esta lista antes de mandarla.
 */
export const FACT_ALICUOTAS_IVA = [0, 2.5, 5, 10.5, 21, 27] as const

/** Labels de la columna de estado de envío del presupuesto (color_mm48mc2p), tal cual el board. */
export const ENVIO_ESTADO = {
  aEnviar: 'A  Enviar',
  enviando: 'Enviando',
  enviado: 'Enviado',
  error: 'Error en Envio',
  pendiente: 'Pend de Enviar',
} as const

/**
 * Estado "Crear Comprobante" de la columna ✋Comprobante (status) del board de Facturación.
 * Ponerlo dispara la emisión electrónica. Se escribe por índice —el id de la etiqueta en el
 * board— y no por el texto: es lo que aguanta que le reescriban el label. Validado: "Crear
 * Comprobante" es el id 3.
 */
export const FACT_CREAR_COMPROBANTE_INDEX = 3

/**
 * Estado de envío de la factura, en "🤖Estado de Envio Fact" (color_mm5bc1xy) del board de
 * Ventas. OJO: la etiqueta que dispara el envío es "Enviar" (id 3), no "A Enviar". Se escribe
 * por índice. Los demás labels los mueve la automatización: "Enviando" / "Enviada" / error.
 */
export const VENTA_ENVIO_FACTURA_INDEX = 3
export const ENVIO_FACTURA_ESTADO = {
  enviar: 'Enviar',
  enviando: 'Enviando',
  enviado: 'Enviada',
  error: 'Error - Ver Updates',
} as const
