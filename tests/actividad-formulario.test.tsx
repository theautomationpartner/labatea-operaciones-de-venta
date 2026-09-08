/**
 * REGISTRO DE ACTIVIDADES · el formulario CRECE con las respuestas, y lo que se pliega NO se borra.
 *
 * Plegar esconde campos; no tira lo que el usuario escribió. Lo que impide que un dato escondido
 * viaje a Monday es la condición con la que se crea la actividad futura —actividad completada Y
 * interruptor encendido, o sea exactamente lo que se ve en pantalla—, no vaciar el formulario a
 * espaldas de quien lo llenó.
 *
 * No hay runner de DOM en el proyecto, así que se renderiza con `react-dom/server`, que ya es
 * dependencia. Los efectos NO corren en el render de servidor, así que nada pega contra Monday.
 *
 * Se corre con esbuild + node (`npm run test:actividad-formulario`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActividadView } from '@/features/actividad/ActividadView'
import { TablaActividades } from '@/features/actividad/TablaActividades'
import { ActividadPersonaView } from '@/features/actividad/ActividadPersonaView'
import { SelectorTipoOperacion } from '@/features/actividad/SelectorTipoOperacion'
import { TablaContactos } from '@/features/actividad/TablaContactos'
import { TablaContactosElegidos } from '@/features/actividad/TablaContactosElegidos'
import { hayProyectada } from '@/lib/actividad'
import { initialState, reducer, type AppState } from '@/state/appState'
import { DispatchContext, StateContext } from '@/state/context'
import type { Cliente, Contacto, Vendedor } from '@/types'

const vendedor = { id: '9', ini: 'LT', name: 'Luciano', color: '#000' } as Vendedor

/** La operación parada en la etapa 2, antes de contestar qué se viene a hacer con esa gente. */
const enEtapa2 = (): AppState =>
  reducer(
    { ...initialState, vendedor, operacion: 'REGISTRO DE ACTIVIDADES' },
    { type: 'goto', paso: 'actividad' },
  )

/** Y con "REGISTRAR NUEVA ACTIVIDAD" elegido, que es lo que despliega el formulario. */
const enCurso = (): AppState =>
  reducer(enEtapa2(), {
    type: 'setTipoOperacionActividad',
    value: 'REGISTRAR NUEVA ACTIVIDAD',
  })

const render = (state: AppState) =>
  renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      { value: state },
      createElement(DispatchContext.Provider, { value: () => {} }, createElement(ActividadView)),
    ),
  )

/* ---------- El "Tipo de Operación" ----------
   Se contesta en la etapa 1, junto con la Persona y sus contactos: a quién y para qué son la misma
   decisión. Nada viene preseleccionado, como el tipo de venta. */
const selector = renderToStaticMarkup(
  createElement(
    StateContext.Provider,
    { value: enEtapa2() },
    createElement(
      DispatchContext.Provider,
      { value: () => {} },
      createElement(SelectorTipoOperacion),
    ),
  ),
)
assert.ok(selector.includes('Tipo de Operación'), 'falta el selector de tipo de operación')
assert.ok(selector.includes('REGISTRAR NUEVA ACTIVIDAD'), 'falta la opción de la nueva')
assert.ok(selector.includes('COMPLETAR ACTIVIDAD PENDIENTE'), 'falta la de completar')
assert.ok(selector.includes('cfgbox'), 'y va en la misma caja que el tipo de venta')

/* La etapa 2 sólo EJECUTA lo contestado: sin respuesta no despliega ninguna de las dos ramas, y
   el selector ya no vive ahí. */
const sinElegirQueHacer = enEtapa2()
const htmlSinElegir = render(sinElegirQueHacer)
assert.ok(!htmlSinElegir.includes('Tipo de Operación'), 'el selector se movió a la etapa 1')
assert.ok(!htmlSinElegir.includes('act-tipo'), 'sin elegir no se despliega el formulario')
assert.ok(!htmlSinElegir.includes('act-tabla'), 'ni la lista de pendientes')

