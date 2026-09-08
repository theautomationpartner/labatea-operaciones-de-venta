/**
 * Operación REGISTRO DE ACTIVIDADES: asienta la gestión comercial de las Personas del CRM.
 *
 * El asiento entra por el WIDGET "Emails & Activities" de la Persona (`create_timeline_item`), no
 * por el tablero: Monday sincroniza solo cada timeline item al board "Actividades"
 * (18420688236), y la app completa después lo que esa sincronización no arrastra. El detalle, y
 * qué se verificó contra la cuenta, está en el bloque de `asentarEnTimeline`.
 *
 * Una operación deja UNA o DOS gestiones: la actividad que se cargó y, cuando se completó y se
 * pidió agendar la próxima, la actividad PROYECTADA. Son hermanas —no una padre con subítems—: la
 * futura es una actividad más, que va a completarse (o a vencer) por su cuenta. Y cada una se
 * asienta en la ficha de CADA Persona elegida, así que deja un ítem por Persona.
 *
 * El board no tiene columna de texto para la descripción: la descripción ES el nombre del ítem.
 * "Resolucion/Observaciones" es otra cosa —cómo terminó—, y viaja además como contenido del
 * timeline item, que es lo que se lee en el widget.
 */
import { aIso, desdeIso } from '@/lib/dates'
import type {
  ActividadListada,
  ActividadPendiente,
  ActividadProyectada,
  EstadoActividad,
  TipoActividad,
} from '@/types'
import { memoGlobal, registrarLimpieza } from './cache'
import {
  ACTIVIDAD_COMPLETADA_INDEX,
  ACTIVIDAD_PENDIENTE_INDEX,
  BOARDS,
  COL,
  personCol,
} from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * Cómo se llama cada estado EN EL BOARD. La pantalla dice "Completada" (concuerda con "actividad")
 * y el board dice "Completado": el label tiene que viajar tal cual está escrito allá o Monday
 * rechaza el valor.
 */
export const ESTADO_ACTIVIDAD_LABEL: Record<EstadoActividad, string> = {
  Pendiente: 'Pendiente',
  Completada: 'Completado',
}

/** Los labels de "✋Tipo de actividad", en el orden en el que se ofrecen en el selector. */
export const TIPOS_ACTIVIDAD: readonly TipoActividad[] = [
  'Visita al Campo',
  'Llamada telefónica',
  'Reunión Presencial',
  'Whatsapp',
  'Email',
]

/** Una Persona involucrada en la gestión, con los contactos de ELLA que se tildaron. */
export interface PersonaActividad {
  /** Ítem de la Persona (board 18420688238): sobre él se crea el timeline item. */
  itemId: string
  nombre: string
  /** Contactos tildados de esta Persona. Vacío = la gestión se asienta sin contactos. */
  contactos: { itemId: string; nombre: string }[]
}

/** Lo que hace falta para asentar UNA gestión. */
export interface DatosActividad {
  tipo: TipoActividad
  /** dd/MM/yyyy, como se maneja en toda la app. Acá se traduce al timestamp que pide Monday. */
  fecha: string
  /** HH:mm. Junto con la fecha arma el timestamp del timeline item (ver `aTimestamp`). */
  hora: string
  estado: EstadoActividad
  /** Cómo terminó. Vacía = no se escribe la columna. */
  resolucion?: string
  /**
   * A quiénes se les asienta. Son varias porque la etapa 1 deja mezclar contactos de distintos
   * clientes: la gestión queda en la ficha de CADA una, con sus propios contactos.
   */
  personas: PersonaActividad[]
  /** Usuario de Monday del vendedor de la operación. */
  vendedorId?: string | null
}

/** El resultado de la operación: qué quedó asentado. */
export interface ActividadCreada {
  /** Ítem del tablero de la actividad cargada (el de la primera Persona, si fueron varias). */
  actividadId: string
  /** null cuando no se agendó ninguna actividad futura. */
  proyectadaId: string | null
  /**
   * Cuántos ítems quedaron a medio completar: Monday los tenía que sincronizar y no aparecieron a
   * tiempo, así que se quedaron sin estado, resolución, contactos ni vendedor. Ver
   * `esperarSincronizacion`: la gestión igual está asentada, lo que falta se completa a mano.
   */
  sinCompletar: number
}

