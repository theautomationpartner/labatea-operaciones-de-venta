/**
 * La etapa "Registrar Actividad" del PRESUPUESTO y de la VENTA DIRECTA abre con una PREGUNTA
 * —"¿Querés asociar actividades…?"— contestada que NO.
 *
 * Son tres reglas que se sostienen entre sí, y romper una sola deja la etapa mintiendo:
 *   1. NO es el valor inicial, y con NO no se le pregunta NADA a Monday. La consulta salía al
 *      entrar a la etapa, para todos: el que no pensaba asociar ninguna gestión pagaba igual una
 *      lectura del tablero de actividades.
 *   2. Contestar que NO se lleva puesto lo que estuviera tildado. Si no, el documento saldría
 *      imputado a una gestión que el usuario ya dijo no querer asociar: la tabla está escondida y
 *      nadie vería el error hasta verlo en el board.
 *   3. Con SÍ, tildar al menos una es OBLIGATORIO. Es la mitad que no puede quedar en el aire: sin
 *      la ventana que frena, "asociar" y "no asociar" terminarían en el mismo documento sin
 *      actividades, y la pregunta no habría servido para nada.
 *
 * Se corre con esbuild + node (`npm run test:asociar-actividades`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TablaActividades } from '@/features/actividad/TablaActividades'
import { VentaActividadView } from '@/features/actividad/VentaActividadView'
import { initialState, reducer, type AppState } from '@/state/appState'
import { DispatchContext, StateContext } from '@/state/context'
import type { ActividadListada, Cliente, Vendedor } from '@/types'

const act = (id: string): ActividadListada => ({
  id,
  nombre: `Visita ${id}`,
  tipo: 'Visita',
  contactos: [],
  fecha: '15/09/2026',
  estado: 'Completado',
  resolucion: '',
})

/* ---------- 1) La pregunta arranca en NO ---------- */
assert.equal(
  initialState.asociarActividades,
  false,
  'la etapa tiene que abrir con la pregunta en NO: asociar una gestión es opcional',
)

/* ---------- 2) Contestar que NO borra lo tildado ---------- */
const conDos: AppState = {
  ...initialState,
  asociarActividades: true,
  actividadesDocumento: [act('1'), act('2')],
}
const enNo = reducer(conDos, { type: 'setAsociarActividades', value: false })
assert.equal(enNo.asociarActividades, false)
assert.deepEqual(
  enNo.actividadesDocumento,
  [],
  'contestar que NO tiene que soltar las actividades tildadas: escondidas, se emitirían igual',
)

/* Volver a SÍ no las trae de vuelta: la respuesta anterior ya las descartó. */
const devuelta = reducer(enNo, { type: 'setAsociarActividades', value: true })
assert.equal(devuelta.asociarActividades, true)
assert.deepEqual(devuelta.actividadesDocumento, [], 'volver a SÍ arranca sin nada tildado')

/* Contestar lo MISMO no toca nada: el estado se devuelve tal cual (sin re-render de la etapa). */
assert.equal(
  reducer(devuelta, { type: 'setAsociarActividades', value: true }),
  devuelta,
  'contestar lo mismo no puede generar un estado nuevo',
)

/* Y con SÍ lo tildado se conserva: sólo el NO limpia. */
const sigueTildada = reducer(
  { ...initialState, asociarActividades: false, actividadesDocumento: [act('9')] },
  { type: 'setAsociarActividades', value: true },
)
assert.deepEqual(
  sigueTildada.actividadesDocumento.map((a) => a.id),
  ['9'],
  'pasar a SÍ no puede borrar nada',
)

/* ---------- 3) Otro cliente reabre la pregunta en NO ----------
   La respuesta era sobre el documento del cliente anterior, y las actividades que se listan son
   las que ese documento iba a llevar. */
const cliente = { id: 'c-2', name: 'Otro cliente' } as Cliente
const conOtro = reducer(
  { ...initialState, asociarActividades: true, actividadesDocumento: [act('1')] },
  { type: 'setCliente', cliente },
)
assert.equal(conOtro.asociarActividades, false, 'cambiar de cliente vuelve a dejar la pregunta en NO')
assert.deepEqual(conOtro.actividadesDocumento, [], 'y sin actividades del cliente anterior')

/* ---------- 4) La vista: sin SÍ no hay consulta, y con SÍ no se pasa sin tildar ---------- */
const vista = readFileSync('src/features/actividad/VentaActividadView.tsx', 'utf8')

