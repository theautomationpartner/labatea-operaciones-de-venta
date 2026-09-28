import { createElement } from 'react'
import { nombreSinCodigo } from '@/lib/busquedaClientes'
import { limpiarNombre, logoComoDataUrl } from './comun'
import type { DatosPresupuestoPdf } from './PresupuestoPdf'

/**
 * Nombre del archivo del presupuesto, sin extensión: "Razón social del cliente-Nro. de presupuesto"
 * ("Agropecuaria Ñandú S.A.-PRESUP-009"). Es el nombre con el que queda en Monday, el título de la
 * pestaña y el que recibe el cliente, así que va sin el código interno del cliente. Lo que no puede
 * ir en un nombre de archivo se cambia por un espacio.
 */
export function nombrePresupuestoPdf(razonSocial: string, numero: string): string {
  return `${limpiarNombre(nombreSinCodigo(razonSocial))}-${limpiarNombre(numero)}`
}

/**
 * Genera el PDF del presupuesto EN EL NAVEGADOR y lo devuelve como archivo, listo para abrirlo en
 * una pestaña y para subirlo a la columna file del ítem al registrarlo.
 *
 * react-pdf entra por `import()`: es una librería pesada que sólo hace falta en este paso, así que
 * Vite la deja en un chunk aparte y no engorda la carga inicial de la app.
 */
export async function generarPresupuestoPdf(
  datos: Omit<DatosPresupuestoPdf, 'nombre'>,
): Promise<File> {
  const nombre = nombrePresupuestoPdf(datos.cliente.name, datos.numero)
  const [{ pdf }, { PresupuestoPdf }, logoSrc] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./PresupuestoPdf'),
    datos.logoSrc ? logoComoDataUrl(datos.logoSrc) : Promise.resolve(undefined),
  ])
  // `pdf()` pide un <Document>; el componente lo es, pero su tipo no lo dice.
  const documento = createElement(PresupuestoPdf, { ...datos, nombre, logoSrc }) as unknown as Parameters<
    typeof pdf
  >[0]
  const blob = await pdf(documento).toBlob()
  return new File([blob], `${nombre}.pdf`, { type: 'application/pdf' })
}
