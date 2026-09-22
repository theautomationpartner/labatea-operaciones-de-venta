import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { buscarEnPadron, type EntradaPadron } from '@/lib/busquedaClientes'
import { buscarClientes, getPadron, recordarClientes, refrescarCliente } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

/** Estado de la búsqueda del cliente, compartido con la vista para renderizar el resultado. */
export type BusquedaEstado = 'idle' | 'buscando' | 'no-encontrado' | 'error'

interface BuscarClienteProps {
  estado: BusquedaEstado
  onEstado: (estado: BusquedaEstado) => void
}

/**
 * Búsqueda del cliente, en dos velocidades.
 *
 * 1. **Mientras se escribe**, sobre el padrón cacheado en el servidor por el Cron Job y bajado una
 *    vez por sesión (`services/monday/padronPersonas.ts`). No sale un solo pedido de red: los 2681
 *    clientes se recorren en ~1 ms, así que la lista se rearma en cada tecla y el que más matchea
 *    encabeza (ver `lib/busquedaClientes.ts`).
 * 2. **El botón Buscar** sigue consultando Monday directo. Es la salida para el cliente que todavía
 *    no está cacheado —uno dado de alta hace dos minutos— y para cuando el padrón no se pudo bajar.
 *
 * Al ELEGIR un cliente se lo relee de Monday antes de cargarlo. El padrón tiene hasta 5 minutos de
 * antigüedad y de ese objeto salen el crédito disponible y la situación del cliente, que es con lo
 * que se decide si una venta puede seguir: eso no se sirve de un caché.
 *
 * ── Teclado ──
 * Las flechas recorren los resultados y Enter carga el resaltado; la primera fila —la que más
 * matchea— arranca marcada, así que Enter siempre confirma algo que se está viendo. Enter sale a
 * Monday SÓLO cuando no hay ningún resultado para lo escrito: con la lista a la vista, nunca toca
 * la red. No hay ningún cartel que lo explique, a propósito: es el gesto que todo el mundo prueba
 * primero en un buscador con lista.
 */
