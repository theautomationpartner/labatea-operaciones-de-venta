/**
 * REGISTRO DE ACTIVIDADES: las reglas de fecha de la actividad proyectada y lo que se escribe en el
 * board de "Actividades".
 *
 * Las dos mitades se prueban juntas porque son la misma promesa: que lo que la pantalla acepta sea
 * exactamente lo que termina asentado. Las fechas se afirman sobre las funciones puras (`lib/
 * actividad`), y el asiento sobre el PAYLOAD que sale hacia Monday —interceptando el `fetch`, la
 * única salida de `mondayApi`—: las columnas se arman dentro de un `Record<string, unknown>` que el
 * typecheck no mira, así que un label mal escrito o una columna que se deja de mandar no rompe nada
 * visible.
 *
 * Cubre además la etapa "Registrar Actividad" de la venta y el presupuesto: qué actividades se
 * ofrecen (las que no tienen documento asociado), cómo quedan asociadas al emitir y cómo se leen
 * después en el resumen.
 *
 * Se corre con esbuild + node (`npm run test:actividad`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  errorFechaProyectada,
  etiquetaActividad,
  faltantesActividad,
  mensajeVendedorNoInvitado,
  resumenActividades,
} from '@/lib/actividad'
import { formatDate } from '@/lib/dates'
import {
  ACTIVIDAD_COMPLETADA_INDEX,
  ACTIVIDAD_PENDIENTE_INDEX,
  COL,
} from '@/services/monday/columns'
import {
  actividadesSinAsignarEnCache,
  asociarActividades,
  completarActividades,
  ESTADO_ACTIVIDAD_LABEL,
  filtrarPendientesDe,
  getActividadesPendientes,
  getActividadesSinAsignar,
  registrarActividad,
  VendedorNoInvitadoError,
} from '@/services/monday/actividades'
import { limpiarCachesConsultas } from '@/services/monday/cache'
import type { ActividadPendiente, ActividadState } from '@/types'

/** Una fecha a `dias` de hoy, en el formato dd/MM/yyyy con el que trabaja toda la app. */
const enDias = (dias: number): string => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + dias)
  return formatDate(d)
}

const HOY = enDias(0)
const AYER = enDias(-1)
const MANANA = enDias(1)
const EN_UNA_SEMANA = enDias(7)

/* ==========================================================================================
   1) La actividad proyectada es FUTURA: hoy no vale, ayer menos.
   ========================================================================================== */
assert.equal(errorFechaProyectada(EN_UNA_SEMANA), null, 'una fecha futura se acepta')
assert.equal(errorFechaProyectada(MANANA), null, 'mañana ya es futuro')
assert.ok(errorFechaProyectada(HOY), 'HOY no es una actividad futura: se rechaza')
assert.ok(errorFechaProyectada(AYER), 'y ayer, menos')
assert.equal(errorFechaProyectada(''), null, 'vacía no es un error de fecha sino un dato faltante')

/* ==========================================================================================
   3) Los faltantes: la actividad completada pide resolución, y la futura arrastra sus reglas.
   ========================================================================================== */
const base: ActividadState = {
  tipoOperacion: 'REGISTRAR NUEVA ACTIVIDAD',
  tipo: 'Visita al Campo',
  fecha: HOY,
  hora: '09:30',
  estado: 'Completada',
  resolucion: 'Se relevó la campaña',
  cargarFutura: false,
  proyectada: { tipo: null, fecha: '', hora: '', resolucion: '' },
  contactos: [],
  pendientes: [],
  actividadId: null,
  proyectadaId: null,
  completadas: false,
}

assert.deepEqual(faltantesActividad(base), [], 'con tipo, fecha, hora y estado la actividad está lista')
/* La HORA se reclama igual que la fecha: el asiento entra por el widget de la Persona, que ubica
   la gestión en un momento del día. Sin hora, todas caerían a la misma. */
assert.deepEqual(
  faltantesActividad({ ...base, hora: '' }),
  ['Hora de la actividad'],
  'sin hora no se puede asentar',
)
assert.deepEqual(
  faltantesActividad({ ...base, estado: 'Pendiente', resolucion: '' }),
  [],
  'la pendiente no necesita resolución: todavía no se resolvió',
)
/* Ni siquiera la completada la exige: hay gestiones que se cierran sin nada que aclarar, y pedir
   texto sí o sí sólo produce relleno. */
assert.deepEqual(
  faltantesActividad({ ...base, resolucion: '' }),
  [],
  'la resolución es opcional también con la actividad completada',
)

/* Con el interruptor encendido, la proyectada suma sus propios faltantes... */
const conFutura = {
  ...base,
  cargarFutura: true,
  proyectada: { tipo: null, fecha: '', hora: '', resolucion: '' },
}
const faltanFutura = faltantesActividad(conFutura)
assert.ok(faltanFutura.includes('Tipo de la actividad proyectada'))
assert.ok(faltanFutura.includes('Fecha de la actividad proyectada'))
assert.ok(faltanFutura.includes('Hora de la actividad proyectada'), 'y su hora')

/* ...y sus reglas de fecha frenan el avance, no sólo pintan el campo de rojo. */
const futuraMalFechada = {
  ...base,
  cargarFutura: true,
  proyectada: { tipo: 'Llamada telefónica' as const, fecha: HOY, hora: '10:00', resolucion: '' },
}
assert.ok(
  faltantesActividad(futuraMalFechada).some((f) => f.includes('posterior a hoy')),
  'una actividad "futura" con fecha de hoy no deja cerrar la etapa',
)
assert.deepEqual(
  faltantesActividad({
    ...futuraMalFechada,
    proyectada: { tipo: 'Llamada telefónica', fecha: MANANA, hora: '10:00', resolucion: '' },
  }),
  [],
  'con tipo y una fecha futura, la proyectada ya está completa: no pide nada más',
)

