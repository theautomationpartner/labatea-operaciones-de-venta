/**
 * El aviso "el cobro todavía no cierra" NO cambia el alto de la card de Registrar cobro.
 *
 * El mensaje aparece y desaparece solo, según cómo vaya quedando la DIFERENCIA mientras se cargan
 * los importes. Montándolo condicionalmente, completar el cobro le sacaba de golpe el renglón más
 * su separación con la tabla (~65px) y la card pegaba un salto.
 *
 * La solución tiene dos mitades y el test verifica las dos, porque cualquiera de las dos sola no
 * alcanza:
 *   1. el renglón se monta SIEMPRE, con mensaje o sin él (se afirma sobre el markup);
 *   2. su alto está reservado por CSS aunque quede vacío (se afirma sobre la hoja de estilos).
 *
 * Se corre con esbuild + node (`npm run test:aviso-alto`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CobroTarjetas } from '@/features/cobro/CobroTarjetas'
import { resumenCobro, type BalancePago, type ResumenCobro } from '@/lib/cobros'
import { AppProvider } from '@/state/AppProvider'
import type { Cliente, MovimientoPago } from '@/types'

const cliente = { id: '1', name: 'CLIENTE DE PRUEBA', condicionPago: 'CONTADO' } as Cliente
const TOTAL = 100_000

const balance = (importe: number): BalancePago => ({
  movimiento: { id: '1', formaPago: 'Tarjeta de crédito', importe } as MovimientoPago,
  recibido: importe,
  descuento: 0,
  cancelado: importe,
})

const render = (cobrado: number) => {
  const balances = cobrado > 0 ? [balance(cobrado)] : []
  const resumen: ResumenCobro = resumenCobro(balances, TOTAL)
  return renderToStaticMarkup(
    createElement(
      AppProvider,
      null,
      createElement(CobroTarjetas, {
        cliente,
        tipo: 'CREDITO',
        resumen,
        balances,
        diferencia: TOTAL - cobrado,
      }),
    ),
  )
}

/* Tres estados: falta cobrar, se cobró de más, y el cobro cierra justo (sin mensaje). */
const falta = render(40_000)
const excedido = render(140_000)
const justo = render(TOTAL)

assert.ok(falta.includes('Todavía faltan'), 'con la diferencia abierta se explica qué falta')
assert.ok(excedido.includes('supera el total de la venta'), 'y el exceso también se avisa')
assert.ok(
  !justo.includes('supera el total') && !justo.includes('Todavía faltan'),
  'con la diferencia en 0 no queda ningún mensaje: es lo que antes encogía la card',
)

/* Lo que importa: el renglón sigue montado en los TRES casos. Si desapareciera con el cobro
   completo, la card volvería a saltar. */
const renglones = (html: string) => html.split('cobro-card-acts').length - 1
for (const [nombre, html] of [
  ['falta cobrar', falta],
  ['cobrado de más', excedido],
  ['cobro completo', justo],
] as const) {
  assert.equal(renglones(html), 1, `${nombre}: el renglón del aviso tiene que seguir montado`)
  assert.ok(
    html.includes('cobro-bloqueo-inline'),
    `${nombre}: y con él el span que reserva el alto`,
  )
}

/* Y la reserva del alto, que es lo que hace que ese span vacío ocupe igual que uno con texto. */
const css = readFileSync('src/styles/cobro.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const regla = /\.cobro-v2 \.cobro-bloqueo-inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
assert.ok(regla, 'no existe la regla del aviso: cambió la hoja de estilos')

const linea = /--linea:\s*([^;]+)/.exec(regla)?.[1].trim()
assert.equal(linea, '20px', 'el alto de una línea del aviso')
assert.equal(
  /min-height:\s*([^;]+)/.exec(regla)?.[1].trim(),
  'var(--linea)',
  'el span vacío tiene que seguir ocupando una línea: sin `min-height` colapsa a 0 y vuelve el salto',
)
assert.equal(
  /line-height:\s*([^;]+)/.exec(regla)?.[1].trim(),
  'var(--linea)',
  'y el texto tiene que medir EXACTAMENTE eso, o con mensaje ocuparía distinto que sin él',
)

console.log('OK · el aviso del cobro aparece y desaparece sin mover el alto de la card')
