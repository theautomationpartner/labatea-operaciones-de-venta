import { Fragment, useMemo, useState } from 'react'
import { esConsignada } from '@/lib/facturacion'
import { money } from '@/lib/format'

/** Una línea pendiente, ya resuelta por la vista: origen, cantidades y estado. */
export interface PendienteFila {
  /** Identidad global de la línea (`${documentoId}-${indice}`). */
  uid: string
  codigo: string
  nombre: string
  /** Documento del que sale la línea; distingue productos repetidos y filtra por card. */
  origen: string
  /** Cómo se muestra ese documento, si su identificador visible no es el del filtro. */
  origenLabel?: string
  /** Cantidad de referencia: presupuestada / de remito / vendida. */
  referencia: number
  /** Cantidad ya resuelta: vendida / facturada / entregada. */
  resuelta: number
  /** Cantidad que queda por resolver: es el tope de lo que se puede llevar. */
  pend: number
  estadoColor: string
  estadoLabel: string
  /** Tipo de mercadería del producto: 'CO' (consignada) o 'COM'. */
  tipo?: string
  /** Precio unitario del producto (sólo se muestra con `mostrarPrecios`). */
  precio?: number
  /** Subtotal de la línea, tal como lo trae la fuente (sólo con `mostrarPrecios`). */
  subtotal?: number
  /** Unidad de medida del producto (sólo se muestra con `mostrarUm`). */
  um?: string
  /** Ruta de entrega asignada al pendiente (sólo se muestra con `mostrarRuta`). */
  ruta?: string
  /** La línea ya está en la tabla de seleccionados: no se vuelve a agregar. */
  ya: boolean
  /**
   * El documento de origen no habilita esta línea (por defecto, sí). Se muestra igual, con su
   * estado, pero no se puede elegir.
   */
  seleccionable?: boolean
  /** Por qué la línea no se puede elegir. Va al `title` de la fila y al lector de pantalla. */
  motivoBloqueo?: string
}

interface PendientesSelectorProps {
  titulo: string
  hint: string
  vacio: string
  /** Rótulos de las columnas numéricas, que cambian según el flujo. */
  colReferencia: string
  colResuelta: string
  colPend: string
  /** Rótulo de la cantidad a llevar: «A vender» / «A facturar» / «A remitir». */
  colAccion: string
  /** Suma la columna de tipo de mercadería (CO / COM). */
  mostrarTipo?: boolean
  /**
   * Parte el listado en dos secciones —mercadería común y consignada—, con la misma lógica de
   * división de consignación del resto de la app (`esConsignada`). Sin esto, la lista es plana.
   */
  dividirTipo?: boolean
  /** Suma las columnas de precio unitario y subtotal por línea (venta pendiente de facturar). */
  mostrarPrecios?: boolean
  /** Suma la columna de unidad de medida por línea (remito de venta ANTERIOR). */
  mostrarUm?: boolean
  /** Suma la columna de ruta de entrega por línea (remito de venta ANTERIOR). */
  mostrarRuta?: boolean
  filas: PendienteFila[]
  /** Documento seleccionado en el panel de cards; filtra la lista. null = todos. */
  filtroOrigen: string | null
  /** Limpia el filtro por documento (vuelve a mostrar todos). Si se pasa, se muestra un
   *  "Ver todos" en la barra del listado mientras haya un filtro activo. */
  onVerTodos?: () => void
  onConfirmar: (seleccion: { uid: string; cantidad: number }[]) => void
}

/**
 * Lista plana de productos pendientes de todos los documentos del cliente. Cada fila
 * se selecciona por click o checkbox; al hacerlo abre un input para bajar la cantidad
 * a llevar (nunca subirla del tope pendiente). Se puede filtrar por documento (card) y
 * por un buscador en vivo de nombre/código. «Confirmar» las pasa a la tabla de la venta.
 */
