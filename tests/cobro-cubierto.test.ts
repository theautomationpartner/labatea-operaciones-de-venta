/**
 * Con el cobro CUBIERTO el formulario se cierra, y se dice por qué.
 *
 * Es la contracara del exceso: en vez de dejar cargar un movimiento de más y después reclamar que
 * se deshaga, se frena antes. Pero cerrar el formulario sin decir nada deja el paso gris y mudo
 * justo cuando el trabajo terminó bien, que se lee como una falla —de ahí que el aviso vaya en
 * VERDE y con tilde, y no en el rojo del resto de los bloqueos—.
 *
 * Se corre con esbuild + node (`npm run test:cobro-cubierto`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MSG_COBRO_CUBIERTO,
  SIN_DESCUENTOS_PAGO,
  balancePagos,
  cobroCubierto,
  resumenCobro,
} from '@/lib/cobros'
import type { MovimientoPago } from '@/types'

const VENTA = 98285.88
const mov = (formaPago: string, importe: number) => ({ formaPago, importe }) as MovimientoPago
const cubierto = (...ms: MovimientoPago[]) =>
  cobroCubierto(resumenCobro(balancePagos(ms, SIN_DESCUENTOS_PAGO), VENTA))

/* ---------- Cuándo se cierra ---------- */
assert.equal(cubierto(mov('Efectivo', VENTA)), true, 'cobrado justo: no hay nada más que cargar')
assert.equal(cubierto(mov('Efectivo', 50000)), false, 'falta cobrar: el formulario sigue abierto')
assert.equal(cubierto(mov('Cheque', 600000)), false, 'cobrado de más: hay que corregir, no cerrar')
/* El anticipo absorbe el excedente y con eso el cobro queda cubierto: es la salida que ofrece el
   aviso del exceso, así que tiene que terminar acá. */
assert.equal(
  cubierto(mov('Cheque', 600000), mov('Anticipo', 501714.12)),
  true,
  'el anticipo por el excedente cierra el cobro',
)
/* Con el paso recién abierto los dos totales valen cero. Ahí NO hay nada cubierto —hay un cobro sin
   empezar—, y cerrar el formulario dejaría la pantalla inservible antes de tocarla. */
assert.equal(cubierto(), false, 'sin movimientos el formulario nace abierto')

/* ---------- Lo que se dice ---------- */
assert.equal(
  MSG_COBRO_CUBIERTO,
  'El total recibido ya cubre el total a cancelar: para cargar otro movimiento, quitá o ajustá alguno de los registrados.',
)
/* Nombra la SALIDA y no sólo el bloqueo: la tabla queda editable, que es por dónde se vuelve a
   abrir el formulario. Sin eso el usuario se queda sin saber cómo seguir. */
assert.match(MSG_COBRO_CUBIERTO, /quitá o ajustá/, 'dice cómo volver a abrirlo')

/* ---------- Que la vista efectivamente lo use ---------- */
const vista = readFileSync('src/features/cobro/CobroView.tsx', 'utf8')
assert.match(
  vista,
  /bloqueado=\{bloqueado \|\| cubierto\}/,
  'el formulario se cierra con el cobro cubierto',
)
assert.ok(vista.includes('fa-circle-check'), 'el aviso lleva el tilde, no el signo de exclamación')
assert.ok(vista.includes('cobro-bloqueo-inline--ok'), 'y la clase que lo pinta verde')

/* Y que esa clase exista de verdad: el markup pidiendo una clase sin definir es cómo se pierde un
   color de estado sin que nada falle (ya pasó tres veces en este mismo paso). */
const css = readFileSync('src/styles/cobro.css', 'utf8')
assert.match(
  css,
  /\.cobro-bloqueo-inline--ok[^{]*\{[^}]*var\(--c-success\)/,
  'la clase del aviso cubierto tiene que pintar en verde',
)

console.log('OK · cobro cubierto: el formulario se cierra y el aviso lo explica en verde')