export function BuscarCliente({ estado, onEstado }: BuscarClienteProps) {
  const dispatch = useDispatch()
  // El campo arranca (y queda) vacío: no muestra el cliente elegido, para encadenar búsquedas.
  const [termino, setTermino] = useState('')
  const [errorInput, setErrorInput] = useState('')
  /* Resultados de la consulta DIRECTA a Monday (botón Buscar). `null` = no se consultó, y entonces
     manda el live search. Distinguir "no busqué" de "busqué y no hay" es lo que evita que la lista
     local tape un "no encontrado" que el usuario acaba de pedir. */
  const [remotos, setRemotos] = useState<Cliente[] | null>(null)
  const [padron, setPadron] = useState<readonly EntradaPadron[]>([])
  const [abierto, setAbierto] = useState(false)
  /**
   * Fila resaltada, la que carga el Enter. Arranca en 0: con la lista ordenada por cuánto matchea,
   * la primera es la mejor coincidencia, y dejarla resaltada hace que Enter cargue SIEMPRE algo que
   * se está viendo marcado. Sin eso, "Enter confirma un cliente" sería confirmar a ciegas.
   */
  const [activo, setActivo] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  /**
   * El resaltado se está moviendo con el teclado. Mientras sea `true`, el mouse quieto no roba el
   * resaltado por el solo hecho de que la lista scrollee debajo de él.
   */
  const conTeclado = useRef(false)
  useClickOutside(ref, useCallback(() => setAbierto(false), []), abierto)
  const buscando = estado === 'buscando'

  /* El padrón se pide al montar el paso. Si falla, queda vacío y el componente sigue funcionando
     con el botón Buscar: la pantalla no depende del caché para servir. */
  useEffect(() => {
    let vivo = true
    void getPadron().then((p) => {
      if (vivo) setPadron(p.entradas)
    })
    return () => {
      vivo = false
    }
  }, [])

  /* La búsqueda local. `useMemo` y no estado: es una función del término y del padrón, y guardarla
     en estado sólo abriría la puerta a que queden desincronizados. */
  const locales = useMemo(() => buscarEnPadron(padron, termino), [padron, termino])

  /* Lo que se muestra: lo que trajo Monday si se apretó Buscar, el live search si no. */
  const resultados = remotos ?? locales.clientes
  const desplegado = abierto && resultados.length > 0

  /* Acotado al render y no guardado así en el estado: la lista cambia con cada tecla y el índice
     guardado puede quedar apuntando más allá del final por un instante. Acotarlo acá evita que ese
     instante exista. */
  const indiceActivo = resultados.length > 0 ? Math.min(activo, resultados.length - 1) : -1
  const marcado = desplegado && indiceActivo >= 0 ? resultados[indiceActivo] : null

  /* Cambió lo que se está mostrando: el resaltado vuelve a la mejor coincidencia. Sin esto, tipear
     una letra más dejaría marcada la fila número 5 de una lista que ya es otra. */
  useEffect(() => {
    setActivo(0)
  }, [termino, remotos])

  /**
   * El resaltado tiene que verse: se desplaza la lista lo mínimo para dejarlo dentro.
   *
   * A mano y NO con `scrollIntoView`. Ese método desplaza todos los ancestros scrolleables hasta
   * dejar el elemento a la vista —incluida la ventana—, así que la página entera se movería debajo
   * del usuario en cada flecha aunque la fila ya estuviera visible. Acá se toca un solo
   * `scrollTop`: el del desplegable. Es el mismo problema que ya se pagó en el buscador de
   * productos (ver `test:buscador-teclado`).
   */
  useEffect(() => {
    if (!desplegado || indiceActivo < 0) return
    const cont = listaRef.current
    const fila = cont?.children[indiceActivo] as HTMLElement | undefined
    if (!cont || !fila) return
    /* Por rectángulos y no por `offsetTop`, que se mide contra el ancestro posicionado más cercano
       y se rompería en silencio si el CSS cambiara un `position`. */
    const caja = cont.getBoundingClientRect()
    const f = fila.getBoundingClientRect()
    if (f.top < caja.top) cont.scrollTop -= caja.top - f.top
    else if (f.bottom > caja.bottom) cont.scrollTop += f.bottom - caja.bottom
  }, [desplegado, indiceActivo])

  const limpiar = () => {
    setTermino('')
    setRemotos(null)
    setAbierto(false)
    setActivo(0)
  }

  /**
   * Carga el cliente elegido, con los datos frescos.
   *
   * La relectura NO es opcional y su fallo NO cae al dato cacheado: de acá sale el crédito
   * disponible, y operar sobre un saldo que no se pudo confirmar es exactamente lo que no se
   * puede hacer. Se avisa con la ventana de siempre y no se carga nada, igual que cuando falla
   * una búsqueda.
   */
  const elegir = async (c: Cliente) => {
    setAbierto(false)
    onEstado('buscando')
    try {
      const fresco = await refrescarCliente(c.id)
      if (!fresco) {
        /* Estaba en el padrón pero ya no está en Monday: lo borraron entre la última corrida del
           cron y ahora. Se trata como no encontrado, que es lo que es. */
        onEstado('no-encontrado')
        return
      }
      limpiar()
      dispatch({ type: 'setCliente', cliente: fresco })
      onEstado('idle')
    } catch {
      onEstado('error')
      dispatch({ type: 'errorMonday', accion: 'leer los datos del cliente' })
    }
  }

  /** El botón Buscar: consulta directa a Monday, para el cliente que el padrón no tiene. */
  const buscar = async () => {
    const t = termino.trim()
    if (!t) {
      setErrorInput('Ingresá un nombre, código de cliente o CUIT.')
      return
    }
    setErrorInput('')
    setAbierto(false)
    onEstado('buscando')
    try {
      const { personas: encontrados, truncado: hayMas } = await buscarClientes(t)
      setRemotos(encontrados)
      /* Lo que trajo Monday se suma al padrón de la sesión: sería absurdo encontrarlo por acá y
         que el live search siguiera sin conocerlo dos segundos después. */
      recordarClientes(encontrados)
      if (encontrados.length === 0) {
        onEstado('no-encontrado')
        return
      }
      /* Una sola coincidencia: se carga directo. Varias: se muestran para elegir.
         Con la lista truncada NO se auto-carga aunque haya venido una sola: puede no ser la que el
         usuario busca, y elegirla por él sería decidir con información incompleta. */
      if (encontrados.length === 1 && !hayMas) {
        await elegir(encontrados[0])
        return
      }
      setAbierto(true)
      onEstado('idle')
    } catch {
      /* El fallo de la API lo comunica la ventana global (`ModalErrorMonday`); el estado 'error'
         sólo sirve para que la vista no muestre la ficha como si hubiera resultado. */
      onEstado('error')
      dispatch({ type: 'errorMonday', accion: 'buscar el cliente' })
    }
  }

  /**
   * Teclado del buscador: flechas para recorrer los resultados, Enter para confirmar.
   *
   * Enter carga el cliente resaltado. Sólo dispara la consulta a Monday cuando NO hay ningún
   * resultado para lo escrito, que es exactamente el caso en que hace falta: el padrón no lo tiene
   * y puede ser un cliente dado de alta después de la última corrida del cron. Con resultados a la
   * vista, Enter nunca sale a la red.
   *
   * Cuelga del CONTENEDOR y no del `<input>`, y no es un detalle de estilo: apretar Buscar con el
   * mouse deja el foco en el BOTÓN, y desde ahí un manejador puesto en el input no se entera de
   * nada —las flechas scrollean la página y Enter vuelve a disparar el botón—. Es el bug que ya se
   * pagó en el buscador de productos.
   */
  const alPresionarTecla = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (buscando) return
    const navegar = (delta: number) => {
      if (resultados.length === 0) return
      // Sin esto el cursor salta al principio o al final del texto, y la página scrollea.
      e.preventDefault()
      conTeclado.current = true
      if (!abierto) {
        // La lista estaba replegada: la primera flecha la vuelve a abrir en vez de mover algo
        // que no se ve.
        setAbierto(true)
        return
      }
      setActivo((i) => Math.min(resultados.length - 1, Math.max(0, i + delta)))
    }
    switch (e.key) {
      case 'ArrowDown':
        return navegar(1)
      case 'ArrowUp':
        return navegar(-1)
      case 'Escape':
        if (abierto) {
          e.preventDefault()
          setAbierto(false)
        }
        return
      case 'Enter':
        e.preventDefault()
        if (marcado) void elegir(marcado)
        else void buscar()
        return
      default:
        return
    }
  }

  return (
    /* El envoltorio existe SÓLO para que el teclado llegue desde cualquier punto del buscador: el
       campo y el botón Buscar son hermanos, así que sin un padre común las teclas apretadas con el
       foco en el botón no llegarían al manejador. Va con `display: contents`, así que no existe
       para el layout —los dos siguen siendo los ítems flex de `.unified-toolbar`, con su
       `flex-grow` y su `gap` intactos— pero sí para los eventos. */
    <div className="search-teclado" onKeyDown={alPresionarTecla}>
      <div className="search-container" ref={ref}>
        {/* El desplegable de resultados cuelga de ACÁ, no del contenedor: así su `top: 100%` cae
            justo en el borde de abajo del campo. Colgado del contenedor se le sumaba todo lo que
            viene después del input —el gap y el renglón del aviso—, y la lista quedaba flotando
            separada del buscador. El anclaje mide exactamente lo que mide el campo. */}
        <div className="search-anclaje">
        {/* Con la lista abierta el campo se cuadra abajo, así el borde entre los dos deja de
            leerse como el corte entre dos cajas y pasan a ser un solo panel. */}
        <div className={`search-wrapper ${desplegado ? 'search-wrapper--abierto' : ''}`}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Buscar cliente por código, nombre o CUIT..."
            autoComplete="off"
            value={termino}
            disabled={buscando}
            onChange={(e) => {
              setTermino(e.target.value)
              if (errorInput) setErrorInput('')
              /* Editar descarta el resultado de la consulta directa: lo que se ve vuelve a ser el
                 live search sobre lo nuevo que se está escribiendo. */
              setRemotos(null)
              setAbierto(true)
              // Editar la búsqueda limpia el resultado anterior (aviso / error).
              if (estado !== 'idle') onEstado('idle')
            }}
            onFocus={() => setAbierto(true)}
            role="combobox"
            aria-expanded={desplegado}
            aria-controls="clientes-listbox"
            aria-activedescendant={marcado ? `cliente-op-${indiceActivo}` : undefined}
          />
        </div>

        {/* Los resultados: los del padrón mientras se escribe, los de Monday si se apretó Buscar. */}
        {desplegado && (
          <div
            className="results"
            role="listbox"
            id="clientes-listbox"
            aria-label="Resultados de clientes"
            ref={listaRef}
            /* El mouse recupera el mando recién cuando se mueve de verdad, no cuando la lista le
               pasa por debajo al scrollear con el teclado. */
            onMouseMove={() => {
              conTeclado.current = false
            }}
          >
            {resultados.map((c, i) => (
              <div
                className={`ritem ${i === indiceActivo ? 'ritem--activo' : ''}`}
                key={c.id}
                id={`cliente-op-${i}`}
                role="option"
                aria-selected={i === indiceActivo}
                onClick={() => void elegir(c)}
                /* El mousedown por defecto le saca el foco al campo y se lo da a la fila, y desde
                   ahí las flechas vuelven a scrollear la página. Cancelarlo deja el foco donde
                   estaba: se puede señalar con el mouse y seguir con el teclado. */
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  if (!conTeclado.current) setActivo(i)
                }}
              >
                <span className="ritem-name">{c.name}</span>
                <span className="ritem-code">{c.codigo}</span>
              </div>
            ))}
          </div>
        )}
        </div>

        {/* Debajo del campo ya NO va la ayuda de siempre ("Buscar por razón social…"): el
            placeholder del input dice lo mismo. Queda sólo el error de "buscaste sin escribir
            nada", que aparece y desaparece —y por eso el renglón se monta igual cuando está
            vacío, con el alto reservado por CSS, para que el buscador no pegue un salto—.
            Siempre presente, además, puede ser una región viva de verdad. */}
        <span
          className={`search-helper ${errorInput ? 'search-helper--error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {errorInput}
        </span>
      </div>

      {/* El botón dejó de ser el único camino: ahora es el escape para el cliente que el padrón
          todavía no tiene. El título lo explica sin ocupar lugar en pantalla. */}
      <button
        type="button"
        className="btn-buscar"
        onClick={buscar}
        disabled={buscando}
        title="Buscar este cliente directamente en Monday, por si todavía no está en la lista"
      >
        {buscando ? (
          <>
            <i className="fas fa-spinner fa-spin" /> Buscando...
          </>
        ) : (
          <>
            <i className="fas fa-search" /> Buscar
          </>
        )}
      </button>
    </div>
  )
}
