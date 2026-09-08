/**
 * Reglas de REGISTRO DE ACTIVIDADES. Son puras (sin React ni red): cada vista decide cómo mostrarlas.
 *
 * Las dos reglas de fecha viven acá y no en el `input[type=date]` porque el `min` del navegador
 * frena el calendario pero NO lo que se tipea a mano: la fecha inválida entra igual, y sin este
 * control se asentaría en Monday una actividad "futura" que ya pasó.
 */
import { parseDate } from '@/lib/dates'
import type { ActividadListada, ActividadProyectada, ActividadState } from '@/types'

/** Texto vacío o sólo espacios cuenta como dato ausente. */
const vacio = (v: string | null | undefined) => !v || !v.trim()

/**
 * La fecha, a medianoche. Comparar Date contra Date sin normalizar la hora hace que "hoy" sea
 * mayor o menor que sí mismo según a qué hora se opere, que es justo lo que estas reglas no
 * pueden permitirse.
 */
const aMedianoche = (fecha: string): Date | null => {
  const d = parseDate(fecha)
  if (!d) return null
  d.setHours(0, 0, 0, 0)
  return d
}

/** Hoy a medianoche: el piso contra el que se miden la actividad proyectada y su alarma. */
export const hoyMedianoche = (): Date => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Por qué la fecha de la actividad PROYECTADA no sirve. Tiene que ser posterior a hoy: se está
 * agendando algo que todavía no pasó, y "hoy" tampoco vale —lo que se hace hoy se carga como la
 * actividad de hoy, no como una futura—. Vacía no es un error de fecha sino un dato faltante
 * (ver `faltantesActividad`), así que no devuelve nada.
 */
export function errorFechaProyectada(fecha: string): string | null {
  if (vacio(fecha)) return null
  const d = aMedianoche(fecha)
  if (!d) return 'La fecha no es válida.'
  return d.getTime() > hoyMedianoche().getTime()
    ? null
    : 'La actividad proyectada es futura: la fecha tiene que ser posterior a hoy.'
}

/** Datos sin los que la actividad PROYECTADA no se puede crear. Rotulados como se leen en pantalla. */
export function faltantesProyectada(p: ActividadProyectada): string[] {
  const faltan: string[] = []
  if (!p.tipo) faltan.push('Tipo de la actividad proyectada')
  if (vacio(p.fecha)) faltan.push('Fecha de la actividad proyectada')
  if (vacio(p.hora)) faltan.push('Hora de la actividad proyectada')
  return faltan
}

/**
 * Todo lo que falta para poder asentar la operación: los datos de la actividad, los de la
 * proyectada cuando se pidió cargarla, y los errores de fecha. Se junta TODO en una sola lista
 * —no se corta en el primer faltante— para que el aviso diga de una vez qué hay que completar.
 *
 * La Persona NO entra acá: se elige en la etapa siguiente y esa etapa la reclama por su cuenta.
 */
export function faltantesActividad(a: ActividadState): string[] {
  const faltan: string[] = []
  if (!a.tipo) faltan.push('Tipo de actividad')
  if (vacio(a.fecha)) faltan.push('Fecha de la actividad')
  /* La hora se reclama igual que la fecha: el widget de la Persona asienta la gestión en un
     momento del día, no en un día suelto, y sin hora todas caerían a la misma. */
  if (vacio(a.hora)) faltan.push('Hora de la actividad')
  if (!a.estado) faltan.push('¿Es una actividad pendiente o completada?')
  /* La resolución NO se reclama, ni siquiera con la actividad completada: hay gestiones que se
     cierran sin nada que aclarar, y obligar a escribir algo sólo produce texto de relleno. */

  if (a.estado === 'Completada' && a.cargarFutura) {
    faltan.push(...faltantesProyectada(a.proyectada))
    const errFecha = errorFechaProyectada(a.proyectada.fecha)
    if (errFecha) faltan.push(errFecha)
  }
  return faltan
}

