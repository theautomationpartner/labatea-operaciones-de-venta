/**
 * Lo que comparten los PDF que genera la app (presupuesto, remito de venta y remito preimpreso).
 *
 * Los templates de referencia son HTML: miden en px CSS y react-pdf en puntos. `px()` hace la misma
 * conversión que el navegador al imprimir (96 px = 72 pt), así cada tamaño sale igual.
 */
export const px = (n: number): number => n * 0.75

/**
 * `line-height` del HTML, en puntos. react-pdf infla el interlineado relativo (1.5) en los textos
 * con partes en negrita anidadas, y un número suelto lo toma como multiplicador: en absoluto, y con
 * unidad, sale igual que en el navegador.
 */
export const alto = (fontPx: number, factor: number): string => `${px(fontPx * factor)}pt`

/** Logo de los documentos (`public/`). No es el mismo que el del header de la app. */
export const LOGO_DOCUMENTOS = '/logo-la-batea-pdf.png'

/** Caracteres que Windows y macOS no aceptan en un nombre de archivo. */
const PROHIBIDOS = /[\\/:*?"<>|\u0000-\u001f]+/g

/** Un texto apto para nombre de archivo: lo prohibido se cambia por un espacio. */
export const limpiarNombre = (t: string): string =>
  t.replace(PROHIBIDOS, ' ').replace(/\s+/g, ' ').trim()

/**
 * Trae el logo como data URL. Si no se puede, el PDF sale sin logo: react-pdf corta el documento
 * entero cuando una imagen no carga, y el logo no justifica quedarse sin el documento.
 */
export async function logoComoDataUrl(src: string): Promise<string | undefined> {
  try {
    const res = await fetch(src)
    if (!res.ok) return undefined
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const lector = new FileReader()
      lector.onload = () => resolve(String(lector.result))
      lector.onerror = () => reject(lector.error)
      lector.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}