/* ==========================================================================================
   4) El asiento en Monday: por el widget de la Persona, no por el tablero.
   ==========================================================================================
   La actividad se crea como TIMELINE ITEM sobre el ítem de cada Persona (`create_timeline_item`),
   que es lo que alimenta el widget de Emails & Activities de su ficha. El ítem del tablero lo crea
   Monday solo, sincronizando ese timeline item; la app lo espera y le completa lo que la
   sincronización no arrastra (estado, resolución, contactos, vendedor y el nombre).

   Se afirma sobre las DOS salidas —lo que se manda al widget y el parche al ítem sincronizado—
   porque juntas son la promesa: que lo que la pantalla aceptó termine asentado igual que antes. */

interface TimelineCreado {
  item: string
  act: string
  title: string
  ts: string
  content: string | null
}
interface Parche {
  id: string
  cv: Record<string, unknown>
}

const timeline: TimelineCreado[] = []
const parches: Parche[] = []
/* El vendedor se escribe en una mutación APARTE (ver `completarItemSincronizado`): se junta acá
   para que lo que se afirma del parche de la gestión no dependa de él. */
const vendedores: Parche[] = []
const customCreadas: string[] = []
/* Las custom activities que la cuenta YA tiene. "Visita al Campo" no está a propósito: es el caso
   que obliga a darla de alta antes de poder asentar nada. */
let customExistentes = [{ id: 'act-llamada', name: 'Llamada telefónica' }]
/* El tablero, con un ítem viejo de la Persona 555: es lo que prueba que los recién sincronizados
   se reconocen por descarte y no "el último que haya". */
let itemsTablero: { id: string; personaId: string }[] = [{ id: '900', personaId: '555' }]
let proximoItem = 1000

/* La espera de la sincronización se colapsa: el reloj no es lo que se está probando, y son 1,5 s
   por vuelta. Se deja pasar el turno igual (setTimeout con 0), así el orden de las llamadas es el
   real. */
const setTimeoutReal = globalThis.setTimeout
globalThis.setTimeout = ((fn: () => void) =>
  setTimeoutReal(fn, 0)) as unknown as typeof globalThis.setTimeout

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query, variables } = JSON.parse(init.body) as {
    query: string
    variables: Record<string, string>
  }
  const responder = (data: unknown) => ({ ok: true, json: async () => ({ data }) })

  if (query.includes('create_item')) throw new Error('la actividad ya no se crea con create_item')

  if (query.includes('create_custom_activity')) {
    customCreadas.push(variables.name)
    const id = `act-${customCreadas.length}`
    customExistentes = [...customExistentes, { id, name: variables.name }]
    return responder({ create_custom_activity: { id } })
  }
  if (query.includes('custom_activity {')) return responder({ custom_activity: customExistentes })

  if (query.includes('create_timeline_item')) {
    timeline.push({
      item: variables.item,
      act: variables.act,
      title: variables.title,
      ts: variables.ts,
      content: variables.content ?? null,
    })
    // Monday sincroniza el timeline item al tablero: acá aparece el ítem que crea.
    itemsTablero = [...itemsTablero, { id: String(proximoItem++), personaId: variables.item }]
    return responder({ create_timeline_item: { id: `tl-${timeline.length}` } })
  }
  if (query.includes('change_multiple_column_values')) {
    const cv = JSON.parse(variables.cv) as Record<string, unknown>
    if (Object.keys(cv).length === 1 && COL.actividad.vendedor in cv) {
      vendedores.push({ id: variables.id, cv })
    } else {
      parches.push({ id: variables.id, cv })
    }
    return responder({ change_multiple_column_values: { id: variables.id } })
  }
  // La foto del tablero: los ítems ligados a las Personas, de los más nuevos.
  return responder({
    boards: [
      {
        items_page: {
          items: [...itemsTablero]
            .reverse()
            .map((i) => ({ id: i.id, column_values: [{ linked_item_ids: [i.personaId] }] })),
        },
      },
    ],
  })
}) as unknown as typeof fetch

const creada = await registrarActividad(
  {
    tipo: 'Visita al Campo',
    fecha: HOY,
    hora: '15:45',
    estado: 'Completada',
    resolucion: 'Pidió cotización de fertilizante',
    personas: [
      {
        itemId: '555',
        nombre: '7001 - La Batea S.A',
        contactos: [{ itemId: '11', nombre: 'Juan Pérez' }],
      },
      {
        itemId: '666',
        nombre: '7002 - Campo Sur',
        contactos: [{ itemId: '22', nombre: 'Ana Gómez' }],
      },
    ],
    vendedorId: '99',
  },
  { tipo: 'Llamada telefónica', fecha: EN_UNA_SEMANA, hora: '08:15', resolucion: '' },
)

/* Una Persona = un timeline item = un ítem del tablero. Con dos Personas y una futura agendada,
   son cuatro asientos: la gestión queda en la ficha de CADA una, que es para lo que sirve el
   widget. Antes era un solo ítem con las dos Personas adentro y ninguna ficha se enteraba. */
assert.equal(timeline.length, 4, 'un timeline item por Persona, y otra vuelta para la proyectada')
assert.equal(parches.length, 4, 'y cada ítem sincronizado se completa')
assert.equal(creada.sinCompletar, 0, 'todos aparecieron a tiempo')
assert.equal(creada.actividadId, '1000')
assert.equal(creada.proyectadaId, '1002', 'la proyectada es la segunda vuelta, no la segunda Persona')