/* ===== El asiento va por el widget "Emails & Activities" de la Persona =====

   La actividad NO se crea con `create_item` sobre el tablero: se crea como TIMELINE ITEM sobre el
   ítem de la Persona (`create_timeline_item`), que es lo que alimenta el widget de Emails &
   Activities de su ficha. Monday sincroniza solo ese timeline item al tablero "Actividades"
   —verificado contra la cuenta: el ítem aparece a los 2-4 segundos—, así que el asiento del tablero
   se sigue creando, pero ahora la gestión también queda donde el vendedor la mira: en la Persona.

   Una Persona = un timeline item = un ítem del tablero. Con varias elegidas la gestión queda
   asentada en la ficha de cada una, que es justamente para lo que sirve el widget. Por eso ya no
   hay UN ítem con todas las Personas adentro, sino uno por Persona con SUS contactos.

   Lo que la sincronización arma sola:
     · el ítem, con nombre "<Persona>  -  <Tipo>"
     · "✋Personas" ← la Persona sobre la que se creó el timeline item
     · "✋Tipo de actividad" ← el nombre de la custom activity
     · "✋Fecha Act" ← el timestamp
   Lo que NO puede arrastrar, y por eso se completa después (`completarItemSincronizado`):
     · el ESTADO: la sincronización lo deja siempre en "Done", conteste lo que conteste el usuario
     · la resolución, los contactos y el vendedor
     · el nombre con el template de la app
   El vendedor tampoco se puede mandar en la mutación: su `user_id` sólo acepta al dueño del token
   ("User is not allowed to act on this item"), así que va en el parche como una columna más. */

/** Ícono y color con los que se da de alta la custom activity que falte, por tipo. */
const ESTILO_TIPO: Record<TipoActividad, { icono: string; color: string }> = {
  'Visita al Campo': { icono: 'PLANE', color: 'GO_GREEN' },
  'Llamada telefónica': { icono: 'HEADPHONES', color: 'BRINK_PINK' },
  'Reunión Presencial': { icono: 'LOCATION', color: 'VIVID_CERULEAN' },
  Whatsapp: { icono: 'PAPERPLANE', color: 'YELLOW_GREEN' },
  Email: { icono: 'NOTEBOOK', color: 'CORNFLOWER_BLUE' },
}

/** Para comparar nombres de custom activity sin que un acento o una mayúscula los separe. */
const normalizar = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

/** Las custom activities de la cuenta, por nombre normalizado. Una consulta por operación. */
const customActivitiesMemo = memoGlobal(async (): Promise<Map<string, string>> => {
  const data = await mondayApi<{ custom_activity: { id: string; name: string }[] }>(
    `query { custom_activity { id name } }`,
  )
  return new Map(data.custom_activity.map((c) => [normalizar(c.name), c.id]))
})

/**
 * El id de la custom activity del tipo elegido. Es lo único que `create_timeline_item` no acepta
 * como texto: hay que mandarle el id de la actividad configurada en la cuenta.
 *
 * Si la cuenta no la tiene, se da de alta con el nombre EXACTO del tipo —que es el que después la
 * sincronización copia a "✋Tipo de actividad"—. Los cinco tipos de la app son fijos y el widget no
 * puede asentar uno que no exista: la alternativa sería que la operación fallara por una
 * configuración que igual hay que crear.
 */
async function idDeTipo(tipo: TipoActividad): Promise<string> {
  const existentes = await customActivitiesMemo()
  const ya = existentes.get(normalizar(tipo))
  if (ya) return ya
  const { icono, color } = ESTILO_TIPO[tipo]
  const creada = await mondayApi<{ create_custom_activity: { id: string } }>(
    `mutation ($name: String!) {
      create_custom_activity(name: $name, icon_id: ${icono}, color: ${color}) { id }
    }`,
    { name: tipo },
  )
  existentes.set(normalizar(tipo), creada.create_custom_activity.id)
  return creada.create_custom_activity.id
}

/**
 * El nombre del ítem: `TIPO - FECHA - PERSONA - CONTACTOS`.
 *
 * No lo escribe nadie a mano, y tampoco sirve el que arma la sincronización ("<Persona>  -  <Tipo>",
 * sin fecha ni contactos): se arma con lo que la operación ya sabe, así todas las actividades se
 * nombran igual y la grilla del board se puede leer y ordenar. Los contactos van por su nombre
 * (Nombre + Apellido, como los muestra la tabla de la etapa 1), separados por coma.
 *
 * Un tramo vacío no deja un separador colgando: se descarta antes de unir. Y se recorta al final
 * porque Monday acepta nombres largos pero la grilla no los muestra enteros.
 */
const NOMBRE_MAX = 200
function nombreDe(tipo: TipoActividad, fecha: string, persona: PersonaActividad): string {
  const contactos = persona.contactos
    .map((c) => c.nombre.trim())
    .filter(Boolean)
    .join(', ')
  const tramos = [tipo, fecha, persona.nombre.trim(), contactos].filter(Boolean)
  const limpio = tramos.join(' - ').replace(/\s+/g, ' ')
  return limpio.length > NOMBRE_MAX ? `${limpio.slice(0, NOMBRE_MAX - 1)}…` : limpio
}