/* La etapa se llama por lo que se eligió hacer en ella. */
const completando = reducer(sinElegirQueHacer, {
  type: 'setTipoOperacionActividad',
  value: 'COMPLETAR ACTIVIDAD PENDIENTE',
})
const htmlCompletando = render(completando)
assert.ok(htmlCompletando.includes('Completar Actividad Pendiente'), 'la etapa no se renombró')
assert.ok(htmlCompletando.includes('Actividades pendientes'), 'falta la lista de pendientes')
assert.ok(!htmlCompletando.includes('act-tipo'), 'y el formulario no se despliega en esta rama')
/* Tildar al menos una es OBLIGATORIO: acá la tabla reclama, no aclara que sea opcional. */
assert.ok(
  htmlCompletando.includes('Tildá al menos una actividad para pasarla a Completado'),
  'la tabla tiene que reclamar la selección',
)
assert.ok(!htmlCompletando.includes('Opcional: podés continuar'), 'y no ofrecerla como opcional')

/* Volver a la actividad nueva SUELTA lo tildado: son ramas excluyentes, y lo que no se ve no se
   escribe en el tablero. */
const conPendiente = reducer(completando, {
  type: 'togglePendienteActividad',
  actividad: { id: '77', nombre: 'Llamar a Ana', fecha: '', estado: 'Pendiente', resolucion: '' },
})
assert.equal(conPendiente.actividad.pendientes.length, 1, 'la pendiente tildada no se guardó')
const vueltaANueva = reducer(conPendiente, {
  type: 'setTipoOperacionActividad',
  value: 'REGISTRAR NUEVA ACTIVIDAD',
})
assert.deepEqual(vueltaANueva.actividad.pendientes, [], 'al cambiar de rama se sueltan')
assert.ok(render(vueltaANueva).includes('Registrar Nueva Actividad'), 'y la etapa se renombra')

/* ---------- El formulario base: los tres campos, en orden, desde el arranque ----------
   Tipo, fecha y resolución son de la actividad, no del estado: se ven siempre. Lo único que
   depende de la respuesta es el interruptor de la próxima gestión. */
const base = enCurso()
const htmlBase = render(base)
assert.ok(htmlBase.includes('act-tipo'), 'falta el tipo de actividad')
assert.ok(htmlBase.includes('act-fecha'), 'falta la fecha de actividad')
assert.ok(htmlBase.includes('act-hora'), 'y su hora: el widget ubica la gestión en el día')
assert.ok(htmlBase.includes('act-resol'), 'la resolución se muestra desde el arranque')
assert.ok(
  htmlBase.indexOf('act-tipo') < htmlBase.indexOf('act-fecha') &&
    htmlBase.indexOf('act-fecha') < htmlBase.indexOf('act-resol'),
  'y en ese orden: tipo, fecha, resolución',
)
assert.ok(htmlBase.includes('¿Es una actividad pendiente o completada?'), 'falta la pregunta')
assert.ok(htmlBase.includes('act-estado-op--pendiente'), 'falta la opción Pendiente')
assert.ok(htmlBase.includes('act-estado-op--completada'), 'falta la opción Completada')
assert.ok(!htmlBase.includes('act-sw-nom'), 'sin estado elegido no está el interruptor de la futura')

/* ---------- PENDIENTE: la resolución sigue estando, el interruptor no ---------- */
const pendiente = reducer(base, { type: 'setActividad', patch: { estado: 'Pendiente' } })
const htmlPendiente = render(pendiente)
assert.ok(htmlPendiente.includes('act-resol'), 'la resolución no depende del estado')
assert.ok(!htmlPendiente.includes('act-sw-nom'), 'la pendiente no agenda una próxima')

/* ---------- COMPLETADA: aparece el interruptor, con la pregunta formal ---------- */
const completada = reducer(base, { type: 'setActividad', patch: { estado: 'Completada' } })
const htmlCompletada = render(completada)
assert.ok(
  htmlCompletada.includes('¿Desea cargar futura actividad?'),
  'falta el interruptor de la futura, con su pregunta',
)
assert.ok(
  !htmlCompletada.includes('Actividad proyectada'),
  'el interruptor arranca apagado: la proyectada no se despliega sola',
)