/* La consulta al tablero está detrás de la respuesta: el efecto corta antes de pedir nada. */
const efecto = vista.slice(vista.indexOf('useEffect('), vista.indexOf('}, [asociarActividades'))
const corte = 'if (!asociarActividades || !cliente) return'
assert.ok(
  efecto.includes(corte),
  'con la pregunta en NO no se le puede pegar a Monday: el efecto tiene que cortar antes',
)
assert.ok(
  efecto.indexOf(corte) < efecto.indexOf('getActividadesSinAsignar('),
  'el corte va ANTES de la consulta, no después',
)
/* La consulta es POR CLIENTE: sin cliente no hay a quién pedirle las actividades, y la etapa las
   pediría todas. */
assert.ok(
  efecto.includes('getActividadesSinAsignar(clienteId)'),
  'se piden las actividades del cliente de la operación, no las del tablero entero',
)
assert.ok(
  vista.includes('}, [asociarActividades, cliente, dispatch])'),
  'y el efecto tiene que volver a correr cuando se conteste que sí, o cuando cambie el cliente',
)

/* El botón frena cuando se contestó que sí y no se tildó ninguna. */
assert.ok(
  vista.includes('if (asociarActividades && actividadesDocumento.length === 0)'),
  'con SÍ y sin ninguna tildada, "Continuar" tiene que frenar',
)
assert.ok(vista.includes('<AvisoModal'), 'y explicarlo en la ventana estándar de datos que faltan')

/* La pregunta reemplaza al viejo rótulo "Actividades sin asociar", y nombra el documento de cada
   operación: decir "al presupuesto" en una venta sería preguntar por otra cosa. */
assert.ok(
  vista.includes('`¿Querés asociar actividades ${documento}?`'),
  'el título de la caja es la pregunta, no un rótulo',
)
for (const [operacion, doc] of [
  ['PRESUPUESTAR', 'al presupuesto'],
  ['VENTA', 'a la venta'],
] as const) {
  assert.ok(
    new RegExp(`${operacion}: '${doc}'`).test(vista),
    `la pregunta de ${operacion} tiene que decir "${doc}"`,
  )
}

/* ---------- 5) La etapa dibujada: plegada con NO, con la tabla y el reclamo con SÍ ---------- */
const vendedor: Vendedor = {
  id: '1',
  ini: 'LP',
  name: 'Lucía Pérez',
  color: '#0052cc',
  equiposIds: [],
  esAdminDeCuenta: false,
}
const render = (state: AppState) =>
  renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      { value: state },
      createElement(
        DispatchContext.Provider,
        { value: () => {} },
        createElement(VentaActividadView),
      ),
    ),
  )
const base: AppState = { ...initialState, operacion: 'PRESUPUESTAR', vendedor }

const enNoHtml = render(base)
assert.ok(
  enNoHtml.includes('¿Querés asociar actividades al presupuesto?'),
  'la caja se encabeza con la pregunta, no con "Actividades sin asociar"',
)
assert.ok(
  !enNoHtml.includes('Actividades sin asociar'),
  'el rótulo viejo no puede sobrevivir en ningún lado de la etapa',
)
/* Plegada: ni la tabla ni el reclamo. Lo único que se ve además de la pregunta es el SÍ/NO. */
assert.ok(!enNoHtml.includes('act-tabla-scroll'), 'con NO la tabla no se dibuja')
assert.ok(!enNoHtml.includes('Tildá al menos una actividad'), 'con NO no se le reclama nada al usuario')
assert.ok(enNoHtml.includes('act-tabla-caja--plegada'), 'la caja tiene que quedar plegada')
assert.ok(enNoHtml.includes('act-asoc-toggle'), 'falta el SÍ/NO')

/* El orden de la cabecera: pregunta · SÍ/NO · reclamo. El control va PEGADO a la pregunta —es lo
   que se contesta— y lo que falta se lee después, detrás del NO. */
const orden = (html: string, ...trozos: string[]) =>
  trozos.every((t, i) => i === 0 || html.indexOf(trozos[i - 1]) < html.indexOf(t))
assert.ok(
  orden(enNoHtml, 'act-tabla-title', 'act-asoc-toggle'),
  'el SÍ/NO va después del título',
)

