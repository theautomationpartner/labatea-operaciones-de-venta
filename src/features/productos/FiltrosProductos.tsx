import { useEffect, useState } from 'react'
import { getOpcionesFiltros, type OpcionesFiltros } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { CampoFiltro } from '@/types'

const CAMPOS: CampoFiltro[] = ['Rubro', 'Subrubro', 'Categoría']

/**
 * Filtros por taxonomía del Maestro de Productos. Las opciones salen de las columnas dropdown
 * reales del board (Rubro/Subrubro/Categoría). Al elegir una se agrega como chip removible; la
 * búsqueda de producto los aplica (OR dentro de un campo, AND entre campos).
 */
export function FiltrosProductos() {
  const { filtros } = useApp()
  const dispatch = useDispatch()
  const [opciones, setOpciones] = useState<OpcionesFiltros>({
    Rubro: [],
    Subrubro: [],
    Categoría: [],
  })

  // Se cargan una vez las opciones reales de cada columna dropdown.
  useEffect(() => {
    let vivo = true
    getOpcionesFiltros()
      .then((o) => vivo && setOpciones(o))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  return (
    <div className="filters-row">
      {CAMPOS.map((campo) => (
        <select
          key={campo}
          id={`filtro-${campo}`}
          className="filter-select"
          aria-label={campo}
          value=""
          onChange={(e) => {
            if (e.target.value)
              dispatch({ type: 'addFiltro', filtro: { campo, valor: e.target.value } })
          }}
        >
          <option value="">{campo}</option>
          {opciones[campo].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ))}

      <div className="chips-group">
        {filtros.length === 0 && <span className="chips-empty">Sin filtros aplicados.</span>}
        {filtros.map((f) => (
          <span className="chip" key={`${f.campo}-${f.valor}`}>
            <span className="chip-icon" />
            {f.valor}
            <button
              type="button"
              className="chip-close"
              aria-label={`Quitar ${f.campo} ${f.valor}`}
              onClick={() => dispatch({ type: 'removeFiltro', filtro: f })}
            >
              <i className="fas fa-times" />
            </button>
          </span>
        ))}
        {filtros.length > 0 && (
          <button
            type="button"
            className="btn-link"
            // Se quitan uno por uno: el estado de filtros no cambia de forma.
            onClick={() => filtros.forEach((f) => dispatch({ type: 'removeFiltro', filtro: f }))}
          >
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  )
}