/* El tipo viaja como el ID de la custom activity de la cuenta, no como texto: es lo único que la
   mutación no acepta escrito. La que no existía se da de alta con el nombre EXACTO del tipo, que
   es el que después la sincronización copia a "✋Tipo de actividad". */
assert.deepEqual(customCreadas, ['Visita al Campo'], 'sólo se crea la que la cuenta no tenía')
assert.equal(timeline[0].act, 'act-1', 'la recién creada')
assert.equal(timeline[2].act, 'act-llamada', 'y la que ya estaba se reutiliza')

const [aLaBatea, aCampoSur] = timeline
assert.equal(aLaBatea.item, '555', 'el timeline item se crea SOBRE la Persona')
assert.equal(aCampoSur.item, '666')
/* El template es `TIPO - FECHA - CONTACTOS`. La Persona NO entra: tiene su propia columna, que la
   sincronización completa sola, y cada ítem lleva los contactos de LA SUYA. */
assert.equal(
  aLaBatea.title,
  `Visita al Campo - ${HOY} - Juan Pérez`,
  'el título sale del template, con SUS contactos: el ítem es de esta Persona',
)
assert.equal(aCampoSur.title, `Visita al Campo - ${HOY} - Ana Gómez`)
assert.ok(
  !aLaBatea.title.includes('La Batea') && !aCampoSur.title.includes('Campo Sur'),
  'el nombre del cliente ya no se mapea al nombre del ítem',
)
assert.equal(aLaBatea.content, 'Pidió cotización de fertilizante', 'la resolución se lee en el widget')

/* El timestamp lleva la fecha Y LA HORA que cargó el usuario, en su huso: el widget ubica la
   gestión en un momento del día, no en un día suelto. Se lee en local porque así es como lo va a
   mostrar Monday; serializado en UTC, un huso al oeste —el nuestro— puede cambiarle hasta el día. */
const [dia, mes, anio] = HOY.split('/').map(Number)
const enLaFecha = new Date(aLaBatea.ts)
assert.equal(enLaFecha.getDate(), dia, 'el día local del timestamp es el elegido')
assert.equal(enLaFecha.getMonth() + 1, mes)
assert.equal(enLaFecha.getFullYear(), anio)
assert.equal(enLaFecha.getHours(), 15, 'y la hora, la que se cargó')
assert.equal(enLaFecha.getMinutes(), 45)

const enLaFutura = new Date(timeline[2].ts)
assert.equal(enLaFutura.getHours(), 8, 'la proyectada lleva la SUYA, no la de la actividad')
assert.equal(enLaFutura.getMinutes(), 15)

/* El parche: todo lo que la sincronización no puede arrastrar. */
const [pLaBatea, pCampoSur] = parches
assert.equal(pLaBatea.id, '1000', 'se parchea el ítem que apareció, no otro')
assert.equal(
  pLaBatea.cv.name,
  `Visita al Campo - ${HOY} - Juan Pérez`,
  'el nombre que arma la sincronización ("<Persona>  -  <Tipo>") se reemplaza por el de la app',
)
/* El label del board es "Completado", NO "Completada" como se lee en la pantalla. Con el texto de
   la pantalla, Monday rechaza el valor. Y la sincronización lo deja en "Done": sin este parche, el
   estado que contestó el usuario no llega nunca. */
assert.deepEqual(pLaBatea.cv[COL.actividad.estado], { label: 'Completado' })
assert.deepEqual(pLaBatea.cv[COL.actividad.resolucion], { text: 'Pidió cotización de fertilizante' })
assert.deepEqual(pLaBatea.cv[COL.actividad.contactos], { item_ids: [11] }, 'sus contactos, no todos')
assert.deepEqual(pCampoSur.cv[COL.actividad.contactos], { item_ids: [22] })
/* El vendedor va DENTRO del parche, en la misma mutación que el resto. Es atómica a propósito: si
   Monday no lo acepta —un invitado al que no se invitó al tablero—, no tiene que quedar nada a
   medias (ver los casos del invitado, más abajo). */
assert.deepEqual(pLaBatea.cv[COL.actividad.vendedor], {
  personsAndTeams: [{ id: 99, kind: 'person' }],
})
assert.equal(vendedores.length, 0, 'no hay una escritura aparte para el vendedor')
assert.ok(
  !(COL.actividad.persona in pLaBatea.cv),
  'la Persona NO se parchea: es lo único que la sincronización sí deja bien',
)
assert.ok(
  !(COL.actividad.fechaAlarma in pLaBatea.cv),
  'la fecha de notificación ya no se escribe: el campo se sacó del formulario',
)

/* La proyectada nace PENDIENTE, con SU tipo y SU fecha, y a la misma gente. */
const [, , tlFutura] = timeline
assert.equal(tlFutura.title, `Llamada telefónica - ${EN_UNA_SEMANA} - Juan Pérez`)
assert.equal(tlFutura.content, null, 'todavía no hay nada que resolver')
assert.deepEqual(parches[2].cv[COL.actividad.estado], { label: 'Pendiente' })
assert.deepEqual(parches[2].cv[COL.actividad.contactos], { item_ids: [11] }, 'hereda los contactos')
assert.ok(
  !(COL.actividad.resolucion in parches[2].cv),
  'y no lleva resolución: todavía no se hizo nada que resolver',
)

