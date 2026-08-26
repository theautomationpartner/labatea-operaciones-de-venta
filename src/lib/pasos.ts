import type { Operacion, Paso, TipoEmisionRemito, TipoEntrega, TipoVenta } from '@/types'

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
  _tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
  tipoEmision: TipoEmisionRemito | null = null,
): readonly string[] {
  /* ANTERIOR y POSTERIOR recorren las MISMAS cuatro etapas: el tipo de emisión sólo decide de
     dónde salen los productos. La DEVOLUCION sí cambia el recorrido: son tres etapas y la última
     no es una emisión, es la imputación contra los remitos ya entregados. */
  if (operacion === 'REMITO') {
    return tipoEmision === 'DEVOLUCION' ? PASOS_REMITO_DEVOLUCION : PASOS_REMITO_OPERACION
  }
  // La VENTA PROFORMA tiene un recorrido fijo de cuatro pasos: no configura venta ni entrega.
  if (operacion === 'VENTA PROFORMA') return PASOS_VENTA
  if (operacion !== 'VENTA') return PASOS_PRESUPUESTO
  if (esFlujoRemito(tipoEntrega)) return PASOS_REMITO
  // VENTA estándar: la etapa "Entrega de Mercadería" SÓLO aparece con entrega POSTERIOR.
  return tipoEntrega === 'POSTERIOR' ? PASOS_VENTA_ENTREGA : PASOS_VENTA
}

/** Tras el "Cobro": si la entrega es POSTERIOR pasa por "Entrega de Mercadería"; si no, va a factura. */
export const pasoTrasCobro = (tipoEntrega: TipoEntrega | null): Paso =>
  tipoEntrega === 'POSTERIOR' ? 'entrega' : 'factura'

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
): readonly Paso[] {
  if (operacion === 'REMITO') {
    // ANTERIOR y POSTERIOR comparten claves; la DEVOLUCION cierra en su propia etapa.
    return tipoEmision === 'DEVOLUCION'
      ? ['cliente', 'remito-productos', 'remito-devolucion']
      : ['cliente', 'remito-productos', 'remito-envio', 'remito-emision']
  }
  if (operacion === 'VENTA PROFORMA') return ['cliente', 'venta-proforma', 'cobro', 'factura']
  if (operacion !== 'VENTA') return ['cliente', 'productos', 'emision'] // PRESUPUESTAR
  const prod = pasoDeProductos(operacion, tipoVenta, tipoEntrega)
  if (esFlujoRemito(tipoEntrega)) return ['cliente', 'remito', 'cobro', 'factura']
  return tipoEntrega === 'POSTERIOR'
    ? ['cliente', prod, 'cobro', 'entrega', 'factura']
    : ['cliente', prod, 'cobro', 'factura']
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
): number {
  const i = pasosKeysDe(operacion, tipoVenta, tipoEntrega, tipoEmision).indexOf(paso)
  return i >= 0 ? i : 0
}

/** Paso 2 de cada flujo: de dónde salen los productos de la operación. */
export function pasoDeProductos(
  operacion: Operacion | null,
  tipoVenta: TipoVenta | null,
  tipoEntrega: TipoEntrega | null,
): Paso {
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
]