/** La etapa 1 está completa: se puede pasar a elegir la Persona. */
export const actividadCompleta = (a: ActividadState): boolean => faltantesActividad(a).length === 0

/**
 * Se va a crear una SEGUNDA actividad (la proyectada). Es la condición de las dos: que la
 * actividad se haya completado y que se haya pedido agendar la próxima.
 */
export const hayProyectada = (a: ActividadState): boolean =>
  a.estado === 'Completada' && a.cargarFutura

/**
 * Cómo se ROTULA una actividad en una lista: el tipo y, si tiene, el primer contacto.
 *
 * El nombre del ítem lleva además la fecha y la Persona ("Visita al Campo - 07/09/2026 - 7001 - La
 * Batea S.A TEST - Juan Pérez"): en una celda de tabla no se lee, y las tres primeras partes ya
 * están en sus propias columnas. Lo que no está en ninguna otra es CON QUIÉN se hizo, así que el
 * rótulo se queda con eso.
 *
 * Del resto de los contactos se muestra sólo el "+": la lista completa va en el `title`, así que
 * pasar el mouse alcanza para verlos sin abrir nada.
 */
export function etiquetaActividad(a: ActividadListada): ResumenActividades {
  // Sin tipo cargado se cae al nombre del ítem: mostrar una celda vacía sería peor.
  const tipo = a.tipo.trim() || a.nombre.trim()
  const contactos = a.contactos.map((c) => c.trim()).filter(Boolean)
  return {
    visible: contactos.length > 0 ? `${tipo} - ${contactos[0]}` : tipo,
    ocultas: Math.max(contactos.length - 1, 0),
    titulo: contactos.length > 0 ? contactos.join('\n') : a.nombre,
  }
}

/* ===== Las actividades asociadas al documento ===== */

/** Cómo se muestran las actividades elegidas en el resumen del presupuesto o de la venta. */
export interface ResumenActividades {
  /** El nombre que se lee: el de la primera. '' cuando no hay ninguna. */
  visible: string
  /** Cuántas quedaron escondidas detrás del "+". 0 = se ven todas (o sea, hay una sola). */
  ocultas: number
  /** Todos los nombres, uno por renglón: es lo que aparece al pasar el mouse. */
  titulo: string
}

/**
 * El resumen del documento tiene UN renglón para las actividades, y los nombres son largos: entran
 * de a uno. Se muestra el primero y el resto se pliega detrás de un "+", con la lista completa en
 * el `title` para poder leerla sin salir de la pantalla.
 *
 * El "+" va sin número cuando esconde una sola —"Llamada con Simón, +"— y con la cantidad cuando
 * esconde varias, que si no no se sabe si falta una o cinco.
 */
export function resumenActividades(actividades: readonly ActividadListada[]): ResumenActividades {
  return condensarNombres(actividades.map((a) => a.nombre))
}

/**
 * Una lista de nombres que no entra en un renglón: se muestran los primeros y el resto queda
 * detrás de un "+", con la lista completa en el `title`.
 *
 * `visibles` decide cuántos se leen. Es 1 donde el renglón es angosto —la clave "Actividades" de
 * un resumen— y 2 en una celda de tabla, que tiene más aire. El "+" va SIN número cuando esconde
 * uno solo ("Juan, Ana, +") y con la cantidad cuando esconde varios ("Juan, Ana, +3"): con un solo
 * escondido el número no agrega nada, y con varios sí, porque si no no se sabe si falta uno o cinco.
 */
export function condensarNombres(
  nombres: readonly string[],
  visibles = 1,
): ResumenActividades {
  const limpios = nombres.map((n) => n.trim()).filter(Boolean)
  return {
    visible: limpios.slice(0, visibles).join(', '),
    ocultas: Math.max(limpios.length - visibles, 0),
    titulo: limpios.join('\n'),
  }
}