/**
 * El timestamp que pide el widget: la fecha y la hora que cargó el usuario, en su huso. El `Date`
 * se arma con los componentes LOCALES y se serializa a UTC, que es como lo guarda Monday y como lo
 * vuelve a mostrar en la zona de la cuenta.
 *
 * Sin hora cargada cae al MEDIODÍA, no a la medianoche: es el punto del día que sigue cayendo en
 * la misma fecha en cualquier huso. Es un resguardo, no el caso normal —la hora es obligatoria—.
 */
function aTimestamp(fecha: string, hora: string): string {
  const iso = aIso(fecha)
  if (!iso) return new Date().toISOString()
  const [anio, mes, dia] = iso.split('-').map(Number)
  const [h, m] = (hora ?? '').split(':').map(Number)
  return new Date(
    anio,
    mes - 1,
    dia,
    Number.isFinite(h) ? h : 12,
    Number.isFinite(m) ? m : 0,
    0,
  ).toISOString()
}

/** Cuántos ítems del tablero se miran para reconocer los que acaba de sincronizar Monday. */
const VENTANA_SYNC = 50
/** Cada cuánto se vuelve a mirar, y cuántas veces. Medido contra la cuenta: aparecen en 2-4 s. */
const ESPERA_SYNC_MS = 1500
const INTENTOS_SYNC = 12

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Ítems de "Actividades" ligados a alguna de estas Personas, de los más nuevos. */
async function actividadesDeLasPersonas(
  personaIds: readonly string[],
): Promise<{ id: string; personaId: string }[]> {
  const buscadas = new Set(personaIds)
  const data = await mondayApi<{
    boards: {
      items_page: { items: { id: string; column_values: { linked_item_ids?: string[] }[] }[] }
    }[]
  }>(
    `query {
      boards(ids: [${BOARDS.actividades}]) {
        items_page(
          limit: ${VENTANA_SYNC}
          query_params: { order_by: [{ column_id: "__creation_log__", direction: desc }] }
        ) {
          items {
            id
            column_values(ids: ["${COL.actividad.persona}"]) {
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )
  const encontrados: { id: string; personaId: string }[] = []
  for (const item of data.boards[0]?.items_page.items ?? []) {
    for (const personaId of item.column_values[0]?.linked_item_ids ?? []) {
      if (buscadas.has(personaId)) encontrados.push({ id: item.id, personaId })
    }
  }
  return encontrados
}

/**
 * Espera a que Monday sincronice los timeline items recién creados y devuelve qué ítem del tablero
 * le tocó a cada Persona.
 *
 * Se reconocen POR DESCARTE: se fotografían los ítems de esas Personas antes de crear nada, y el
 * que aparece después es el nuevo. No hay forma de pedírselo a la API —la mutación devuelve el id
 * del timeline item, que no es el del ítem del tablero, y el ítem tampoco guarda el del timeline—,
 * así que la foto previa es lo único que los ata.
 *
 * Si alguna no aparece en el tiempo previsto se devuelve lo que haya: la gestión ya está asentada
 * —el timeline item existe y el ítem va a terminar apareciendo—, y lo que falta es completarlo.
 */
async function esperarSincronizacion(
  personaIds: readonly string[],
  previos: ReadonlySet<string>,
): Promise<Map<string, string>> {
  let nuevos = new Map<string, string>()
  for (let intento = 0; intento < INTENTOS_SYNC; intento++) {
    await esperar(ESPERA_SYNC_MS)
    nuevos = new Map()
    for (const { id, personaId } of await actividadesDeLasPersonas(personaIds)) {
      if (!previos.has(id) && !nuevos.has(personaId)) nuevos.set(personaId, id)
    }
    if (nuevos.size >= personaIds.length) break
  }
  return nuevos
}

/** Le escribe al ítem sincronizado todo lo que la sincronización no pudo traer. */
async function completarItemSincronizado(
  itemId: string,
  persona: PersonaActividad,
  datos: DatosActividad,
): Promise<void> {
  const cv: Record<string, unknown> = {
    // El nombre que arma la sincronización no lleva fecha ni contactos: se reemplaza por el nuestro.
    name: nombreDe(datos.tipo, datos.fecha, persona),
    // La sincronización deja SIEMPRE "Done": el estado real es el que contestó el usuario.
    [COL.actividad.estado]: { label: ESTADO_ACTIVIDAD_LABEL[datos.estado] },
  }
  if (datos.resolucion?.trim()) cv[COL.actividad.resolucion] = { text: datos.resolucion.trim() }
  const contactos = persona.contactos
    .map((c) => Number(c.itemId))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (contactos.length > 0) cv[COL.actividad.contactos] = { item_ids: contactos }
  const vendedor = personCol(datos.vendedorId)
  if (vendedor) cv[COL.actividad.vendedor] = vendedor

  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board: BOARDS.actividades, cv: JSON.stringify(cv) },
  )
}

/**
 * Asienta UNA gestión: un timeline item en la ficha de cada Persona, y el ítem que Monday
 * sincroniza de cada uno, completado con lo que la sincronización no arrastra.
 */
async function asentarEnTimeline(
  datos: DatosActividad,
): Promise<{ ids: string[]; sinCompletar: number }> {
  if (!mondayHabilitado()) return { ids: [`mock-actividad-${Date.now()}`], sinCompletar: 0 }
  const personaIds = datos.personas.map((p) => p.itemId)
  if (personaIds.length === 0) return { ids: [], sinCompletar: 0 }

  const customActivityId = await idDeTipo(datos.tipo)
  const previos = new Set((await actividadesDeLasPersonas(personaIds)).map((a) => a.id))
  const timestamp = aTimestamp(datos.fecha, datos.hora)

  for (const persona of datos.personas) {
    await mondayApi(
      `mutation ($item: ID!, $act: String!, $title: String!, $ts: ISO8601DateTime!, $content: String) {
        create_timeline_item(
          item_id: $item
          custom_activity_id: $act
          title: $title
          timestamp: $ts
          content: $content
        ) { id }
      }`,
      {
        item: persona.itemId,
        act: customActivityId,
        title: nombreDe(datos.tipo, datos.fecha, persona),
        ts: timestamp,
        // El contenido es lo que se lee en el widget: la resolución, si la hay.
        content: datos.resolucion?.trim() || null,
      },
    )
  }

  const sincronizados = await esperarSincronizacion(personaIds, previos)
  /* En el orden en que se eligieron las Personas, no en el que los devolvió el tablero: el primero
     es el que la operación guarda como "la" actividad registrada. */
  const ids: string[] = []
  let sinCompletar = 0
  for (const persona of datos.personas) {
    const itemId = sincronizados.get(persona.itemId)
    if (!itemId) {
      sinCompletar++
      continue
    }
    ids.push(itemId)
    /* Un fallo acá no tira abajo la operación: la gestión ya está asentada y en el widget, y lo
       que quedó a medias es un ítem del tablero que se termina de completar a mano. */
    try {
      await completarItemSincronizado(itemId, persona, datos)
    } catch {
      sinCompletar++
    }
  }
  return { ids, sinCompletar }
}

/**
 * Cierra la operación: la actividad cargada y, si se agendó, la proyectada.
 *
 * La proyectada nace SIEMPRE "Pendiente" —todavía no pasó— y se asienta a la misma gente: es la
 * próxima gestión con las mismas Personas y los mismos contactos.
 *
 * El orden importa por dos razones. La primera, la de siempre: si la proyectada fallara, lo que se
 * hizo ya quedó asentado y la agenda se completa a mano; al revés, quedaría agendado el seguimiento
 * de algo que no figura en ningún lado. La segunda es técnica: los ítems que sincroniza Monday se
 * reconocen por descarte (ver `esperarSincronizacion`), y con las dos gestiones en el aire a la vez
 * no habría cómo saber cuál es cuál.
 */
export async function registrarActividad(
  datos: DatosActividad,
  proyectada: ActividadProyectada | null,
): Promise<ActividadCreada> {
  const principal = await asentarEnTimeline(datos)
  const base = { actividadId: principal.ids[0] ?? '', sinCompletar: principal.sinCompletar }
  if (!proyectada || !proyectada.tipo) return { ...base, proyectadaId: null }

  const futura = await asentarEnTimeline({
    ...datos,
    tipo: proyectada.tipo,
    fecha: proyectada.fecha,
    hora: proyectada.hora,
    estado: 'Pendiente',
    // Tiene sus propios campos, incluida la resolución: son los MISMOS que la actividad de origen.
    resolucion: proyectada.resolucion,
  })
  return {
    ...base,
    proyectadaId: futura.ids[0] ?? null,
    sinCompletar: base.sinCompletar + futura.sinCompletar,
  }
}

/* ===== Actividades pendientes de asociar a un documento ===== */

/** Tope de actividades que se traen. Si alguna vez se llena, hay un problema de higiene del board. */
const TOPE_ACTIVIDADES = 100

/**
 * La consulta en crudo. La versión pública (`getActividadesSinAsignar`) la envuelve en la caché.
 *
 * El filtro va del lado del SERVIDOR, no en memoria: una gestión que no puede elegirse no tiene por
 * qué viajar hasta el navegador para que después se la descarte, y con el tablero creciendo la
 * lista traería sobre todo actividades que sobran.
 *   · `is_empty` en las dos relaciones: sin presupuesto y sin venta asignados. Una actividad con
 *     presupuesto YA asignado no se ofrece de nuevo —ni para cargar OTRO presupuesto, ni para una
 *     VENTA DIRECTA, ni para una VENTA PROFORMA armada con una proforma DIRECTA—: quedó atada a la
 *     venta CON PRESUPUESTO PREVIO que salga de ese presupuesto (la hereda, ver
 *     `getActividadesDePresupuestos`), y ofrecerla de nuevo dejaría la misma gestión repartida
 *     entre dos documentos.
 *   · Estado "Completado": una Pendiente o Vencida todavía no tiene una gestión resuelta que
 *     imputar a un documento; recién al completarla tiene sentido ofrecerla acá.
 *
 * Es LA MISMA consulta para las tres etapas "Registrar Actividad" que existen (PRESUPUESTAR,
 * VENTA DIRECTA, VENTA PROFORMA con proforma DIRECTA — ver `VentaActividadView`): no hay una
 * variante por operación, así que esta regla rige para las tres por igual.
 *
 * Se ordenan de la más nueva a la más vieja: la gestión que originó lo que se está por emitir
 * suele ser de estos días.
 */
async function getActividadesSinAsignarImpl(): Promise<ActividadListada[]> {
  if (!mondayHabilitado()) return []
  const data = await mondayApi<{
    boards: { items_page: { items: MondayItemActividad[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.actividades}]) {
        items_page(
          limit: ${TOPE_ACTIVIDADES}
          query_params: {
            rules: [
              { column_id: "${COL.actividad.presupuesto}", compare_value: [null], operator: is_empty }
              { column_id: "${COL.actividad.venta}", compare_value: [null], operator: is_empty }
              { column_id: "${COL.actividad.estado}", compare_value: [${ACTIVIDAD_COMPLETADA_INDEX}], operator: any_of }
            ]
            operator: and
          }
        ) {
          items {
            id
            name
            column_values(ids: [${COLUMNAS_LISTADO}]) {
              id
              text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )
  const items = data.boards[0]?.items_page.items ?? []
  return (await listarActividades(items)).sort(masNuevaPrimero)
}

/* Caché de la consulta + un índice con lo YA resuelto.

   El índice existe para poder contestar SIN esperar: volver a la etapa con el stepper tiene que
   mostrar la tabla ya armada, y no un "cargando" de un frame contra un resultado que ya estaba.
   Se vacía junto con el resto de las cachés al cambiar de operación. */
const actividadesMemo = memoGlobal(getActividadesSinAsignarImpl)
let actividadesResueltas: ActividadListada[] | null = null
registrarLimpieza(() => {
  actividadesResueltas = null
})

/**
 * Las actividades que TODAVÍA no se asociaron a ningún documento: sin presupuesto y sin venta
 * asignados. Son las que se ofrecen en la etapa "Registrar Actividad" de la venta y el presupuesto.
 *
 * CACHEADA: se consulta UNA sola vez por operación, como el resto de las lecturas de la app. Ir y
 * volver a la etapa con el stepper no vuelve a pegarle a Monday —no cambia nada que pueda alterar
 * el resultado—, y la caché se vacía al cambiar de operación (`limpiarCachesConsultas`), que es
 * cuando una gestión cargada mientras tanto tiene que aparecer.
 */
export async function getActividadesSinAsignar(): Promise<ActividadListada[]> {
  const actividades = await actividadesMemo()
  actividadesResueltas = actividades
  return actividades
}

/** Lo ya traído, sin esperar. `null` = todavía no se consultó en esta operación. */
export const actividadesSinAsignarEnCache = (): ActividadListada[] | null => actividadesResueltas

interface MondayItemActividad {
  id: string
  name: string
  column_values: { id: string; text: string | null; linked_item_ids?: string[] }[]
}

/**
 * Las columnas con las que se LISTA una actividad. En un solo lugar porque son tres las consultas
 * que la listan —sin asociar, pendientes y por id—: si una trajera menos, la misma gestión se
 * vería distinta según de dónde salió.
 */
const COLUMNAS_LISTADO = `"${COL.actividad.tipo}","${COL.actividad.fecha}","${COL.actividad.estado}","${COL.actividad.resolucion}","${COL.actividad.contactos}"`

/** La fecha viene en ISO (yyyy-MM-dd) y la app trabaja en dd/MM/yyyy. */
function mapActividadListada(item: MondayItemActividad): ActividadListada {
  const porId = Object.fromEntries(item.column_values.map((c) => [c.id, c.text ?? '']))
  return {
    id: item.id,
    nombre: item.name,
    tipo: porId[COL.actividad.tipo] ?? '',
    // Los nombres se resuelven aparte, en una sola consulta para todas (ver `listarActividades`).
    contactos: [],
    fecha: desdeIso(porId[COL.actividad.fecha] ?? ''),
    estado: porId[COL.actividad.estado] ?? '',
    resolucion: porId[COL.actividad.resolucion] ?? '',
  }
}

/** Ítems de contacto conectados a la actividad. */
const contactosDe = (item: MondayItemActividad): string[] =>
  item.column_values.find((c) => c.id === COL.actividad.contactos)?.linked_item_ids ?? []

/**
 * Nombre + Apellido de cada contacto, por id de ítem.
 *
 * El `name` del ítem NO sirve: el board de Contactos los nombra con las empresas a las que están
 * vinculados ("Luciano 1 - 1111 -, 7001 - La Batea S.A TEST, …"), así que el nombre real sale de
 * sus columnas. Es el mismo criterio que usa `mapContacto` para la tabla de la etapa 1.
 */
async function nombresDeContactos(ids: readonly string[]): Promise<Map<string, string>> {
  const limpios = [...new Set(ids)].filter((id) => id && Number.isFinite(Number(id)))
  if (!mondayHabilitado() || limpios.length === 0) return new Map()
  const data = await mondayApi<{
    items: { id: string; name: string; column_values: { id: string; text: string | null }[] }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        name
        column_values(ids: ["${COL.contacto.nombre}","${COL.contacto.apellido}"]) {
          id
          text
        }
      }
    }`,
    { ids: limpios },
  )
  const nombres = new Map<string, string>()
  for (const item of data.items ?? []) {
    const porId = Object.fromEntries(item.column_values.map((c) => [c.id, (c.text ?? '').trim()]))
    const completo = [porId[COL.contacto.nombre], porId[COL.contacto.apellido]]
      .filter(Boolean)
      .join(' ')
    // Sin ninguna de las dos columnas cargada se cae al nombre del ítem: algo hay que mostrar.
    nombres.set(item.id, completo || item.name)
  }
  return nombres
}

