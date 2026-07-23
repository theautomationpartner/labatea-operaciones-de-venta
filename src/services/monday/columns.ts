/**
 * IDs de tableros y columnas de la cuenta de La Batea, validados uno por uno contra la API
 * real (get_board_info / queries). Único punto a tocar si el board cambia.
 */
import type { CondicionIVA, ListaPrecio } from '@/types'

export const BOARDS = {
  personas: 18420688238,
  productos: 18421035535,
  contactos: 18420688239,
  presupuestos: 18421035513,
  /** Board de subelementos del presupuesto (uno por producto). */
  presupuestosSub: 18421035575,
  config: 18421035530,
  ctaCte: 18421858736,
  /** Movimientos de la cuenta corriente (subelementos de la Cta Cte del cliente). */
  ctaCteSub: 18421858762,
  /** "➡️Recibos y Cobros": cabecera del cobro. Sólo se usa en el pago SIMULTÁNEO. */
  cobros: 18421035524,
  /** Subelementos del recibo: un movimiento de pago cada uno. */
  cobrosSub: 18421035599,
  /** "💰Fact Vtas Pends de Cobro": la deuda que deja el pago POSTERIOR. */
  factPendientes: 18421035508,
  /** "💳Ctas Bancarias Personas": las cuentas a las que el cliente transfiere. */
  ctasBancarias: 18421723667,
  /** "📈Ventas": la venta cerrada, con un subelemento por producto. */
  ventas: 18421035510,
  /** "🧾🚚 Remitos Ventas": la mercadería ya entregada, pendiente o no de facturar. */
  remitos: 18421035529,
  /** Subelementos del remito: un movimiento de mercadería por producto. */
  remitosSub: 18421035607,
  /** "Facturación": un ítem por comprobante a emitir. */
  facturacion: 18422405731,
  /** Subelementos del comprobante: una línea de facturación por producto. */
  facturacionSub: 18422405734,
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

/** Índice de "Activa" en "✋Estado" (color_mm57wxbx) del board de cuentas bancarias. */
export const CTA_BANCARIA_ACTIVA_INDEX = 1

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

/** Índices de "🤖Estado del Facturacion" (color_mm5bf05j), a nivel remito. */
export const REMITO_ESTADO_FACT_INDEX = {
  parcialmenteFacturado: 0,
  totalmenteFacturado: 1,
  sinFacturar: 2,
} as const

/** Índices de "🤖 Estado Facturacion" (color_mm54wrds), a nivel producto del remito. */
export const REMITO_SUB_ESTADO_FACT_INDEX = {
  facturacionCompleta: 0,
  parcialmenteFacturado: 1,
  pendDeFacturar: 2,
} as const

/**
 * Estado de facturación que deja un producto del remito FUERA de la selección. Es el índice
 * de "Pend de Facturar" en color_mm54wrds, tal como se definió para este flujo.
 */
export const REMITO_SUB_ESTADO_NO_SELECCIONABLE = REMITO_SUB_ESTADO_FACT_INDEX.pendDeFacturar

/**
 * Índices de "✋️Situacion Cliente" (color_mm58nd7b) en el board de Personas. La situación se
 * lee por índice y no por el texto de la etiqueta ("0-Liberado Con Credito", "1-Bloqueado"…),
 * que puede reescribirse en el board sin avisar.
 */
/**
 * Índices de "🤖Estado de Vta Gnral" (color_mm54y5vc) en el board de Presupuestos.
 * 0 = Parcialmente Vendido · 1 = 100% Vendido · 2 = 0% Vendido.
 */
export const PRESUP_ESTADO_VENTA_INDEX = {
  parcialmenteVendido: 0,
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
    codigo: 'numeric_mm54mgjg',
    rubro: 'dropdown_mm509v8g',
    subrubro: 'dropdown_mm51jz35',
    categoria: 'dropdown_mm50pcb8',
    stockFisico: 'numeric_mm483de6',
    stockComercial: 'formula_mm4c5p89',
    stockDisponible: 'formula_mm4c96zp',
    proveedor: 'board_relation_mm4812az',
    /** "🤖Código Sistema Prov": espeja el código del proveedor conectado. */
    proveedorCodigo: 'lookup_mm5fh97p',
    tipoMercaderia: 'color_mm48hm74',
    /** "✋IVA": alícuota del producto, en %. Se suma al precio de lista si el cliente la paga. */
    iva: 'numeric_mm5gyrnb',
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
  },
  // Columnas del subelemento (un producto de la lista):
  presupuestoSub: {
    producto: 'board_relation_mm57gxye',
    cantidad: 'numeric_mksesd2',
    rentabilidad: 'numeric_mm4cmpa6',
    precioUnit: 'numeric_mkw85hdw',
    /** Subtotal en pesos: fórmula del board (cant × precio si la moneda es Pesos). NO se setea. */
    subtotal: 'formula_mm58pwc',
    /** Subtotal en dólares: misma fórmula para moneda Dólares. Tampoco se setea. */
    subtotalUsd: 'formula_mm5f75gm',
    descuento: 'numeric_mm472cqy',
    /** "🤖 Cant Vendida": unidades del producto ya llevadas a una venta. */
    cantVendida: 'numeric_mm54546t',
    /** "🤖Estado de Uso": 0% / Parcialmente / 100% Vendido. */
    estadoUso: 'color_mm54j58z',
    /** "Reflejo" del Tipo de Mercadería del producto conectado: CO / COM. */
    tipoMercaderia: 'lookup_mm5gym7g',
    /** ID del subelemento; se usa para renombrarlo. */
    pulseId: 'pulse_id_mkw8mfdg',
  },
  // Cabecera del recibo (board 18421035524). Sólo se crea en el cobro SIMULTÁNEO.
  cobro: {
    /** "🤖Importe Total a Cobrar": lleva el total cobrado, que en simultáneo es el 100%. */
    totalCobrado: 'numeric_mm5gch94',
    ctaCte: 'board_relation_mkwb7fmp',
    /** "📈Ventas": la venta que este recibo cobra. Se linkea recién al crearla. */
    venta: 'board_relation_mm4kwppn',
    /** ID del recibo ("RECIBO-01"); el ítem se renombra con este valor. */
    pulseId: 'pulse_id_mkwb9111',
  },
  // Un movimiento de pago del recibo (board 18421035599).
  cobroSub: {
    /** "✋Caja": la forma de pago. Es una columna status, con sus propias etiquetas. */
    formaPago: 'status',
    importe: 'numeric_mm4e61yk',
    descuento: 'numeric_mm4eyzzc',
    montoCobrado: 'numeric_mm5gkcqp',
    referencia: 'text_mkwbmwz5',
    vencimiento: 'date_mkwb4g2c',
    pulseId: 'pulse_id_mkwbrvf5',
  },
  // Factura de venta pendiente de cobro (board 18421035508): la deuda del pago POSTERIOR.
  factPendiente: {
    ctaCte: 'board_relation_mkwbweqx',
    /** "🤖Vta $": el importe total a cobrar que queda pendiente. */
    total: 'numeric_mkwbck5d',
    /** "🤖Estado": cuánto de esta factura ya se cobró. Nace pendiente al 100%. */
    estado: 'color_mkwb727e',
  },
  // Movimiento de la cuenta corriente (board 18421858762).
  ctaCteSub: {
    /** "Saldo Inicial": el saldo final del movimiento anterior, o 0 si es el primero. */
    saldoAnterior: 'numeric_mm58aacc',
    ventas: 'numeric_mm5gdhkt',
    cobros: 'numeric_mm5gtxav',
    /**
     * "Saldo Final" = saldo inicial + ventas − cobros. Es una columna numérica común, no una
     * fórmula: la calcula y la escribe la app. De acá sale el saldo inicial del movimiento
     * siguiente, así que si queda vacía se corta el arrastre de toda la cuenta.
     */
    saldoFinal: 'numeric_mm5gb7jq',
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
    cliente: 'board_relation_mm582k6v',
    /** "✋️Tipo De Vta": Directa / C-Presup Previo. */
    tipoVenta: 'color_mm5142e4',
    /** "✋Tipo de Entrega": Anterior / Posterior / Simultánea. */
    tipoEntrega: 'color_mm489k2j',
    /** "✋Tipo de Cobro": Posterior / Simultaneo. */
    tipoCobro: 'color_mm5b7t0d',
    /** "✋Entrega": Envio / Sin Envio. Leída del board; todavía sin mapeo definido. */
    entrega: 'color_mm52jx3d',
    rentabilidad: 'numeric_mm52rk7t',
  },
  // Un producto de la venta (subelemento de 📈Ventas).
  ventaSub: {
    producto: 'board_relation_mkwctrv6',
    cantidad: 'numeric_mksesd2',
    precioUnit: 'numeric_mkw85hdw',
    descuento: 'numeric_mm472cqy',
    rentabilidad: 'numeric_mm4cmpa6',
    /** "🤖Cant Entregada Simult": sólo se llena si la entrega es simultánea a la venta. */
    cantEntregadaSimult: 'numeric_mm54fxxh',
  },
  // Cabecera del remito de venta (board 18421035529).
  remito: {
    /** "Cliente": es por donde se acotan los remitos al cliente elegido. */
    cliente: 'board_relation_mm5act3k',
    /** "✋Venta": Anterior / Posterior, según cuándo se factura lo entregado. */
    venta: 'color_mkwbrkg6',
    /** "🤖Estado del Facturacion": cuánto del remito ya se facturó. */
    estadoFacturacion: 'color_mm5bf05j',
    /** "🤖Nro Rto": el número impreso del remito. */
    nroRemito: 'text_mm516d4q',
    fechaEmision: 'date_mm5144rt',
    /** ID del ítem ("RTOVTA-04"); es con lo que se renombra y lo que ve el usuario. */
    pulseId: 'pulse_id_mkwbze0n',
  },
  // Un producto entregado en el remito (subelemento de 🧾🚚 Remitos Ventas).
  remitoSub: {
    producto: 'board_relation_mkwca4wb',
    /** "✋Cant a Entregar": las unidades que salieron en el remito. */
    cantEntregada: 'numeric_mm54mbjx',
    /** "🤖Cant Facturada": de esas unidades, las que ya se facturaron. */
    cantFacturada: 'numeric_mkwcg93f',
    /** "🤖 Estado Facturacion" de la línea. */
    estadoFacturacion: 'color_mm54wrds',
    unidadMedida: 'dropdown_mm5g9mp',
    /** ID del subelemento ("RTOVMOV-03"). */
    pulseId: 'pulse_id_mkwcxgza',
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
  },
  // Una línea del comprobante (subelemento de Facturación).
  facturacionSub: {
    unidadMedida: 'dropdown_mm2gk2mv',
    cantidad: 'numeric_mm1srkr2',
    /** "Precio Unitario $": de él dependen Subtotal/IVA/Total en pesos. */
    precioUnit: 'numeric_mm1swnhz',
    /** "Precio Unitario u$": la otra mitad de las fórmulas, para comprobantes en dólares. */
    precioUnitUsd: 'numeric_mm344c83',
    prodServ: 'dropdown_mm2fyez4',
    /** "Alícuota IVA %": la tasa del producto. La usan las fórmulas de IVA del board. */
    alicuotaIva: 'dropdown_mm2g198w',
  },
  config: {
    valor: 'numeric_mm5bgy5p',
    /** Topes del descuento por producto, en el ítem "Descuento de Producto". */
    descuentoMax: 'numeric_mm5fxdjv',
    descuentoMin: 'numeric_mm5f6k1v',
    /** "Tipo de Config": clasifica cada ítem del tablero de configuración. */
    tipo: 'color_mm4emv5g',
    /** "Valor %": el porcentaje del ítem. En los medios de pago, su descuento. */
    valorPct: 'numeric_mm4e5cta',
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
 * Forma de pago de la app → etiqueta de la columna "✋Caja" del subelemento del recibo.
 * En el board las tarjetas van con mayúscula inicial en las dos palabras.
 */
export const FORMA_PAGO_LABEL: Record<string, string> = {
  Efectivo: 'Efectivo',
  Cheque: 'Cheque',
  Transferencia: 'Transferencia',
  'Tarjeta de débito': 'Tarjeta de Débito',
  'Tarjeta de crédito': 'Tarjeta de Crédito',
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

/** Labels de la columna de estado de envío (color_mm48mc2p), tal cual están en el board. */
export const ENVIO_ESTADO = {
  aEnviar: 'A  Enviar',
  enviando: 'Enviando',
  enviado: 'Enviado',
  error: 'Error en Envio',
  pendiente: 'Pend de Enviar',
} as const
