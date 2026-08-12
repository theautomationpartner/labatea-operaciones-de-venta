/**
 * La posición de cada vista en el stepper sale de su CLAVE de `Paso`, no de su etiqueta ni de un
 * índice escrito a mano.
 *
 * Buscar por texto —`pasos.indexOf('Emitir factura')`— ató la posición al rótulo que se muestra:
 * al renombrar la etapa a "Emitir y Enviar" el `indexOf` pasó a devolver −1, el `Math.max(…, 0)` lo
 * convirtió en 0 y la ÚLTIMA etapa se marcaba como la primera, con el título numerado "1".
 */
import assert from 'node:assert/strict'
import { ETAPA, indiceDePaso, pasosDe, pasosKeysDe } from '@/lib/pasos'
import type { Operacion, Paso, TipoEmisionRemito, TipoEntrega, TipoVenta } from '@/types'

interface Caso {
  titulo: string
  op: Operacion
  tv: TipoVenta | null
  te: TipoEntrega | null
  em?: TipoEmisionRemito | null
  /** Posición esperada de cada vista del recorrido, 0-based. */
  esperado: Partial<Record<Paso, number>>
}

const CASOS: Caso[] = [
  {
    titulo: 'PRESUPUESTAR',
    op: 'PRESUPUESTAR', tv: null, te: null,
    esperado: { cliente: 0, productos: 1, emision: 2 },
  },
  {
    titulo: 'VENTA · entrega SIMULTANEA',
    op: 'VENTA', tv: 'DIRECTA', te: 'SIMULTANEA',
    esperado: { cliente: 0, productos: 1, cobro: 2, factura: 3 },
  },
  {
    titulo: 'VENTA · entrega POSTERIOR',
    op: 'VENTA', tv: 'DIRECTA', te: 'POSTERIOR',
    esperado: { cliente: 0, productos: 1, cobro: 2, entrega: 3, factura: 4 },
  },
  {
    titulo: 'VENTA · entrega ANTERIOR',
    op: 'VENTA', tv: 'DIRECTA', te: 'ANTERIOR',
    esperado: { cliente: 0, remito: 1, cobro: 2, factura: 3 },
  },
  {
    titulo: 'VENTA CON PRESUPUESTO PREVIO',
    op: 'VENTA', tv: 'CON PRESUPUESTO PREVIO', te: 'SIMULTANEA',
    esperado: { cliente: 0, venta: 1, cobro: 2, factura: 3 },
  },
  {
    titulo: 'VENTA PROFORMA',
    op: 'VENTA PROFORMA', tv: null, te: null,
    esperado: { cliente: 0, 'venta-proforma': 1, cobro: 2, factura: 3 },
  },
  {
    titulo: 'REMITO',
    op: 'REMITO', tv: null, te: null, em: 'POSTERIOR',
    esperado: { cliente: 0, 'remito-productos': 1, 'remito-envio': 2, 'remito-emision': 3 },
  },
]

for (const c of CASOS) {
  const etiquetas = pasosDe(c.op, c.tv, c.te, c.em ?? null)
  const claves = pasosKeysDe(c.op, c.tv, c.te, c.em ?? null)
  assert.equal(etiquetas.length, claves.length, `${c.titulo}: etiquetas y claves desalineadas`)

  for (const [paso, posicion] of Object.entries(c.esperado) as [Paso, number][]) {
    assert.equal(
      indiceDePaso(paso, c.op, c.tv, c.te, c.em ?? null),
      posicion,
      `${c.titulo}: "${paso}" no cae en la posición ${posicion}`,
    )
  }

  /* "Emitir y Enviar" es SIEMPRE la última etapa, en toda operación. Es lo que estaba roto: se
     marcaba como la primera. */
  assert.equal(
    etiquetas[etiquetas.length - 1],
    ETAPA.emitir,
    `${c.titulo}: la última etapa no es "${ETAPA.emitir}"`,
  )
  const ultima = claves[claves.length - 1]
  assert.equal(
    indiceDePaso(ultima, c.op, c.tv, c.te, c.em ?? null),
    etiquetas.length - 1,
    `${c.titulo}: la vista de cierre no se ubica en la última posición`,
  )
}

/* Una clave que no pertenece al recorrido cae en 0: es el comportamiento de resguardo, y es
   exactamente el que enmascaraba el bug cuando la búsqueda era por texto. */
assert.equal(indiceDePaso('entrega', 'PRESUPUESTAR', null, null), 0, 'el resguardo cambió')

console.log(`OK · ${CASOS.length} recorridos: cada vista se ubica por su clave de paso`)
