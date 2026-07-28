/**
 * Reglas de negocio puras (sin React, sin DOM): totales, crédito y cobertura.
 * Aisladas acá para que la capa de servicio sólo tenga que aportar los datos.
 */
import { aplicaCredito, creditoDisponibleProyectado, creditoResultante } from '@/lib/credito'
import { round2 } from '@/lib/format'
import type {
  Cliente,
  FacturaItem,
  LineaPresupuesto,
  Producto,
  TipoVenta,
  VentaItem,
} from '@/types'

export const IVA_RATE = 0.21

/** La comisión del vendedor depende del tipo de venta. En puntos porcentuales. */
export const COMISION_PCT: Record<TipoVenta, number> = {
  'CON PRESUPUESTO PREVIO': 4,
  DIRECTA: 1.5,
}

/** Comisión sobre el importe neto (sin IVA). */
export const comisionDe = (neto: number, tipoVenta: TipoVenta): number =>
  round2((neto * COMISION_PCT[tipoVenta]) / 100)

/** Umbrales de semáforo sobre el % de crédito utilizado. */
const CREDITO_ALERTA = 50
const CREDITO_CRITICO = 90
/** Por encima de este % el footer del presupuesto pasa a rojo. */
const CREDITO_FOOTER_CRITICO = 95

/** Importe de la línea, ya bonificado. Como todo monto, redondeado a dos decimales. */
export const totalLinea = (l: LineaPresupuesto): number =>
  round2(l.producto.precio * l.cantidad * (1 - l.descuento / 100))

/**
 * Rentabilidad que queda tras bonificar. El margen de lista se mide sobre el precio de lista;
 * al bajar el precio, el costo pesa más y el margen cae:
 *
 *   costo = precio × (1 − rent/100)   ·   precio bonificado = precio × (1 − desc/100)
 *   rent efectiva = 1 − costo / precio bonificado
 *
 * Un producto regalado (100%) se lleva el costo entero: −100%.
 */
export function rentabilidadEfectiva(rentabilidadLista: number, descuento: number): number {
  if (!descuento) return rentabilidadLista
  if (descuento >= 100) return -100
  const costo = 1 - rentabilidadLista / 100
  return (1 - costo / (1 - descuento / 100)) * 100
}

/** La rentabilidad de la línea, ya con su descuento aplicado. */
export const rentabilidadLinea = (l: LineaPresupuesto): number =>
  rentabilidadEfectiva(l.producto.rentabilidad, l.descuento)

export const subtotalLinea = (l: LineaPresupuesto): number =>
  round2(l.producto.precio * l.cantidad)

export interface ResumenPresupuesto {
  /**
   * Suma de la columna **Subtotal** de la tabla: cantidad × precio, SIN descuentos. Es el
   * bruto del documento; sólo coincide con el total cuando ninguna línea lleva bonificación.
   */
  subtotal: number
  /** Lo bonificado sobre el bruto: subtotal − neto. */
  descuento: number
  /** Suma de la columna **Total** de la tabla: lo que queda después de bonificar. */
  neto: number
  /** IVA sobre el neto. En el presupuesto siempre es 0: el presupuesto no lo liquida. */
  iva: number
  /** Importe final del documento: neto + IVA. */
  total: number
  /** Rentabilidad ponderada por importe de cada línea. */
  rentabilidad: number
}

/**
 * Totales de una lista de productos, con los mismos números que muestra la tabla: el subtotal
 * es la suma de la columna Subtotal (bruto) y el neto, la de la columna Total (bonificado).
 *
 * `conIva` distingue los dos usos: la VENTA liquida el 21% sobre el neto, y el PRESUPUESTO no
 * lo liquida en absoluto —sus precios son los de lista, sin la alícuota del producto—.
 */
export function resumenPresupuesto(
  lineas: LineaPresupuesto[],
  conIva = true,
): ResumenPresupuesto {
  // Los dos suman líneas ya redondeadas: es lo mismo que se ve producto por producto.
  const subtotal = round2(lineas.reduce((acc, l) => acc + subtotalLinea(l), 0))
  const neto = round2(lineas.reduce((acc, l) => acc + totalLinea(l), 0))
  // Cada línea pesa por su importe ya bonificado, y aporta su rentabilidad efectiva.
  const rentabilidad =
    neto > 0
      ? lineas.reduce((acc, l) => acc + rentabilidadLinea(l) * (totalLinea(l) / neto), 0)
      : 0
  const iva = conIva ? round2(neto * IVA_RATE) : 0
  return {
    subtotal,
    descuento: round2(subtotal - neto),
    neto,
    iva,
    total: round2(neto + iva),
    rentabilidad,
  }
}

export interface CreditoCliente {
  disponible: number
  usadoPct: number
  disponiblePct: number
  /** Color del semáforo, en variables CSS. */
  color: string
  /** Clase de texto asociada al semáforo. */
  clase: 'v-green' | 'v-orange' | 'v-red'
  bloqueado: boolean
}

