import type {
  Operacion,
  Paso,
  TipoEmisionRemito,
  TipoEntrega,
  TipoOperacionActividad,
  TipoVenta,
} from '@/types'

/**
 * Nombres de las etapas del stepper. Son los MISMOS en todas las operaciones: una etapa que hace
 * lo mismo se llama igual, aunque por dentro tome los productos de otro lado (catálogo, presupuesto,
 * proforma o remito). Antes cada recorrido inventaba su variante —"Cargar productos", "Seleccionar
 * remito", "Productos a remitar", "Emitir factura", "Emitir remito", "Emisión y envío"—, así que la
 * misma etapa cambiaba de nombre según cómo hubieras entrado.
 *
 * La única excepción es la DEVOLUCION, donde la mercadería va en el sentido inverso y la etapa no
 * hace lo mismo que su equivalente de venta (ver `productosDevolucion`).
 */
export const ETAPA = {
  cliente: 'Seleccionar Cliente',
  productos: 'Seleccionar Productos',
  cobro: 'Cobro',
  entrega: 'Entrega de Mercadería',
  /**
   * DEVOLUCION. Es la única etapa que NO comparte el nombre con su equivalente de las otras
   * operaciones: no se eligen productos para vender sino para que vuelvan, y el recorrido entero
   * va en el sentido inverso. Nombrarla igual que la de venta invitaba a leer mal la operación.
   */
  productosDevolucion: 'Seleccionar Productos Regresados',
  /** DEVOLUCION: reemplaza a la entrega. No sale mercadería, se imputa la que vuelve. */
  imputacion: 'Imputación de Remitos',
  emitir: 'Emitir y Enviar',
  /**
   * VENTA / PRESUPUESTO · la gestión que originó el documento. En esas operaciones la etapa se
   * llama siempre así; en REGISTRO DE ACTIVIDADES el rótulo lo decide el tipo de operación elegido
   * (ver `rotuloEtapaActividad`).
   */
  actividad: 'Registrar Actividad',
  /** REGISTRO DE ACTIVIDADES · se carga una gestión que todavía no estaba en el tablero. */
  actividadNueva: 'Registrar Nueva Actividad',
  /** REGISTRO DE ACTIVIDADES · se cierran gestiones que ya estaban agendadas. */
  actividadCompletar: 'Completar Actividad Pendiente',
  /**
   * REGISTRO DE ACTIVIDADES · a quién se le asienta. NO se llama "Seleccionar Cliente" como en el resto:
   * acá se elige una Persona del CRM —no necesariamente alguien a quien se le vende— y con ella
   * viajan sus contactos, que es la mitad del trabajo de la etapa.
   */
  persona: 'Seleccionar Persona',
} as const

export const PASOS_PRESUPUESTO = [ETAPA.cliente, ETAPA.productos, ETAPA.emitir] as const

export const PASOS_VENTA = [
  ETAPA.cliente,
  ETAPA.productos,
  ETAPA.cobro,
  ETAPA.emitir,
] as const

/** VENTA con entrega POSTERIOR: la mercadería sale después de facturar, así que suma su etapa. */
export const PASOS_VENTA_ENTREGA = [
  ETAPA.cliente,
  ETAPA.productos,
  ETAPA.cobro,
  ETAPA.entrega,
  ETAPA.emitir,
] as const

/** Venta con entrega ANTERIOR: la mercadería ya salió por remito, falta facturarla. */
export const PASOS_REMITO = PASOS_VENTA

/** Operación REMITO: no hay cobro, y la entrega es la etapa central. */
export const PASOS_REMITO_OPERACION = [
  ETAPA.cliente,
  ETAPA.productos,
  ETAPA.entrega,
  ETAPA.emitir,
] as const

/**
 * REMITO · DEVOLUCION: tres etapas. No hay entrega que definir —la mercadería vuelve, no sale— ni
 * emisión que enviar: la imputación contra los remitos de entrega ES el cierre de la operación,
 * y desde ahí se registran el movimiento de stock y la cantidad devuelta de cada remito.
 */
export const PASOS_REMITO_DEVOLUCION = [
  ETAPA.cliente,
  ETAPA.productosDevolucion,
  ETAPA.imputacion,
] as const

