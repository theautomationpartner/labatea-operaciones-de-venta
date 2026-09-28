import { createElement } from 'react'
import { nombreSinCodigo } from '@/lib/busquedaClientes'
import { limpiarNombre } from './comun'
import type { DatosProformaPdf, LineaProformaPdf } from './ProformaPdf'

/** Importes como los muestra la app: miles con punto y coma decimal ("203.458,45"). */
const AR = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Cantidades sin decimales de más ("12", "2,5"). */
const CANT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
export const importe = (n: number): string => AR.format(n)

/** Una fila de la card de la proforma, con lo que el PDF necesita. */
export interface FilaProforma {
  codigo?: string
  nombre: string
  cantidad: number
  um?: string
  precioUnitario: number
  bonifUnit: number
  totalLinea: number
}

/** Las líneas del PDF, desde las filas de la card (los mismos importes). */
export const lineasProformaPdf = (filas: readonly FilaProforma[]): LineaProformaPdf[] =>
  filas.map((f) => ({
    codigo: f.codigo ?? '',
    producto: f.nombre,
    cantidad: CANT.format(f.cantidad),
    um: f.um ?? '',
    unitario: importe(f.precioUnitario),
    impBonif: importe(f.bonifUnit),
    subtotal: importe(f.totalLinea),
  }))

/**
 * Nombre del archivo, sin extensión: "Razón social-PROFORMA-037", sin el código interno del cliente,
 * igual que el del presupuesto.
 */
export const nombreProformaPdf = (razonSocial: string, numero: string): string =>
  `${limpiarNombre(nombreSinCodigo(razonSocial))}-${limpiarNombre(numero)}`

/**
 * Genera EN EL NAVEGADOR el PDF de la factura proforma. Igual que los otros documentos, react-pdf
 * entra por `import()`. La proforma no lleva logo.
 */
export async function generarProformaPdf(datos: Omit<DatosProformaPdf, 'nombre'>): Promise<File> {
  const nombre = nombreProformaPdf(datos.cliente.razonSocial, datos.numero)
  const [{ pdf }, { ProformaPdf }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./ProformaPdf'),
  ])
  // `pdf()` pide un <Document>; el componente lo es, pero su tipo no lo dice.
  const documento = createElement(ProformaPdf, { ...datos, nombre }) as unknown as Parameters<typeof pdf>[0]
  const blob = await pdf(documento).toBlob()
  return new File([blob], `${nombre}.pdf`, { type: 'application/pdf' })
}