/**
 * Estado de crédito del cliente. El disponible lo calcula el board ("🤖Crédito Disponible");
 * el uso es lo que falta para llegar al límite, no un cálculo propio.
 */
export function creditoCliente(c: Cliente): CreditoCliente {
  const disponible = c.disponible
  const usado = c.limit - disponible
  const usadoPct = c.limit > 0 ? Math.round((usado / c.limit) * 100) : 0
  const disponiblePct = c.limit > 0 ? Math.round((disponible / c.limit) * 100) : 100

  let color = 'var(--green)'
  let clase: CreditoCliente['clase'] = 'v-green'
  if (usadoPct >= CREDITO_CRITICO) {
    color = 'var(--red)'
    clase = 'v-red'
  } else if (usadoPct >= CREDITO_ALERTA) {
    color = 'var(--yellow)'
    clase = 'v-orange'
  }

  return { disponible, usadoPct, disponiblePct, color, clase, bloqueado: c.situation === 'Bloqueado' }
}

export interface ImpactoCredito {
  /** Crédito que le quedaría al cliente si se confirma la operación. */
  disponible: number
  usadoPct: number
  critico: boolean
  /** El límite rige esta operación. Con `false` los tres campos de arriba quedan neutros. */
  aplica: boolean
}

/**
 * Proyecta el crédito sumando el importe de la operación en curso: el disponible del board
 * baja y el uso crece a medida que se cargan productos.
 *
 * Si el crédito no rige (contado, o cliente liberado sin crédito) no se proyecta nada: no
 * hay línea que consumir, así que la operación nunca "usa" ni "excede".
 */
export function impactoCredito(cliente: Cliente | null, importe: number): ImpactoCredito {
  if (!aplicaCredito(cliente)) {
    return { disponible: cliente?.disponible ?? 0, usadoPct: 0, critico: false, aplica: false }
  }
  const limite = cliente?.limit ?? 0
  const usado = (cliente ? cliente.limit - cliente.disponible : 0) + importe
  const usadoPct = limite > 0 ? Math.min((usado / limite) * 100, 100) : 0
  return {
    // El disponible proyectado sale de la fórmula centralizada, ya clampada en 0.
    disponible: creditoDisponibleProyectado(cliente, importe),
    usadoPct,
    critico: usadoPct >= CREDITO_FOOTER_CRITICO,
    aplica: true,
  }
}

export interface ResumenVenta {
  /** Suma de la columna Subtotal de la tabla: cantidad × precio, sin descuentos. */
  subtotal: number
  /** Lo bonificado sobre el bruto: subtotal − total. */
  descuento: number
  /** Suma de la columna Total: lo que se factura tras bonificar (sin IVA). */
  total: number
  comision: number
  /** Alícuota aplicada, para rotular la métrica. */
  comisionPct: number
  rentabilidad: number
  /** Crédito disponible del cliente antes de esta venta. */
  disponible: number
  /** Uso de la cuenta corriente incluyendo esta venta: mismo criterio que PRESUPUESTAR. */
  usadoPct: number
  /** Al rojo, igual que en el footer del presupuesto. */
  critico: boolean
  /** Crédito que queda tras la venta (puede ser negativo). */
  resultante: number
  limite: number
}

export function resumenVenta(
  items: VentaItem[],
  cliente: Cliente | null,
  tipoVenta: TipoVenta,
): ResumenVenta {
  // Cada línea entra ya bonificada, y aporta la rentabilidad que le queda tras el descuento.
  const importeItem = (it: VentaItem) =>
    round2(it.precio * it.aVender * (1 - (it.desc ?? 0) / 100))
  // El bruto es el de la columna Subtotal: cantidad × precio, antes de bonificar.
  const subtotal = round2(items.reduce((acc, it) => acc + round2(it.precio * it.aVender), 0))
  const total = round2(items.reduce((acc, it) => acc + importeItem(it), 0))
  const rentPonderada = items.reduce(
    (acc, it) => acc + rentabilidadEfectiva(it.rent, it.desc ?? 0) * importeItem(it),
    0,
  )

  const limite = cliente?.limit ?? 0
  const disponible = cliente?.disponible ?? 0
  const impacto = impactoCredito(cliente, total)

  return {
    subtotal,
    descuento: round2(subtotal - total),
    total,
    comision: comisionDe(total, tipoVenta),
    comisionPct: COMISION_PCT[tipoVenta],
    rentabilidad: total > 0 ? Math.round(rentPonderada / total) : 0,
    disponible,
    usadoPct: impacto.usadoPct,
    critico: impacto.critico,
    resultante: cliente ? creditoResultante(cliente, total) : round2(disponible - total),
    limite,
  }
}

/**
 * Topes del descuento por producto, en puntos porcentuales. Son los valores de respaldo:
 * los vigentes se leen del tablero de configuración al iniciar la app.
 */
export const DESCUENTO_MAX_DEFAULT = 5
export const DESCUENTO_MIN_DEFAULT = 1.5

/**
 * Umbrales de la barra de cobertura, sobre el % de stock disponible consumido: hasta la
 * mitad va en verde, de ahí en más en amarillo y, al llegar al total disponible, en rojo.
 */