/* Sin actividad proyectada se asienta UNA sola gestión: agendar la próxima es opcional. */
timeline.length = 0
parches.length = 0
vendedores.length = 0
const sola = await registrarActividad(
  {
    tipo: 'Llamada telefónica',
    fecha: HOY,
    hora: '11:00',
    estado: 'Pendiente',
    personas: [{ itemId: '555', nombre: '7001 - La Batea S.A', contactos: [] }],
    vendedorId: null,
  },
  null,
)
assert.equal(timeline.length, 1, 'sin futura agendada, un solo asiento')
assert.equal(sola.proyectadaId, null)
/* Sin contactos no queda un separador colgando: el tramo vacío se descarta antes de unir. */
assert.equal(timeline[0].title, `Llamada telefónica - ${HOY}`)
assert.ok(
  !(COL.actividad.contactos in parches[0].cv),
  'sin contactos tildados la columna no se escribe: vacía no es un dato',
)
assert.ok(
  !(COL.actividad.vendedor in parches[0].cv),
  'y sin vendedor tampoco se manda la columna Person',
)
assert.equal(vendedores.length, 0, 'ni una escritura aparte para asignarlo')

/* Si el ítem no aparece en la ventana de espera, la gestión igual quedó asentada —el timeline item
   existe— y se avisa cuántos quedaron a medio completar, en vez de mentir que salió todo. */
timeline.length = 0
parches.length = 0
const sincronizar = itemsTablero
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query, variables } = JSON.parse(init.body) as {
    query: string
    variables: Record<string, string>
  }
  const responder = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
  if (query.includes('custom_activity {')) return responder({ custom_activity: customExistentes })
  if (query.includes('create_timeline_item')) {
    timeline.push({ item: variables.item, act: '', title: '', ts: '', content: null })
    return responder({ create_timeline_item: { id: 'tl-huerfano' } })
  }
  if (query.includes('change_multiple_column_values')) {
    parches.push({ id: variables.id, cv: {} })
    return responder({ change_multiple_column_values: { id: variables.id } })
  }
  // El tablero NO se mueve: la sincronización nunca llega.
  return responder({
    boards: [
      {
        items_page: {
          items: sincronizar.map((i) => ({
            id: i.id,
            column_values: [{ linked_item_ids: [i.personaId] }],
          })),
        },
      },
    ],
  })
}) as unknown as typeof fetch

const aMedias = await registrarActividad(
  {
    tipo: 'Llamada telefónica',
    fecha: HOY,
    hora: '11:00',
    estado: 'Pendiente',
    personas: [{ itemId: '555', nombre: '7001 - La Batea S.A', contactos: [] }],
  },
  null,
)
assert.equal(timeline.length, 1, 'el asiento en el widget se hizo igual')
assert.equal(parches.length, 0, 'no hay ítem que completar')
assert.equal(aMedias.sinCompletar, 1, 'y se dice cuántos quedaron a medias')

/* ---------- Vendedor INVITADO que no está en el tablero ----------
   Monday no lo deja figurar en "✋Vendedor" del tablero de Actividades. La decisión es que la
   operación NO exista: ni la entrada del widget ni el ítem del tablero. Hay dos redes:
     1) antes de crear nada, se pregunta si puede figurar (invitado y no suscripto → no);
     2) si igual Monday lo rechaza al completar el ítem, se reconoce ESE rechazo exacto y se borra
        lo que se alcanzó a crear.
   Y un fallo cualquiera NO se confunde con este: sigue siendo un asiento a medias. */
interface EscenarioInvitado {
  /** Qué contesta la consulta previa. `null` = no contesta (la red 1 no puede decidir). */
  previa: { is_guest: boolean; suscripto: boolean } | null
  /** Con qué error contesta Monday el parche. `null` = lo acepta. */
  errorParche: Record<string, unknown> | null
}
const RECHAZO_INVITADO = {
  message: 'invalid value - unable to assign person with id: 111857051',
  extensions: {
    code: 'ColumnValueException',
    error_data: {
      column_id: COL.actividad.vendedor,
      column_validation_error_code: 'invalidPersonAssignment',
    },
  },
}

function escenarioInvitado(e: EscenarioInvitado) {
  const registro = { creados: 0, parches: 0, borradosItem: [] as string[], borradosTimeline: [] as string[] }
  let tablero: { id: string; personaId: string }[] = []
  let proximo = 7000
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body) as {
      query: string
      variables: Record<string, string>
    }
    const responder = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
    if (query.includes('is_guest')) {
      if (!e.previa) return responder({})
      return responder({
        users: [{ id: '111857051', is_guest: e.previa.is_guest }],
        boards: [
          {
            name: 'Actividades',
            subscribers: e.previa.suscripto ? [{ id: '111857051' }] : [{ id: '107870718' }],
          },
        ],
      })
    }
    if (query.includes('custom_activity {')) return responder({ custom_activity: customExistentes })
    if (query.includes('create_timeline_item')) {
      registro.creados++
      tablero = [...tablero, { id: String(proximo++), personaId: variables.item }]
      return responder({ create_timeline_item: { id: `tl-${registro.creados}` } })
    }
    if (query.includes('delete_timeline_item')) {
      registro.borradosTimeline.push(variables.id)
      return responder({ delete_timeline_item: { id: variables.id } })
    }
    if (query.includes('delete_item')) {
      registro.borradosItem.push(variables.id)
      return responder({ delete_item: { id: variables.id } })
    }
    if (query.includes('change_multiple_column_values')) {
      registro.parches++
      if (e.errorParche) return { ok: true, json: async () => ({ errors: [e.errorParche] }) }
      return responder({ change_multiple_column_values: { id: variables.id } })
    }
    return responder({
      boards: [
        {
          items_page: {
            items: [...tablero]
              .reverse()
              .map((i) => ({ id: i.id, column_values: [{ linked_item_ids: [i.personaId] }] })),
          },
        },
      ],
    })
  }) as unknown as typeof fetch
  return registro
}

