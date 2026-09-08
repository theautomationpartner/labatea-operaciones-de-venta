import { useEffect, useState, type ReactNode } from 'react'
import { errorFechaProyectada, hoyMedianoche } from '@/lib/actividad'
import { aIso, formatDate } from '@/lib/dates'
import { useApp, useDispatch } from '@/state/hooks'
import type { ActividadProyectada, EstadoActividad, TipoActividad } from '@/types'
import { CamposActividad, Req } from './CamposActividad'

/** Las dos respuestas a la pregunta, con el color con el que se leen en el board. */
const ESTADOS: { valor: EstadoActividad; icono: string }[] = [
  { valor: 'Pendiente', icono: 'fa-hourglass-half' },
  { valor: 'Completada', icono: 'fa-circle-check' },
]

/**
 * Cuánto dura el plegado, en milisegundos. Tiene que coincidir con la animación `act-plegar` de
 * `actividad.css`: es el reloj de respaldo por si el navegador no dispara `animationend`.
 */
const SALIDA_MS = 260

/** Lo que muestra el bloque de la actividad completada. Congelado, es la copia que se está plegando. */
interface DatosCompletada {
  resolucion: string
  cargarFutura: boolean
  proyectada: ActividadProyectada
}

/**
 * Envuelve un bloque que aparece y se pliega con animación.
 *
 * Plegándose, el bloque sigue MONTADO hasta que la animación termina: sin eso, el contenido
 * desaparecía de golpe en el mismo cuadro en que se contestaba la pregunta. Quien lo usa lo
 * desmonta recién en `onFin`.
 */
function Plegable({
  saliendo,
  onFin,
  className = '',
  children,
}: {
  saliendo: boolean
  onFin?: () => void
  className?: string
  children: ReactNode
}) {
  /* Red de seguridad: con la pestaña en segundo plano o las animaciones desactivadas por el
     sistema, `animationend` puede no llegar nunca, y el bloque quedaría montado para siempre. */
  useEffect(() => {
    if (!saliendo || !onFin) return
    const t = setTimeout(onFin, SALIDA_MS + 120)
    return () => clearTimeout(t)
  }, [saliendo, onFin])

  return (
    <div
      className={`act-extra ${saliendo ? 'act-extra--saliendo' : ''} ${className}`.trim()}
      aria-hidden={saliendo || undefined}
      /* Sólo la animación de ESTE bloque lo desmonta: `animationend` burbujea, y la del bloque de
         la actividad proyectada —que está adentro— cerraría al padre antes de tiempo. */
      onAnimationEnd={(e) => {
        if (saliendo && e.target === e.currentTarget) onFin?.()
      }}
    >
      {children}
    </div>
  )
}

/** El bloque de la actividad proyectada: los campos de la próxima gestión y su notificación. */
function BloqueProyectada({
  datos,
  congelado,
  onFin,
  onCampo,
}: {
  datos: ActividadProyectada
  /** Es una copia que se está plegando: se dibuja igual, pero ya no se edita. */
  congelado: boolean
  onFin?: () => void
  onCampo: (patch: Partial<ActividadProyectada>) => void
}) {
  const errFecha = errorFechaProyectada(datos.fecha)
  /* Piso del calendario de la futura: mañana. Hoy no vale —lo que se hace hoy es la actividad de
     hoy, no una futura—. */
  const manana = new Date(hoyMedianoche())
  manana.setDate(manana.getDate() + 1)
  const minProyectada = aIso(formatDate(manana))
  // La copia que se pliega usa otros `id`: dos campos con el mismo id no pueden convivir en el DOM.
  const pre = congelado ? 'actp-out' : 'actp'

  return (
    <Plegable saliendo={congelado} onFin={onFin} className="act-proyectada">
      <div className="act-proyectada-head">
        <h4 className="act-proyectada-title">
          <i className="fas fa-calendar-plus" /> Actividad proyectada
        </h4>
        <span className="act-proyectada-hint">
          Es una actividad futura: la fecha tiene que ser posterior a hoy.
        </span>
      </div>

      {/* Los MISMOS tres campos que la actividad que se está cargando: tipo, fecha y resolución. */}
      <CamposActividad
        idPrefijo={pre}
        tipo={datos.tipo}
        fecha={datos.fecha}
        hora={datos.hora}
        resolucion={datos.resolucion}
        onTipo={(tipo: TipoActividad) => onCampo({ tipo })}
        onFecha={(fecha) => onCampo({ fecha })}
        onHora={(hora) => onCampo({ hora })}
        onResolucion={(resolucion) => onCampo({ resolucion })}
        fechaMin={minProyectada}
        errorFecha={errFecha}
      />
    </Plegable>
  )
}

