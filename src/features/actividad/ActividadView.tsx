import { useCallback, useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { faltantesActividad, hayProyectada } from '@/lib/actividad'
import { indiceDePaso, pasosDe, rotuloEtapaActividad } from '@/lib/pasos'
import {
  actividadesPendientesEnCache,
  completarActividades,
  filtrarPendientesDe,
  getActividadesPendientes,
  type PersonaActividad,
  registrarActividad,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { ActividadPendiente, ContactoElegido, TipoOperacionActividad } from '@/types'
import { ActividadRegistrada } from './ActividadRegistrada'
import { FormularioActividad } from './FormularioActividad'
import { TablaActividades } from './TablaActividades'

/** Qué explica el título de la etapa, según lo que se haya elegido hacer. */
const DESCRIPCION: Record<TipoOperacionActividad, string> = {
  'REGISTRAR NUEVA ACTIVIDAD':
    'Registra la actividad comercial, tipo, fecha, y estado de la actividad',
  'COMPLETAR ACTIVIDAD PENDIENTE':
    'Selecciona cuáles de las actividades pendientes pasan a Completado',
}

/**
 * Los contactos tildados, agrupados por la Persona de la que salieron.
 *
 * Es la forma en la que se asienta la gestión: un timeline item por Persona, cada uno con SUS
 * contactos (ver `registrarActividad`). El orden es el de tildado, y cada Persona aparece una vez.
 */
function personasConSusContactos(contactos: readonly ContactoElegido[]): PersonaActividad[] {
  const porPersona = new Map<string, PersonaActividad>()
  for (const c of contactos) {
    let persona = porPersona.get(c.personaId)
    if (!persona) {
      persona = { itemId: c.personaId, nombre: c.personaNombre, contactos: [] }
      porPersona.set(c.personaId, persona)
    }
    persona.contactos.push({ itemId: c.itemId, nombre: c.nombre })
  }
  return [...porPersona.values()]
}

/**
 * REGISTRO DE ACTIVIDADES · etapa 2, y cierre de la operación.
 *
 * La etapa hace DOS cosas distintas sobre el mismo tablero, y el "Tipo de Operación" que se
 * contestó en la etapa 1 (`SelectorTipoOperacion`) decide cuál:
 *   · REGISTRAR NUEVA ACTIVIDAD: el formulario de siempre (`FormularioActividad`, compartido con
 *     la etapa "Registrar Actividad" de la venta y el presupuesto). Se crea un ítem nuevo —dos, si
 *     se agenda la próxima— a nombre de las Personas y contactos elegidos en la etapa 1.
 *   · COMPLETAR ACTIVIDAD PENDIENTE: no se carga nada. Se listan las gestiones que esa misma gente
 *     ya tenía agendadas y se eligen cuáles pasan a "Completado".
 */
export function ActividadView() {
  const { operacion, tipoVenta, tipoEntrega, remito, actividad, vendedor } = useApp()
  const dispatch = useDispatch()
  // Qué falta para poder cerrar. Se arma al intentar finalizar, no mientras se completa.
  const [faltantes, setFaltantes] = useState<string[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* La operación salió, pero con una observación que hay que leer. No es un error —no se puede
     reintentar, ya está asentada—, así que cierra la operación igual al aceptarlo. */
  const [aviso, setAviso] = useState<string | null>(null)
  // La operación ya quedó asentada: se muestra el tilde y la app se reinicia sola.
  const [listo, setListo] = useState(false)
  /* Si ya se consultaron las pendientes en esta operación, la lista arranca puesta y el "cargando"
     ni se dibuja: el resultado estaba, y un spinner de un frame es un parpadeo gratis cada vez que
     se va y se vuelve con el stepper. */
  const cacheadas = actividadesPendientesEnCache()
  const [pendientes, setPendientes] = useState<ActividadPendiente[]>(cacheadas ?? [])
  const [cargandoPendientes, setCargandoPendientes] = useState(false)

  const completar = actividad.tipoOperacion === 'COMPLETAR ACTIVIDAD PENDIENTE'

  /* Las pendientes se traen recién al elegir esa opción: quien viene a cargar una actividad nueva
     no necesita la consulta. Está cacheada (`getActividadesPendientes`), así que ir y volver no le
     pega de nuevo a Monday; la caché se vacía al cambiar de operación. */
  useEffect(() => {
    if (!completar) return
    let vivo = true
    setCargandoPendientes(actividadesPendientesEnCache() === null)
    getActividadesPendientes()
      .then((as) => {
        if (!vivo) return
        setPendientes(as)
        setCargandoPendientes(false)
      })
      .catch(() => {
        if (!vivo) return
        setPendientes([])
        setCargandoPendientes(false)
        dispatch({ type: 'errorMonday', accion: 'traer las actividades pendientes' })
      })
    return () => {
      vivo = false
    }
  }, [completar, dispatch])

  const numero = indiceDePaso('actividad', operacion, tipoVenta, tipoEntrega, remito.tipoEmision)
  /* La operación ya se asentó (se creó la actividad, o se cerraron las pendientes): no se repite.
     Lo único que hace es APAGAR los controles —el botón de finalizar y el tipo de operación—; la
     etapa no suma ningún cartel al cerrarse. El cierre ya se cuenta con el tilde, que además
     reinicia la app, así que un aviso en la etapa sería un elemento que aparece para nadie. */
  const yaCerrada = actividad.actividadId !== null || actividad.completadas

  /* De qué gente son las pendientes que se ofrecen: las Personas y los contactos tildados en la
     etapa 1. Se recalcula en cada render a propósito —la lista tope es de 100 ítems—, así volver
     atrás a sumar un cliente se refleja acá sin volver a consultar el tablero. */
  const personaIds = [...new Set(actividad.contactos.map((c) => c.personaId))]
  const contactosIds = actividad.contactos.map((c) => c.itemId)
  const pendientesDeLaGente = filtrarPendientesDe(pendientes, personaIds, contactosIds)

  const finalizar = async () => {
    if (guardando || yaCerrada) return
    if (!actividad.tipoOperacion) {
      // Se señala el selector además de nombrarlo en la ventana.
      dispatch({ type: 'intentoAvanzar' })
      setFaltantes(['Tipo de Operación'])
      return
    }
    if (completar) return completarPendientes()
    return registrarNueva()
  }

  /** COMPLETAR ACTIVIDAD PENDIENTE: cerrar en el board las que se tildaron. */
  const completarPendientes = async () => {
    const ids = actividad.pendientes.map((a) => a.id)
    // Es el único dato obligatorio de esta rama: sin nada tildado no hay nada que cerrar.
    if (ids.length === 0) {
      setFaltantes(['Al menos una actividad pendiente para pasar a Completado'])
      return
    }
    setGuardando(true)
    setError(null)
    const fallidas = await completarActividades(ids)
    /* Las que sí salieron ya están cerradas en el tablero: la operación se da por hecha igual, o
       reintentar volvería a tocar las que anduvieron. El aviso dice cuántas quedaron afuera. */
    if (fallidas.length < ids.length) dispatch({ type: 'actividadesCompletadas' })
    setGuardando(false)
    if (fallidas.length > 0) {
      setError(
        `No se pudieron pasar a Completado ${fallidas.length} de ${ids.length} actividades. Revisá en el tablero cuáles quedaron pendientes.`,
      )
      dispatch({ type: 'errorMonday', accion: 'completar las actividades pendientes' })
      return
    }
    setListo(true)
  }

  /** REGISTRAR NUEVA ACTIVIDAD: crear el ítem (y el de la proyectada, si se agendó). */
  const registrarNueva = async () => {
    /* Se revisa TODO de nuevo, incluidos los contactos: a la etapa 1 se puede volver con el
       stepper y destildarlos, y desde acá esa actividad incompleta se estaría por escribir. */
    const faltan = [...faltantesActividad(actividad)]
    if (actividad.contactos.length === 0) faltan.unshift('Contactos con los que se hizo')
    if (faltan.length > 0) {
      setFaltantes(faltan)
      return
    }
    if (!actividad.tipo || !actividad.estado) return

    setGuardando(true)
    setError(null)
    try {
      const creada = await registrarActividad(
        {
          tipo: actividad.tipo,
          fecha: actividad.fecha,
          hora: actividad.hora,
          estado: actividad.estado,
          resolucion: actividad.resolucion,
          personas: personasConSusContactos(actividad.contactos),
          vendedorId: vendedor?.id ?? null,
        },
        hayProyectada(actividad) ? actividad.proyectada : null,
      )
      dispatch({
        type: 'actividadRegistrada',
        actividadId: creada.actividadId,
        proyectadaId: creada.proyectadaId,
      })
      setGuardando(false)
      /* La gestión quedó asentada igual —el timeline item existe—, pero algún ítem del tablero no
         llegó a completarse. Se dice, en vez de mostrar el tilde como si todo hubiera salido: lo
         que falta ahí (estado, resolución, contactos) hay que terminarlo a mano. */
      if (creada.sinCompletar > 0) {
        setAviso(
          `La actividad quedó cargada en la ficha de la Persona, pero ${creada.sinCompletar} ${
            creada.sinCompletar === 1 ? 'asiento del tablero quedó' : 'asientos del tablero quedaron'
          } sin el estado, la resolución ni los contactos: Monday todavía no los había sincronizado. Completalos desde el tablero.`,
        )
        return
      }
      setListo(true)
    } catch {
      setGuardando(false)
      setError(
        'No se pudo registrar la actividad. Revisá en el tablero si quedó algo creado antes de reintentar.',
      )
      dispatch({ type: 'errorMonday', accion: 'registrar la actividad' })
    }
  }

  /* Qué se está escribiendo, dicho como lo contestó el usuario. */
  const detalleGuardado = completar
    ? 'Pasando a Completado las actividades seleccionadas'
    : actividad.estado === 'Completada'
      ? hayProyectada(actividad)
        ? 'Registrando la actividad como completada y creando la nueva actividad proyectada'
        : 'Registrando la actividad como completada'
      : 'Registrando la actividad como pendiente'

  /* Vuelve la app a su estado inicial. Va memoizado porque es lo que dispara el temporizador del
     aviso de cierre: recreado en cada render, el efecto se reiniciaría y el reloj no llegaría nunca. */
  const reiniciar = useCallback(() => dispatch({ type: 'reset' }), [dispatch])

  if (!vendedor) return null

  return (
    <section className="view actividad-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(
          operacion,
          tipoVenta,
          tipoEntrega,
          remito.tipoEmision,
          null,
          actividad.tipoOperacion,
        )}
        actual={numero}
      />

      <div className="paso-body">
        <PasoTitulo
          numero={numero + 1}
          titulo={rotuloEtapaActividad(actividad.tipoOperacion)}
          descripcion={
            actividad.tipoOperacion
              ? DESCRIPCION[actividad.tipoOperacion]
              : 'Volvé a la etapa anterior y elegí el tipo de operación'
          }
        />

        {/* Una rama o la otra; sin elegir todavía no se despliega ninguna. */}
        {actividad.tipoOperacion === 'REGISTRAR NUEVA ACTIVIDAD' && <FormularioActividad />}

        {completar && (
          <TablaActividades
            actividades={pendientesDeLaGente}
            elegidas={actividad.pendientes.map((a) => a.id)}
            cargando={cargandoPendientes}
            onToggle={(act) => dispatch({ type: 'togglePendienteActividad', actividad: act })}
            titulo="Actividades pendientes"
            buscando="Buscando las actividades pendientes de la Persona seleccionada"
            vacio={
              <>
                <i className="fas fa-calendar-xmark" /> La gente seleccionada no tiene actividades
                pendientes en el tablero. Volvé a la etapa anterior para sumar otra Persona, o
                registrá una actividad nueva.
              </>
            }
            requerida
            avisoRequerida="Tildá al menos una actividad para pasarla a Completado"
          />
        )}

        <div className="actions-footer actions-footer--dos">
          <button
            type="button"
            className="btn-volver"
            onClick={() => dispatch({ type: 'goto', paso: 'actividad-persona' })}
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>

          <div className="act-cierre">
            {/* El botón queda activo aunque falte algo: al intentarlo, la ventana dice qué. Sólo
                lo apaga la operación YA asentada, que es irreversible. */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={guardando || yaCerrada}
              onClick={finalizar}
            >
              <i className="fas fa-flag-checkered" /> Finalizar Operación
            </button>
          </div>
        </div>
      </div>

      {guardando && (
        <ModalCargando
          titulo={completar ? 'Completando las actividades' : 'Registrando la actividad'}
          detalle={detalleGuardado}
        />
      )}

      {faltantes && (
        <AvisoModal
          titulo="Faltan datos para cerrar la operación"
          faltantes={faltantes}
          onClose={() => setFaltantes(null)}
        >
          No se puede finalizar hasta completar esto:
        </AvisoModal>
      )}

      {error && (
        <AvisoModal titulo="No se pudo cerrar la operación" onClose={() => setError(null)}>
          {error}
        </AvisoModal>
      )}

      {/* Salió, pero con algo que contar. Al aceptar se cierra la operación igual: lo que quedó
          pendiente es trabajo en el tablero, no acá. */}
      {aviso && (
        <AvisoModal titulo="Actividad registrada, con una observación" onClose={reiniciar}>
          {aviso}
        </AvisoModal>
      )}

      {/* Cierre de la operación: el tilde, y la app vuelve sola a su estado inicial. */}
      {listo && (
        <ActividadRegistrada
          onFin={reiniciar}
          texto={
            completar
              ? `${actividad.pendientes.length === 1 ? 'Actividad completada' : 'Actividades completadas'}`
              : 'Actividad registrada'
          }
        />
      )}
    </section>
  )
}