const datosInvitado = {
  tipo: 'Visita al Campo' as const,
  fecha: HOY,
  hora: '10:14',
  estado: 'Completada' as const,
  resolucion: 'testing desde usuario Dev TAP',
  personas: [
    {
      itemId: '12524661079',
      nombre: '7001 - La Batea S.A TEST',
      contactos: [{ itemId: '12587733631', nombre: 'Luciano 1' }],
    },
  ],
  vendedorId: '111857051',
}

/* Red 1: la consulta previa dice que es invitado y no está en el tablero → no se crea NADA. */
const frenado = escenarioInvitado({ previa: { is_guest: true, suscripto: false }, errorParche: null })
await assert.rejects(
  registrarActividad(datosInvitado, null),
  (err: unknown) => err instanceof VendedorNoInvitadoError && err.tablero === 'Actividades',
  'un invitado que no está en el tablero frena la operación',
)
assert.equal(frenado.creados, 0, 'y no se crea ni la entrada del widget: no queda ningún ítem vacío')

/* Invitado AL que sí se invitó al tablero: pasa, como cualquier miembro. */
const invitadoConAcceso = escenarioInvitado({ previa: { is_guest: true, suscripto: true }, errorParche: null })
const conAcceso = await registrarActividad(datosInvitado, null)
assert.equal(conAcceso.sinCompletar, 0, 'si lo invitaron al tablero, se registra normal')
assert.equal(invitadoConAcceso.creados, 1)

/* Red 2: la consulta previa no alcanza a contestar, y Monday rechaza al vendedor en el parche con
   ESE código exacto → se borra lo creado (el ítem del tablero Y la entrada del widget). */
const deshecho = escenarioInvitado({ previa: null, errorParche: RECHAZO_INVITADO })
await assert.rejects(
  registrarActividad(datosInvitado, null),
  (err: unknown) => err instanceof VendedorNoInvitadoError,
  'el rechazo exacto de Monday también frena la operación',
)
assert.equal(deshecho.creados, 1, 'la entrada del widget se había creado')
assert.deepEqual(deshecho.borradosItem, ['7000'], 'y se borra el ítem que sincronizó el tablero')
assert.deepEqual(deshecho.borradosTimeline, ['tl-1'], 'y la entrada del widget: no queda nada')

/* Un fallo CUALQUIERA no se confunde con "no está invitado": no se borra nada y sigue siendo un
   asiento a medias, que se completa a mano. Es lo que valida que el impedimento sea ESE. */
const otroError = escenarioInvitado({
  previa: null,
  errorParche: { message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
})
const aMediasPorOtro = await registrarActividad(datosInvitado, null)
assert.equal(aMediasPorOtro.sinCompletar, 1, 'otro error deja el asiento a medias, como antes')
assert.equal(otroError.borradosItem.length + otroError.borradosTimeline.length, 0, 'y no borra nada')

/* El aviso: dice qué tablero, por qué, y quién lo resuelve. */
const aUsuario = mensajeVendedorNoInvitado('Actividades', 'Dev TAP', true)
assert.ok(aUsuario.startsWith('Tu usuario no está invitado al tablero "Actividades"'))
assert.ok(aUsuario.includes('no se lo puede asignar como Vendedor'))
assert.ok(aUsuario.includes('No se registró nada'))
assert.ok(aUsuario.includes('Pedile a tu administrador de sistema que te invite al tablero "Actividades"'))
const aOtro = mensajeVendedorNoInvitado('Actividades', 'Camila Ferreras', false)
assert.ok(
  aOtro.startsWith('El vendedor Camila Ferreras no está invitado'),
  'si el vendedor es otro, no se le dice "tu usuario" a quien está operando',
)

console.log('OK · vendedor invitado: se frena antes de crear, se deshace si Monday lo rechaza, y el aviso dice quién lo resuelve')

globalThis.setTimeout = setTimeoutReal
const llamadas: { name: string; cv: Record<string, unknown> }[] = []

/* ==========================================================================================
   5) La etapa "Registrar Actividad" del documento: qué actividades se ofrecen y cómo se asocian.
   ========================================================================================== */
let ultimaQuery = ''
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query } = JSON.parse(init.body) as { query: string }
  ultimaQuery = query
  llamadas.push({ name: '', cv: {} })
  return {
    ok: true,
    json: async () => ({
      data: {
        boards: [
          {
            items_page: {
              items: [
                {
                  id: '1',
                  name: 'Llamada telefónica para conocer su propuesta',
                  column_values: [
                    { id: COL.actividad.fecha, text: '2026-07-02' },
                    { id: COL.actividad.estado, text: 'Completado' },
                    { id: COL.actividad.resolucion, text: 'Pidió cotización' },
                  ],
                },
                {
                  id: '2',
                  name: 'Visita al campo',
                  column_values: [
                    { id: COL.actividad.fecha, text: '2026-08-15' },
                    { id: COL.actividad.estado, text: 'Completado' },
                    { id: COL.actividad.resolucion, text: '' },
                  ],
                },
                // Sin fecha cargada: tiene que quedar al final, no romper el orden.
                {
                  id: '3',
                  name: 'Mail sin fecha',
                  column_values: [
                    { id: COL.actividad.fecha, text: '' },
                    { id: COL.actividad.estado, text: 'Completado' },
                    { id: COL.actividad.resolucion, text: '' },
                  ],
                },
              ],
            },
          },
        ],
        change_multiple_column_values: { id: '1' },
      },
    }),
  }
}) as unknown as typeof fetch