/* ---------- Interruptor encendido: se despliega la proyectada, con SUS campos ----------
   Son sólo dos: tipo y fecha. Ni descripción —el nombre del ítem se arma solo, ver `nombreDe`—
   ni fecha de notificación, que se sacó del formulario. */
const conFutura = reducer(completada, { type: 'setActividad', patch: { cargarFutura: true } })
const htmlFutura = render(conFutura)
assert.ok(htmlFutura.includes('Actividad proyectada'), 'falta el bloque de la actividad proyectada')
assert.ok(htmlFutura.includes('actp-tipo'), 'falta el tipo de la proyectada')
assert.ok(htmlFutura.includes('actp-fecha'), 'y su fecha')
assert.ok(htmlFutura.includes('actp-hora'), 'y su hora')
assert.ok(htmlFutura.includes('actp-resol'), 'y su resolución: son los MISMOS campos')
assert.ok(!htmlFutura.includes('Fecha de Notificación'), 'la fecha de notificación ya no se pide')
assert.ok(!htmlFutura.includes('actp-desc'), 'ni la descripción: el nombre del ítem se arma solo')
assert.ok(!htmlFutura.includes('act-desc'), 'tampoco la de la actividad principal')

/* ---------- El formulario NO borra nada de lo que se cargó ----------
   Plegar un bloque esconde campos; no los vacía. Lo que el usuario escribió es suyo, y contestar
   otra cosa más arriba no puede hacérselo perder. */
const cargada = reducer(
  reducer(conFutura, { type: 'setActividad', patch: { resolucion: 'Se cerró el pedido' } }),
  { type: 'setActividadProyectada', patch: { tipo: 'Llamada telefónica' } },
)
assert.equal(cargada.actividad.resolucion, 'Se cerró el pedido')
assert.equal(cargada.actividad.proyectada.tipo, 'Llamada telefónica')

const sinFutura = reducer(cargada, { type: 'setActividad', patch: { cargarFutura: false } })
assert.equal(sinFutura.actividad.resolucion, 'Se cerró el pedido', 'la resolución sigue')
assert.equal(
  sinFutura.actividad.proyectada.tipo,
  'Llamada telefónica',
  'y la proyectada también: apagar el interruptor la esconde, no la tira',
)

const vueltaAPendiente = reducer(cargada, { type: 'setActividad', patch: { estado: 'Pendiente' } })
assert.equal(
  vueltaAPendiente.actividad.resolucion,
  'Se cerró el pedido',
  'contestar "Pendiente" NO borra la resolución: se sigue viendo, y es del usuario',
)
assert.equal(vueltaAPendiente.actividad.proyectada.tipo, 'Llamada telefónica', 'ni la proyectada')

/* Lo que impide que un dato escondido viaje a Monday no es borrarlo, sino la condición con la que
   se crea la actividad futura: hace falta la actividad COMPLETADA y el interruptor encendido. */
assert.equal(hayProyectada(vueltaAPendiente.actividad), false, 'pendiente: no se agenda ninguna')
assert.equal(hayProyectada(sinFutura.actividad), false, 'interruptor apagado: tampoco')
assert.equal(hayProyectada(cargada.actividad), true, 'las dos condiciones juntas: ahí sí')

/* ---------- Mezclar contactos de varias Personas ----------
   La etapa 1 deja buscar un cliente, tildar los suyos, CONFIRMARLOS, buscar otro y sumar los de
   ese. Cambiar de Persona reinicia la transacción entera, pero NO puede llevarse los contactos ya
   confirmados: cada uno viaja con su Persona pegada, y el asiento se le hace a todas. */
const contacto = (itemId: string, nombre: string, personaId: string, personaNombre: string) => ({
  itemId,
  nombre,
  telefono: '',
  email: '',
  personaId,
  personaNombre,
})

