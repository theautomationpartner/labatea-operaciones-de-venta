/**
 * La posición de cada vista en el stepper sale de su CLAVE de `Paso`, no de su etiqueta ni de un
 * índice escrito a mano.
 *
 * Buscar por texto —`pasos.indexOf('Emitir factura')`— ató la posición al rótulo que se muestra:
 * al renombrar la etapa a "Emitir y Enviar" el `indexOf` pasó a devolver −1, el `Math.max(…, 0)` lo
 * convirtió en 0 y la ÚLTIMA etapa se marcaba como la primera, con el título numerado "1".
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ETAPA,
  indiceDePaso,
  OPERACIONES,
  pasoInicialDe,
  pasoPrevioAEmision,
  pasosDe,
  pasosKeysDe,
  registraActividad,
} from '@/lib/pasos'
import type {
  Operacion,
  Paso,
  TipoEmisionRemito,
  TipoEntrega,
  TipoOperacionActividad,
  TipoVenta,
} from '@/types'

interface Caso {
  titulo: string
  op: Operacion
  tv: TipoVenta | null
  te: TipoEntrega | null
  em?: TipoEmisionRemito | null
  /** VENTA PROFORMA: tipo de venta de la proforma elegida. Decide si el recorrido suma la actividad. */
  tvp?: TipoVenta | null
  /** Posición esperada de cada vista del recorrido, 0-based. */
  esperado: Partial<Record<Paso, number>>
}

/*
 * "Registrar Actividad" ('venta-actividad') va SIEMPRE anteúltima, justo antes de emitir, y sólo
 * en las operaciones que originan la gestión: el presupuesto siempre, la venta cuando es DIRECTA
 * y la venta con proforma cuando esa proforma es DIRECTA. Con presupuesto previo NO aparece: la
 * actividad ya la registró ese presupuesto.
 */