/**
 * Las actividades listas para mostrar: el mapeo de cada ítem más los NOMBRES de sus contactos,
 * resueltos todos juntos en una sola consulta (no una por actividad).
 */
async function listarActividades(items: readonly MondayItemActividad[]): Promise<ActividadListada[]> {
  const nombres = await nombresDeContactos(items.flatMap(contactosDe))
  return items.map((item) => ({
    ...mapActividadListada(item),
    contactos: contactosDe(item)
      .map((id) => nombres.get(id) ?? '')
      .filter(Boolean),
  }))
}

/** Orden por fecha, de la más nueva a la más vieja; las que no tienen fecha van al final. */
const masNuevaPrimero = (a: ActividadListada, b: ActividadListada): number => {
  const fa = aIso(a.fecha)
  const fb = aIso(b.fecha)
  if (!fa) return 1
  if (!fb) return -1
  return fb.localeCompare(fa)
}

/**
 * Asocia las actividades elegidas al documento que se acaba de crear: les escribe la relación con
 * el presupuesto o con la venta.
 *
 * Con esto la actividad deja de aparecer en la lista de la etapa (ver `getActividadesSinAsignar`):
 * ya rindió su documento y no puede volver a asociarse a otro.
 *
 * Es POSTERIOR al documento y best-effort por decisión: si el enlace falla, el presupuesto o la
 * venta ya están creados y correctos, y forzar un rollback por una relación sería peor. Devuelve
 * los ids que NO se pudieron asociar, para que quien llama pueda avisarlo.
 */
