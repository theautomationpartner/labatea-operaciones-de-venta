import { createElement } from 'react'
import { logoComoDataUrl } from './comun'
import type { DatosRemitoPdf } from './datosRemito'

/** Los dos PDF de un remito. */
export interface PdfsRemito {
  /** Remito VENTA: el que recibe el cliente ("🤖RTO Enviar PDF"). */
  venta: File
  /** Remito PREIMPRESO: la réplica del formulario en papel ("🤖RTO PDF PREIMPRESO"). */
  preimpreso: File
}

/**
 * Genera EN EL NAVEGADOR los dos PDF del remito, con los mismos datos: el de VENTA y el PREIMPRESO.
 * Igual que el del presupuesto, react-pdf entra por `import()` y el logo se baja una sola vez.
 *
 * `nombres`: los de cada archivo, sin extensión (ver `nombresRemitoPdf`).
 */
export async function generarRemitoPdfs(
  datos: Omit<DatosRemitoPdf, 'nombre'>,
  nombres: { venta: string; preimpreso: string },
): Promise<PdfsRemito> {
  const [{ pdf }, { RemitoVentaPdf }, { RemitoPreimpresoPdf }, logoSrc] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./RemitoVentaPdf'),
    import('./RemitoPreimpresoPdf'),
    datos.logoSrc ? logoComoDataUrl(datos.logoSrc) : Promise.resolve(undefined),
  ])
  type Documento = Parameters<typeof pdf>[0]
  // `pdf()` pide un <Document>; los componentes lo son, pero su tipo no lo dice.
  const venta = createElement(RemitoVentaPdf, { ...datos, nombre: nombres.venta, logoSrc }) as unknown as Documento
  const preimpreso = createElement(RemitoPreimpresoPdf, {
    ...datos,
    nombre: nombres.preimpreso,
    logoSrc,
  }) as unknown as Documento
  const [blobVenta, blobPreimpreso] = await Promise.all([pdf(venta).toBlob(), pdf(preimpreso).toBlob()])
  return {
    venta: new File([blobVenta], `${nombres.venta}.pdf`, { type: 'application/pdf' }),
    preimpreso: new File([blobPreimpreso], `${nombres.preimpreso}.pdf`, { type: 'application/pdf' }),
  }
}