/**
 * REGISTRO DE ACTIVIDADES: dos etapas, y en este orden. Primero se eligen la Persona y sus
 * contactos, y recién después se dice qué se hace con ellos: cargar una gestión nueva, o cerrar
 * alguna de las que ya tienen pendientes. La segunda etapa depende de la primera —la lista de
 * pendientes se arma con lo elegido ahí—, así que la operación arranca eligiendo cliente como
 * todas las demás.
 */
export const PASOS_ACTIVIDAD = [ETAPA.persona, ETAPA.actividad] as const

/**
 * Cómo se llama la segunda etapa de REGISTRO DE ACTIVIDADES: son dos trabajos distintos, y la
 * etapa se nombra por el que se eligió. Sin elegir todavía queda el rótulo genérico, que es lo que
 * el stepper muestra al entrar.
 */
export const rotuloEtapaActividad = (tipo: TipoOperacionActividad | null): string =>
  tipo === 'REGISTRAR NUEVA ACTIVIDAD'
    ? ETAPA.actividadNueva
    : tipo === 'COMPLETAR ACTIVIDAD PENDIENTE'
      ? ETAPA.actividadCompletar
      : ETAPA.actividad

/**
 * La entrega ANTERIOR parte de un remito ya emitido, no del catálogo ni del presupuesto:
 * la mercadería salió antes de la factura, así que lo que se carga son sus pendientes de
 * facturar. Vale para los dos tipos de venta, directa o con presupuesto previo.
 */
export const esFlujoRemito = (tipoEntrega: TipoEntrega | null): boolean =>
  tipoEntrega === 'ANTERIOR'

/**
 * Los pasos que muestra el encabezado. El tipo de venta ya no cambia el recorrido —lo define
 * la entrega—, pero sigue en la firma para que sea la misma que la de `pasoDeProductos`.
 */
export function pasosDe(
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
  tipoEmision: TipoEmisionRemito | null = null,
  tipoVentaProforma: TipoVenta | null = null,
  tipoOperacionActividad: TipoOperacionActividad | null = null,
): readonly string[] {
  /* ANTERIOR y POSTERIOR recorren las MISMAS cuatro etapas: el tipo de emisión sólo decide de
     dónde salen los productos. La DEVOLUCION sí cambia el recorrido: son tres etapas y la última
     no es una emisión, es la imputación contra los remitos ya entregados. */
  if (operacion === 'REMITO') {
    return tipoEmision === 'DEVOLUCION' ? PASOS_REMITO_DEVOLUCION : PASOS_REMITO_OPERACION
  }
  /* La segunda etapa cambia de nombre con lo que se eligió hacer en ella; las CLAVES no cambian
     (ver `pasosKeysDe`), así que el stepper sigue navegando igual. */
  if (operacion === 'REGISTRO DE ACTIVIDADES') {
    return [ETAPA.persona, rotuloEtapaActividad(tipoOperacionActividad)]
  }
  const base =
    // La VENTA PROFORMA tiene un recorrido fijo: no configura tipo de venta ni de entrega.
    operacion === 'VENTA PROFORMA'
      ? PASOS_VENTA
      : operacion !== 'VENTA'
        ? PASOS_PRESUPUESTO
        : esFlujoRemito(tipoEntrega)
          ? PASOS_REMITO
          : // VENTA estándar: "Entrega de Mercadería" SÓLO aparece con entrega POSTERIOR.
            tipoEntrega === 'POSTERIOR'
            ? PASOS_VENTA_ENTREGA
            : PASOS_VENTA
  return registraActividad(operacion, tipoVenta, tipoVentaProforma)
    ? conActividad(base, ETAPA.actividad)
    : base
}

/**
 * ¿El recorrido incluye "Registrar Actividad" antes de emitir?
 *
 * La gestión comercial se registra UNA vez, y la registra el documento que la origina:
 *   · PRESUPUESTAR: siempre. El presupuesto nace de una gestión con el cliente.
 *   · VENTA: sólo la DIRECTA. La que viene CON PRESUPUESTO PREVIO ya tiene su actividad, cargada
 *     al emitir ese presupuesto; volver a pedirla duplicaría el asiento en el tablero.
 *   · VENTA PROFORMA: el mismo criterio, mirando el tipo de venta de la PROFORMA elegida.
 *   · REMITO y REGISTRO DE ACTIVIDADES: no. El remito no origina una gestión, y la operación de
 *     actividades ES la gestión.
 */
export function registraActividad(
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoVentaProforma: TipoVenta | null = null,
): boolean {
  if (operacion === 'PRESUPUESTAR') return true
  if (operacion === 'VENTA') return tipoVenta === 'DIRECTA'
  if (operacion === 'VENTA PROFORMA') return tipoVentaProforma === 'DIRECTA'
  return false
}

