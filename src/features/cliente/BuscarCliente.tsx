import { useCallback, useRef, useState } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { buscarClientes } from '@/services/monday'
import { useDispatch } from '@/state/hooks'
import type { Cliente } from '@/types'

/** Estado de la búsqueda del cliente, compartido con la vista para renderizar el resultado. */
export type BusquedaEstado = 'idle' | 'buscando' | 'no-encontrado' | 'error'

interface BuscarClienteProps {
  estado: BusquedaEstado
  onEstado: (estado: BusquedaEstado) => void
}

/**
 * Búsqueda del cliente contra el tablero de Personas de Monday (capa de servicio). Detecta
 * si se ingresó nombre, código (4 díg) o CUIT (11 díg) y no exige coincidencia exacta. Si hay
 * una sola coincidencia se carga directo; si hay varias —dos clientes con el mismo nombre—
 * se abren como desplegable para elegir cuál. El loading y el «no encontrado» los muestra la
 * vista en el lugar de la ficha, no acá.
 */
export function BuscarCliente({ estado, onEstado }: BuscarClienteProps) {
  const dispatch = useDispatch()
  // El campo arranca (y queda) vacío: no muestra el cliente elegido, para encadenar búsquedas.
  const [termino, setTermino] = useState('')
  const [errorInput, setErrorInput] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  /* La búsqueda trajo el tope y quedaron coincidencias afuera. Se DICE: callarlo era el bug —con
     50 resultados fijos, quien buscaba "MARIA" veía 50 de 135 y concluía que su cliente no estaba
     cargado—. */
  const [truncado, setTruncado] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, useCallback(() => setAbierto(false), []), abierto)
  const buscando = estado === 'buscando'
  /** Hay lista de resultados montada debajo del campo. */
  const desplegado = abierto && resultados.length > 0

  const elegir = (c: Cliente) => {
    // El campo queda vacío tras elegir: el resultado se ve en la ficha, no en el buscador.
    setTermino('')
    setResultados([])
    setTruncado(false)
    setAbierto(false)
    dispatch({ type: 'setCliente', cliente: c })
    onEstado('idle')
  }

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
      setTruncado(hayMas)
      if (encontrados.length === 0) {
        onEstado('no-encontrado')
        return
      }
      /* Una sola coincidencia: se carga directo. Varias: se muestran para elegir.
         Con la lista truncada NO se auto-carga aunque haya venido una sola: puede no ser la que el
         usuario busca, y elegirla por él sería decidir con información incompleta. */
      if (encontrados.length === 1 && !hayMas) {
        elegir(encontrados[0])
        return
      }
      setResultados(encontrados)
      setAbierto(true)
      onEstado('idle')
    } catch {
      /* El fallo de la API lo comunica la ventana global (`ModalErrorMonday`); el estado 'error'
         sólo sirve para que la vista no muestre la ficha como si hubiera resultado. */
      onEstado('error')
      dispatch({ type: 'errorMonday', accion: 'buscar el cliente' })
    }
  }

  return (
    <>
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
              if (abierto) setAbierto(false)
              // Editar la búsqueda limpia el resultado anterior (aviso / error).
              if (estado !== 'idle') onEstado('idle')
            }}
            onKeyDown={(e) => e.key === 'Enter' && !buscando && buscar()}
          />
        </div>

        {/* Varios clientes con el mismo nombre: se elige por código. */}
        {desplegado && (
          <div className="results">
            {/* La lista vino cortada: se avisa ARRIBA de los resultados, que es donde se mira antes
                de recorrerlos. Sin esto, el que no encuentra su cliente entre los que ve concluye
                que no existe. */}
            {truncado && (
              <div className="results-aviso" role="status">
                <i className="fas fa-circle-info" aria-hidden="true" /> Se muestran los primeros{' '}
                {resultados.length} resultados. Agregá más letras, o buscá por código o CUIT, para
                encontrar el cliente exacto.
              </div>
            )}
            {resultados.map((c) => (
              <div className="ritem" key={c.id} onClick={() => elegir(c)}>
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

      <button type="button" className="btn-buscar" onClick={buscar} disabled={buscando}>
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
    </>
  )
}