export async function asociarActividades(
  actividadesIds: readonly string[],
  documento: { presupuestoId?: string | null; ventaId?: string | null },
): Promise<string[]> {
  const columna = documento.presupuestoId ? COL.actividad.presupuesto : COL.actividad.venta
  const documentoId = Number(documento.presupuestoId ?? documento.ventaId)
  if (!Number.isFinite(documentoId) || documentoId <= 0) return [...actividadesIds]
  if (actividadesIds.length === 0) return []
  if (!mondayHabilitado()) return []

  const sinAsociar: string[] = []
  for (const id of actividadesIds) {
    try {
      await mondayApi(
        `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
          change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
        }`,
        {
          id,
          board: BOARDS.actividades,
          cv: JSON.stringify({ [columna]: { item_ids: [documentoId] } }),
        },
      )
    } catch {
      sinAsociar.push(id)
    }
  }
  return sinAsociar
}



/* ===== Actividades PENDIENTES de las Personas elegidas =====
   Es la otra mitad de REGISTRO DE ACTIVIDADES: en vez de cargar una gestión nueva, se cierran las
   que ya estaban agendadas para la gente elegida en la etapa 1. */

/**
 * TODAS las pendientes del tablero, con las relaciones que dicen a quién involucran.
 *
 * El filtro por Persona y por contacto va EN MEMORIA (ver `filtrarPendientesDe`), no en la
 * consulta: Monday no filtra una `board_relation` por el id del ítem conectado —una regla
 * `any_of` con ids devuelve vacío, verificado contra el board—, así que la única regla que sirve
 * del lado del servidor es el estado. Como la selección de Personas cambia dentro de la misma
 * operación (la etapa 1 deja sumar clientes), filtrar acá también sería peor: habría que volver a
 * consultar en cada cambio.
 */
