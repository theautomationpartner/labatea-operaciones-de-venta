import { useEffect, useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { CompBody } from '@/features/shared/CompBody'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { aIso, hoy, hoyIso } from '@/lib/dates'
import {
  construirNotaCredito,
  DIAS_MAX_DEVOLUCION,
  hayImputacion,
  hayLineasInvalidas,
  imputarDevolucion,
  lineaInvalida,
  notaCreditoAMonday,
  type PrecioLinea,
  type ImputacionProducto,
  type NotaCreditoPendiente,
  type RemitoEntrega,
} from '@/lib/devoluciones'
import { money, moneyU, round2 } from '@/lib/format'
import { indiceDePaso, pasosDe } from '@/lib/pasos'
import {
  crearNotaCredito,
  getPreciosDeLineas,
  getRemitosEntregaCliente,
  remitosEntregaEnCache,
  registrarDevolucionEnRemitos,
  registrarDevolucionStock,
} from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/** Estado del registro en Monday. No hay 'listo': al terminar, la app se reinicia. */
type EstadoRegistro = 'idle' | 'registrando' | 'error'

/**
 * Paso 3 (y último) de REMITO · DEVOLUCION: la imputación contra los remitos de entrega.
 *
 * El operador ya declaró cliente, productos y cantidades; acá el sistema muestra QUÉ remitos
 * absorben esa devolución: se consume del más nuevo hacia atrás, descartando lo emitido hace más de
 * 30 días corridos. Lo que no entra por esa regla NO se descuenta en silencio —queda cargado sobre
 * la última línea, marcada en rojo— y hay que corregirlo a mano antes de poder cerrar.
 *
 * La consulta a Monday se hace UNA vez por combinación de cliente y productos: volver con el
 * stepper reusa lo ya traído (ver `remitosEntregaEnCache`), y sólo cambiar los productos a devolver
 * la rehace.
 *
 * "Finalizar Operación" es el ÚNICO disparador de la escritura: suma la mercadería al stock (un
 * movimiento de ingreso por producto), acumula la cantidad devuelta en cada línea de remito
 * imputada y deja la nota de crédito pendiente de emitir. Las dos primeras se esperan —y al volver
 * la app se reinicia—; la nota de crédito se dispara sin esperarla.
 */
export function RemitoDevolucionView() {
  const { cliente, vendedor, operacion, tipoVenta, tipoEntrega, remito } = useApp()
  const dispatch = useDispatch()
  const yaRegistrada = remito.devolucionRegistrada

  /* La fecha de la devolución se fija AL ENTRAR al paso y no se recalcula en cada render: es la
     que mide los 30 días y la que se escribe en el movimiento de stock, así que las dos cosas
     tienen que hablar del mismo día aunque la pantalla quede abierta pasada la medianoche. */
  const [fechaDevolucion] = useState(hoy)

  const clienteId = cliente?.id
  /* Clave con la que se cruza cada producto contra las líneas de los remitos: el id del Maestro.
     En modo local (sin token) el catálogo de mentira no trae id, así que se cae al `uid` de la
     línea —el mismo que devuelven los remitos de mentira—, y el flujo se puede recorrer igual.
     Se serializa para que el efecto no se vuelva a disparar por una lista nueva pero igual. */
  const productoIds = useMemo(
    () => remito.items.map((it) => it.productoId ?? it.uid),
    [remito.items],
  )
  const claveProductos = productoIds.join(',')

  /* Lo ya consultado para ESTA combinación de cliente y productos, si la hay. Arrancar de la caché
     —y no de un estado vacío con `cargando` en true— es lo que hace que volver a la etapa con el
     stepper muestre la tabla armada al instante: ir y venir entre pasos no cambia la operación, así
     que no hay nada que recalcular. La consulta se rehace SÓLO al cambiar los productos a devolver. */
  const cacheados = clienteId ? remitosEntregaEnCache(clienteId, productoIds) : null
  const [remitos, setRemitos] = useState<RemitoEntrega[]>(cacheados ?? [])
  const [cargando, setCargando] = useState(cacheados === null)
  const [precios, setPrecios] = useState<PrecioLinea[]>([])
  /* Los precios llegan DESPUÉS de los remitos: mientras tanto las líneas de la nota de crédito no
     tienen importe, y eso no es un error que haya que pintar de rojo. */
  const [cargandoPrecios, setCargandoPrecios] = useState(false)

  const [estado, setEstado] = useState<EstadoRegistro>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sinImputar, setSinImputar] = useState(false)
  /* Cantidades corregidas a mano, por línea de remito. Sólo se llena cuando una fila quedó
     inválida: la imputación normal no se edita. */
  const [corregidas, setCorregidas] = useState<Record<string, number>>({})
  const [avisoInvalida, setAvisoInvalida] = useState(false)

  // Remitos de entrega del cliente que contienen los productos a devolver.
  useEffect(() => {
    if (!clienteId || productoIds.length === 0) {
      setRemitos([])
      setCargando(false)
      return
    }
    let vivo = true
    /* Con la consulta ya resuelta para esta combinación, la caché contesta al toque: no se pinta
       el "buscando" por un frame contra un resultado que ya estaba. */
    setCargando(remitosEntregaEnCache(clienteId, claveProductos.split(',')) === null)
    getRemitosEntregaCliente(clienteId, claveProductos.split(','))
      .then((rs) => vivo && setRemitos(rs))
      .catch(() => {
        if (!vivo) return
        setRemitos([])
        dispatch({
          type: 'errorMonday',
          accion: 'buscar los remitos de entrega del cliente',
        })
      })
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
    // `claveProductos` representa a `productoIds`: es su versión estable entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, claveProductos, dispatch])

  /* La imputación es DERIVADA: sale de lo declarado en el paso anterior y de los remitos traídos.
     No vive en el estado global justamente porque no se edita. */
  const calculadas: ImputacionProducto[] = useMemo(
    () =>
      imputarDevolucion(
        remito.items.map((it) => ({
          uid: it.uid,
          productoId: it.productoId ?? it.uid,
          codigo: it.codigo,
          nombre: it.nombre,
          um: it.um,
          cantidad: it.cantidad,
        })),
        remitos,
        fechaDevolucion,
      ),
    [remito.items, remitos, fechaDevolucion],
  )

  /* Las correcciones se aplican ACÁ, sobre la imputación calculada, y no en cada consumidor: así
     la tabla, la nota de crédito, el movimiento de stock y lo que se asienta en los remitos hablan
     todos de la misma cantidad. Los totales del producto se recalculan con las líneas ya corregidas. */
  const imputaciones: ImputacionProducto[] = useMemo(() => {
    if (Object.keys(corregidas).length === 0) return calculadas
    return calculadas.map((p) => {
      const lineas = p.lineas.map((l) =>
        l.subitemId in corregidas ? { ...l, imputada: corregidas[l.subitemId] } : l,
      )
      const imputada = round2(lineas.reduce((acc, l) => acc + l.imputada, 0))
      return {
        ...p,
        lineas,
        imputada,
        sinCubrir: round2(Math.max(p.solicitada - imputada, 0)),
      }
    })
  }, [calculadas, corregidas])

  /* Líneas que la regla dejó imposibles al calcularlas. Se marcan UNA vez, sobre el cálculo
     original, y quedan editables para el resto de la etapa: si el input apareciera y desapareciera
     según la cantidad tecleada, el control se movería debajo del cursor justo cuando el operador lo
     está usando. Corregida la cantidad se van los colores de error, pero el campo se queda. */
  const editables = useMemo(
    () =>
      new Set(calculadas.flatMap((p) => p.lineas.filter(lineaInvalida).map((l) => l.subitemId))),
    [calculadas],
  )

  const ajustarCantidad = (subitemId: string, cantidad: number) => {
    setCorregidas((prev) => ({ ...prev, [subitemId]: cantidad }))
    setAvisoInvalida(false)
  }

  /* Ninguna línea puede devolver más de lo que su remito entregó. Mientras alguna lo haga, la
     operación no se cierra: lo que se escribiría en el stock y en el remito sería falso. */
  const hayInvalidas = hayLineasInvalidas(imputaciones)

  /* Precio de venta de cada LÍNEA imputada: es el de la nota de crédito. Se pide recién cuando la
     imputación ya está resuelta, así se consultan sólo las ventas que se van a usar. */
  const remitosImputados = useMemo(() => {
    const ids = new Set(imputaciones.flatMap((p) => p.lineas.map((l) => l.remitoId)))
    return remitos.filter((r) => ids.has(r.id))
  }, [imputaciones, remitos])
  const claveImputados = remitosImputados.map((r) => r.id).join(',')

  useEffect(() => {
    if (remitosImputados.length === 0) {
      setPrecios([])
      return
    }
    let vivo = true
    setCargandoPrecios(true)
    getPreciosDeLineas(remitosImputados)
      .then((ps: PrecioLinea[]) => vivo && setPrecios(ps))
      /* La nota de crédito es informativa: si los precios no se pueden leer, la devolución igual
         se puede registrar. El panel lo dice. */
      .catch(() => vivo && setPrecios([]))
      .finally(() => vivo && setCargandoPrecios(false))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveImputados])

  const notaCredito: NotaCreditoPendiente = useMemo(
    () => construirNotaCredito(imputaciones, precios, fechaDevolucion),
    [imputaciones, precios, fechaDevolucion],
  )

  if (!cliente) return null

  const puedeRegistrar = hayImputacion(imputaciones)

  /**
   * Cierre de la operación. Dos escrituras, cada una en UNA sola solicitud a la API:
   *   1) un movimiento de ingreso por producto en "Stock y Movimientos" (suma al stock),
   *   2) la cantidad devuelta acumulada en cada línea de remito imputada (evita reimputarla).
   * La segunda es best-effort: si la columna todavía no existe en el board, el stock ya quedó
   * bien y la pantalla avisa qué falta.
   */
  const finalizar = async () => {
    if (yaRegistrada || estado === 'registrando') return
    /* Primero lo que está MAL, después lo que falta: con una cantidad imposible en la tabla, el
       aviso tiene que hablar de eso y no de que no hay nada para devolver. */
    if (hayInvalidas) {
      setAvisoInvalida(true)
      return
    }
    if (!puedeRegistrar) {
      setSinImputar(true)
      return
    }
    setEstado('registrando')
    setError(null)
    try {
      /* Lo que entra al stock es lo IMPUTADO, no lo declarado: por el excedente fuera de plazo no
         se emite remito de devolución, así que tampoco vuelve la mercadería. */
      const porProducto = imputaciones.filter((p) => p.imputada > 0)

      /* La nota de crédito sale PRIMERO y SIN `await`: así empieza a escribirse mientras corren
         las otras dos, y el cierre no la espera. Un fallo suyo tampoco puede tumbar la devolución
         —el stock y los remitos son lo que tiene que quedar bien—, así que se traga acá. */
      const aEmitir = notaCreditoAMonday(notaCredito)
      if (aEmitir.lineas.length > 0) {
        void crearNotaCredito({
          nombre: cliente.name,
          clienteId: cliente.id,
          vendedorId: vendedor?.id ?? null,
          vencimientoIso: aIso(aEmitir.vencimiento),
          total: aEmitir.total,
          iva: aEmitir.iva,
          lineas: aEmitir.lineas,
        }).catch(() => {
          /* Documento posterior: si no se pudo crear, se emite a mano. */
        })
      }

      const stock = await registrarDevolucionStock(
        porProducto.map((p) => ({
          stockId: remito.items.find((it) => it.uid === p.uid)?.stockId,
          nombre: p.nombre,
          cantidad: p.imputada,
        })),
        hoyIso(),
      )
      /* Un producto sin ítem de stock no frena el cierre, pero tampoco puede desaparecer sin dejar
         rastro: su devolución no movió ningún saldo y alguien va a tener que ajustarlo. */
      if (stock.sinItemDeStock.length > 0) {
        console.warn(
          '[devolución] sin ítem en el board de stock: ' + stock.sinItemDeStock.join(', '),
        )
      }

      await registrarDevolucionEnRemitos(
        porProducto.flatMap((p) =>
          p.lineas.map((l) => ({
            subitemId: l.subitemId,
            imputada: l.imputada,
          })),
        ),
      )

      /* Asentadas las cantidades devueltas, la operación está cerrada: la app vuelve al inicio sin
         pedir una confirmación más. */
      dispatch({ type: 'registrarDevolucion' })
      dispatch({ type: 'reset' })
    } catch {
      setEstado('error')
      setError(
        'No se pudo registrar la devolución. Revisá en Monday si quedó algún movimiento a medias antes de reintentar.',
      )
      dispatch({ type: 'errorMonday', accion: 'registrar la devolución' })
    }
  }

  const numero =
    indiceDePaso('remito-devolucion', operacion, tipoVenta, tipoEntrega, remito.tipoEmision) + 1

  return (
    <section className="view productos-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={numero - 1}
      />
      <PasoTitulo
        numero={numero}
        titulo="Imputación de remitos"
        descripcion={`La devolución se imputa automáticamente del remito de entrega más nuevo hacia atrás. Sólo entran los emitidos dentro de los ${DIAS_MAX_DEVOLUCION} días corridos previos al ${fechaDevolucion}.`}
      />

      {yaRegistrada && (
        <div className="card aviso-bloqueo">
          <i className="fas fa-lock" /> La devolución ya se registró en Monday: la mercadería sumó
          al stock y quedó imputada a los remitos. No se puede volver a registrar.
        </div>
      )}

      {/* Las dos piezas se dibujan SIEMPRE, desde el primer cuadro: la tabla con sus columnas y el
          buscando adentro, y la card de la nota de crédito vacía hasta que haya algo que acreditar.
          Así la etapa nace con su forma final y no salta de layout cuando llegan los datos. */}
      <TablaImputacion
        imputaciones={imputaciones}
        editables={editables}
        onCantidad={ajustarCantidad}
        cargando={cargando}
      />

      <NotaCreditoPanel nc={notaCredito} cargando={cargando || cargandoPrecios} />

      <div className="footer-acts">
        <button
          type="button"
          className="btn btn-out"
          disabled={yaRegistrada}
          title={
            yaRegistrada
              ? 'La devolución ya se registró: no se puede volver a editarla.'
              : undefined
          }
          onClick={() => dispatch({ type: 'goto', paso: 'remito-productos' })}
        >
          <i className="fas fa-arrow-left" /> Volver a paso anterior
        </button>
        {/* Queda clickeable aunque no haya nada imputado: la ventana explica POR QUÉ, en vez de
            dejar un botón muerto sin motivo. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={yaRegistrada || estado === 'registrando' || cargando || hayInvalidas}
          title={
            hayInvalidas
              ? 'Corregí las cantidades imputadas marcadas como inválidas para poder finalizar.'
              : undefined
          }
          onClick={finalizar}
        >
          {estado === 'registrando' ? (
            <>
              <i className="fas fa-circle-notch spin" /> Registrando devolución…
            </>
          ) : (
            <>
              <i className="fas fa-flag-checkered" /> Finalizar Operación
            </>
          )}
        </button>
      </div>

      {avisoInvalida && (
        <AvisoModal titulo="Hay cantidades inválidas" onClose={() => setAvisoInvalida(false)}>
          Alguna línea imputa más unidades de las que ese remito entregó. Corregí las cantidades
          marcadas en rojo antes de finalizar la operación.
        </AvisoModal>
      )}

      {sinImputar && (
        <AvisoModal titulo="No hay nada para devolver" onClose={() => setSinImputar(false)}>
          Ningún remito de entrega de este cliente con estos productos está dentro de los{' '}
          {DIAS_MAX_DEVOLUCION} días corridos, o ya se devolvió por completo. No se emite remito de
          devolución.
        </AvisoModal>
      )}

      {estado === 'error' && error && (
        <AvisoModal
          titulo="No se pudo registrar la devolución"
          onClose={() => {
            setError(null)
            setEstado('idle')
          }}
        >
          {error}
        </AvisoModal>
      )}

      {/* Tapa la pantalla mientras se escriben el stock y los remitos, igual que al registrar una
          venta. Al volver la segunda escritura la app se reinicia sola: no hay ventana de "listo",
          porque no queda nada que decidir. */}
      {estado === 'registrando' && (
        <ModalCargando
          titulo="Registrando devolución..."
          detalle="Estamos registrando los remitos imputados y creando la nota de crédito en el sistema. Espera unos segundos"
        />
      )}
    </section>
  )
}

/**
 * Remitos a imputar: UNA fila por línea de remito, con el producto adelante. Antes era una tabla
 * por producto; con varios productos devueltos eso multiplicaba encabezados y obligaba a leer la
 * misma información en tres lugares distintos.
 *
 * La cantidad imputada NO se edita: la calcula la regla. El input aparece únicamente cuando la
 * fila quedó inválida —imputar más de lo que ese remito entregó, que la regla no puede producir
 * pero un dato torcido del tablero sí—, y es la única forma de destrabar la operación.
 */
function TablaImputacion({
  imputaciones,
  editables,
  onCantidad,
  cargando,
}: {
  imputaciones: ImputacionProducto[]
  /** Líneas que nacieron imposibles: muestran el input mientras dure la etapa, corregidas o no. */
  editables: Set<string>
  onCantidad: (subitemId: string, cantidad: number) => void
  /** La consulta está en curso: la tabla conserva sus columnas y el aviso ocupa el lugar de las filas. */
  cargando: boolean
}) {
  // Filas visibles: lo imputado de cada producto y, detrás, lo que quedó afuera y por qué.
  const filas = cargando
    ? []
    : imputaciones.flatMap((p) => [
        ...p.lineas.map((l) => ({ prod: p, linea: l, descarte: null })),
        ...p.descartados.map((d) => ({ prod: p, linea: null, descarte: d })),
      ])

  /**
   * Unidades que NO van a volver por este producto: lo que se pidió POR ENCIMA de lo que sus
   * remitos pueden recibir mientras siga sin corregirse; y, si no hubo ningún remito donde imputar,
   * todo lo declarado. Bajada la cantidad a algo posible, el excedente deja de existir —el operador
   * ya decidió cuánto se devuelve— y el aviso se va.
   */
  const sinDevolver = (p: ImputacionProducto): number => {
    const excedente = round2(
      p.lineas.reduce((acc, l) => acc + Math.max(0, l.imputada - l.disponible), 0),
    )
    if (excedente > 0) return excedente
    return p.lineas.length === 0 ? p.sinCubrir : 0
  }
  const pendientes = imputaciones.filter((p) => sinDevolver(p) > 0)
  const hayPendientes = !cargando && pendientes.length > 0

  const celdaProducto = (p: ImputacionProducto) => (
    <td>
      {p.codigo && <span className="devol-prod-cod">{p.codigo}</span>}
      <span className="devol-prod">{p.nombre}</span>
    </td>
  )

  return (
    <div className="tablec">
      <div className="thtitle">Remitos a imputar{cargando ? '' : ` (${filas.length})`}</div>

      <div className="pend-scroll">
        <table className="pend-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Remito de entrega</th>
              <th className="ta-c">Fecha</th>
              <th className="ta-c">Antigüedad</th>
              <th className="ta-c">Cant. entregada</th>
              <th className="ta-c">Cantidad imputada</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={6} className="tablec-empty devol-cargando">
                  <i className="fas fa-circle-notch spin" /> Buscando y calculando remitos a imputar
                </td>
              </tr>
            )}
            {!cargando && filas.length === 0 && (
              <tr>
                <td colSpan={6} className="tablec-empty tablec-empty--alerta">
                  No hay remitos de entrega de este cliente con los productos a devolver.
                </td>
              </tr>
            )}

            {filas.map(({ prod, linea, descarte }) => {
              // Fila descartada: el remito existe y tiene mercadería, pero no es elegible.
              if (descarte) {
                return (
                  <tr key={`${descarte.remitoId}-${prod.uid}-descartado`} className="devol-fuera">
                    {celdaProducto(prod)}
                    <td>
                      <span className="devol-remito">{descarte.remitoNro}</span>
                    </td>
                    {/* La fecha de emisión es el MOTIVO del descarte: va en rojo, aunque el resto
                        de la fila esté apagada. */}
                    <td className="ta-c devol-fuera-fecha">{descarte.fecha || '—'}</td>
                    <td className="ta-c">
                      {descarte.dias != null ? `${descarte.dias} días` : '—'}
                    </td>
                    <td className="ta-c">—</td>
                    <td className="ta-c" style={{ color: 'var(--red)', fontWeight: 600 }}>
                      <span className="pend-qty-slot">
                        {descarte.motivo === 'PLAZO'
                          ? `Fuera de los ${DIAS_MAX_DEVOLUCION} días`
                          : 'Sin fecha de emisión'}
                      </span>
                    </td>
                  </tr>
                )
              }

              const l = linea!
              // Nunca se puede devolver más de lo que ese remito todavía podía recibir.
              const invalida = lineaInvalida(l)
              /* El campo se muestra si la línea nació mal, aunque ya esté corregida: lo que cambia
                 al corregirla son los colores, no la presencia del control. */
              const editable = editables.has(l.subitemId) || invalida
              return (
                <tr key={l.subitemId}>
                  {celdaProducto(prod)}
                  <td>
                    <span className="devol-remito">{l.remitoNro}</span>
                  </td>
                  <td className="ta-c">{l.fecha}</td>
                  <td className="ta-c">{l.dias} días</td>
                  <td className="ta-c">{l.entregada}</td>
                  <td className="ta-c">
                    {/* La ranura reserva SIEMPRE el alto del control, haya input o no: así todas
                        las filas de la tabla miden lo mismo y ninguna cambia de alto al corregir
                        una cantidad. */}
                    <span className="pend-qty-slot">
                      {editable ? (
                        /* Se muestra lo que el operador pidió devolver —no un valor recortado— y se
                         corrige acá mismo, con el mismo control de cantidad que el resto de la app
                         (teclear o las flechas). El motivo va en el `title` y no en un cartel
                         debajo: repetido en cada fila, el cartel pesaba más que el propio dato. */
                        <span
                          className={`qbox ${invalida ? 'qbox--error' : ''}`}
                          title={
                            invalida
                              ? `Este remito sólo puede recibir ${l.disponible} de vuelta. Corregí la cantidad para poder finalizar.`
                              : undefined
                          }
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Cantidad imputada de ${prod.nombre} en ${l.remitoNro}`}
                            aria-invalid={invalida}
                            value={l.imputada}
                            onChange={(e) =>
                              onCantidad(
                                l.subitemId,
                                Number(e.target.value.replace(/\D/g, '')) || 0,
                              )
                            }
                          />
                          <span className="qbtns">
                            <button
                              type="button"
                              aria-label={`Sumar una unidad de ${prod.nombre}`}
                              onClick={() => onCantidad(l.subitemId, l.imputada + 1)}
                            >
                              <i className="fas fa-angle-up" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Restar una unidad de ${prod.nombre}`}
                              disabled={l.imputada <= 0}
                              onClick={() => onCantidad(l.subitemId, l.imputada - 1)}
                            >
                              <i className="fas fa-angle-down" />
                            </button>
                          </span>
                        </span>
                      ) : (
                        <span style={{ fontWeight: 700 }}>{l.imputada}</span>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Lo que no va a volver, avisado una vez al pie y no producto por producto. Aparece con el
          excedente ya cargado en la tabla —desde el primer dibujado— y se va recién cuando ninguna
          cantidad supera lo que su remito puede recibir: mientras siga en rojo, esas unidades no
          se devuelven, y el aviso es lo que lo explica.

          El párrafo se dibuja SIEMPRE y se oculta con `visibility`, que conserva su caja: montarlo
          y desmontarlo cambiaba el alto de la tabla al corregir una cantidad, y la lista entera
          saltaba justo mientras el operador estaba tecleando. */}
      <p
        className={`devol-sincubrir ${hayPendientes ? '' : 'devol-sincubrir--reservado'}`}
        aria-hidden={!hayPendientes}
      >
        <i className="fas fa-triangle-exclamation" /> No se emite remito de devolución por el
        excedente: {pendientes.map((p) => `${p.nombre} (${sinDevolver(p)} ${p.um})`).join(', ')}.
      </p>
    </div>
  )
}

/**
 * Nota de crédito que deja la devolución. Todavía NO se escribe en ningún tablero: el destino en
 * Monday está sin definir, así que acá se muestra ya calculada —precio de la venta de cada línea
 * imputada, su IVA y su total— para que se vea exactamente qué se va a emitir.
 *
 * Es la MISMA card que el presupuesto y los comprobantes de la factura (`comp-*` + `CompBody`):
 * cabecera siempre visible con productos e importe, detalle por producto al desplegar y los
 * totales al pie. Se pliega con la misma animación que el resto.
 */
function NotaCreditoPanel({
  nc,
  cargando,
}: {
  nc: NotaCreditoPendiente
  /** Todavía no se sabe qué se va a acreditar: la card se dibuja, pero vacía. */
  cargando: boolean
}) {
  const [abierta, setAbierta] = useState(true)
  /* Mientras se resuelve la imputación no hay nada que acreditar: se muestran el encabezado y las
     columnas, y nada más. Rellenarla a medias —con las líneas pero sin sus precios— la haría pasar
     por una nota de crédito en cero, que es justo lo que no es. */
  const lineas = cargando ? [] : nc.lineas

  const enPesos = lineas.filter((l) => l.moneda === 'Pesos')
  const subtotal = round2(enPesos.reduce((acc, l) => acc + l.subtotal, 0))
  const iva = round2(enPesos.reduce((acc, l) => acc + l.ivaImporte, 0))
  const totalPesos = cargando ? 0 : nc.totalPesos
  const hayDolares = !cargando && nc.totalDolares > 0

  return (
    /* Las clases `comp-*` viven bajo el namespace `.factura-v2`, así que la card se monta dentro
       de él —igual que el remito a generar en la etapa de emisión— y se le neutraliza el box de
       página para que tome el ancho de la columna en vez de imponer el suyo. */
    <div className="factura-v2" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
      <div className="comprobantes">
        <div className="comp-card">
          <div className="comp-head">
            <button
              type="button"
              className="comp-toggle"
              aria-expanded={abierta}
              onClick={() => setAbierta((v) => !v)}
            >
              <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
              <span className="comp-tit">Nota de crédito pendiente de emisión</span>
            </button>

            <div className="comp-head-datos">
              <div className="comp-head-dato">
                <span className="comp-head-lbl">Productos</span>
                <span className="comp-head-val">{lineas.length}</span>
              </div>
              <div className="comp-head-dato">
                <span className="comp-head-lbl">Importe total</span>
                <span className="comp-head-val comp-head-val--imp">{money(totalPesos)}</span>
                {/* Los dólares no se mezclan con los pesos: van aparte, en verde, como en el resto. */}
                {hayDolares && (
                  <span
                    className="comp-head-val comp-head-val--imp"
                    style={{ color: 'var(--green-dark)', fontSize: '0.85em' }}
                  >
                    {moneyU(nc.totalDolares)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <CompBody abierta={abierta}>
            <div className="comp-body">
              <table className="comp-table comp-table--pareja">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="ta-c">Venta</th>
                    <th className="ta-c">Cantidad</th>
                    <th className="ta-r">Precio unitario</th>
                    <th className="ta-r">IVA</th>
                    <th className="ta-r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l, i) => {
                    const usd = l.moneda === 'Dólares'
                    const fmt = usd ? moneyU : money
                    const colUsd = usd ? 'var(--green-dark)' : undefined
                    return (
                      <tr key={`${l.remitoId}-${l.productoId ?? i}`}>
                        <td>
                          {l.codigo && <span className="comp-cod">{l.codigo}</span>}
                          <span className="comp-nom">{l.nombre}</span>
                        </td>
                        <td className="ta-c">{l.ventaNro || '—'}</td>
                        <td className="ta-c">{l.cantidad}</td>
                        <td className="ta-r" style={{ color: colUsd }}>
                          {l.sinPrecio ? (
                            <span style={{ color: 'var(--red)' }}>sin precio</span>
                          ) : (
                            <>
                              {fmt(l.precioUnitario)}
                              {/* En dólares la NC hereda el tipo de cambio de la factura original. */}
                              {usd && l.tipoCambio ? (
                                <span className="devol-tc"> · TC {l.tipoCambio}</span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="ta-r" style={{ color: colUsd }}>
                          {fmt(l.ivaImporte)}
                        </td>
                        <td className="ta-r comp-total-prod" style={{ color: colUsd }}>
                          {fmt(l.total)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Totales y advertencias SÓLO con líneas cargadas: mientras la imputación no está
                  resuelta, una NC en cero se leería como una nota de crédito sin importe, que es
                  justo lo que no es. Van en la misma posición y con las mismas clases que las demás
                  cards; la NC no lleva Descuento ni Gravado porque acredita el precio con el que se
                  vendió, tal cual, sin bonificaciones nuevas encima. */}
              {lineas.length > 0 && (
                <>
                  <div className="comp-pie">
                    <div className="comp-tot">
                      <div className="comp-tot-row">
                        <span>Subtotal</span>
                        <b>{money(subtotal)}</b>
                      </div>
                      <div className="comp-tot-row">
                        <span>IVA</span>
                        <b>{money(iva)}</b>
                      </div>
                      <div className="comp-tot-row comp-tot-row--total">
                        <span>Total</span>
                        <b>{money(totalPesos)}</b>
                      </div>
                      {hayDolares && (
                        <div
                          className="comp-tot-row comp-tot-row--total"
                          style={{ color: 'var(--green-dark)' }}
                        >
                          <span>Total en dólares</span>
                          <b>{moneyU(nc.totalDolares)}</b>
                        </div>
                      )}
                    </div>
                  </div>

                  {nc.incompleta && (
                    <p className="devol-sincubrir">
                      <i className="fas fa-triangle-exclamation" /> Falta el precio de alguna línea
                      en la venta de su remito: la nota de crédito no se puede emitir así.
                    </p>
                  )}
                </>
              )}
            </div>
          </CompBody>
        </div>
      </div>
    </div>
  )
}