const conPrimero = reducer(
  reducer(base, { type: 'setCliente', cliente: { id: '555', name: 'La Batea S.A' } as Cliente }),
  {
    type: 'agregarContactosActividad',
    contactos: [contacto('11', 'Juan Pérez', '555', 'La Batea S.A')],
  },
)
const conSegundo = reducer(
  reducer(conPrimero, { type: 'setCliente', cliente: { id: '666', name: 'Campo Sur' } as Cliente }),
  {
    type: 'agregarContactosActividad',
    contactos: [contacto('22', 'Ana Gómez', '666', 'Campo Sur')],
  },
)
assert.deepEqual(
  conSegundo.actividad.contactos.map((c) => c.itemId),
  ['11', '22'],
  'cambiar de Persona no borra lo confirmado en la anterior',
)

/* Confirmar SUMA, nunca pisa: es lo que permite ir y venir entre clientes. Y no repite, porque al
   volver a una Persona ya cargada sus contactos siguen a la vista (tildados y bloqueados). */
const todosDelSegundo = reducer(conSegundo, {
  type: 'agregarContactosActividad',
  contactos: [
    contacto('22', 'Ana Gómez', '666', 'Campo Sur'),
    contacto('33', 'Luis Díaz', '666', 'Campo Sur'),
  ],
})
assert.deepEqual(
  todosDelSegundo.actividad.contactos.map((c) => c.itemId),
  ['11', '22', '33'],
  'confirmar los del segundo cliente no pisa al primero, y no duplica al repetido',
)

/* Quitar es la única forma de deshacer una confirmación, y vive en la tabla de seleccionados. */
const quitado = reducer(todosDelSegundo, { type: 'quitarContactoActividad', itemId: '11' })
assert.deepEqual(
  quitado.actividad.contactos.map((c) => c.personaId),
  ['666', '666'],
  'al quitar el último contacto de una Persona, esa Persona sale del asiento',
)

/* ---------- La tabla de contactos: las tres columnas pedidas ---------- */
const contactos: Contacto[] = [
  {
    id: 'CONTACT-009',
    itemId: '11',
    name: 'Juan Pérez',
    phone: '+54 9 11 5555-5555',
    email: 'juan@campo.com',
    ini: 'JP',
    color: '#0073ea',
    status: '',
    ok: true,
  },
  {
    id: 'CONTACT-010',
    itemId: '22',
    name: 'Ana Gómez',
    phone: '',
    email: '',
    ini: 'AG',
    color: '#0073ea',
    status: '',
    ok: true,
  },
]

const tabla = renderToStaticMarkup(
  createElement(TablaContactos, {
    contactos,
    tildados: ['11'],
    yaElegidos: [],
    cargando: false,
    sinPersona: false,
    faltan: true,
    onToggle: () => {},
    onTodos: () => {},
    onConfirmar: () => {},
  }),
)
assert.ok(tabla.includes('<th>Contacto</th>'), 'falta la columna del contacto')
assert.ok(tabla.includes('<th>Email</th>'), 'falta la columna de Email')
assert.ok(tabla.includes('<th>Whatsapp</th>'), 'falta la columna de Whatsapp')
// Nombre + Apellido arriba y el código del board debajo, como la tabla de anticipos.
assert.ok(tabla.includes('Juan Pérez'), 'el nombre del contacto es Nombre + Apellido')
assert.ok(tabla.includes('CONTACT-009'), 'y su código va como segundo renglón')
assert.ok(tabla.includes('juan@campo.com') && tabla.includes('+54 9 11 5555-5555'))
assert.ok(tabla.includes('—'), 'los datos que el board no tiene se muestran con un guión')
/* Tildar no es elegir: la cabecera lo dice, y el botón de confirmar es el que cierra el paso. */
assert.ok(tabla.includes('1 de 2 tildado, sin confirmar'), 'la cabecera cuenta lo tildado')
assert.ok(tabla.includes('Confirmar 1 contacto'), 'y el botón dice cuántos van a entrar')