/** Mete "Registrar Actividad" JUSTO ANTES de la última etapa, que es siempre la emisión. */
function conActividad<T>(pasos: readonly T[], etapa: T): readonly T[] {
  return [...pasos.slice(0, -1), etapa, pasos[pasos.length - 1]]
}

/** La etapa final de cada operación: donde se emite y se envía el documento. */
export const pasoDeEmision = (operacion: Operacion | null): Paso =>
  operacion === 'PRESUPUESTAR' ? 'emision' : 'factura'

/**
 * Adónde se va al terminar la etapa anterior a la emisión (productos, cobro o entrega): a registrar
 * la actividad si el recorrido la tiene, o directo a emitir si no.
 */
export const pasoAntesDeEmitir = (
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoVentaProforma: TipoVenta | null = null,
): Paso =>
  registraActividad(operacion, tipoVenta, tipoVentaProforma)
    ? 'venta-actividad'
    : pasoDeEmision(operacion)

/**
 * De qué etapa se viene al entrar a "Registrar Actividad": la última antes de ella. Es el destino
 * del botón "Volver".
 */
export const pasoPrevioAActividad = (
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
): Paso => {
  // El presupuesto no tiene cobro: viene derecho de la selección de productos.
  if (operacion === 'PRESUPUESTAR') return pasoDeProductos(operacion, tipoVenta, tipoEntrega)
  return tipoEntrega === 'POSTERIOR' ? 'entrega' : 'cobro'
}

/**
 * De qué etapa se VIENE al entrar a la emisión: el destino del botón "Volver" de la última etapa.
 *
 * Es el espejo de `pasoAntesDeEmitir`, y por eso vive acá y no escrito a mano en cada vista: la
 * emisión de PRESUPUESTO volvía fija a "Seleccionar Productos" y se saltaba "Registrar Actividad",
 * que en ese recorrido está justo en el medio. Con la regla en un solo lugar, sumar o sacar la
 * etapa vale para las tres operaciones que la tienen a la vez.
 */
export const pasoPrevioAEmision = (
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
  tipoVentaProforma: TipoVenta | null = null,
): Paso =>
  registraActividad(operacion, tipoVenta, tipoVentaProforma)
    ? 'venta-actividad'
    : pasoPrevioAActividad(operacion, tipoVenta, tipoEntrega)

/**
 * Tras el "Cobro": si la entrega es POSTERIOR pasa por "Entrega de Mercadería"; si no, sigue con lo
 * que venga antes de emitir (la actividad, o la emisión misma).
 */
export const pasoTrasCobro = (
  tipoEntrega: TipoEntrega | null,
  operacion: Operacion | null = null,
  tipoVenta: TipoVenta | null = null,
  tipoVentaProforma: TipoVenta | null = null,
): Paso =>
  tipoEntrega === 'POSTERIOR'
    ? 'entrega'
    : pasoAntesDeEmitir(operacion, tipoVenta, tipoVentaProforma)

/**
 * Claves de `Paso` en el MISMO orden que las etiquetas de `pasosDe`: mapea el índice del stepper
 * a la etapa a la que se navega al hacer clic en su círculo. Debe quedar sincronizada con `pasosDe`
 * (misma cantidad y orden), y con `pasoDeProductos` para el paso 2.
 */
export function pasosKeysDe(
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
  tipoEmision: TipoEmisionRemito | null = null,
  tipoVentaProforma: TipoVenta | null = null,
): readonly Paso[] {
  if (operacion === 'REMITO') {
    // ANTERIOR y POSTERIOR comparten claves; la DEVOLUCION cierra en su propia etapa.
    return tipoEmision === 'DEVOLUCION'
      ? ['cliente', 'remito-productos', 'remito-devolucion']
      : ['cliente', 'remito-productos', 'remito-envio', 'remito-emision']
  }
  if (operacion === 'REGISTRO DE ACTIVIDADES') return ['actividad-persona', 'actividad']
  const prod = pasoDeProductos(operacion, tipoVenta, tipoEntrega)
  const base: readonly Paso[] =
    operacion === 'VENTA PROFORMA'
      ? ['cliente', 'venta-proforma', 'cobro', 'factura']
      : operacion !== 'VENTA'
        ? ['cliente', 'productos', 'emision'] // PRESUPUESTAR
        : esFlujoRemito(tipoEntrega)
          ? ['cliente', 'remito', 'cobro', 'factura']
          : tipoEntrega === 'POSTERIOR'
            ? ['cliente', prod, 'cobro', 'entrega', 'factura']
            : ['cliente', prod, 'cobro', 'factura']
  /* La misma inserción que en `pasosDe`, en la misma posición: las dos listas TIENEN que quedar
     alineadas índice por índice, o el stepper navegaría a una etapa distinta de la que muestra. */
  return registraActividad(operacion, tipoVenta, tipoVentaProforma)
    ? conActividad(base, 'venta-actividad')
    : base
}