const CASOS: Caso[] = [
  {
    titulo: 'PRESUPUESTAR',
    op: 'PRESUPUESTAR', tv: null, te: null,
    esperado: { cliente: 0, productos: 1, 'venta-actividad': 2, emision: 3 },
  },
  {
    titulo: 'VENTA DIRECTA · entrega SIMULTANEA',
    op: 'VENTA', tv: 'DIRECTA', te: 'SIMULTANEA',
    esperado: { cliente: 0, productos: 1, cobro: 2, 'venta-actividad': 3, factura: 4 },
  },
  {
    titulo: 'VENTA DIRECTA · entrega POSTERIOR',
    op: 'VENTA', tv: 'DIRECTA', te: 'POSTERIOR',
    esperado: { cliente: 0, productos: 1, cobro: 2, entrega: 3, 'venta-actividad': 4, factura: 5 },
  },
  {
    titulo: 'VENTA DIRECTA · entrega ANTERIOR',
    op: 'VENTA', tv: 'DIRECTA', te: 'ANTERIOR',
    esperado: { cliente: 0, remito: 1, cobro: 2, 'venta-actividad': 3, factura: 4 },
  },
  {
    titulo: 'VENTA CON PRESUPUESTO PREVIO',
    op: 'VENTA', tv: 'CON PRESUPUESTO PREVIO', te: 'SIMULTANEA',
    esperado: { cliente: 0, venta: 1, cobro: 2, factura: 3 },
  },
  {
    titulo: 'VENTA PROFORMA · proforma DIRECTA',
    op: 'VENTA PROFORMA', tv: null, te: null, tvp: 'DIRECTA',
    esperado: { cliente: 0, 'venta-proforma': 1, cobro: 2, 'venta-actividad': 3, factura: 4 },
  },
  {
    titulo: 'VENTA PROFORMA · proforma CON PRESUPUESTO PREVIO',
    op: 'VENTA PROFORMA', tv: null, te: null, tvp: 'CON PRESUPUESTO PREVIO',
    esperado: { cliente: 0, 'venta-proforma': 1, cobro: 2, factura: 3 },
  },
  {
    titulo: 'VENTA PROFORMA · todavía sin proforma elegida',
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
  const etiquetas = pasosDe(c.op, c.tv, c.te, c.em ?? null, c.tvp ?? null)
  const claves = pasosKeysDe(c.op, c.tv, c.te, c.em ?? null, c.tvp ?? null)
  assert.equal(etiquetas.length, claves.length, `${c.titulo}: etiquetas y claves desalineadas`)

  for (const [paso, posicion] of Object.entries(c.esperado) as [Paso, number][]) {
    assert.equal(
      indiceDePaso(paso, c.op, c.tv, c.te, c.em ?? null, c.tvp ?? null),
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
  /* Y cuando el recorrido registra actividad, esa etapa es la ANTEÚLTIMA: entre el trabajo de la
     operación y su emisión, nunca al final ni en el medio. */
  const registra = registraActividad(c.op, c.tv, c.tvp ?? null)
  assert.equal(
    claves.includes('venta-actividad'),
    registra,
    `${c.titulo}: la etapa de actividad no coincide con lo que decide registraActividad`,
  )
  if (registra) {
    assert.equal(
      claves[claves.length - 2],
      'venta-actividad',
      `${c.titulo}: "Registrar Actividad" no quedó anteúltima`,
    )
    assert.equal(
      etiquetas[etiquetas.length - 2],
      ETAPA.actividad,
      `${c.titulo}: la etiqueta anteúltima no es "${ETAPA.actividad}"`,
    )
  }

  const ultima = claves[claves.length - 1]
  assert.equal(
    indiceDePaso(ultima, c.op, c.tv, c.te, c.em ?? null, c.tvp ?? null),
    etiquetas.length - 1,
    `${c.titulo}: la vista de cierre no se ubica en la última posición`,
  )

  /* El "Volver" de la emisión aterriza en la ANTEÚLTIMA etapa, sea cual sea. Es el bug que hubo:
     la emisión del presupuesto volvía fija a "Seleccionar Productos" y se saltaba "Registrar
     Actividad", que en ese recorrido está justo en el medio. Se afirma para TODOS los recorridos
     que usan el helper, así el día que se sume o se saque una etapa el salto no reaparece.

     REMITO queda afuera: su emisión tiene sus propias claves ('remito-envio') y no pasa por acá. */
  if (c.op !== 'REMITO') {
    assert.equal(
      pasoPrevioAEmision(c.op, c.tv, c.te, c.tvp ?? null),
      claves[claves.length - 2],
      `${c.titulo}: el "Volver" de la emisión no cae en la etapa anterior`,
    )
  }
}

/* Y que las dos vistas de emisión lo USEN de verdad. Se afirma sobre el CÓDIGO FUENTE —como el
   test del inicio— porque el bug fue exactamente ese: un `paso: 'productos'` fijo, que es un
   `Paso` válido y ningún typecheck mira. */
for (const vista of [
  'src/features/emision/EmisionView.tsx',
  'src/features/factura/FacturaView.tsx',
]) {
  const fuente = readFileSync(vista, 'utf8')
  assert.ok(
    fuente.includes('pasoPrevioAEmision('),
    `${vista}: el "Volver" tiene que navegar con \`pasoPrevioAEmision\``,
  )
}

/* Una clave que no pertenece al recorrido cae en 0: es el comportamiento de resguardo, y es
   exactamente el que enmascaraba el bug cuando la búsqueda era por texto. */
assert.equal(indiceDePaso('entrega', 'PRESUPUESTAR', null, null), 0, 'el resguardo cambió')

/* ==========================================================================================
   REGISTRO DE ACTIVIDADES: primero la Persona, después qué se hace con ella.
   ==========================================================================================
   El recorrido está invertido respecto de cómo nació: la etapa 2 DEPENDE de la 1 —la lista de
   pendientes se arma con las Personas y contactos elegidos ahí—, así que la operación abre
   eligiendo cliente como todas las demás. */
const clavesAct = pasosKeysDe('REGISTRO DE ACTIVIDADES', null, null)
assert.deepEqual(
  [...clavesAct],
  ['actividad-persona', 'actividad'],
  'la Persona va PRIMERO y la actividad después',
)
assert.equal(indiceDePaso('actividad-persona', 'REGISTRO DE ACTIVIDADES', null, null), 0)
assert.equal(indiceDePaso('actividad', 'REGISTRO DE ACTIVIDADES', null, null), 1)

/* La segunda etapa se llama por lo que se elija hacer en ella, pero las CLAVES no cambian: el
   stepper navega igual con cualquiera de los tres rótulos. */
const rotulos = (tipo: TipoOperacionActividad | null) => [
  ...pasosDe('REGISTRO DE ACTIVIDADES', null, null, null, null, tipo),
]
assert.deepEqual(rotulos(null), [ETAPA.persona, ETAPA.actividad], 'sin elegir, el rótulo genérico')
assert.deepEqual(rotulos('REGISTRAR NUEVA ACTIVIDAD'), [ETAPA.persona, ETAPA.actividadNueva])
assert.deepEqual(rotulos('COMPLETAR ACTIVIDAD PENDIENTE'), [ETAPA.persona, ETAPA.actividadCompletar])
for (const tipo of [null, 'REGISTRAR NUEVA ACTIVIDAD', 'COMPLETAR ACTIVIDAD PENDIENTE'] as const) {
  assert.equal(
    rotulos(tipo).length,
    clavesAct.length,
    `el rótulo "${tipo}" desalinea etiquetas y claves`,
  )
}

/* ==========================================================================================
   El PUNTO DE ENTRADA: a qué etapa lleva el "Confirmar" del inicio.
   ==========================================================================================
   No todas las operaciones abren eligiendo cliente: REGISTRO DE ACTIVIDADES arranca registrando
   la actividad. Con un `paso` que no pertenece al recorrido, la app dibuja la vista equivocada
   —el cuerpo de "Seleccionar cliente"— debajo de un stepper que sí muestra las etapas correctas:
   `indiceDePaso` no encuentra la clave, cae en su resguardo (0) y marca la primera igual. Es un
   desajuste que no rompe nada visible en el encabezado, así que se afirma acá. */
for (const op of OPERACIONES) {
  const claves = pasosKeysDe(op, 'DIRECTA', 'SIMULTANEA', 'POSTERIOR', 'DIRECTA')
  assert.equal(
    pasoInicialDe(op),
    claves[0],
    `${op}: la etapa inicial tiene que ser la PRIMERA de su recorrido`,
  )
}

/* Y que el inicio lo use de verdad. Se afirma sobre el CÓDIGO FUENTE —como el test del botón de
   volver— porque el bug real fue ese: `InicioView` mandaba a 'cliente' fijo, sin preguntar por la
   operación, y ningún typecheck lo ve (es un `Paso` válido). */
const inicio = readFileSync('src/features/inicio/InicioView.tsx', 'utf8')
assert.ok(
  inicio.includes('pasoInicialDe(operacion)'),
  'el "Confirmar" del inicio tiene que navegar con `pasoInicialDe(operacion)`',
)
assert.ok(
  !/paso:\s*'cliente'/.test(inicio),
  'y no con un paso fijo: con REGISTRO DE ACTIVIDADES eso dibuja la vista del cliente',
)

console.log(`OK · ${CASOS.length} recorridos: cada vista se ubica por su clave de paso`)
console.log('OK · cada operación entra por la primera etapa de SU recorrido')