/* Los YA confirmados se ven elegidos y BLOQUEADOS: al volver a un cliente ya cargado, la lista
   dice cuáles de sus contactos están adentro. Se quitan desde la tabla de abajo, no desde acá. */
const conYaElegido = renderToStaticMarkup(
  createElement(TablaContactos, {
    contactos,
    tildados: [],
    yaElegidos: ['11'],
    cargando: false,
    sinPersona: false,
    faltan: false,
    onToggle: () => {},
    onTodos: () => {},
    onConfirmar: () => {},
  }),
)
assert.ok(conYaElegido.includes('is-ya'), 'la fila del confirmado se marca')
assert.ok(conYaElegido.includes('Ya seleccionado'), 'y lo dice con todas las letras')
assert.ok(conYaElegido.includes('disabled'), 'su casilla no se puede tocar')

/* Y si YA están todos elegidos, la lista lo dice así: es distinto de que la Persona no tenga
   ninguno cargado en el tablero, que es un problema a resolver en Monday. */
const todosAdentro = renderToStaticMarkup(
  createElement(TablaContactos, {
    contactos: [],
    tildados: [],
    yaElegidos: ['11', '22'],
    cargando: false,
    sinPersona: false,
    faltan: false,
    todosElegidos: true,
    onToggle: () => {},
    onTodos: () => {},
    onConfirmar: () => {},
  }),
)
assert.ok(todosAdentro.includes('Ya seleccionaste todos los contactos de esta Persona'))
assert.ok(
  !todosAdentro.includes('no tiene contactos cargados'),
  'no se confunde con la Persona sin contactos en el tablero',
)
assert.ok(
  conYaElegido.includes('Confirmar</button>') || conYaElegido.includes('Confirmar<'),
  'sin nada tildado el botón no promete un número',
)

/* Sin ningún contacto tildado, la cabecera lo RECLAMA: es un dato obligatorio, no una sugerencia. */
const sinTildar = renderToStaticMarkup(
  createElement(TablaContactos, {
    contactos,
    tildados: [],
    yaElegidos: [],
    cargando: false,
    sinPersona: false,
    faltan: true,
    onToggle: () => {},
    onTodos: () => {},
    onConfirmar: () => {},
  }),
)
assert.ok(sinTildar.includes('act-tabla-req'), 'el reclamo va con la clase del aviso en rojo')
assert.ok(
  sinTildar.includes('Tilda con que contactos se hizo o se va a efectuar la actividad'),
  'y dice qué hay que tildar',
)
assert.ok(!tabla.includes('act-tabla-req'), 'con un contacto tildado el reclamo desaparece')

/* Mientras se consultan los contactos: el renglón de búsqueda, no la lista vacía —que diría que
   la Persona no tiene contactos cuando todavía no se sabe—. */
const buscando = renderToStaticMarkup(
  createElement(TablaContactos, {
    contactos: [],
    tildados: [],
    yaElegidos: [],
    cargando: true,
    sinPersona: false,
    faltan: true,
    onToggle: () => {},
    onTodos: () => {},
    onConfirmar: () => {},
  }),
)
assert.ok(buscando.includes('Buscando contactos del cliente seleccionado'), 'falta el aviso de búsqueda')
assert.ok(buscando.includes('fa-spin'), 'y su animación')
assert.ok(!buscando.includes('no tiene contactos cargados'), 'no se afirma nada hasta tener respuesta')
assert.ok(
  !buscando.includes('act-tabla-req'),
  'y no se reclama tildar contactos que todavía no están a la vista',
)

/* Sin Persona todavía la tabla se dibuja, pero VACÍA. Nada de skeleton: el gris de carga promete
   datos en camino, y antes de elegir una Persona no hay ninguna consulta en curso. */