const enSiHtml = render({ ...base, asociarActividades: true })
assert.ok(enSiHtml.includes('act-tabla-scroll'), 'con SÍ se despliega la tabla')
assert.ok(
  enSiHtml.includes('Tildá al menos una actividad'),
  'con SÍ, tildar una es obligatorio y la cabecera lo tiene que reclamar',
)
assert.ok(
  !enSiHtml.includes('podés continuar sin tildar ninguna'),
  'desplegada, la tabla no puede seguir diciendo que es opcional',
)
assert.ok(
  orden(enSiHtml, 'act-tabla-title', 'act-asoc-toggle', 'act-tabla-req'),
  'el reclamo en rojo va a la DERECHA del NO, no entre la pregunta y el control',
)

/* Desplegar y plegar se animan, y la caja sobrevive al "no" hasta que la animación termina: la
   tabla se va deslizándose en vez de desaparecer en el mismo cuadro en que se contesta. */
assert.ok(enSiHtml.includes('act-plegable'), 'el cuerpo de la tabla tiene que entrar animado')
const css = readFileSync('src/styles/actividad.css', 'utf8')
for (const regla of [
  '.actividad-v2 .act-plegable {',
  '.actividad-v2 .act-plegable--saliendo {',
  '@keyframes act-desplegar {',
  '@keyframes act-plegar {',
]) {
  assert.ok(css.includes(regla), `falta ${regla} en actividad.css`)
}
const fuenteTabla = readFileSync('src/features/actividad/TablaActividades.tsx', 'utf8')
assert.ok(
  fuenteTabla.includes('<Plegable saliendo={colapsada} onFin={() => setMontado(false)}>'),
  'el cuerpo se pliega con el Plegable compartido, no desmontándose de golpe',
)

/* La VENTA pregunta por la venta, con las mismas dos mitades. */
assert.ok(
  render({ ...base, operacion: 'VENTA', tipoVenta: 'DIRECTA' }).includes(
    '¿Querés asociar actividades a la venta?',
  ),
  'en la VENTA la pregunta nombra a la venta',
)

/* ---------- 6) La tabla se pagina de a 10 ---------- */
const muchas = Array.from({ length: 23 }, (_, i) => act(String(i + 1)))
const conMuchas = renderToStaticMarkup(
  createElement(TablaActividades, {
    titulo: '¿Querés asociar actividades al presupuesto?',
    actividades: muchas,
    elegidas: [],
    cargando: false,
    onToggle: () => {},
  }),
)
/* La altura de la caja es el motivo: con 23 gestiones sin cortar, el pie de la etapa —el que lleva
   "Continuar"— se va abajo de todo y la decisión que la etapa viene a pedir sale de la pantalla. */