async function getActividadesPendientesImpl(): Promise<ActividadPendiente[]> {
  if (!mondayHabilitado()) return []
  const data = await mondayApi<{
    boards: { items_page: { items: MondayItemActividad[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.actividades}]) {
        items_page(
          limit: ${TOPE_ACTIVIDADES}
          query_params: {
            rules: [
              { column_id: "${COL.actividad.estado}", compare_value: [${ACTIVIDAD_PENDIENTE_INDEX}], operator: any_of }
            ]
          }
        ) {
          items {
            id
            name
            column_values(ids: [${COLUMNAS_LISTADO},"${COL.actividad.persona}"]) {
              id
              text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )
  const items = data.boards[0]?.items_page.items ?? []
  const listadas = await listarActividades(items)
  return items
    .map((item, i) => ({
      ...listadas[i],
      personaIds:
        item.column_values.find((c) => c.id === COL.actividad.persona)?.linked_item_ids ?? [],
      contactosIds: contactosDe(item),
    }))
    .sort(masNuevaPrimero)
}

/* Misma técnica que las actividades sin asociar: una sola consulta por operación, más el índice
   con lo ya resuelto para poder contestar sin un "cargando" de un frame al volver con el stepper. */
const pendientesMemo = memoGlobal(getActividadesPendientesImpl)
let pendientesResueltas: ActividadPendiente[] | null = null
registrarLimpieza(() => {
  pendientesResueltas = null
})

/** Las actividades en estado "Pendiente" del tablero. CACHEADA por operación. */
export async function getActividadesPendientes(): Promise<ActividadPendiente[]> {
  const actividades = await pendientesMemo()
  pendientesResueltas = actividades
  return actividades
}

/** Lo ya traído, sin esperar. `null` = todavía no se consultó en esta operación. */
export const actividadesPendientesEnCache = (): ActividadPendiente[] | null => pendientesResueltas

/**
 * Las pendientes que le corresponden a lo elegido en la etapa 1: las de esas Personas, y de ellas
 * las que involucran a alguno de los contactos tildados.
 *
 * Las dos condiciones, en ese orden:
 *   1. La actividad tiene que estar asentada a alguna de las Personas elegidas. Sin esto se
 *      estarían ofreciendo para cerrar gestiones de terceros.
 *   2. De las que quedan, se descartan las que involucran SÓLO a contactos que no se tildaron: se
 *      eligió cerrar lo de esta gente, no todo lo de la firma. Una actividad SIN contactos
 *      cargados sí se ofrece —es lo normal en las que vienen de antes de esta operación—, porque
 *      descartarla sería esconderla por un dato que el board nunca tuvo.
 */
export function filtrarPendientesDe(
  actividades: readonly ActividadPendiente[],
  personaIds: readonly string[],
  contactosIds: readonly string[],
): ActividadPendiente[] {
  const personas = new Set(personaIds)
  const contactos = new Set(contactosIds)
  if (personas.size === 0) return []
  return actividades.filter((a) => {
    if (!a.personaIds.some((id) => personas.has(id))) return false
    return a.contactosIds.length === 0 || a.contactosIds.some((id) => contactos.has(id))
  })
}

/**
 * Pasa a "Completado" las pendientes elegidas. Es el cierre de la operación cuando se eligió
 * COMPLETAR ACTIVIDAD PENDIENTE.
 *
 * Se escribe SÓLO el estado: la actividad ya está cargada con su tipo, su fecha y su gente, y esta
 * operación no la edita, la cierra. Devuelve los ids que NO se pudieron pasar, para que la vista
 * pueda avisarlo —una por una, así un fallo en la tercera no se lleva puestas las dos anteriores—.
 */
export async function completarActividades(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0 || !mondayHabilitado()) return []
  const sinCompletar: string[] = []
  for (const id of ids) {
    try {
      await mondayApi(
        `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
          change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
        }`,
        {
          id,
          board: BOARDS.actividades,
          cv: JSON.stringify({
            [COL.actividad.estado]: { label: ESTADO_ACTIVIDAD_LABEL.Completada },
          }),
        },
      )
    } catch {
      sinCompletar.push(id)
    }
  }
  return sinCompletar
}

/* ===== Herencia de actividades entre documentos =====
   La gestión comercial se elige UNA sola vez, en el documento que la origina. Un documento que
   nace de otro —la venta CON PRESUPUESTO PREVIO, la proforma que se arma con esos mismos
   presupuestos, y la venta que a su vez sale de esa proforma— no vuelve a preguntarla: hereda las
   que ya están conectadas al documento anterior, leyendo SU columna "🤖Actividades" (no la
   reversa de la Actividad, que es otra cosa —ver `asociarActividades`—). */

/** IDs de actividades conectadas a uno o más ítems, en la columna dada. Vacío = ninguno conectado. */
async function actividadesConectadas(
  columnaActividades: string,
  itemIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(itemIds)].filter((id) => id && Number.isFinite(Number(id)))
  if (!mondayHabilitado() || ids.length === 0) return []
  const data = await mondayApi<{
    items: { column_values: { linked_item_ids?: string[] }[] }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${columnaActividades}"]) {
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }`,
    { ids },
  )
  const encontradas = new Set<string>()
  for (const item of data.items) {
    for (const cv of item.column_values) {
      for (const actividadId of cv.linked_item_ids ?? []) encontradas.add(actividadId)
    }
  }
  return [...encontradas]
}

/**
 * Las actividades YA conectadas a uno o más presupuestos, leídas de SU columna "🤖Actividades"
 * (board_relation_mm6w6mra). Las usa la venta CON PRESUPUESTO PREVIO —que no tiene la etapa
 * "Registrar Actividad"— para heredar las de los presupuestos que aportaron algún producto
 * vendido, y también la creación de la factura proforma cuando la venta que la emite es de ese
 * mismo tipo.
 *
 * Duplicados entre presupuestos se dejan pasar: `crearVenta`/`crearProforma` mandan `item_ids`
 * y Monday no repite un mismo id dos veces en la relación.
 */
export const getActividadesDePresupuestos = (
  presupuestoIds: readonly string[],
): Promise<string[]> => actividadesConectadas(COL.presupuesto.actividades, presupuestoIds)

/**
 * Las actividades YA conectadas a una proforma, leídas de SU columna "🤖Actividades"
 * (board_relation_mm6zc4fa). Las hereda la VENTA PROFORMA armada a partir de una proforma CON
 * PRESUPUESTO PREVIO: esa proforma ya las trae de sus propios presupuestos (ver
 * `getActividadesDePresupuestos`), así que la venta no vuelve a preguntar.
 */
export const getActividadesDeProforma = (proformaId: string): Promise<string[]> =>
  actividadesConectadas(COL.proforma.actividades, [proformaId])

/**
 * Los registros COMPLETOS (nombre, fecha, estado, resolución) de una lista de ids de actividad.
 * Reutiliza el mismo mapeo que `getActividadesSinAsignar`, para mostrarlas igual en cualquier lado.
 */
export async function getActividadesPorId(ids: readonly string[]): Promise<ActividadListada[]> {
  const limpios = [...new Set(ids)].filter((id) => id && Number.isFinite(Number(id)))
  if (!mondayHabilitado() || limpios.length === 0) return []
  const data = await mondayApi<{ items: MondayItemActividad[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        name
        column_values(ids: [${COLUMNAS_LISTADO}]) {
          id
          text
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }`,
    { ids: limpios },
  )
  return listarActividades(data.items)
}

/**
 * Las actividades COMPLETAS ya conectadas a uno o más presupuestos: lo mismo que
 * `getActividadesDePresupuestos`, pero con el registro entero (para mostrarlas en un resumen,
 * no sólo para escribir la relación).
 */
export const getActividadesHeredadasDePresupuestos = (
  presupuestoIds: readonly string[],
): Promise<ActividadListada[]> => getActividadesDePresupuestos(presupuestoIds).then(getActividadesPorId)

/** Igual que arriba, pero heredadas de una proforma (ver `getActividadesDeProforma`). */
export const getActividadesHeredadasDeProforma = (
  proformaId: string,
): Promise<ActividadListada[]> => getActividadesDeProforma(proformaId).then(getActividadesPorId)