const enEspera = renderToStaticMarkup(
  createElement(TablaContactos, {
    contactos: [],
    tildados: [],
    yaElegidos: [],
    cargando: false,
    sinPersona: true,
    faltan: true,
    onToggle: () => {},
    onTodos: () => {},
    onConfirmar: () => {},
  }),
)
assert.ok(enEspera.includes('<th>Whatsapp</th>'), 'el encabezado se monta sin Persona elegida')
assert.ok(!enEspera.includes('skeleton'), 'y NO se promete una carga que no está pasando')
assert.ok(
  enEspera.includes('Buscá una Persona para ver sus contactos'),
  'la tabla vacía dice qué hace falta',
)
assert.ok(
  !enEspera.includes('act-tabla-req'),
  'el reclamo aparece recién con la Persona elegida: antes no hay nada que tildar',
)

/* ---------- La etapa 1 pide distinto según la rama ----------
   Registrar una actividad nueva necesita los contactos: son los que se asientan en el ítem que se
   va a crear. Completar pendientes no crea nada —cierra gestiones que ya existen, con la gente que
   ya tienen cargada—, así que ahí la etapa se reduce a elegir la firma. */
const etapa1 = (tipo: 'REGISTRAR NUEVA ACTIVIDAD' | 'COMPLETAR ACTIVIDAD PENDIENTE') =>
  renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      {
        value: reducer(
          reducer(
            { ...initialState, vendedor, operacion: 'REGISTRO DE ACTIVIDADES' },
            { type: 'goto', paso: 'actividad-persona' },
          ),
          { type: 'setTipoOperacionActividad', value: tipo },
        ),
      },
      createElement(
        DispatchContext.Provider,
        { value: () => {} },
        createElement(ActividadPersonaView),
      ),
    ),
  )

const paraNueva = etapa1('REGISTRAR NUEVA ACTIVIDAD')
assert.ok(paraNueva.includes('Contactos de la Persona'), 'la nueva pide los contactos')
assert.ok(paraNueva.includes('Contactos seleccionados'), 'y muestra los confirmados')

const paraCompletar = etapa1('COMPLETAR ACTIVIDAD PENDIENTE')
assert.ok(paraCompletar.includes('Tipo de Operación'), 'el selector sigue estando')
assert.ok(paraCompletar.includes('Buscar cliente'), 'y el buscador de la firma también')
assert.ok(!paraCompletar.includes('Contactos de la Persona'), 'completar NO pide contactos')
assert.ok(!paraCompletar.includes('Contactos seleccionados'), 'ni muestra la tabla de elegidos')
assert.ok(
  paraCompletar.includes('actividades pendientes vas a completar'),
  'y el título de la etapa lo dice',
)

/* ---------- La tabla de CONFIRMADOS: la selección de verdad, de todas las Personas ---------- */
const elegidos = renderToStaticMarkup(
  createElement(TablaContactosElegidos, {
    contactos: [
      {
        itemId: '11',
        nombre: 'Juan Pérez',
        telefono: '+54 9 11 5555-5555',
        email: 'juan@campo.com',
        personaId: '555',
        personaNombre: '7001 - La Batea S.A',
      },
      {
        itemId: '22',
        nombre: 'Ana Gómez',
        telefono: '',
        email: '',
        personaId: '666',
        personaNombre: '7002 - Campo Sur',
      },
    ],
    onQuitar: () => {},
  }),
)
assert.ok(elegidos.includes('Contactos seleccionados'), 'falta el título de la tabla')
assert.ok(elegidos.includes('<th>Whatsapp</th>') && elegidos.includes('<th>Email</th>'))
assert.ok(elegidos.includes('juan@campo.com') && elegidos.includes('+54 9 11 5555-5555'))
/* De qué Persona salió cada uno: mezclando firmas, un nombre suelto no dice a quién se le asienta. */
assert.ok(elegidos.includes('7001 - La Batea S.A') && elegidos.includes('7002 - Campo Sur'))
assert.ok(elegidos.includes('—'), 'los datos que el board no tiene se muestran con un guión')
/* El MISMO tacho de la tabla de productos: sacar un renglón de una selección es el mismo gesto
   en toda la app. */