const listadas = await getActividadesSinAsignar()

/* El filtro va del lado del SERVIDOR: si se cayera, la etapa ofrecería gestiones que ya rindieron
   su documento (o que ni siquiera se completaron) y se asociaría dos veces la misma. */
assert.ok(
  ultimaQuery.includes(COL.actividad.presupuesto) && ultimaQuery.includes(COL.actividad.venta),
  'la consulta filtra por las dos relaciones del documento',
)
assert.equal(
  (ultimaQuery.match(/is_empty/g) ?? []).length,
  2,
  'y las pide VACÍAS a las dos: sin presupuesto Y sin venta',
)
assert.ok(
  ultimaQuery.includes(COL.actividad.estado) &&
    ultimaQuery.includes(`compare_value: [${ACTIVIDAD_COMPLETADA_INDEX}]`),
  'y sólo pide el estado Completado: Pendiente y Vencido no pueden originar un documento todavía',
)

assert.deepEqual(
  listadas.map((a) => a.id),
  ['2', '1', '3'],
  'se ordenan de la más nueva a la más vieja, y la que no tiene fecha va al final',
)
// La fecha llega en ISO del board y la app trabaja en dd/MM/yyyy.
assert.equal(listadas[1].fecha, '02/07/2026')
assert.equal(listadas[1].estado, 'Completado', 'todas las listadas llegan Completadas')
assert.equal(listadas[1].resolucion, 'Pidió cotización')
assert.equal(listadas[2].fecha, '', 'sin fecha en el board, sin fecha en la fila')


/* La consulta queda CACHEADA: volver a llamar (como hace la vista al re-montarse al ir y volver
   con el stepper) no vuelve a pegarle al servidor. Se cuenta cada fetch para probarlo, no basta
   con mirar el resultado —dos promesas podrían devolver lo mismo por casualidad—. */
let fetches = 0
const fetchOriginal = globalThis.fetch
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  fetches++
  return fetchOriginal(...args)
}) as unknown as typeof fetch

const otraVez = await getActividadesSinAsignar()
assert.equal(fetches, 0, 'la segunda lectura NO vuelve a consultar Monday')
assert.equal(otraVez, listadas, 'devuelve el MISMO array ya resuelto')
assert.deepEqual(
  actividadesSinAsignarEnCache(),
  listadas,
  'y queda disponible sin esperar, para pintar la tabla sin el "cargando" de un frame',
)

/* Cambiar de operación limpia la caché junto con el resto: la próxima etapa vuelve a consultar. */
limpiarCachesConsultas()
assert.equal(actividadesSinAsignarEnCache(), null, 'sin caché no hay nada que devolver sin esperar')
await getActividadesSinAsignar()
assert.equal(fetches, 1, 'tras limpiar la caché, la siguiente lectura sí consulta de nuevo')

/* ---------- Una actividad que YA tiene presupuesto: no se vuelve a ofrecer ----------
   Esta vez el mock SÍ interpreta las `rules` que manda la consulta (como haría Monday), sobre un
   padrón fijo de actividades con distintas combinaciones de presupuesto/venta/estado. Es más
   estricto que sólo mirar la query: prueba que, honrando esas reglas, una actividad con
   presupuesto asignado —la que va a heredar la venta CON PRESUPUESTO PREVIO que salga de ese
   presupuesto (ver `getActividadesDePresupuestos`)— queda afuera de la lista, sin importar si
   quien pregunta es PRESUPUESTAR, una VENTA DIRECTA o una VENTA PROFORMA con proforma DIRECTA:
   es LA MISMA consulta para las tres (ver `VentaActividadView`). */
const PADRON_ACTIVIDADES = [
  { id: 'A', presupuesto: null, venta: null, estado: 'Completado' }, // libre: tiene que listarse
  { id: 'B', presupuesto: '777', venta: null, estado: 'Completado' }, // ya tiene presupuesto
  { id: 'C', presupuesto: null, venta: '888', estado: 'Completado' }, // ya tiene venta
  { id: 'D', presupuesto: null, venta: null, estado: 'Pendiente' }, // sin completar
]

function actividadesQueHonranLasReglas(query: string) {
  const pideVacio = (col: string) => query.includes(`{ column_id: "${col}"`) && query.includes('is_empty')
  return PADRON_ACTIVIDADES.filter((a) => {
    if (pideVacio(COL.actividad.presupuesto) && a.presupuesto) return false
    if (pideVacio(COL.actividad.venta) && a.venta) return false
    if (query.includes(`compare_value: [${ACTIVIDAD_COMPLETADA_INDEX}]`) && a.estado !== 'Completado') {
      return false
    }
    return true
  })
}

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query } = JSON.parse(init.body) as { query: string }
  const items = actividadesQueHonranLasReglas(query).map((a) => ({
    id: a.id,
    name: `Actividad ${a.id}`,
    column_values: [
      { id: COL.actividad.fecha, text: '' },
      { id: COL.actividad.estado, text: a.estado },
      { id: COL.actividad.resolucion, text: '' },
    ],
  }))
  return { ok: true, json: async () => ({ data: { boards: [{ items_page: { items } }] } }) }
}) as unknown as typeof fetch

