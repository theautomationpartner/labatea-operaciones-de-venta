/**
 * Render de comprobación de la cabecera de las cards de "Comprobantes a generar", en sus tres
 * estados. No es un test de la suite: se corre a mano cuando se toca ese bloque.
 *
 *   npx esbuild tests/qa/render-comprobantes.tsx --bundle --platform=node --format=cjs \
 *     --tsconfig=tsconfig.json --define:import.meta.env.DEV=false \
 *     --define:import.meta.env.VITE_MONDAY_TOKEN=undefined \
 *     --outfile=node_modules/.cache/render-comprobantes.cjs && node node_modules/.cache/render-comprobantes.cjs
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComprobantesAGenerar } from '@/features/factura/ComprobantesAGenerar'
import type { ComprobanteAGenerar } from '@/lib/facturacion'
import type { ComprobanteEmitido } from '@/types'

const linea = (nombre: string) => ({
  productoId: '1',
  nombre,
  cantidad: 2,
  precioUnitario: 1000,
  descuento: 0,
  rentabilidad: 30,
  iva: 21,
})

const comprobante = (clave: string, consignada: boolean): ComprobanteAGenerar =>
  ({
    clave,
    tipo: consignada ? 'CONSIGNADA' : 'COMUN',
    proveedorId: consignada ? '9' : null,
    proveedorNombre: consignada ? 'PROVEEDOR TEST' : null,
    titulo: consignada ? 'Consignada · PROVEEDOR TEST' : 'Mercadería común',
    lineas: [linea('PRODUCTO')],
    bruto: 2000,
    descuento: 0,
    subtotal: 2000,
    iva: 420,
    total: 2420,
  }) as ComprobanteAGenerar

const COMPROBANTES = [comprobante('COMUN', false), comprobante('CO:9', true)]

const render = (emitiendo: boolean, emitidos: Map<string, ComprobanteEmitido>): string =>
  renderToStaticMarkup(
    createElement(ComprobantesAGenerar, {
      comprobantes: COMPROBANTES,
      descFormaPago: 0,
      letra: 'A',
      puntoVenta: '0000',
      fechaEmision: '18/09/2026',
      venceAPlazo: false,
      dias: { COMUN: 30, 'CO:9': 30 },
      emitidos,
      emitiendo,
    }),
  )

/** Sólo el bloque de estado de cada card, uno por línea. */
const estados = (html: string): string[] =>
  [...html.matchAll(/<span class="comp-estado">.*?<\/span><\/span>/g)].map((m) => m[0])

const emitida = (clave: string): [string, ComprobanteEmitido] => [
  clave,
  { clave, titulo: 'x', id: '100', lineasCreadas: 1, lineasEsperadas: 1 },
]
const aMedias = (clave: string): [string, ComprobanteEmitido] => [
  clave,
  { clave, titulo: 'x', id: '100', lineasCreadas: 0, lineasEsperadas: 1 },
]

const CASOS: [string, boolean, Map<string, ComprobanteEmitido>][] = [
  ['EN REPOSO (sin emitir)', false, new Map()],
  ['EMITIENDO (las dos cards)', true, new Map()],
  ['EMITIDAS', false, new Map([emitida('COMUN'), emitida('CO:9')])],
  ['UNA INCOMPLETA', false, new Map([emitida('COMUN'), aMedias('CO:9')])],
]

for (const [titulo, emitiendo, emitidos] of CASOS) {
  console.log(`\n===== ${titulo} =====`)
  estados(render(emitiendo, emitidos)).forEach((e, i) => {
    console.log(`  card ${i + 1} (${i === 0 ? 'común' : 'consignada'}): ${e}`)
  })
}

const html = render(true, new Map())
console.log(`\n¿queda la palabra "Emitiendo" en pantalla?  ${/Emitiendo…|Emitiendo\.\.\./.test(html)}`)