/**
 * Lo que sólo tiene sentido con la actividad ya hecha: agendar la próxima. La resolución ya no vive
 * acá —es un campo más de la actividad, se pida o no— sino en `CamposActividad`.
 */
function BloqueCompletada({
  datos,
  congelado = false,
  onFin,
  proyectadaSaliente = null,
  onFinProyectada,
  onFutura,
  onProyectada,
}: {
  datos: DatosCompletada
  /** Es la copia que se está plegando: se dibuja igual, pero ya no se edita. */
  congelado?: boolean
  onFin?: () => void
  /** La actividad proyectada que se pliega DENTRO de un bloque que sigue vivo. */
  proyectadaSaliente?: ActividadProyectada | null
  onFinProyectada?: () => void
  onFutura?: (v: boolean) => void
  onProyectada?: (patch: Partial<ActividadProyectada>) => void
}) {
  return (
    <Plegable saliendo={congelado} onFin={onFin}>
      {/* El interruptor de la próxima gestión. Apagado por defecto: agendar es una decisión, y
          cerrar una actividad no obliga a abrir otra. */}
      <div className="act-sw-fila">
        <label className="act-sw">
          <input
            type="checkbox"
            className="act-sw-input"
            checked={datos.cargarFutura}
            onChange={(e) => onFutura?.(e.target.checked)}
          />
          <span className="act-sw-pista" aria-hidden="true">
            <span className="act-sw-bolita" />
          </span>
          <span className="act-sw-txt">
            <span className="act-sw-nom">¿Desea cargar futura actividad?</span>
            <span className="act-sw-ayuda">
              Agenda una próxima actividad para resolver la resolución de esta actividad. Se creará
              como una actividad aparte, con estado Pendiente.
            </span>
          </span>
        </label>
      </div>

      {/* La proyectada viva; o, si se acaba de apagar el interruptor, su copia plegándose. */}
      {datos.cargarFutura ? (
        <BloqueProyectada
          datos={datos.proyectada}
          congelado={congelado}
          onCampo={(patch) => onProyectada?.(patch)}
        />
      ) : (
        proyectadaSaliente && (
          <BloqueProyectada
            datos={proyectadaSaliente}
            congelado
            onFin={onFinProyectada}
            onCampo={() => {}}
          />
        )
      )}
    </Plegable>
  )
}

/**
 * El formulario de la actividad: qué se hizo, de qué tipo, cuándo, y si quedó pendiente o
 * completada (con su resolución y, si se pide, la próxima gestión).
 *
 * Lo comparten las DOS etapas que registran una actividad —la operación REGISTRO DE ACTIVIDADES y
 * la etapa "Registrar Actividad" de la venta y el presupuesto—, porque es exactamente el mismo
 * asiento. Lo que cambia en cada una es el marco: el encabezado del paso y adónde lleva el botón.
 *
 * El formulario CRECE con las respuestas y se PLIEGA con la misma animación. Lo que se pliega se
 * borra del estado (ver el reducer) —un dato escondido no puede terminar viajando a Monday sin que
 * nadie lo vea—, así que el bloque que se va se dibuja desde una COPIA congelada: de otro modo se
 * vaciaría a la vista antes de terminar de irse.
 */