limpiarCachesConsultas()
const libres = await getActividadesSinAsignar()
assert.deepEqual(
  libres.map((a) => a.id).sort(),
  ['A'],
  'con presupuesto (B), con venta (C) o sin completar (D) quedan afuera; sólo A está realmente libre',
)
console.log('OK · una actividad con presupuesto asignado no vuelve a ofrecerse (PRESUPUESTAR / VENTA DIRECTA / VENTA PROFORMA DIRECTA comparten la misma consulta)')


/* La asociación escribe la relación del documento en CADA actividad elegida. */
llamadas.length = 0
const payloads: Record<string, unknown>[] = []
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { variables } = JSON.parse(init.body) as { variables: { cv: string } }
  payloads.push(JSON.parse(variables.cv))
  return { ok: true, json: async () => ({ data: { change_multiple_column_values: { id: '1' } } }) }
}) as unknown as typeof fetch

assert.deepEqual(await asociarActividades(['1', '2'], { presupuestoId: '777' }), [])
assert.equal(payloads.length, 2, 'una escritura por actividad elegida')
assert.deepEqual(payloads[0], { [COL.actividad.presupuesto]: { item_ids: [777] } })
assert.deepEqual(payloads[1], { [COL.actividad.presupuesto]: { item_ids: [777] } })

payloads.length = 0
await asociarActividades(['9'], { ventaId: '555' })
assert.deepEqual(
  payloads[0],
  { [COL.actividad.venta]: { item_ids: [555] } },
  'la venta escribe SU columna, no la del presupuesto',
)

payloads.length = 0
await asociarActividades([], { ventaId: '555' })
assert.equal(payloads.length, 0, 'sin actividades elegidas no se escribe nada')

/* ==========================================================================================
   7) REGISTRO DE ACTIVIDADES · COMPLETAR ACTIVIDAD PENDIENTE.
   ==========================================================================================
   La consulta trae TODAS las pendientes del tablero y el recorte por Persona y contacto se hace en
   memoria. Monday SÍ filtra una board_relation por id, pero sólo con el id como NÚMERO (con texto
   devuelve vacío sin avisar); el recorte va en memoria porque la selección de Personas cambia
   dentro de la misma operación, y filtrar del lado del servidor obligaría a volver a consultar en
   cada cambio. */
limpiarCachesConsultas()
llamadas.length = 0
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const query = JSON.parse(init.body).query as string
  llamadas.push(query)
  /* El nombre del contacto NO sale del `name` de su ítem —el board los nombra con las empresas a
     las que están vinculados—, así que se resuelve por sus columnas Nombre + Apellido. */
  if (query.includes(COL.contacto.nombre)) {
    return {
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: '11',
              name: 'Juan Pérez - 7001 - La Batea S.A TEST, PROVEEDOR TEST',
              column_values: [
                { id: COL.contacto.nombre, text: 'Juan' },
                { id: COL.contacto.apellido, text: 'Pérez' },
              ],
            },
            {
              id: '22',
              name: 'Ana Gómez - 7001 - La Batea S.A TEST',
              column_values: [
                { id: COL.contacto.nombre, text: 'Ana' },
                { id: COL.contacto.apellido, text: 'Gómez' },
              ],
            },
          ],
        },
      }),
    }
  }
  return {
    ok: true,
    json: async () => ({
      data: {
        boards: [
          {
            items_page: {
              items: [
                {
                  id: '40',
                  name: 'Llamar a Ana',
                  column_values: [
                    { id: COL.actividad.tipo, text: 'Visita al Campo' },
                    /* "✋Fecha Act" guarda fecha Y hora, así que su texto viene con la hora
                       pegada: es el caso real, y el que rompía la conversión. */
                    { id: COL.actividad.fecha, text: '2026-03-02 09:45' },
                    { id: COL.actividad.estado, text: 'Pendiente' },
                    { id: COL.actividad.resolucion, text: '' },
                    { id: COL.actividad.persona, text: '', linked_item_ids: ['555'] },
                    { id: COL.actividad.contactos, text: '', linked_item_ids: ['11', '22'] },
                  ],
                },
              ],
            },
          },
        ],
      },
    }),
  }
}) as unknown as typeof fetch

const pendientes = await getActividadesPendientes()
assert.equal(pendientes.length, 1)
assert.deepEqual(pendientes[0].personaIds, ['555'], 'las relaciones viajan con la actividad')
assert.deepEqual(pendientes[0].contactosIds, ['11', '22'])
assert.equal(
  pendientes[0].fecha,
  '02/03/2026',
  'la fecha se lista SIN la hora: la gestión se ubica por su día',
)
assert.equal(pendientes[0].tipo, 'Visita al Campo', 'el tipo sale de su columna, no del nombre')
assert.deepEqual(
  pendientes[0].contactos,
  ['Juan Pérez', 'Ana Gómez'],
  'y los contactos, por Nombre + Apellido: el `name` de su ítem trae las empresas',
)

/* Así se ROTULA una actividad en la tabla: el tipo y con quién se hizo. El nombre del ítem lleva
   además la fecha y la Persona, que ya tienen su propia columna —o se eligieron en la etapa
   anterior—, y en una celda no se lee. El resto de los contactos va detrás del "+". */
const etiqueta = etiquetaActividad(pendientes[0])
assert.equal(etiqueta.visible, 'Visita al Campo - Juan Pérez')
assert.equal(etiqueta.ocultas, 1, 'el segundo contacto queda detrás del "+"')
assert.ok(etiqueta.titulo.includes('Ana Gómez'), 'y el hover los muestra a los dos')