const huecas = (html: string) => (html.match(/act-tabla-fila--hueca/g) ?? []).length
const filas = (html: string) =>
  (html.match(/class="act-tabla-fila/g) ?? []).length - huecas(html)
assert.equal(filas(conMuchas), 10, 'la primera página tiene que mostrar 10 filas, no las 23')
assert.ok(conMuchas.includes('Página 1 de 3'), 'el pie tiene que decir en qué página se está')
assert.ok(conMuchas.includes('23 actividades'), 'y cuántas hay en total, no cuántas se ven')
/* Cada una está en UNA sola página: la 11 no puede aparecer en la primera. */
assert.ok(conMuchas.includes('Visita 10'), 'la décima entra en la primera página')
assert.ok(!/Visita 11</.test(conMuchas), 'la undécima ya no')

/* Con 10 o menos no hay pie: un paginador de una sola página es un renglón que no decide nada. */
const conDiez = renderToStaticMarkup(
  createElement(TablaActividades, {
    titulo: '¿Querés asociar actividades al presupuesto?',
    actividades: muchas.slice(0, 10),
    elegidas: [],
    cargando: false,
    onToggle: () => {},
  }),
)
assert.equal(filas(conDiez), 10, 'diez entran enteras')
assert.ok(!conDiez.includes('act-tabla-pager'), 'y sin segunda página no se dibuja el pie')

/* Mientras se consulta tampoco: no hay ninguna fila que paginar. */
const buscando = renderToStaticMarkup(
  createElement(TablaActividades, {
    titulo: '¿Querés asociar actividades al presupuesto?',
    actividades: muchas,
    elegidas: [],
    cargando: true,
    onToggle: () => {},
  }),
)
assert.ok(!buscando.includes('act-tabla-pager'), 'buscando no se pagina nada')

/* ---------- 7) El alto de la tabla no depende de cuántas caigan en la página ----------
   Una página llena no necesita relleno; la última, con menos de diez, se completa con filas huecas.
   Sin eso, pasar de una página llena a una de tres renglones encogía la caja de golpe: el pie de la
   etapa saltaba hacia arriba y el botón "Siguiente" se iba de abajo del cursor. */
assert.equal(huecas(conMuchas), 0, 'una página llena no lleva relleno')
assert.equal(huecas(conDiez), 0, 'sin paginador tampoco: no hay entre qué páginas saltar')
assert.ok(
  fuenteTabla.includes('Array.from({ length: POR_PAGINA - visibles.length }'),
  'la última página se completa hasta POR_PAGINA con filas huecas',
)
/* Y sólo cuando hay paginador: con una sola página no hay salto que evitar, y reservarle diez
   renglones a un tablero con tres gestiones dejaría la etapa casi vacía. */
assert.ok(
  fuenteTabla.includes('paginas > 1 &&\n                Array.from({ length: POR_PAGINA - visibles.length }'),
  'el relleno tiene que estar atado a que haya más de una página',
)
/* El hueco tiene que OCUPAR el lugar de la fila que falta: escondido, no quitado. */
const cssTabla = readFileSync('src/styles/actividad.css', 'utf8')
const reglaHueca = cssTabla.slice(
  cssTabla.indexOf('.actividad-v2 .act-tabla-fila--hueca {'),
  cssTabla.indexOf('}', cssTabla.indexOf('.actividad-v2 .act-tabla-fila--hueca {')),
)
assert.ok(reglaHueca.includes('visibility: hidden'), 'la fila hueca se esconde con visibility')
assert.ok(
  !reglaHueca.includes('display: none'),
  'con display:none dejaría de ocupar lugar, que es justo para lo que está',
)
/* Y el alto sale de los MISMOS elementos que el de una fila real —el nombre y la pastilla—, no de
   un alto fijo en píxeles que haya que recordar cambiar cuando cambie el de la fila. */
assert.ok(
  fuenteTabla.includes('<span className="act-tabla-nom">&nbsp;</span>') &&
    fuenteTabla.includes('<span className="act-badge act-badge--gris">&nbsp;</span>'),
  'la fila hueca reserva el alto con los mismos elementos que lo definen en una fila con datos',
)

/* Lo tildado NO es por página: viaja por id, así que el contador de la cabecera cuenta sobre el
   TOTAL aunque lo elegido esté en otra página. Sin esto, pasar de página se leería como perder la
   selección. */
const conElegidaDeOtraPagina = renderToStaticMarkup(
  createElement(TablaActividades, {
    titulo: '¿Querés asociar actividades al presupuesto?',
    actividades: muchas,
    elegidas: ['15'],
    cargando: false,
    onToggle: () => {},
  }),
)
assert.ok(
  conElegidaDeOtraPagina.includes('1 de 23 seleccionada'),
  'el contador cuenta sobre el total, no sobre la página que se está viendo',
)

/* La página se acota en el RENDER: la lista se encoge sola —las pendientes se recalculan al cambiar
   de cliente— y un número viejo dejaría la tabla vacía con filas que sí están. */
assert.ok(
  fuenteTabla.includes('const actual = Math.min(pagina, paginas - 1)'),
  'la página tiene que acotarse contra las que hay, en cada render',
)
/* Y el reset mira el CONTENIDO, no el array: `pendientesDeLaGente` se recalcula en cada render de
   ActividadView, y atado a la referencia el paginador volvía a la página 1 al tildar una fila. */
assert.ok(
  fuenteTabla.includes("const clave = actividades.map((a) => a.id).join(',')") &&
    fuenteTabla.includes('}, [clave])'),
  'volver a la primera página tiene que depender de QUÉ actividades hay, no de la identidad del array',
)
assert.ok(
  !fuenteTabla.includes('}, [actividades])'),
  'atado al array, el paginador se resetearía solo en cada render',
)

console.log(
  'OK · asociar actividades: la pregunta abre en NO y sin consulta al tablero, el NO suelta lo tildado y el SÍ despliega la tabla y exige al menos una',
)
console.log('OK · la tabla de actividades se pagina de a 10 y no crece con lo que traiga el tablero')
