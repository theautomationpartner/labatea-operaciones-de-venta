import { nombreSinCodigo } from '@/lib/busquedaClientes'
import type { DatosImprenta } from '@/services/monday/talonarios'
import type { RemitoItem } from '@/types'
import { limpiarNombre } from './comun'

/** Una línea de los PDF del remito: la mercadería que sale, sin importes. */
export interface LineaRemitoPdf {
  codigo: string
  descripcion: string
  /** La factura con la que se vendió (remito ANTERIOR). Vacía si todavía no se facturó. */
  factura: string
  unidad: string
  cantidad: string
}

/**
 * Lo que necesitan los dos PDF del remito (VENTA y PREIMPRESO). Salen del estado de la app al emitir
 * y del talonario (número y pie de imprenta con el CAI).
 */
export interface DatosRemitoPdf {
  /** "0091-00000007": punto de venta y hoja del talonario (ver `numeroRemito`). */
  numero: string
  /** Nombre del archivo, sin extensión: también es el título del documento. */
  nombre: string
  /** dd/MM/yyyy. */
  fechaEmision: string
  cliente: {
    name: string
    cuit: string
    addr: string
    /** Condición frente al IVA ("Responsable Inscripto"…). */
    condicionIva: string
  }
  /** Código de Operación de Traslado, si se generó. */
  cot: string
  lineas: LineaRemitoPdf[]
  imprenta: DatosImprenta
  logoSrc?: string
}

/** Cantidad como se escribe en el remito: sin decimales de más ("12", "2,5"). */
const CANT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** Las líneas del remito, desde lo que se va a remitir. */
export const lineasRemitoPdf = (items: readonly RemitoItem[]): LineaRemitoPdf[] =>
  items.map((it) => ({
    codigo: it.codigo,
    descripcion: it.nombre,
    factura: it.nroFactura ?? '',
    unidad: it.um,
    cantidad: CANT.format(it.cantidad),
  }))

/**
 * Nombres de los dos archivos, sin extensión: "Razón social-REMITO 0091-00000007" y el mismo con
 * " PREIMPRESO". Sin el código interno del cliente, igual que el del presupuesto.
 */
export function nombresRemitoPdf(razonSocial: string, numero: string): { venta: string; preimpreso: string } {
  const base = `${limpiarNombre(nombreSinCodigo(razonSocial))}-REMITO ${limpiarNombre(numero)}`
  return { venta: base, preimpreso: `${base} PREIMPRESO` }
}
