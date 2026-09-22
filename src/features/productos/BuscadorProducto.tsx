import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PRODUCTOS_POR_PAGINA,
  buscarProductos,
  conStockFresco,
  getCatalogo,
  productoDesdeCache,
  siguientePaginaProductos,
  type Catalogo,
} from '@/services/monday'
import { buscarEnCatalogo } from '@/lib/busquedaProductos'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useApp, useDispatch } from '@/state/hooks'
import type { Filtro, ListaPrecio, Producto } from '@/types'
import {
  SIN_RESULTADOS,
  cerrado,
  replegado,
  conPaginaSiguiente,
  conPrimeraPagina,
  conResultadosLocales,
  cursorActual,
  enPagina,
  hayAnterior,
  haySiguiente,
  paginaActual,
  reabierto,
  sinMasPaginas,
  type ResultadosBusqueda,
} from './resultadosBusqueda'

/** Pista del campo cuando quedó una búsqueda guardada, replegada tras elegir un producto. */
const PISTA_RELISTAR = 'Hacé click para volver a ver los resultados de la última búsqueda.'

/**
 * Desde cuántas letras se busca en el catálogo mientras se escribe.
 *
 * Con una sola letra matchean cientos de productos y la lista no dice nada; desde dos, el orden por
 * puntaje ya empieza a poner arriba lo que se busca. Un código, en cambio, sirve desde el primer
 * dígito: son de uno a cuatro caracteres y el prefijo recorta muchísimo.
 */
const MINIMO_LIVE = 2

/** Lo escrito alcanza para buscar en el catálogo mientras se tipea. */
const sirveParaLive = (t: string): boolean => t.length >= MINIMO_LIVE || /^\d+$/.test(t)

/** Identifica una búsqueda, para saber si los resultados en pantalla siguen siendo los de lo escrito. */
const claveBusqueda = (termino: string, filtros: readonly Filtro[]): string =>
  `${termino}\u0000${filtros.map((f) => `${f.campo}:${f.valor}`).join('|')}`

interface BuscadorProductoProps {
  /** Lista de precio del cliente: define de qué columna sale el precio/rentabilidad. */
  lista: ListaPrecio
  /** true = precio con IVA (Consumidor Final/Monotributo); false = sin IVA (Resp. Inscripto). */
  conIva: boolean
  onSelect: (p: Producto) => void
  /**
   * Código del producto cargado AHORA en «Producto seleccionado». Es lo único que se marca en la
   * lista, y por eso lo aporta el padre: el buscador no puede saberlo —el producto se descarga al
   * agregarlo a la tabla, y ahí la marca tiene que irse—.
   *
   * Antes la marca salía de un Set que el propio buscador acumulaba, así que comparar tres
   * productos antes de decidirse dejaba a los tres en gris para siempre.
   */
  codigoCargado?: string
  /** `v2` = barra ancha del paso de productos; por defecto, el campo con rótulo de siempre. */
  variante?: 'clasico' | 'v2'
  /**
   * Recibe el aviso de búsqueda (sin resultados / error de red) para mostrarlo donde iría
   * el producto elegido, en vez de debajo del campo. Sólo lo usa la variante `v2`.
   */
  onAviso?: (aviso: string) => void
}

/**
 * Búsqueda de producto en dos velocidades.
 *
 * ── 1. Mientras se escribe: el catálogo cacheado ──
 * El Maestro de Productos entero vive en el navegador (lo mantiene un Vercel Cron Job; ver
 * `api/cron/productos.ts` y `services/monday/catalogoProductos.ts`). Cada tecla rearma la lista en
 * memoria, sin red y sin debounce, con el que más matchea primero. Es el reemplazo del ciclo
 * "escribo, aprieto Buscar, espero, me faltó una letra, vuelvo a empezar".
 *
 * ── 2. El botón Buscar: Monday, en vivo ──
 * Sigue existiendo y hace lo de siempre: consulta el tablero directamente. Es la salida para el
 * producto que se acaba de crear y que el cron todavía no levantó —como mucho, cinco minutos—, y
 * para confirmar contra la fuente cuando el live search no muestra lo que se espera.
 *
 * Las dos velocidades comparten el mismo desplegable paginado, a propósito: quien filtra por rubro
 * y recibe ochenta productos navega con las mismas flechas, venga eso del caché o de Monday.
 *
 * ── Lo que distingue a un resultado del caché: el stock ──
 * El caché NO guarda cantidades —se mueven con cada venta, y cachearlas sería mostrar un disponible
 * que ya se vendió—. Por eso, al elegir una fila que vino del caché, se lee el stock contra Monday
 * ANTES de entregar el producto: una consulta por selección, no una por tecla. Si esa lectura
 * falla, el producto NO se carga; mostrarlo con el stock en cero sería peor que no mostrarlo.
 *
 * Se elige un producto por vez: al hacer click la lista se repliega y el producto se carga en
 * «Producto seleccionado», donde se ajustan cantidad y descuento antes de agregarlo. Los resultados
 * NO se pierden: volver a hacer click en el buscador los relista donde estaban.
 */