assert.ok(elegidos.includes('fa-trash-alt'), 'y cada renglón se saca con el tacho de siempre')

const sinConfirmar = renderToStaticMarkup(
  createElement(TablaContactosElegidos, { contactos: [], onQuitar: () => {} }),
)
assert.ok(
  sinConfirmar.includes('Todavía no confirmaste ningún contacto'),
  'vacía, la tabla dice qué falta hacer',
)

console.log('OK · contactos: se tildan por Persona, se confirman y se acumulan en su propia tabla')

/* ---------- TablaActividades: opcional en las tres operaciones que la usan ---------- */
const actividad = {
  id: '1',
  nombre: 'Llamada telefónica - 07/09/2026 - La Batea S.A - Simón Paz, Ana Gómez',
  tipo: 'Llamada telefónica',
  contactos: ['Simón Paz', 'Ana Gómez'],
  fecha: '',
  estado: 'Completado',
  resolucion: '',
}

const sinElegir = renderToStaticMarkup(
  createElement(TablaActividades, {
    actividades: [actividad],
    elegidas: [],
    cargando: false,
    onToggle: () => {},
  }),
)
assert.ok(
  !sinElegir.includes('act-tabla-req'),
  'no reclama nada sin tildar: presupuesto, venta y venta con proforma la tratan igual, opcional',
)
assert.ok(sinElegir.includes('Opcional: podés continuar sin tildar ninguna.'))

/* La fila se rotula con el TIPO y con quién se hizo. El nombre del ítem lleva además la fecha y la
   Persona —que ya tienen su propia columna— y en una celda no se lee. El resto de los contactos
   queda detrás del "+", con la lista entera en el `title`. */
assert.ok(sinElegir.includes('Llamada telefónica - Simón Paz'), 'falta el rótulo de la fila')
assert.ok(!sinElegir.includes('07/09/2026'), 'y NO se repite la fecha, que tiene su columna')
assert.ok(sinElegir.includes('+'), 'el segundo contacto queda detrás del "+"')
assert.ok(sinElegir.includes('Ana Gómez'), 'y el hover los muestra a los dos')

/* La columna de contactos: con quiénes se hizo cada gestión. Se leen DOS y el resto va detrás del
   "+", con la lista completa en el `title`. */
assert.ok(sinElegir.includes('<th>Contactos</th>'), 'falta la columna de contactos')
assert.ok(sinElegir.includes('Simón Paz, Ana Gómez'), 'los dos primeros se leen, separados por coma')

const conTres = renderToStaticMarkup(
  createElement(TablaActividades, {
    actividades: [{ ...actividad, contactos: ['Simón Paz', 'Ana Gómez', 'Luis Díaz'] }],
    elegidas: [],
    cargando: false,
    onToggle: () => {},
  }),
)
assert.ok(conTres.includes('Simón Paz, Ana Gómez'), 'se siguen leyendo dos')
assert.ok(conTres.includes('Luis Díaz'), 'y el tercero está en el hover')
const titulo = /title="([^"]*)"/.exec(conTres)?.[1] ?? ''
assert.deepEqual(
  titulo.split('\n'),
  ['Simón Paz', 'Ana Gómez', 'Luis Díaz'],
  'el `title` trae la lista entera, uno por renglón',
)

/* Sin contactos cargados, la celda no queda vacía: va el guión, como el resto de los datos que el
   board no tiene. */
const sinContactos = renderToStaticMarkup(
  createElement(TablaActividades, {
    actividades: [{ ...actividad, contactos: [] }],
    elegidas: [],
    cargando: false,
    onToggle: () => {},
  }),
)
assert.ok(sinContactos.includes('—'), 'sin contactos, guión')

console.log('OK · TablaActividades: opcional en las tres operaciones (presupuesto, venta, venta con proforma)')

console.log('OK · REGISTRO DE ACTIVIDADES: el formulario crece con las respuestas y la tabla lista contactos')
