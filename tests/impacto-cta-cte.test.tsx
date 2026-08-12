/**
 * "Impacto en cuenta corriente": cómo queda la cuenta del cliente después de una venta que deja
 * deuda. Se verifica qué métricas muestra la card y con qué clases.
 *
 * No hay runner de DOM en el proyecto, así que se renderiza con `react-dom/server`, que ya es
 * dependencia: alcanza para ver qué queda montado. Los efectos NO corren en el render de servidor,
 * así que nada pega contra Monday.
 *
 * CUÁNDO se muestra la card no se mira acá: eso es `mostrarImpactoCtaCte`, que depende sólo de la
 * forma de pago y está cubierto en `deuda.test.ts` (Caso 6).
 *
 * Se corre con esbuild + node (`npm run test:impacto-cta-cte`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImpactoCtaCte } from '@/features/cobro/ImpactoCtaCte'
import type { ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'

const cliente = {
  id: '1',
  name: 'Cliente Test',
  condicionPago: 'CUENTA CORRIENTE',
  limit: 1000,
  codigo: 'CTA-042',
  ctaCteId: '99',
  saldoCtaCte: 400,
  lineaUtilizada: 400,
  remitosPendFacturar: 0,
  disponible: 600,
  activity: 'Activo',
  situation: 'Liberado con crédito',
} as Cliente

/** Venta de $250 sin nada cobrado: es el caso del cobro POSTERIOR, el único que deja deuda. */
const resumen = {
  totalACobrar: 250,
  totalCobrado: 0,
  descuentoTotal: 0,
  cancelado: 0,
} as ResumenCobro

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const impacto = renderToStaticMarkup(createElement(ImpactoCtaCte, { cliente, resumen }))

console.log('Caso 1 · Las 4 métricas del resumen de cuenta:')
ok('1. N° de cuenta', impacto.includes('N° de cuenta') && impacto.includes('CTA-042'))
ok('2. Saldo actual', impacto.includes('Saldo actual') && impacto.includes(money(400)))
ok('3. Deuda', impacto.includes('>Deuda<') && impacto.includes(money(250)))
// saldo 400 + deuda 250 = 650, dentro del límite de 1000.
ok('4. Saldo resultante', impacto.includes('SALDO RESULTANTE') && impacto.includes(money(650)))
ok('ya no se muestran límite ni monto cancelado', !impacto.includes('Monto cancelado'))

console.log('Caso 2 · La "Deuda" va en verde:')
ok('el rótulo lleva la clase verde', impacto.includes('cobro-cab-lbl cobro-cab-lbl--verde">Deuda<'))
ok('el valor lleva la clase verde', impacto.includes('cobro-imp-num cobro-imp-num--verde'))
ok('no quedó ninguna acción montada dentro de la card', !impacto.includes('cobro-card-acts'))

console.log(`\nOK · ${asserts} asserts pasaron.`)