/**
 * En qué posición del stepper cae una etapa del recorrido en curso. Es lo que cada vista usa para
 * marcarse como actual y para numerar su título.
 *
 * Se busca por la CLAVE de `Paso`, no por la etiqueta: buscar por texto ataba la posición al nombre
 * que se muestra, así que al renombrar "Emitir factura" a "Emitir y Enviar" el `indexOf` empezó a
 * devolver −1 y la última etapa se marcaba como la primera. La clave es la identidad de navegación
 * y no cambia porque se reescriba un rótulo.
 *
 * Sin la etapa en el recorrido devuelve 0: es preferible marcar la primera antes que romper.
 */
export function indiceDePaso(
  paso: Paso,
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
  tipoEmision: TipoEmisionRemito | null = null,
  tipoVentaProforma: TipoVenta | null = null,
): number {
  const i = pasosKeysDe(operacion, tipoVenta, tipoEntrega, tipoEmision, tipoVentaProforma).indexOf(
    paso,
  )
  return i >= 0 ? i : 0
}

/** Paso 2 de cada flujo: de dónde salen los productos de la operación. */
export function pasoDeProductos(
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
): Paso {
  /* REGISTRO DE ACTIVIDADES no tiene productos, pero sí un paso 2: la actividad. Se contesta con
     él para que cambiar de operación a mitad de camino caiga en una etapa de ESTE recorrido y no
     en una de otra operación. */
  if (operacion === 'REGISTRO DE ACTIVIDADES') return 'actividad'
  if (operacion === 'REMITO') return 'remito-productos'
  // La VENTA PROFORMA arma la venta a partir de las proformas del cliente.
  if (operacion === 'VENTA PROFORMA') return 'venta-proforma'
  if (operacion !== 'VENTA') return 'productos'
  // La entrega ANTERIOR manda sobre el tipo de venta: siempre se factura desde el remito.
  if (esFlujoRemito(tipoEntrega)) return 'remito'
  return tipoVenta === 'CON PRESUPUESTO PREVIO' ? 'venta' : 'productos'
}

/** Las tres entregas valen para cualquier tipo de venta. */
export const ENTREGAS: readonly TipoEntrega[] = ['POSTERIOR', 'ANTERIOR', 'SIMULTANEA']

/** El remito se emite antes o después de facturar; o es la vuelta de la mercadería. */
export const EMISIONES_REMITO: readonly TipoEmisionRemito[] = [
  'POSTERIOR',
  'ANTERIOR',
  'DEVOLUCION',
]

/** Etiqueta del tipo de emisión en el selector. Sólo la devolución no se lee bien en mayúsculas. */
export const EMISION_REMITO_LABEL: Record<TipoEmisionRemito, string> = {
  POSTERIOR: 'POSTERIOR',
  ANTERIOR: 'ANTERIOR',
  DEVOLUCION: 'DEVOLUCIÓN',
}

export const OPERACIONES: readonly Operacion[] = [
  'PRESUPUESTAR',
  'VENTA',
  'VENTA PROFORMA',
  'REMITO',
  'REGISTRO DE ACTIVIDADES',
]

/**
 * Primera etapa de la operación, la que sigue al "Confirmar" del inicio.
 *
 * Todas abren eligiendo cliente. REGISTRO DE ACTIVIDADES también, pero con SU vista: ahí se elige
 * una Persona del CRM y sus contactos, no un cliente al que facturarle (ver `PASOS_ACTIVIDAD`).
 * Vive acá —y no repetido en cada vista— porque el arranque de una operación es parte de su
 * recorrido.
 */
export const pasoInicialDe = (operacion: Operacion | null): Paso =>
  operacion === 'REGISTRO DE ACTIVIDADES' ? 'actividad-persona' : 'cliente'
