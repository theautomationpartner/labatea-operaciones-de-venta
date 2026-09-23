import { useCallback, useEffect, useRef, useState } from 'react'
import {
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
import type { ModoStock } from './StockPanel'
import {
  SIN_RESULTADOS,
  cerrado,
  conMasResultados,
  conPrimerosResultados,
  conResultadosLocales,
  convieneTraerMas,
  mover,
  productoActivo,
  reabierto,
  replegado,
  resaltar,
  sinMasResultados,
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

/**
 * Cuántas filas antes del final se empieza a pedir el tramo siguiente a Monday.
 *
 * Cinco y no una: traer un tramo tarda alrededor de un segundo y medio, y si se esperara a tocar la
 * última fila la flecha se quedaría clavada en cada borde. Con cinco de anticipo el tramo llega
 * mientras el usuario todavía está bajando, y la lista se siente continua.
 */
const MARGEN_PRECARGA = 5

/** Cuánto salta el resaltado con AvPág/RePág, que es lo que reemplaza a los botones de página. */
const SALTO_PAGINA = 10

/** Lo escrito alcanza para buscar en el catálogo mientras se tipea. */
const sirveParaLive = (t: string): boolean => t.length >= MINIMO_LIVE || /^\d+$/.test(t)

/** Identifica una búsqueda, para saber si los resultados en pantalla siguen siendo los de lo escrito. */
const claveBusqueda = (termino: string, filtros: readonly Filtro[]): string =>
  `${termino}\u0000${filtros.map((f) => `${f.campo}:${f.valor}`).join('|')}`

/** Id de cada fila. Lo necesita `aria-activedescendant`, que apunta por id y no por elemento. */
const idFila = (i: number): string => `prod-opt-${i}`

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
   * Qué le hace al stock lo que se está cargando. Sólo la DEVOLUCIÓN (`ingreso`) necesita que el
   * producto traiga "Ingreso Total" y "Egreso Total"; es la única pantalla que las muestra y la
   * única que proyecta con `stockConIngreso`.
   *
   * No es un detalle de presentación: esas dos columnas son mirrors y cuestan ~700 ms de los
   * ~2 s que tardaba leer el stock. Presupuesto, venta y remito de entrega no las piden.
   */
  modoStock?: ModoStock
  /**
   * Recibe el aviso de búsqueda (sin resultados / error de red) para mostrarlo donde iría
   * el producto elegido, en vez de debajo del campo. Sólo lo usa la variante `v2`.
   */
  onAviso?: (aviso: string) => void
}

/**
 * Búsqueda de producto en dos velocidades, manejada entera desde el teclado.
 *
 * ── 1. Mientras se escribe: el catálogo cacheado ──
 * El Maestro de Productos entero vive en el navegador (lo mantiene un Vercel Cron Job; ver
 * `api/cron/productos.ts` y `services/monday/catalogoProductos.ts`). Cada tecla rearma la lista en
 * memoria, sin red y sin debounce, con el que más matchea primero.
 *
 * ── 2. El botón Buscar: Monday, en vivo ──
 * Consulta el tablero directamente. Es la salida para el producto que se acaba de crear y que el
 * cron todavía no levantó —como mucho, cinco minutos—.
 *
 * ── Las manos no se van del teclado ──
 * ↑/↓ mueven el resaltado, AvPág/RePág saltan de a diez y **Enter carga el producto resaltado**.
 * Enter sólo dispara la búsqueda contra Monday cuando no hay nada resaltado, que es justo el caso
 * en el que hace falta: el live search no encontró nada.
 *
 * Las teclas se escuchan en el CONTENEDOR, no en el input, y el foco vuelve al campo después de
 * buscar: si no, apretar «Buscar» con el mouse dejaba el foco en el botón y desde ahí las flechas
 * scrolleaban la página y Enter volvía a buscar en vez de cargar. Ver `alPresionarTecla`.
 *
 * La lista es UNA sola y crece sola. No hay botones de página: cuando el resaltado se acerca al
 * final de lo traído, el tramo siguiente se pide por detrás y se agrega abajo. Quien busca baja con
 * la flecha de punta a punta sin encontrarse nunca un borde.
 *
 * ── Lo que distingue a un resultado del caché: el stock ──
 * El caché NO guarda cantidades —se mueven con cada venta, y cachearlas sería mostrar un disponible
 * que ya se vendió—. Por eso, al elegir una fila que vino del caché, se lee el stock contra Monday
 * ANTES de entregar el producto. Si esa lectura falla, el producto NO se carga; mostrarlo con el
 * stock en cero sería peor que no mostrarlo.
 */
export function BuscadorProducto({
  lista,
  conIva,
  onSelect,
  codigoCargado,
  variante = 'clasico',
  modoStock = 'consumo',
  onAviso,
}: BuscadorProductoProps) {
  const { filtros } = useApp()
  const dispatch = useDispatch()
  const [termino, setTermino] = useState('')
  // Toda la búsqueda vive en un solo estado, con transiciones puras (ver el módulo).
  const [resultados, setResultados] = useState<ResultadosBusqueda>(SIN_RESULTADOS)
  const [cargando, setCargando] = useState(false)
  /** Se está trayendo el tramo siguiente por detrás. No bloquea el campo ni la navegación. */
  const [trayendoMas, setTrayendoMas] = useState(false)
  const [error, setError] = useState('')
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  /** Código de la fila que está resolviendo su stock. Sólo puede haber una a la vez. */
  const [resolviendo, setResolviendo] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /* Los movimientos (Ingreso/Egreso Total) se piden sólo en la devolución. Ver `modoStock`. */
  const conMovimientos = modoStock === 'ingreso'
  /**
   * La búsqueda cuyos resultados vinieron de Monday. Mientras lo escrito coincida con esta clave,
   * el live search no pisa la lista: apretar Buscar tiene que poder ganarle al caché, o el
   * resultado que se fue a buscar a la fuente desaparecería en el mismo instante en que llega.
   */
  const directaRef = useRef<string | null>(null)
  /**
   * El resaltado se está moviendo con el teclado.
   *
   * Hace falta porque al bajar con la flecha la lista SCROLLEA bajo un mouse que no se movió, y el
   * `mouseenter` que eso dispara le robaría el resaltado a la tecla. Se apaga en cuanto el mouse se
   * mueve de verdad.
   */
  const conTeclado = useRef(false)
  const cerrar = useCallback(() => setResultados(cerrado), [])
  // Click afuera: una de las formas de cerrar la lista.
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
        truncado,
      ),
    )
  }, [catalogo, termino, filtros, lista, conIva])

  /**
   * El resaltado tiene que verse: se desplaza la lista lo mínimo para dejarlo dentro.
   *
   * A mano y NO con `scrollIntoView`. Ese método desplaza todos los ancestros scrolleables hasta
   * dejar el elemento a la vista —incluida la ventana—, así que la página entera se movía debajo
   * del usuario en cada flecha aunque la fila ya estuviera visible dentro del desplegable. Acá se
   * toca un solo `scrollTop`: el de la lista.
   */
  useEffect(() => {
    if (!resultados.abierto || resultados.activo < 0) return
    const cont = listaRef.current
    const fila = cont?.children[resultados.activo] as HTMLElement | undefined
    if (!cont || !fila) return
    /* Por rectángulos y no por `offsetTop`, que se mide contra el ancestro posicionado más cercano
       y depende de un `position` que el CSS podría cambiar sin que nadie relacione una cosa con la
       otra. */
    const caja = cont.getBoundingClientRect()
    const f = fila.getBoundingClientRect()
    if (f.top < caja.top) cont.scrollTop -= caja.top - f.top
    else if (f.bottom > caja.bottom) cont.scrollTop += f.bottom - caja.bottom
  }, [resultados.activo, resultados.abierto, resultados.productos.length])

  /**
   * La lista crece sola: cuando el resaltado se acerca al final de lo traído, se pide el tramo
   * siguiente. Es lo que reemplaza al botón «Siguiente».
   */
  useEffect(() => {
    if (trayendoMas || cargando) return
    if (!resultados.abierto || !convieneTraerMas(resultados, MARGEN_PRECARGA)) return
    const cursor = resultados.cursor
    if (!cursor) return

    let vivo = true
    setTrayendoMas(true)
    void siguientePaginaProductos(cursor, lista, conIva, conMovimientos)
      .then((res) => {
        if (!vivo) return
        /* Se compara el cursor para no pegarle el tramo a una búsqueda que ya cambió, y porque un
           cursor agotado tiene que apagarse o esto reintentaría en bucle. */
        setResultados((r) =>
          r.cursor !== cursor
            ? r
            : res.productos.length === 0
              ? sinMasResultados(r)
              : conMasResultados(r, res),
        )
      })
      .catch(() => {
        if (!vivo) return
        /* Un tramo que no llega no rompe la búsqueda: se corta el crecimiento y lo ya traído sigue
           navegable. Levantar la ventana de error sería desproporcionado para algo que el usuario
           nunca pidió explícitamente. */
        setResultados((r) => (r.cursor === cursor ? sinMasResultados(r) : r))
      })
      .finally(() => {
        if (vivo) setTrayendoMas(false)
      })
    return () => {
      vivo = false
    }
  }, [resultados, trayendoMas, cargando, lista, conIva, conMovimientos])

  // El aviso se muestra donde lo pida el padre; si no lo maneja, queda bajo el campo.
  const avisar = (mensaje: string) => {
    if (onAviso) onAviso(mensaje)
    else setError(mensaje)
  }

  /**
   * Carga el producto en «Producto seleccionado» y repliega la lista para dejarlo a la vista. Los
   * resultados quedan guardados —no se consulta nada de nuevo— y vuelven a listarse al hacer click
   * en el buscador.
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
        elegido = await conStockFresco(p, conMovimientos)
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
  const hayGuardados = resultados.productos.length > 0 && !resultados.abierto

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
      const res = await buscarProductos(t, lista, conIva, filtros, conMovimientos)
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
      /* Coincidencia única y sin más para traer (el caso típico del código): se carga directo y
         no queda lista que sostener, así que el campo se limpia para el próximo código. */
      if (res.productos.length === 1 && !res.cursor) {
        onSelect(res.productos[0])
        directaRef.current = null
        setTermino('')
        return
      }
      setResultados(conPrimerosResultados(res))
    } catch {
      /* El fallo de la API lo comunica la ventana global: acá no se deja ningún aviso en línea,
         que además se confundía con los avisos de "sin resultados" del propio buscador. */
      dispatch({
        type: 'errorMonday',
        accion: 'buscar productos en el catálogo',
      })
    } finally {
      setCargando(false)
      /* El foco vuelve al campo. Quien apretó «Buscar» con el mouse dejó el foco en el botón, y sin
         esto las flechas y Enter seguirían apuntándole a él en vez de a la lista que acaba de
         aparecer. Es la otra mitad de tener el manejador en el contenedor. */
      inputRef.current?.focus()
    }
  }

  const marcado = productoActivo(resultados)

  /**
   * El teclado maneja la lista entera.
   *
   * ── Por qué va en el CONTENEDOR y no en el input ──
   * Porque el foco no siempre está en el input. Si se aprieta «Buscar» con el mouse, el foco queda
   * en el BOTÓN: ahí las flechas no llegaban a este manejador y el navegador hacía lo suyo
   * —scrollear la página— mientras Enter volvía a activar el botón en vez de cargar el producto.
   * Colgado del contenedor, el evento burbujea desde donde sea que esté el foco dentro del buscador
   * y las teclas funcionan igual.
   *
   * Las flechas llevan `preventDefault` por dos motivos: para que el cursor del input no se vaya al
   * principio o al final del texto, y para que la página no scrollee cuando el foco está en el
   * botón. Enter también lo lleva: sin eso, con el foco en «Buscar», el navegador sintetiza un
   * click y se dispara la búsqueda encima de la selección.
   *
   * Inicio/Fin quedaron AFUERA a propósito: la lista está abierta casi todo el tiempo mientras se
   * escribe, así que apropiárselas sería quitarle al usuario el salto al principio y al final de lo
   * que está tipeando. AvPág/RePág sí, porque en un campo de una línea no hacen nada.
   */
  const alPresionarTecla = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (cargando) return
    const navegar = (delta: number) => {
      e.preventDefault()
      conTeclado.current = true
      /* Si la lista estaba replegada, la primera flecha la vuelve a abrir en vez de mover algo que
         no se ve. */
      setResultados((r) => (r.abierto ? mover(r, delta) : reabierto(r)))
    }
    switch (e.key) {
      case 'ArrowDown':
        return navegar(1)
      case 'ArrowUp':
        return navegar(-1)
      case 'PageDown':
        return navegar(SALTO_PAGINA)
      case 'PageUp':
        return navegar(-SALTO_PAGINA)
      case 'Escape':
        if (resultados.abierto) {
          e.preventDefault()
          setResultados(cerrado)
        }
        return
      case 'Enter':
        e.preventDefault()
        /* Enter carga lo resaltado. Sólo cuando no hay nada resaltado dispara la búsqueda contra
           Monday, que es exactamente el caso en el que hace falta: el live search no encontró nada
           y el producto puede ser nuevo. */
        if (marcado) void elegir(marcado)
        else void buscar()
        return
      default:
        return
    }
  }

  /**
   * El live search no encontró nada y todavía no se consultó a Monday. Es el momento exacto en que
   * hay que señalar el botón Buscar: puede ser un producto recién creado que el cron no levantó.
   */
  const sinCoincidencias =
    !!catalogo &&
    !cargando &&
    resultados.origen === 'cache' &&
    resultados.productos.length === 0 &&
    (sirveParaLive(termino.trim()) || filtros.length > 0)

  const total = resultados.productos.length
  const fuente = resultados.origen === 'cache' ? 'en el catálogo' : 'en Monday'

  // El desplegable es el mismo en las dos variantes.
  const desplegable = resultados.abierto && total > 0 && (
    <div className="results results--nav">
      <div
        className="results-list"
        role="listbox"
        id="prod-listbox"
        aria-label="Resultados de productos"
        ref={listaRef}
        /* El mouse recupera el mando recién cuando se mueve de verdad, no cuando la lista le pasa
           por debajo al scrollear con el teclado. */
        onMouseMove={() => {
          conTeclado.current = false
        }}
      >
        {resultados.productos.map((p, i) => {
          // La fila marcada es UNA: la del producto que está cargado en este momento.
          const elegido = !!codigoCargado && p.codigo === codigoCargado
          const buscandoStock = resolviendo === p.codigo
          const activo = i === resultados.activo
          return (
            <div
              className={`ritem ${elegido ? 'ritem--elegido' : ''} ${activo ? 'ritem--activo' : ''}`}
              key={p.id ?? p.codigo}
              id={idFila(i)}
              role="option"
              aria-selected={activo}
              onClick={() => void elegir(p)}
              /* El mousedown por defecto le saca el foco al campo y se lo da a la fila, y desde ahí
                 las flechas vuelven a scrollear la página. Cancelarlo deja el foco donde estaba: se
                 puede elegir con el mouse y seguir con el teclado sin tener que volver a clickear. */
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => {
                if (!conTeclado.current) setResultados((r) => resaltar(r, i))
              }}
              title={
                elegido ? 'Ya seleccionado. Volvé a hacer click para cargarlo de nuevo.' : undefined
              }
            >
              <span className="ritem-name">{p.nombre}</span>
              <span className="ritem-meta">
                <span className="ritem-code">{p.codigo}</span>
                {buscandoStock && (
                  /* Sólo la animación. El rótulo que había acá ("Stock...") no agregaba nada que el
                     spinner no dijera, y por un instante metía una palabra suelta al lado del
                     nombre del producto. El texto sigue estando para quien usa lector de pantalla,
                     que no ve girar nada. */
                  <i
                    className="fas fa-spinner fa-spin ritem-cargando"
                    role="status"
                    aria-label="Leyendo el stock del producto"
                  />
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
      <div className="results-foot">
        <span className="results-foot-info" aria-live="polite">
          {trayendoMas ? (
            <>
              <i className="fas fa-spinner fa-spin" /> Trayendo más...
            </>
          ) : (
            <>
              {resultados.activo + 1} de {total}
              {resultados.cursor ? '+' : ''} {fuente}
              {/* Se avisa que la lista está cortada. Callarlo hace creer que no hay más. */}
              {resultados.truncado && ' · afiná la búsqueda para ver el resto'}
            </>
          )}
        </span>
        <span className="results-foot-ayuda">
          <kbd>↑</kbd>
          <kbd>↓</kbd> navegar · <kbd>Enter</kbd> cargar
        </span>
      </div>
    </div>
  )

  const avisoSinCoincidencias = sinCoincidencias && (
    <div className="search-hint" role="status">
      Sin coincidencias en el catálogo. Si el producto es nuevo, buscalo directo en Monday con{' '}
      <strong>Buscar</strong> (o <kbd>Enter</kbd>).
    </div>
  )

  /** Lo que comparten las dos variantes del input, que sólo se diferencian en las clases. */
  const propsInput = {
    id: 'prod-search',
    type: 'text' as const,
    title: hayGuardados ? PISTA_RELISTAR : undefined,
    autoComplete: 'off',
    value: termino,
    disabled: cargando,
    role: 'combobox',
    'aria-expanded': resultados.abierto && total > 0,
    'aria-controls': 'prod-listbox',
    'aria-autocomplete': 'list' as const,
    /* Apunta por ID y no por elemento: el foco real nunca se va del input, así que al lector de
       pantalla hay que decirle cuál de las opciones está "activa". */
    'aria-activedescendant':
      resultados.abierto && resultados.activo >= 0 ? idFila(resultados.activo) : undefined,
    /* Volver al buscador relista lo último que se trajo, sin consultar de nuevo. */
    onFocus: reabrir,
    onClick: reabrir,
    ref: inputRef,
  }

  if (variante === 'v2') {
    return (
      /* El aviso va ARRIBA del campo y en el flujo normal, no flotando: la card tiene 24 px de
         padding y un mensaje de dos líneas colgado por encima se le saldría por el borde. */
      <div className="search-bloque">
        {avisoSinCoincidencias}
        <div className="search-row" ref={ref} onKeyDown={alPresionarTecla}>
          <div className="search-input-wrapper">
            <i className="fas fa-search" />
            <input
              {...propsInput}
              className="search-input"
              placeholder="Buscar por nombre, código o filtros aplicados"
              /* Escribir rearma la lista contra el caché; sólo el botón Buscar va a Monday. */
              onChange={(e) => {
                setTermino(e.target.value)
                directaRef.current = null
                if (error) setError('')
                onAviso?.('')
              }}
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
          {error && <div className="search-error">{error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="ig" style={{ maxWidth: 500 }}>
      <label htmlFor="prod-search">Buscar producto por nombre o código</label>
      {avisoSinCoincidencias}
      <div className="searchc" ref={ref} onKeyDown={alPresionarTecla}>
        <div className="iw">
          <i className="fas fa-search" />
          <input
            {...propsInput}
            className="sinput"
            placeholder="Ej: Acarox, Aguja, 3261..."
            onChange={(e) => {
              setTermino(e.target.value)
              directaRef.current = null
              if (error) setError('')
            }}
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
      {error && (
        <div className="helper" style={{ color: 'var(--red)', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}