const sinContactos = etiquetaActividad({ ...pendientes[0], contactos: [] })
assert.equal(sinContactos.visible, 'Visita al Campo', 'sin contactos no queda un guión colgando')
assert.equal(sinContactos.ocultas, 0)
assert.ok(
  llamadas[0].includes(`compare_value: [${ACTIVIDAD_PENDIENTE_INDEX}]`),
  'la única regla del servidor es el estado Pendiente, por índice',
)
assert.ok(
  !llamadas[0].includes(COL.actividad.presupuesto),
  'y NO se filtra por documento: una pendiente se cierra tenga o no un documento asociado',
)

/* Los nombres de los contactos se resuelven en UNA sola consulta para todas las actividades, no
   una por actividad. Son dos llamadas en total: el tablero y los contactos. */
assert.equal(llamadas.length, 2, 'la lista y los nombres de los contactos, nada más')

// Cacheada como el resto: una consulta por operación.
const antesDeLaCache = llamadas.length
await getActividadesPendientes()
assert.equal(llamadas.length, antesDeLaCache, 'la segunda lectura sale de la caché')

/* El recorte: de esa gente, y de esos contactos. */
const pend = (
  id: string,
  personaIds: string[],
  contactosIds: string[],
): ActividadPendiente => ({ id, nombre: id, fecha: '', estado: 'Pendiente', resolucion: '', personaIds, contactosIds })

const universo = [
  pend('propia', ['555'], ['11']),
  pend('otro-contacto', ['555'], ['99']),
  pend('sin-contactos', ['555'], []),
  pend('otra-persona', ['666'], ['11']),
]
assert.deepEqual(
  filtrarPendientesDe(universo, ['555'], ['11']).map((a) => a.id),
  ['propia', 'sin-contactos'],
  'las de otra Persona no se ofrecen, y las de un contacto que no se tildó tampoco',
)
assert.deepEqual(
  filtrarPendientesDe(universo, [], ['11']),
  [],
  'sin Persona elegida no se ofrece ninguna',
)

/* Con `null` en los contactos NO se recorta por contacto: es COMPLETAR ACTIVIDAD PENDIENTE, donde
   la etapa 1 pide sólo el cliente. Se ofrecen todas las pendientes de la firma —filtrar por una
   lista vacía las escondería a todas, que es justo lo contrario de lo que hay que mostrar—. */
assert.deepEqual(
  filtrarPendientesDe(universo, ['555'], null).map((a) => a.id),
  ['propia', 'otro-contacto', 'sin-contactos'],
  'sin contactos elegidos se ofrecen TODAS las de la firma',
)
assert.deepEqual(
  filtrarPendientesDe(universo, ['555'], []).map((a) => a.id),
  ['sin-contactos'],
  'y una lista vacía sí recorta: no es lo mismo "no filtrar" que "ningún contacto elegido"',
)
assert.deepEqual(
  filtrarPendientesDe(universo, ['555', '666'], ['11', '99']).map((a) => a.id),
  ['propia', 'otro-contacto', 'sin-contactos', 'otra-persona'],
  'con las dos Personas y sus contactos, entran todas',
)

/* Y el cierre: sólo se escribe el ESTADO. La actividad ya está cargada; esta operación la cierra,
   no la edita. */
payloads.length = 0
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { variables } = JSON.parse(init.body) as { variables: { cv: string } }
  payloads.push(JSON.parse(variables.cv))
  return { ok: true, json: async () => ({ data: { change_multiple_column_values: { id: '1' } } }) }
}) as unknown as typeof fetch

assert.deepEqual(await completarActividades(['40', '41']), [])
assert.equal(payloads.length, 2, 'una escritura por actividad tildada')
assert.deepEqual(payloads[0], {
  [COL.actividad.estado]: { label: ESTADO_ACTIVIDAD_LABEL.Completada },
})
assert.deepEqual(
  Object.keys(payloads[0]),
  [COL.actividad.estado],
  'nada más que el estado: la resolución y la fecha son las que ya tenía',
)

payloads.length = 0
assert.deepEqual(await completarActividades([]), [], 'sin nada tildado no se escribe')
assert.equal(payloads.length, 0)

console.log('OK · pendientes: se traen por estado, se recortan por Persona y contacto, y se cierran escribiendo sólo el estado')

/* ==========================================================================================
   6) Cómo se leen las actividades asociadas en el resumen del documento.
   ========================================================================================== */
const act = (nombre: string) => ({
  id: nombre,
  nombre,
  tipo: '',
  contactos: [],
  fecha: '',
  estado: '',
  resolucion: '',
})

assert.deepEqual(resumenActividades([]), { visible: '', ocultas: 0, titulo: '' })

const una = resumenActividades([act('Llamada con Simón')])
assert.equal(una.visible, 'Llamada con Simón')
assert.equal(una.ocultas, 0, 'con una sola no hay nada que esconder detrás del "+"')

const dos = resumenActividades([act('Llamada con Simón'), act('Visita al campo')])
assert.equal(dos.visible, 'Llamada con Simón', 'se lee el nombre de la primera')
assert.equal(dos.ocultas, 1, 'y la segunda queda detrás del "+"')
assert.ok(dos.titulo.includes('Visita al campo'), 'el hover muestra las dos')

const tres = resumenActividades([act('A'), act('B'), act('C')])
assert.equal(tres.ocultas, 2, 'con varias escondidas, el "+" lleva la cantidad')

console.log(
  'OK · actividades: reglas de fecha, asiento en el board, listado sin asociar y asociación al documento',
)
