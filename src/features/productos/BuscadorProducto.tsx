import { useCallback, useRef, useState } from 'react'
import { buscarProductos } from '@/services/monday'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useApp } from '@/state/hooks'
import type { ListaPrecio, Producto } from '@/types'

interface BuscadorProductoProps {
  /** Lista de precio del cliente: define de qué columna sale el precio/rentabilidad. */
  lista: ListaPrecio
  /** true = precio con IVA (Consumidor Final/Monotributo); false = sin IVA (Resp. Inscripto). */
  conIva: boolean
  onSelect: (p: Producto) => void
  /** `v2` = barra ancha del paso de productos; por defecto, el campo con rótulo de siempre. */
  variante?: 'clasico' | 'v2'
  /**
   * Recibe el aviso de búsqueda (sin resultados / error de red) para mostrarlo donde iría
   * el producto elegido, en vez de debajo del campo. Sólo lo usa la variante `v2`.
   */
  onAviso?: (aviso: string) => void
}

/**
 * Búsqueda de producto contra el tablero de Productos de Monday. Si hay una sola coincidencia
 * se carga directo en «Producto seleccionado»; si hay varias, se abren como desplegable para
 * que el usuario elija cuál.
 */
export function BuscadorProducto({
  lista,
  conIva,
  onSelect,
  variante = 'clasico',
  onAviso,
}: BuscadorProductoProps) {
  const { filtros } = useApp()
  const [termino, setTermino] = useState('')
  const [resultados, setResultados] = useState<Producto[]>([])
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, useCallback(() => setAbierto(false), []), abierto)

  // El aviso se muestra donde lo pida el padre; si no lo maneja, queda bajo el campo.
  const avisar = (mensaje: string) => {
    if (onAviso) onAviso(mensaje)
    else setError(mensaje)
  }

  const elegir = (p: Producto) => {
    onSelect(p)
    setTermino('')
    setResultados([])
    setAbierto(false)
    setError('')
    onAviso?.('')
  }

  const buscar = async () => {
    const t = termino.trim()
    if (!t) {
      avisar('Ingresá un nombre o código de producto.')
      return
    }
    setError('')
    onAviso?.('')
    setAbierto(false)
    setCargando(true)
    try {
      const res = await buscarProductos(t, lista, conIva, filtros)
      if (res.length === 0) {
        avisar(
          filtros.length > 0
            ? `Sin resultados para «${t}» con los filtros aplicados.`
            : `Sin resultados para «${t}».`,
        )
        return
      }
      // Una sola coincidencia: se carga directo. Varias: se muestran para elegir.
      if (res.length === 1) {
        elegir(res[0])
        return
      }
      setResultados(res)
      setAbierto(true)
    } catch {
      avisar('No se pudo consultar Monday. Reintentá en unos segundos.')
    } finally {
      setCargando(false)
    }
  }

  // El desplegable de coincidencias es el mismo en las dos variantes.
  const desplegable = abierto && resultados.length > 0 && (
    <div className="results">
      {resultados.map((p) => (
        <div className="ritem" key={p.codigo} onClick={() => elegir(p)}>
          <span className="ritem-name">{p.nombre}</span>
          <span className="ritem-code">{p.codigo}</span>
        </div>
      ))}
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
            placeholder="Buscar por nombre, código o características..."
            autoComplete="off"
            value={termino}
            disabled={cargando}
            onChange={(e) => {
              setTermino(e.target.value)
              if (error) setError('')
              onAviso?.('')
              if (abierto) setAbierto(false)
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
            autoComplete="off"
            value={termino}
            disabled={cargando}
            onChange={(e) => {
              setTermino(e.target.value)
              if (error) setError('')
              if (abierto) setAbierto(false)
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
      {error && (
        <div className="helper" style={{ color: 'var(--red)', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}