const COBERTURA_ALERTA = 50
const COBERTURA_CRITICA = 100

export type NivelCobertura = 'ok' | 'alerta' | 'critico'

const COBERTURA_COLOR: Record<NivelCobertura, string> = {
  ok: 'var(--green)',
  alerta: 'var(--yellow)',
  critico: 'var(--red)',
}

export interface Cobertura {
  /** % del stock disponible que consume la cantidad elegida. Puede pasarse de 100. */
  pct: number
  /** El mismo %, acotado a 100: es lo que se pinta en la barra. */
  pctBarra: number
  nivel: NivelCobertura
  color: string
  /** La cantidad elegida supera lo que hay disponible. */
  excede: boolean
}

/** Cuánto del stock disponible se lleva la cantidad en curso. No altera el stock. */
export function cobertura(p: Producto, cantidad: number): Cobertura {
  // Sin stock disponible cualquier cantidad ya lo excede: la barra va al tope, no a cero.
  const pct =
    p.disponible > 0 ? (cantidad / p.disponible) * 100 : cantidad > 0 ? COBERTURA_CRITICA : 0
  const nivel: NivelCobertura =
    pct >= COBERTURA_CRITICA ? 'critico' : pct >= COBERTURA_ALERTA ? 'alerta' : 'ok'
  return {
    pct,
    pctBarra: Math.min(pct, 100),
    nivel,
    color: COBERTURA_COLOR[nivel],
    excede: cantidad > p.disponible,
  }
}

/* ===== Remitos pendientes de facturar ===== */

export const facturaItemUid = (remitoId: string, indice: number): string => `${remitoId}-${indice}`

export interface ResumenFactura {
  subtotal: number
  descuento: number
  /** Lo que efectivamente se factura. */
  neto: number
  /** Rentabilidad general de la venta, en %: ponderada por el importe de cada línea. */
  rentabilidad: number
  disponible: number
  /** Uso de la cuenta corriente incluyendo esta factura: mismo criterio que PRESUPUESTAR. */
  usadoPct: number
  critico: boolean
  resultante: number
  limite: number
}

export function resumenFactura(
  items: FacturaItem[],
  cliente: Cliente | null,
  descuento: number,
): ResumenFactura {
  const subtotal = round2(items.reduce((acc, it) => acc + round2(it.precio * it.aFacturar), 0))
  // El descuento del remito sólo aplica si hay algo que facturar.
  const descuentoAplicado = subtotal > 0 ? round2(Math.min(descuento, subtotal)) : 0
  const neto = round2(subtotal - descuentoAplicado)
  // Rentabilidad general ponderada por el importe de cada línea (la factura no lleva descuento
  // por línea, así que el importe de referencia es precio × cantidad a facturar).
  const rentPonderada = items.reduce(
    (acc, it) => acc + it.rent * round2(it.precio * it.aFacturar),
    0,
  )

  const limite = cliente?.limit ?? 0
  const disponible = cliente?.disponible ?? 0
  const impacto = impactoCredito(cliente, neto)

  return {
    subtotal,
    descuento: descuentoAplicado,
    neto,
    rentabilidad: subtotal > 0 ? Math.round(rentPonderada / subtotal) : 0,
    disponible,
    usadoPct: impacto.usadoPct,
    critico: impacto.critico,
    resultante: disponible - neto,
    limite,
  }
}

/** Estado de avance de una línea de presupuesto ya emitido. */
export type AvanceLinea = 'completo' | 'parcial' | 'pendiente'

export function avanceLinea(vend: number, pend: number): AvanceLinea {
  if (pend === 0) return 'completo'
  return vend > 0 ? 'parcial' : 'pendiente'
}

export const AVANCE_COLOR: Record<AvanceLinea, string> = {
  completo: 'var(--green)',
  parcial: 'var(--orange)',
  pendiente: 'var(--red)',
}

export const AVANCE_LABEL: Record<AvanceLinea, string> = {
  completo: 'Vendido completo',
  parcial: 'Vendido parcialmente',
  pendiente: 'Pendiente',
}

/** Mismo avance, leído en clave de facturación. */
export const AVANCE_LABEL_FACTURA: Record<AvanceLinea, string> = {
  completo: 'Facturado completo',
  parcial: 'Facturado parcialmente',
  pendiente: 'Sin facturar',
}

/** Mismo avance, leído en clave de entrega (remito de emisión ANTERIOR). */
export const AVANCE_LABEL_ENTREGA: Record<AvanceLinea, string> = {
  completo: 'Entregado completo',
  parcial: 'Entregado parcial',
  pendiente: 'Sin entregar',
}

/** Identidad de una línea del presupuesto llevada a la venta. */
export const ventaItemUid = (presupuestoId: string, indice: number): string =>
  `${presupuestoId}-${indice}`

/** Identidad de una línea de una venta llevada al remito (emisión ANTERIOR). */
export const remitoItemUid = (ventaId: string, indice: number): string => `${ventaId}-${indice}`
