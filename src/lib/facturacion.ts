/**
 * Evaluación de la mercadería de la venta: en cuántos comprobantes se parte y qué lleva cada
 * uno. Es lo primero que corre después de crear el ítem de la venta, para cualquier tipo de
 * venta, y no depende de React ni de Monday.
 *
 * La regla es la mercadería, no el producto:
 *   · todo lo COMÚN (COM) va en UN comprobante;
 *   · todo lo CONSIGNADO (CO) va aparte, y además se abre POR PROVEEDOR.
 *
 * Con 6 productos comunes, 4 consignados del Proveedor A y 3 del Proveedor B salen tres
 * comprobantes: uno común, uno de A y uno de B.
 */
/* Se importan los módulos concretos y no el barril de servicios: la capa de servicio de
   facturación depende de este archivo, y pasar por el barril armaría un ciclo. */
import { round2 } from '@/lib/format'
import { FACT_ALICUOTAS_IVA } from '@/services/monday/columns'
import type { LineaVenta } from '@/services/monday/venta'

/** Alícuota que se asume cuando el producto no la trae cargada en el maestro. */
export const ALICUOTA_POR_DEFECTO = 21

/** Clave del comprobante de mercadería común. Es único, así que no necesita proveedor. */
export const CLAVE_COMUN = 'COMUN'

/** Cómo se llama el grupo de mercadería cuando el producto consignado no tiene proveedor. */
const SIN_PROVEEDOR = 'Sin proveedor'

export type TipoMercaderia = 'COMUN' | 'CONSIGNADA'

/** Un comprobante a emitir: un subconjunto de las líneas de la venta, con sus totales. */
export interface ComprobanteAGenerar {
  /** Identidad del grupo dentro de la venta ('COMUN' o 'CO:<proveedor>'). */
  clave: string
  tipo: TipoMercaderia
  /** Proveedor de la mercadería consignada; null en el comprobante de mercadería común. */
  proveedorId: string | null
  proveedorNombre: string | null
  /** Rótulo del comprobante, para mostrarlo y para nombrar el ítem en el board. */
  titulo: string
  /**
   * Vencimiento del pago, en dd/MM/yyyy. Lo completa la vista: nace a 30 días de la emisión y
   * se puede cambiar por comprobante. Sin valor, la capa de servicio aplica ese mismo default.
   */
  vencimiento?: string
  lineas: LineaVenta[]
  subtotal: number
  iva: number
  total: number
}

/**
 * La mercadería es consignada sólo si el tipo es exactamente 'CO'. Se compara entero y no por
 * prefijo a propósito: 'COM' (común) también empieza con "CO". Sin dato se toma como común,
 * que es el comprobante que siempre existe.
 */
export const esConsignada = (tipoMercaderia?: string): boolean =>
  (tipoMercaderia ?? '').trim().toUpperCase() === 'CO'

/**
 * Alícuota con la que se declara la línea. El board sólo acepta las tasas de AFIP que tiene
 * cargadas, así que la del producto se resuelve contra esa lista: si no está, se usa la más
 * cercana, para no inventar una tasa que el comprobante no pueda declarar.
 */
export function alicuotaDe(linea: LineaVenta): number {
  const tasa = linea.iva && linea.iva > 0 ? linea.iva : ALICUOTA_POR_DEFECTO
  if (FACT_ALICUOTAS_IVA.includes(tasa as (typeof FACT_ALICUOTAS_IVA)[number])) return tasa
  return FACT_ALICUOTAS_IVA.reduce((mejor, a) =>
    Math.abs(a - tasa) < Math.abs(mejor - tasa) ? a : mejor,
  )
}

/**
 * Precio unitario que va al comprobante. El subelemento de Facturación no tiene columna de
 * descuento y su subtotal es `cantidad × precio unitario`, así que la bonificación de la línea
 * tiene que venir ya aplicada: si no, la factura no cerraría contra la venta.
 */
export const precioFacturado = (l: LineaVenta): number =>
  round2(l.precioUnitario * (1 - (l.descuento ?? 0) / 100))

/** Importe neto de la línea, ya bonificado. */
export const netoLinea = (l: LineaVenta): number => round2(precioFacturado(l) * l.cantidad)

/** IVA de la línea, con la alícuota que se va a declarar. */
export const ivaLinea = (l: LineaVenta): number => round2((netoLinea(l) * alicuotaDe(l)) / 100)

/**
 * Cómo se identifica el proveedor de una línea consignada: el ítem del board si lo tiene y,
 * si no, su nombre normalizado. Sin ninguno de los dos, todas esas líneas caen en un mismo
 * grupo "sin proveedor" en vez de abrir un comprobante por producto.
 */
const claveProveedor = (l: LineaVenta): string =>
  l.proveedorId || (l.proveedorNombre ?? '').trim().toLowerCase()

/**
 * Parte las líneas de la venta en los comprobantes que hay que emitir. Devuelve primero el de
 * mercadería común y después los consignados, ordenados por proveedor; los grupos vacíos no
 * existen, así que una venta sin consignada da un solo comprobante.
 */
export function comprobantesDeVenta(lineas: LineaVenta[]): ComprobanteAGenerar[] {
  const grupos = new Map<string, LineaVenta[]>()

  for (const l of lineas) {
    const clave = esConsignada(l.tipoMercaderia) ? `CO:${claveProveedor(l)}` : CLAVE_COMUN
    const actual = grupos.get(clave)
    if (actual) actual.push(l)
    else grupos.set(clave, [l])
  }

  const comprobantes: ComprobanteAGenerar[] = []
  for (const [clave, lineasGrupo] of grupos) {
    const consignada = clave !== CLAVE_COMUN
    // Todas las líneas del grupo comparten proveedor: alcanza con mirar la primera.
    const proveedorNombre = consignada
      ? lineasGrupo[0].proveedorNombre?.trim() || SIN_PROVEEDOR
      : null
    const subtotal = round2(lineasGrupo.reduce((acc, l) => acc + netoLinea(l), 0))
    const iva = round2(lineasGrupo.reduce((acc, l) => acc + ivaLinea(l), 0))
    comprobantes.push({
      clave,
      tipo: consignada ? 'CONSIGNADA' : 'COMUN',
      proveedorId: consignada ? lineasGrupo[0].proveedorId ?? null : null,
      proveedorNombre,
      titulo: consignada ? `Consignada · ${proveedorNombre}` : 'Mercadería común',
      lineas: lineasGrupo,
      subtotal,
      iva,
      total: round2(subtotal + iva),
    })
  }

  return comprobantes.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'COMUN' ? -1 : 1
    return (a.proveedorNombre ?? '').localeCompare(b.proveedorNombre ?? '', 'es')
  })
}

/** Totales de todos los comprobantes juntos: es lo que tiene que cerrar contra la venta. */
export function totalesComprobantes(comprobantes: ComprobanteAGenerar[]) {
  return {
    subtotal: round2(comprobantes.reduce((acc, c) => acc + c.subtotal, 0)),
    iva: round2(comprobantes.reduce((acc, c) => acc + c.iva, 0)),
    total: round2(comprobantes.reduce((acc, c) => acc + c.total, 0)),
  }
}