export function PendientesSelector({
  titulo,
  hint,
  vacio,
  colReferencia,
  colResuelta,
  colPend,
  colAccion,
  mostrarTipo = false,
  dividirTipo = false,
  mostrarPrecios = false,
  mostrarUm = false,
  mostrarRuta = false,
  filas,
  filtroOrigen,
  onVerTodos,
  onConfirmar,
}: PendientesSelectorProps) {
  // Columnas de la tabla: la de tipo (venta presupuestada), las de importes (venta pend de facturar)
  // y la de unidad de medida (remito ANTERIOR).
  const columnas =
    (mostrarTipo ? 9 : 8) + (mostrarPrecios ? 2 : 0) + (mostrarUm ? 1 : 0) + (mostrarRuta ? 1 : 0)
  // uid → cantidad elegida. Sólo entran las filas seleccionables (no agregadas, con pendiente).
  const [seleccion, setSeleccion] = useState<ReadonlyMap<string, number>>(new Map())
  const [busqueda, setBusqueda] = useState('')

  // La selección persiste sobre todas las filas, no sólo las visibles bajo el filtro.
  const vigentes = useMemo(() => new Set(filas.map((f) => f.uid)), [filas])

  // Filas mostradas: filtradas por la card seleccionada y por el término del buscador.
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return filas.filter(
      (f) =>
        (!filtroOrigen || f.origen === filtroOrigen) &&
        (!q || f.nombre.toLowerCase().includes(q) || f.codigo.toLowerCase().includes(q)),
    )
  }, [filas, filtroOrigen, busqueda])

  // División de consignación: mercadería común primero, consignada después. Misma regla que el
  // resto de la app (`esConsignada`). Los grupos vacíos no se muestran. null = lista plana.
  const grupos = useMemo(() => {
    if (!dividirTipo) return null
    return [
      { clave: 'comun', label: 'Mercadería común', filas: visibles.filter((f) => !esConsignada(f.tipo)) },
      { clave: 'consignada', label: 'Mercadería consignada', filas: visibles.filter((f) => esConsignada(f.tipo)) },
    ].filter((g) => g.filas.length > 0)
  }, [dividirTipo, visibles])

  /** Una línea ya llevada, sin unidades pendientes o no habilitada no se puede elegir. */
  const noSeleccionable = (f: PendienteFila) =>
    f.ya || f.pend === 0 || f.seleccionable === false

  // La vista ya muestra la TOTALIDAD de los productos de la operación (ni la card ni el buscador
  // la achican): "Ver todos" queda visible pero sin acción.
  const mostrandoTodos = visibles.length === filas.length
  // Filas visibles que se pueden elegir (habilitadas, con pendiente y no agregadas).
  const seleccionablesVisibles = visibles.filter((f) => !noSeleccionable(f))
  // ¿Ya están todas las seleccionables marcadas? Define si el botón selecciona o deselecciona.
  const todasSeleccionadas =
    seleccionablesVisibles.length > 0 && seleccionablesVisibles.every((f) => seleccion.has(f.uid))

  /** Vuelve a mostrar los productos de todos los documentos. Si ya se ven todos, no hace nada. */
  const verTodos = () => {
    if (mostrandoTodos) return
    setBusqueda('')
    onVerTodos?.()
  }

  /**
   * Alterna la selección en bloque de las filas VISIBLES: si no están todas marcadas, marca
   * todas; si ya lo están, las deselecciona. Nunca se inactiva.
   */
  const seleccionarTodos = () => {
    setSeleccion((prev) => {
      const next = new Map(prev)
      if (todasSeleccionadas) {
        for (const f of seleccionablesVisibles) next.delete(f.uid)
      } else {
        for (const f of seleccionablesVisibles) next.set(f.uid, f.pend) // arranca en lo pendiente
      }
      return next
    })
  }

  const toggle = (fila: PendienteFila) => {
    if (noSeleccionable(fila)) return
    setSeleccion((prev) => {
      const next = new Map(prev)
      if (next.has(fila.uid)) next.delete(fila.uid)
      else next.set(fila.uid, fila.pend) // arranca en lo pendiente y sólo baja de ahí
      return next
    })
  }

  const setCantidad = (fila: PendienteFila, cantidad: number) =>
    setSeleccion((prev) => {
      const next = new Map(prev)
      // Tope = lo pendiente (no se aumenta); piso = 1 (una línea seleccionada lleva algo).
      next.set(fila.uid, Math.min(Math.max(cantidad, 1), fila.pend))
      return next
    })

  const confirmar = () => {
    const items = [...seleccion]
      .filter(([uid]) => vigentes.has(uid))
      .map(([uid, cantidad]) => ({ uid, cantidad }))
    if (items.length === 0) return
    onConfirmar(items)
    setSeleccion(new Map())
    // El buscador se reinicia al confirmar.
    setBusqueda('')
  }

  const count = seleccion.size

  /** Una fila de la tabla. Se extrae para poder renderizarla plana o dentro de una sección. */
  const filaTr = (fila: PendienteFila) => {
    const marcada = seleccion.has(fila.uid)
    const bloqueada = noSeleccionable(fila)
    const cantidad = seleccion.get(fila.uid) ?? fila.pend
    return (
      <tr
        key={fila.uid}
        className={`pend-row ${marcada ? 'sel' : ''} ${fila.ya ? 'dt-added' : ''}`}
        aria-selected={marcada}
        title={fila.seleccionable === false ? fila.motivoBloqueo : undefined}
        onClick={() => toggle(fila)}
      >
        <td>
          <input
            type="checkbox"
            checked={fila.ya || marcada}
            disabled={bloqueada}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(fila)}
            aria-label={
              fila.ya
                ? `${fila.nombre} ya está en la venta`
                : fila.seleccionable === false
                  ? fila.motivoBloqueo ?? `${fila.nombre} no se puede seleccionar`
                  : fila.pend === 0
                    ? `${fila.nombre} no tiene unidades pendientes`
                    : `Seleccionar ${fila.nombre}`
            }
          />
        </td>
        <td>
          <span style={{ color: 'var(--primary-blue)', fontWeight: 700 }}>{fila.codigo}</span>
          <span style={{ marginLeft: 10, fontWeight: 600 }}>{fila.nombre}</span>
        </td>
        {mostrarUm && <td className="ta-c">{fila.um || '—'}</td>}
        {/* Ruta de entrega del pendiente: badge para distinguirla de un dato numérico. */}
        {mostrarRuta && (
          <td className="ta-c">
            {fila.ruta ? <span className="ruta-badge">{fila.ruta}</span> : '—'}
          </td>
        )}
        {mostrarPrecios && <td className="ta-r">{money(fila.precio ?? 0)}</td>}
        {mostrarPrecios && (
          <td className="ta-r" style={{ fontWeight: 600 }}>
            {money(fila.subtotal ?? 0)}
          </td>
        )}
        <td className="ta-c" onClick={(e) => e.stopPropagation()}>
          {marcada ? (
            <span className="qbox">
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${colAccion} de ${fila.nombre}`}
                value={cantidad}
                onChange={(e) => setCantidad(fila, Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
              <span className="qbtns">
                <button
                  type="button"
                  aria-label={`Sumar una unidad de ${fila.nombre}`}
                  disabled={cantidad >= fila.pend}
                  onClick={() => setCantidad(fila, cantidad + 1)}
                >
                  <i className="fas fa-angle-up" />
                </button>
                <button
                  type="button"
                  aria-label={`Restar una unidad de ${fila.nombre}`}
                  disabled={cantidad <= 1}
                  onClick={() => setCantidad(fila, cantidad - 1)}
                >
                  <i className="fas fa-angle-down" />
                </button>
              </span>
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          <span className="pend-origen">{fila.origenLabel ?? fila.origen}</span>
        </td>
        <td className="ta-c">{fila.referencia}</td>
        <td className="ta-c">{fila.resuelta}</td>
        <td className="ta-c" style={{ color: fila.estadoColor, fontWeight: 700 }}>
          {fila.pend}
        </td>
        {/* La mercadería consignada (CO) se distingue en dorado, como en el stock. */}
        {mostrarTipo && (
          <td
            className="ta-c"
            style={{ fontWeight: 700, color: fila.tipo === 'CO' ? '#b58200' : 'inherit' }}
          >
            {fila.tipo || '—'}
          </td>
        )}
        <td>
          <span className="estado-cell">
            <span className="dot dot--sm" style={{ background: fila.estadoColor }} />
            {fila.estadoLabel}
          </span>
        </td>
      </tr>
    )
  }

  return (
    <div className="tablec">
      <div className="thtitle">
        {titulo} ({visibles.length})
      </div>
      <p className="pend-hint">
        <i className="fas fa-info-circle" /> {hint}
      </p>

      {/* Buscador que filtra la lista en vivo por nombre o código de producto. Con un documento
          filtrado, "Ver todos" vuelve a mostrar los productos de todos los documentos. */}
      <div className="pend-search">
        <div className="iw">
          <i className="fas fa-search" />
          <input
            type="text"
            className="sinput"
            placeholder="Filtrar por nombre o código de producto..."
            aria-label="Filtrar productos por nombre o código"
            autoComplete="off"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        {/* Acciones sobre la lista. Quedan FIJAS y visibles: cuando su acción no aplica se
            inactivan (disabled + return temprano), nunca se desmontan ni cambian de lugar. */}
        <button
          type="button"
          className="btn-outline"
          onClick={seleccionarTodos}
          title={
            todasSeleccionadas
              ? 'Deseleccionar todos los productos listados'
              : 'Seleccionar todos los productos listados'
          }
        >
          <i className={`fas ${todasSeleccionadas ? 'fa-square-minus' : 'fa-check-double'}`} />{' '}
          {todasSeleccionadas ? 'Deseleccionar todos' : 'Seleccionar todos'}
        </button>
        {onVerTodos && (
          <button
            type="button"
            className="btn-outline"
            onClick={verTodos}
            disabled={mostrandoTodos}
            title={
              mostrandoTodos
                ? 'Ya se están mostrando todos los productos'
                : 'Mostrar los productos de todos los documentos'
            }
          >
            <i className="fas fa-list-ul" /> Ver todos
          </button>
        )}
      </div>

      <div className="pend-scroll">
        <table className="pend-table">
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>Producto</th>
              {mostrarUm && <th className="ta-c">U.M.</th>}
              {mostrarRuta && <th className="ta-c">Ruta</th>}
              {mostrarPrecios && <th className="ta-r">Precio unit.</th>}
              {mostrarPrecios && <th className="ta-r">Subtotal</th>}
              <th className="ta-c" style={{ width: 120 }}>
                {colAccion}
              </th>
              <th>Origen</th>
              <th className="ta-c">{colReferencia}</th>
              <th className="ta-c">{colResuelta}</th>
              <th className="ta-c">{colPend}</th>
              {mostrarTipo && <th className="ta-c">Tipo</th>}
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {/* Sin documentos asociados: no es un filtro vacío, es un impedimento. */}
            {filas.length === 0 && (
              <tr>
                <td colSpan={columnas} className="tablec-empty tablec-empty--alerta">
                  {vacio}
                </td>
              </tr>
            )}
            {filas.length > 0 && visibles.length === 0 && (
              <tr>
                <td colSpan={columnas} className="tablec-empty">
                  Sin coincidencias con el filtro.
                </td>
              </tr>
            )}
            {/* Lista plana, o partida en secciones de consignación (común / consignada). */}
            {grupos
              ? grupos.map((g) => (
                  <Fragment key={g.clave}>
                    <tr className="pend-group-row">
                      <td
                        colSpan={columnas}
                        className={`pend-group ${g.clave === 'consignada' ? 'pend-group--co' : ''}`}
                      >
                        {g.label} ({g.filas.length})
                      </td>
                    </tr>
                    {g.filas.map(filaTr)}
                  </Fragment>
                ))
              : visibles.map(filaTr)}
          </tbody>
        </table>
      </div>

      <div className="pend-acts">
        <button type="button" className="btn-primary" disabled={count === 0} onClick={confirmar}>
          <i className="fas fa-check" /> Confirmar productos ({count})
        </button>
      </div>
    </div>
  )
}