export function FormularioActividad() {
  const { actividad } = useApp()
  const dispatch = useDispatch()
  /* Las copias de lo que se está plegando. `null` = no hay nada yéndose. */
  const [salienteCompletada, setSalienteCompletada] = useState<DatosCompletada | null>(null)
  const [salienteProyectada, setSalienteProyectada] = useState<ActividadProyectada | null>(null)

  const completada = actividad.estado === 'Completada'

  /**
   * Contesta la pregunta. Al volver a "Pendiente" se congela lo que estaba desplegado para que se
   * pliegue con su contenido a la vista; el estado, mientras tanto, ya lo borró.
   */
  const elegirEstado = (valor: EstadoActividad) => {
    if (valor === actividad.estado) return
    if (valor === 'Pendiente' && completada) {
      setSalienteCompletada({
        resolucion: actividad.resolucion,
        cargarFutura: actividad.cargarFutura,
        proyectada: actividad.proyectada,
      })
      // La proyectada se va DENTRO de la copia: una segunda copia suya sería la misma caja repetida.
      setSalienteProyectada(null)
    } else {
      setSalienteCompletada(null)
    }
    dispatch({ type: 'setActividad', patch: { estado: valor } })
  }

  /** Enciende o apaga la próxima gestión, con el mismo criterio de plegado. */
  const cambiarFutura = (encendido: boolean) => {
    setSalienteProyectada(!encendido && actividad.cargarFutura ? actividad.proyectada : null)
    dispatch({ type: 'setActividad', patch: { cargarFutura: encendido } })
  }

  return (
    <div className="act-panel">
      <div className="act-panel-head">
        <h3 className="act-panel-title">
          <i className="fas fa-clipboard-list" /> Datos de la actividad
        </h3>
      </div>

      <div className="act-panel-body">
        <CamposActividad
          idPrefijo="act"
          tipo={actividad.tipo}
          fecha={actividad.fecha}
          hora={actividad.hora}
          resolucion={actividad.resolucion}
          onTipo={(tipo) => dispatch({ type: 'setActividad', patch: { tipo } })}
          onFecha={(fecha) => dispatch({ type: 'setActividad', patch: { fecha } })}
          onHora={(hora) => dispatch({ type: 'setActividad', patch: { hora } })}
          onResolucion={(resolucion) => dispatch({ type: 'setActividad', patch: { resolucion } })}
        />

        {/* La pregunta que ramifica el formulario. Las dos opciones son excluyentes —de ahí los
            radios— pero se dibujan como casillas, que es como se pidió leerlas. */}
        <fieldset className="act-estado">
          <legend className="act-lbl act-lbl--legend">
            ¿Es una actividad pendiente o completada?
            <Req />
          </legend>
          <div className="act-estado-ops">
            {ESTADOS.map((op) => {
              const elegido = actividad.estado === op.valor
              return (
                <label
                  key={op.valor}
                  className={
                    'act-estado-op act-estado-op--' +
                    op.valor.toLowerCase() +
                    (elegido ? ' is-on' : '')
                  }
                >
                  <input
                    type="radio"
                    name="act-estado"
                    className="act-estado-input"
                    checked={elegido}
                    onChange={() => elegirEstado(op.valor)}
                  />
                  <span className="act-estado-box" aria-hidden="true">
                    <i className="fas fa-check" />
                  </span>
                  <span className="act-estado-nom">
                    <i className={`fas ${op.icono}`} /> {op.valor}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {/* COMPLETADA · el bloque vivo; o, si se acaba de volver a "Pendiente", su copia
            plegándose. Nunca los dos a la vez. */}
        {completada ? (
          <BloqueCompletada
            datos={{
              resolucion: actividad.resolucion,
              cargarFutura: actividad.cargarFutura,
              proyectada: actividad.proyectada,
            }}
            proyectadaSaliente={salienteProyectada}
            onFinProyectada={() => setSalienteProyectada(null)}
            onFutura={cambiarFutura}
            onProyectada={(patch) => dispatch({ type: 'setActividadProyectada', patch })}
          />
        ) : (
          salienteCompletada && (
            <BloqueCompletada
              datos={salienteCompletada}
              congelado
              onFin={() => setSalienteCompletada(null)}
            />
          )
        )}
      </div>
    </div>
  )
}