export function BuscadorProducto({
  lista,
  conIva,
  onSelect,
  codigoCargado,
  variante = 'clasico',
  onAviso,
}: BuscadorProductoProps) {
  const { filtros } = useApp()
  const dispatch = useDispatch()
  const [termino, setTermino] = useState('')
  // Toda la búsqueda paginada vive en un solo estado, con transiciones puras (ver el módulo).
  const [resultados, setResultados] = useState<ResultadosBusqueda>(SIN_RESULTADOS)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  /** Código de la fila que está resolviendo su stock. Sólo puede haber una a la vez. */
  const [resolviendo, setResolviendo] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  /**
   * La búsqueda cuyos resultados vinieron de Monday. Mientras lo escrito coincida con esta clave,
   * el live search no pisa la lista: apretar Buscar tiene que poder ganarle al caché, o el
   * resultado que se fue a buscar a la fuente desaparecería en el mismo instante en que llega.
   */
  const directaRef = useRef<string | null>(null)
  const cerrar = useCallback(() => setResultados(cerrado), [])
  // Click afuera: una de las tres únicas formas de cerrar la lista.
  useClickOutside(ref, cerrar, resultados.abierto)

  /* El catálogo se pide una vez, al montar, y no bloquea nada: hasta que llegue, el buscador
     funciona como siempre (escribir + botón Buscar). */
  useEffect(() => {
    let vivo = true
    void getCatalogo().then((c) => {
      if (vivo) setCatalogo(c)
    })
    return () => {
      vivo = false
    }
  }, [])

  /**
   * Live search: rearma la lista con cada tecla, con cada filtro y con cada cambio de lista de
   * precio. Es puro cómputo en memoria —recorrer 1285 productos cuesta menos de 1 ms—, así que no
   * lleva debounce: el debounce sólo agregaría retardo sin ahorrar nada.
   */
  useEffect(() => {
    if (!catalogo) return
    const t = termino.trim()
    /* Los resultados que trajo el botón Buscar mandan hasta que se toque algo. */
    if (directaRef.current === claveBusqueda(t, filtros)) return
    if (!sirveParaLive(t) && filtros.length === 0) {
      setResultados(SIN_RESULTADOS)
      return
    }
    const { productos, truncado } = buscarEnCatalogo(catalogo.entradas, t, filtros)
    setResultados(
      conResultadosLocales(
        productos.map((pc) => productoDesdeCache(pc, lista, conIva)),
        PRODUCTOS_POR_PAGINA,
        truncado,
      ),
    )
  }, [catalogo, termino, filtros, lista, conIva])

  // El aviso se muestra donde lo pida el padre; si no lo maneja, queda bajo el campo.
  const avisar = (mensaje: string) => {
    if (onAviso) onAviso(mensaje)
    else setError(mensaje)
  }

  /**
   * Click en una fila: carga el producto en «Producto seleccionado» y repliega la lista para
   * dejarlo a la vista. Los resultados quedan guardados —no se consulta nada de nuevo— y vuelven a
   * listarse al hacer click en el buscador.
   *
   * Si la fila vino del caché hay un paso más antes de entregarla: leerle el stock a Monday. Ver
   * el encabezado del componente.
   */
  const elegir = async (p: Producto) => {
    if (resolviendo) return
    let elegido = p
    if (resultados.origen === 'cache') {
      setResolviendo(p.codigo)
      try {
        elegido = await conStockFresco(p)
      } catch {
        /* Sin stock no se carga el producto. Entregarlo con las cantidades en cero diría "no hay
           nada en depósito", que es una respuesta distinta de "no se pudo averiguar". */
        dispatch({ type: 'errorMonday', accion: 'leer el stock del producto' })
        return
      } finally {
        setResolviendo('')
      }
    }
    onSelect(elegido)
    setResultados((r) => replegado(r))
    setError('')
    onAviso?.('')
  }

  /** Vuelta al buscador: se relistan los resultados ya traídos, si todavía hay. */
  const reabrir = () => setResultados(reabierto)
  /** Hay una búsqueda guardada que se puede volver a listar sin consultar. */
  const hayGuardados = resultados.paginas.length > 0 && !resultados.abierto

  const buscar = async () => {
    const t = termino.trim()
    // Se puede buscar sólo por filtros: alcanza con un término O con filtros aplicados. Sin
    // ninguno de los dos no hay nada que consultar.
    if (!t && filtros.length === 0) {
      avisar('Ingresá un nombre o código, o aplicá filtros para buscar.')
      return
    }
    setError('')
    onAviso?.('')
    // Búsqueda nueva: es el único punto donde se descarta lo traído antes.
    setResultados(SIN_RESULTADOS)
    setCargando(true)
    try {
      const res = await buscarProductos(t, lista, conIva, filtros)
      /* Se marca ANTES de mostrar: desde acá, el live search deja de pisar esta lista mientras lo
         escrito no cambie. */
      directaRef.current = claveBusqueda(t, filtros)
      if (res.productos.length === 0) {
        avisar(
          t
            ? filtros.length > 0
              ? `Sin resultados para «${t}» con los filtros aplicados.`
              : `Sin resultados para «${t}» en Monday.`
            : 'No hay productos que cumplan con los filtros aplicados.',
        )
        return
      }
      /* Coincidencia única y sin más páginas (el caso típico del código): se carga directo y
         no queda lista que sostener, así que el campo se limpia para el próximo código. */
      if (res.productos.length === 1 && !res.cursor) {
        onSelect(res.productos[0])
        directaRef.current = null
        setTermino('')
        return
      }
      setResultados(conPrimeraPagina(res))
    } catch {
      /* El fallo de la API lo comunica la ventana global: acá no se deja ningún aviso en línea,
         que además se confundía con los avisos de "sin resultados" del propio buscador. */
      dispatch({ type: 'errorMonday', accion: 'buscar productos en el catálogo' })
    } finally {
      setCargando(false)
    }
  }

  const actuales = paginaActual(resultados)
  const atras = hayAnterior(resultados)
  const adelante = haySiguiente(resultados)

  /**
   * Trae la página siguiente. Del caché ya están todas en memoria; de Monday se pide con el cursor
   * guardado, y si ya se había traído (el usuario volvió atrás) se muestra la que está.
   */
  const siguiente = async () => {
    if (cargando || !adelante) return
    if (resultados.pagina < resultados.paginas.length - 1) {
      setResultados((r) => enPagina(r, r.pagina + 1))
      return
    }
    const cursor = cursorActual(resultados)
    if (!cursor) return
    setCargando(true)
    try {
      const res = await siguientePaginaProductos(cursor, lista, conIva)
      // Cursor agotado: no hay más para mostrar, así que se inactiva la flecha.
      setResultados((r) => (res.productos.length === 0 ? sinMasPaginas(r) : conPaginaSiguiente(r, res)))
    } catch {
      dispatch({ type: 'errorMonday', accion: 'traer la página siguiente de productos' })
    } finally {
      setCargando(false)
    }
  }

  const anterior = () => {
    if (cargando || !atras) return
    setResultados((r) => enPagina(r, r.pagina - 1))
  }

  /**
   * El live search no encontró nada y todavía no se consultó a Monday. Es el momento exacto en que
   * hay que señalar el botón Buscar: puede ser un producto recién creado que el cron no levantó.
   */
  const sinCoincidencias =
    !!catalogo &&
    !cargando &&
    resultados.origen === 'cache' &&
    resultados.paginas.length === 0 &&
    (sirveParaLive(termino.trim()) || filtros.length > 0)

  const pie = resultados.origen === 'cache' ? 'en el catálogo' : 'en Monday'

  // El desplegable de coincidencias es el mismo en las dos variantes.
  const desplegable = resultados.abierto && actuales.length > 0 && (
    <div className="results results--paged">
      <div className="results-list">
        {actuales.map((p) => {
          // La fila marcada es UNA: la del producto que está cargado en este momento.
          const elegido = !!codigoCargado && p.codigo === codigoCargado
          const buscandoStock = resolviendo === p.codigo
          return (
            <div
              className={`ritem ${elegido ? 'ritem--elegido' : ''}`}
              key={p.id ?? p.codigo}
              onClick={() => void elegir(p)}
              title={elegido ? 'Ya seleccionado. Volvé a hacer click para cargarlo de nuevo.' : undefined}
            >
              <span className="ritem-name">{p.nombre}</span>
              <span className="ritem-meta">
                <span className="ritem-code">{p.codigo}</span>
                {buscandoStock && (
                  <span className="ritem-tag">
                    <i className="fas fa-spinner fa-spin" /> Stock...
                  </span>
                )}
                {elegido && !buscandoStock && (
                  <span className="ritem-tag">
                    <i className="fas fa-check" /> Seleccionado
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <div className="results-pager">
        <button
          type="button"
          className="results-pager-btn"
          onClick={anterior}
          disabled={!atras || cargando}
          aria-label="Página anterior"
        >
          <i className="fas fa-chevron-left" /> Anterior
        </button>
        <span className="results-pager-info" aria-live="polite">
          Página {resultados.pagina + 1} · {actuales.length} productos {pie}
          {/* Se avisa que la lista está cortada. Callarlo hace creer que no hay más. */}
          {resultados.truncado && ' · afiná la búsqueda para ver el resto'}
        </span>
        <button
          type="button"
          className="results-pager-btn"
          onClick={siguiente}
          disabled={!adelante || cargando}
          aria-label="Página siguiente"
        >
          Siguiente <i className="fas fa-chevron-right" />
        </button>
      </div>
    </div>
  )

  const avisoSinCoincidencias = sinCoincidencias && (
    <div className="search-hint" role="status">
      Sin coincidencias en el catálogo. Si el producto es nuevo, buscalo directo en Monday con{' '}
      <strong>Buscar</strong>.
    </div>
  )

  if (variante === 'v2') {
    return (
      <div className="search-row" ref={ref}>
        <div className="search-input-wrapper">
          <i className="fas fa-search" />
          <input
            id="prod-search"
            type="text"
            className="search-input"
            placeholder="Buscar por nombre, código o filtros aplicados"
            title={hayGuardados ? PISTA_RELISTAR : undefined}
            autoComplete="off"
            value={termino}
            disabled={cargando}
            /* Volver al buscador relista lo último que se trajo, sin consultar de nuevo. */
            onFocus={reabrir}
            onClick={reabrir}
            /* Escribir rearma la lista contra el caché; sólo el botón Buscar va a Monday. */
            onChange={(e) => {
              setTermino(e.target.value)
              directaRef.current = null
              if (error) setError('')
              onAviso?.('')
            }}
            onKeyDown={(e) => e.key === 'Enter' && !cargando && buscar()}
          />
        </div>
        <button type="button" className="btn-primary" onClick={buscar} disabled={cargando}>
          {cargando ? (
            <>
              <i className="fas fa-spinner fa-spin" /> Buscando...
            </>
          ) : (
            <>
              <i className="fas fa-search" /> Buscar
            </>
          )}
        </button>
        {desplegable}
        {avisoSinCoincidencias}
        {error && <div className="search-error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="ig" style={{ maxWidth: 500 }}>
      <label htmlFor="prod-search">Buscar producto por nombre o código</label>
      <div className="searchc" ref={ref}>
        <div className="iw">
          <i className="fas fa-search" />
          <input
            id="prod-search"
            type="text"
            className="sinput"
            placeholder="Ej: Acarox, Aguja, 3261..."
            title={hayGuardados ? PISTA_RELISTAR : undefined}
            autoComplete="off"
            value={termino}
            disabled={cargando}
            onFocus={reabrir}
            onClick={reabrir}
            onChange={(e) => {
              setTermino(e.target.value)
              directaRef.current = null
              if (error) setError('')
            }}
            onKeyDown={(e) => e.key === 'Enter' && !cargando && buscar()}
          />
        </div>
        <button type="button" className="btn btn-outblue" onClick={buscar} disabled={cargando}>
          {cargando ? (
            <>
              <i className="fas fa-spinner fa-spin" /> Buscando...
            </>
          ) : (
            <>
              <i className="fas fa-search" /> Buscar
            </>
          )}
        </button>

        {desplegable}
      </div>
      {avisoSinCoincidencias}
      {error && (
        <div className="helper" style={{ color: 'var(--red)', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}
