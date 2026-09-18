/**
 * Render de comprobación del bloque "Medio de Envío" de `EnviarDocumento`, para contrastarlo con
 * la referencia visual. No es un test de la suite: se corre a mano cuando se toca ese bloque.
 *
 *   npx esbuild tests/qa/render-envio.tsx --bundle --platform=node --format=cjs \
 *     --tsconfig=tsconfig.json --define:import.meta.env.DEV=false \
 *     --define:import.meta.env.VITE_MONDAY_TOKEN=undefined \
 *     --outfile=node_modules/.cache/render-envio.cjs && node node_modules/.cache/render-envio.cjs
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { DispatchContext, StateContext } from '@/state/context'
import { initialState, type AppState } from '@/state/appState'
import type { Cliente, Contacto, Operacion } from '@/types'

const CLIENTE = { id: '1', name: '7001 - La Batea S.A TEST' } as Cliente
const CONTACTOS: Contacto[] = [
  {
    id: 'C-1',
    itemId: '10',
    name: 'Luciano 1',
    phone: '5492494014611',
    email: 'luciano@x.com',
    ini: 'L1',
    color: '#0073ea',
    status: 'ACEPTA PRESUPUESTO',
    ok: true,
  } as Contacto,
]

const render = (operacion: Operacion, documento: string): string => {
  const estado: AppState = {
    ...initialState,
    operacion,
    cliente: CLIENTE,
    contactos: CONTACTOS,
    ventaId: '99',
    proformaId: '98',
    presupuestoId: '97',
    documentoEmitido: true,
    factura: {
      ...initialState.factura,
      comprobantes: [
        { clave: 'COMUN', titulo: 'x', id: '1', lineasCreadas: 1, lineasEsperadas: 1 },
      ],
    },
  }
  return renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      { value: estado },
      createElement(
        DispatchContext.Provider,
        { value: () => {} },
        createElement(EnviarDocumento, { documento }),
      ),
    ),
  )
}

/** El PRIMER bloque `.igp` —el del medio de envío— partido en líneas para poder leerlo. */
function bloqueMedio(html: string): string {
  const desde = html.indexOf('<div class="igp">')
  if (desde < 0) return '(no se renderizó el bloque del medio de envío)'
  // Se corta en el segundo `.igp`, que ya es el selector de contactos.
  const siguiente = html.indexOf('<div class="igp">', desde + 1)
  return html
    .slice(desde, siguiente < 0 ? undefined : siguiente)
    .split('><')
    .join('>\n<')
}

for (const [operacion, documento] of [
  ['VENTA', 'factura'],
  ['VENTA PROFORMA', 'factura'],
  ['VENTA', 'proforma'],
  ['PRESUPUESTAR', 'presupuesto'],
  ['REMITO', 'remito'],
] as [Operacion, string][]) {
  console.log(`\n===== ${operacion} · documento "${documento}" =====`)
  console.log(bloqueMedio(render(operacion, documento)))
}
