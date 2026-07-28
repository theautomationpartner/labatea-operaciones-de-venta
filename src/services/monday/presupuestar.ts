/**
 * Capa de servicio de la etapa PRESUPUESTAR contra los tableros de Monday de La Batea.
 * Cada función usa la query GraphQL validada si hay conexión (`mondayHabilitado`), y si no
 * cae a los datos mock para que el prototipo siga corriendo en local sin token.
 */
import {
  CATEGORIAS,
  CLIENTES,
  CONTACTOS_INICIALES,
  DIAS_VIGENCIA_INICIAL,
  PRESUPUESTOS,
  PRODUCTOS,
  RUBROS,
  SUBRUBROS,
} from '@/data/mock'
import { hoyIso } from '@/lib/dates'
import type {
  ActividadCliente,
  CampoFiltro,
  Cliente,
  CondicionPago,
  Contacto,
  CuentaBancaria,
  Filtro,
  LineaPresupuesto,
  ListaPrecio,
  MedioEnvio,
  Moneda,
  PresupuestoProducto,
  Producto,
  SituacionCliente,
  Vendedor,
} from '@/types'
import { DESCUENTO_PAGO_DEFAULT, FORMAS_PAGO, type DescuentosPago } from '@/lib/cobros'
import {
  BOARDS,
  COL,
  CONFIG_DESCUENTO_ITEM,
  CTA_BANCARIA_ACTIVA_INDEX,
  CONFIG_DIAS_VIGENCIA_ITEM,
  CONFIG_TIPO_MEDIOS_PAGO_INDEX,
  ENVIO_ESTADO,
  MEDIO_ENVIO_LABELS,
  MONEDA_LABEL,
  SITUACION_CLIENTE_INDEX,
  PRESUP_ENVIO_INDEX,
  PRESUP_ESTADO_VENTA_INDEX,
  PRESUP_ESTADO_EMITIR_LABEL,
  PRESUP_VIGENCIA_LABEL,
} from './columns'
import { DESCUENTO_MAX_DEFAULT, DESCUENTO_MIN_DEFAULT } from '@/lib/selectors'
import { round2 } from '@/lib/format'
import { precioConIva } from '@/lib/precios'
import {
  construirBulkRenombrado,
  construirBulkSubitems,
  type Renombrado,
} from './carritoSubitems'
import { byId, num, numCol, sumaMirror, valor, type CV, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/* ===== Similitud para búsqueda no exacta (≈60%) ===== */

const norm = (s: string) => s.toLowerCase().trim()

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const fila = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = fila[0]
    fila[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j]
      fila[j] = Math.min(
        fila[j] + 1,
        fila[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return fila[n]
}

/** Similitud 0..1 entre dos textos; la subcadena cuenta como coincidencia fuerte. */
export function similitud(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (y.includes(x) || x.includes(y)) return 0.9
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

const UMBRAL_SIMILITUD = 0.6

/* ===== 1) Días de vigencia (config, no editable) ===== */

/** Lee el valor de "Días de Vigencia" del tablero de configuración. Se lee una sola vez. */
export async function getDiasVigencia(): Promise<number> {
  if (!mondayHabilitado()) return DIAS_VIGENCIA_INICIAL
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { column_values(ids: ["${COL.config.valor}"]) { id text } } }`,
    { ids: [CONFIG_DIAS_VIGENCIA_ITEM] },
  )
  const valor = num(byId(data.items[0])[COL.config.valor]?.text)
  return valor || DIAS_VIGENCIA_INICIAL
}

/** Topes del descuento por producto, definidos en el tablero de configuración. */
export interface TopesDescuento {
  max: number
  min: number
}

/**
 * Lee el máximo y el mínimo de descuento del ítem "Descuento de Producto". Si el tablero no
 * los tiene cargados, se usan los valores por defecto de la app. Hoy la app sólo valida
 * contra el máximo; el mínimo se trae igual, por si vuelve a regir.
 */
export async function getTopesDescuento(): Promise<TopesDescuento> {
  const porDefecto = { max: DESCUENTO_MAX_DEFAULT, min: DESCUENTO_MIN_DEFAULT }
  if (!mondayHabilitado()) return porDefecto
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.config.descuentoMax}","${COL.config.descuentoMin}"]) { id text }
      }
    }`,
    { ids: [CONFIG_DESCUENTO_ITEM] },
  )
  const c = byId(data.items[0])
  return {
    max: num(c[COL.config.descuentoMax]?.text) || porDefecto.max,
    min: num(c[COL.config.descuentoMin]?.text) || porDefecto.min,
  }
}

/**
 * Descuento por pronto pago de cada forma de pago, tal como está cargado en el tablero de
 * configuración: los ítems marcados "Medios de Pago" en "Tipo de Config", cada uno con su
 * "Valor %". El nombre del ítem es el que identifica la forma de pago; se compara sin
 * distinguir mayúsculas porque el board escribe "Tarjeta de Débito" y la app, "de débito".
 *
 * Las formas que el tablero no traiga conservan el valor por defecto de la app: un medio de
 * pago sin configurar no debería quedar sin descuento por accidente.
 */
export async function getDescuentosPago(): Promise<DescuentosPago> {
  if (!mondayHabilitado()) return { ...DESCUENTO_PAGO_DEFAULT }
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.config}]) {
        items_page(
          limit: 50,
          query_params: {rules: [{column_id: "${COL.config.tipo}", compare_value: [${CONFIG_TIPO_MEDIOS_PAGO_INDEX}], operator: any_of}]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.config.valorPct}"]) { id text }
          }
        }
      }
    }`,
  )
  const descuentos = { ...DESCUENTO_PAGO_DEFAULT }
  for (const item of data.boards[0].items_page.items) {
    const forma = FORMAS_PAGO.find((f) => norm(f) === norm(item.name))
    if (!forma) continue
    const texto = byId(item)[COL.config.valorPct]?.text
    // Sin valor cargado no se pisa el default; un 0 explícito sí es un descuento válido.
    if (texto == null || texto.trim() === '') continue
    descuentos[forma] = num(texto)
  }
  return descuentos
}

/**
 * Cuentas bancarias ACTIVAS del cliente. Los dos filtros van en la consulta: el estado por
 * índice ("Activa" es el 1 de `color_mm57wxbx`) y la relación con Personas, que acota al
 * cliente. Las cuentas inactivas no llegan ni a la app.
 *
 * El id del cliente viaja como NÚMERO, no como string: `compare_value: ["12524661079"]` no
 * matchea nada en una columna `board_relation` —devuelve vacío sin error— y `[12524661079]`
 * sí. Comprobado contra la API.
 */
export async function getCuentasBancarias(clienteId: string): Promise<CuentaBancaria[]> {
  if (!mondayHabilitado() || !clienteId) return []
  const idNumerico = Number(clienteId)
  if (!Number.isFinite(idNumerico)) return []
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query ($cliente: CompareValue!) {
      boards(ids: [${BOARDS.ctasBancarias}]) {
        items_page(
          limit: 100,
          query_params: {rules: [
            {column_id: "${COL.ctaBancaria.estado}", compare_value: [${CTA_BANCARIA_ACTIVA_INDEX}], operator: any_of},
            {column_id: "${COL.ctaBancaria.cliente}", compare_value: $cliente, operator: any_of}
          ]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.ctaBancaria.banco}","${COL.ctaBancaria.cbu}","${COL.ctaBancaria.alias}","${COL.ctaBancaria.tipoCuenta}","${COL.ctaBancaria.numeroCuenta}"]) {
              id text
            }
          }
        }
      }
    }`,
    { cliente: [idNumerico] },
  )
  return data.boards[0].items_page.items.map((item) => {
    const c = byId(item)
    return {
      id: item.id,
      banco: valor(c[COL.ctaBancaria.banco]),
      cbu: valor(c[COL.ctaBancaria.cbu]),
      alias: valor(c[COL.ctaBancaria.alias]),
      tipoCuenta: valor(c[COL.ctaBancaria.tipoCuenta]),
      numeroCuenta: valor(c[COL.ctaBancaria.numeroCuenta]),
    }
  })
}

/* ===== 2) Búsqueda de cliente ===== */

/**
 * Situación del cliente a partir del ÍNDICE de la columna status, no de su texto: las
 * etiquetas del board ("0-Liberado Con Credito"…) se pueden reescribir, los índices no.
 * Sin índice cargado se asume la situación más restrictiva que no bloquea.
 */
function situacionDe(indice: number | null | undefined): SituacionCliente {
  switch (indice) {
    case SITUACION_CLIENTE_INDEX.liberadoConCredito:
      return 'Liberado con crédito'
    case SITUACION_CLIENTE_INDEX.bloqueado:
      return 'Bloqueado'
    default:
      return 'Liberado sin crédito'
  }
}

function mapCliente(item: MondayItem): Cliente {
  const c = byId(item)
  /* Cta Cte conectada. El crédito se calcula acá a partir de las columnas base, no de las
     fórmulas del board:
        saldo            = total ventas − total cobros
        línea utilizada  = saldo + remitos pendientes de facturar
        disponible       = límite − línea utilizada
     El límite sale de la mirror de la cuenta y, si no viene, del propio cliente. */
  const cta = c[COL.cliente.ctaCte]?.linked_items?.[0]
  const ctaCols = cta ? byId(cta) : {}
  const limiteCliente = num(c[COL.cliente.limite]?.text)
  /* Ventas y cobros son mirror de VARIOS movimientos: su display llega como lista ("977,
     3161621") y hay que sumarla. Remitos es un numérico común, y el límite una mirror de un
     solo valor: con `sumaMirror` un valor único se suma consigo mismo, así que va con numCol. */
  const totalVentas = sumaMirror(ctaCols[COL.ctaCte.totalVentas])
  const totalCobros = sumaMirror(ctaCols[COL.ctaCte.totalCobros])
  const remitosPendFacturar = numCol(ctaCols[COL.ctaCte.remitosPendFacturar])
  const limite = numCol(ctaCols[COL.ctaCte.limite]) || limiteCliente
  const saldoCtaCte = totalVentas - totalCobros
  const lineaUtilizada = saldoCtaCte + remitosPendFacturar
  const agente = c[COL.cliente.agenteRet]?.text ?? ''
  return {
    id: item.id,
    // El código del sistema es el que ve el usuario; el id del ítem queda para la API.
    codigo: c[COL.cliente.codigo]?.text?.trim() || item.id,
    name: item.name,
    cuit: c[COL.cliente.cuit]?.text ?? '',
    ptype: c[COL.cliente.tipoPersona]?.text ?? '',
    status: c[COL.cliente.condFiscal]?.text ?? '',
    list: (c[COL.cliente.listaPrecio]?.text as ListaPrecio) || null,
    ret: agente || 'Ninguna',
    agenteRetencion: agente.trim().length > 0,
    // Sin condición de pago en el board llega null: no se asume ninguna, y el paso lo frena.
    condicionPago: (c[COL.cliente.condPago]?.text?.trim() || null) as CondicionPago | null,
    limit: limite,
    // Ítem de Cta Cte: es el que se linkea en la deuda y donde van sus movimientos.
    ctaCteId: cta?.id,
    // Deuda real de la cuenta corriente: lo facturado menos lo cobrado.
    saldoCtaCte,
    // Lo que el cliente ya tiene tomado de su línea (saldo + remitos por facturar).
    lineaUtilizada,
    remitosPendFacturar,
    /* Sin Cta Cte conectada queda el límite completo: sin movimientos no se puede asumir
       que haya deuda. */
    disponible: cta ? limite - lineaUtilizada : limite,
    addr: c[COL.cliente.dirFiscal]?.text ?? '',
    activity: (c[COL.cliente.estado]?.text === 'Inactivo' ? 'Inactivo' : 'Activo') as ActividadCliente,
    situation: situacionDe(c[COL.cliente.situacion]?.index),
  }
}

/**
 * Detecta qué ingresó el usuario: código, CUIT/CUIL o nombre. El CUIT se guarda con guiones en
 * el board ("30-70906788-1"), así que se lo reconoce aunque se escriba con separadores o incompleto:
 * cualquier término formado sólo por dígitos y separadores, con 5 o más dígitos, se toma como
 * CUIT/CUIL. El código es la clave corta que ve el usuario: 4 dígitos exactos.
 */
type TipoBusqueda = 'codigo' | 'cuit' | 'nombre'
const tipoBusqueda = (t: string): TipoBusqueda => {
  if (/^\d{4}$/.test(t)) return 'codigo'
  if (/^[\d.\s-]+$/.test(t) && t.replace(/\D/g, '').length >= 5) return 'cuit'
  return 'nombre'
}

const columnasCliente = Object.values(COL.cliente)

async function fetchClientesMonday(): Promise<Cliente[]> {
  const ids = JSON.stringify(columnasCliente)
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.personas}]) {
        items_page(limit: 200) {
          items {
            id name
            column_values(ids: ${ids}) {
              id text
              ... on StatusValue { index }
              ... on BoardRelationValue {
                linked_items {
                  id name
                  column_values(ids: ["${COL.ctaCte.totalVentas}","${COL.ctaCte.totalCobros}","${COL.ctaCte.remitosPendFacturar}","${COL.ctaCte.limite}"]) {
                    id text
                    ... on MirrorValue { display_value }
                  }
                }
              }
            }
          }
        }
      }
    }`,
  )
  return data.boards[0].items_page.items
    // Sólo los que son Cliente (la categoría es multi-valor: "Cliente, Proveedor, ...").
    .filter((it) => (byId(it)[COL.cliente.categoria]?.text ?? '').includes('Cliente'))
    .map(mapCliente)
}

/**
 * Busca clientes por nombre, código de cliente (4 díg) o CUIT/CUIL (con o sin guiones, entero o
 * parcial). La coincidencia no es exacta: por nombre acepta ~60% de similitud y ordena por mejor
 * match; por CUIT compara sólo los dígitos, así "30-70906788-1" y "30709067881" dan lo mismo.
 *
 * Sólo devuelve clientes ACTIVOS: un cliente inactivo no puede operar, así que se filtra antes
 * de buscar y la vista lo trata como inexistente ("no existe o está inactivo").
 */
export async function buscarClientes(termino: string): Promise<Cliente[]> {
  const t = termino.trim()
  if (!t) return []
  const clientes = mondayHabilitado() ? await fetchClientesMonday() : CLIENTES
  // Los inactivos no se pueden operar: quedan fuera de todo criterio de búsqueda.
  const activos = clientes.filter((c) => c.activity === 'Activo')
  const tipo = tipoBusqueda(t)

  if (tipo === 'codigo') {
    // Se busca por el código del sistema (text_mm542r9d), que es el que ve el usuario.
    return activos.filter((c) => c.codigo === t || norm(c.codigo).includes(norm(t)))
  }
  if (tipo === 'cuit') {
    const soloDigitos = (s: string) => s.replace(/\D/g, '')
    return activos.filter((c) => soloDigitos(c.cuit).includes(soloDigitos(t)))
  }
  // Nombre: ranking por similitud, quedándonos con los que superan el umbral.
  return activos
    .map((c) => ({ c, s: similitud(t, c.name) }))
    .filter((x) => x.s >= UMBRAL_SIMILITUD)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)
}

/* ===== 3) Búsqueda de producto (precio/rentabilidad según lista del cliente) ===== */

/** Columna del precio unitario de la lista del cliente (L1..L8). */
const columnaPrecio = (lista: ListaPrecio): string => COL.precioLista[lista]

function mapProducto(item: MondayItem, lista: ListaPrecio, conIva: boolean): Producto {
  const c = byId(item)
  const margenCol = COL.margen[lista]
  return {
    // ID del ítem en Monday: lo necesita el subitem del presupuesto para linkear el producto.
    id: item.id,
    codigo: valor(c[COL.producto.codigo]),
    nombre: item.name,
    /* El precio de lista (fórmula) viene en display_value. Si el cliente paga IVA, se le
       suma la alícuota del propio producto ("✋IVA"). */
    precio: precioConIva(
      numCol(c[columnaPrecio(lista)]),
      numCol(c[COL.producto.iva]),
      conIva,
    ),
    rentabilidad: margenCol ? numCol(c[margenCol]) : 0,
    // El proveedor es el ítem conectado; su código, la mirror que espeja el del maestro.
    provCod: valor(c[COL.producto.proveedorCodigo]),
    provNombre: c[COL.producto.proveedor]?.linked_items?.[0]?.name ?? '',
    provId: c[COL.producto.proveedor]?.linked_items?.[0]?.id,
    tipo: valor(c[COL.producto.tipoMercaderia]),
    // La alícuota viaja con el producto: es la que se declara en la línea del comprobante.
    iva: numCol(c[COL.producto.iva]),
    rubro: valor(c[COL.producto.rubro]),
    subrubro: valor(c[COL.producto.subrubro]),
    categoria: valor(c[COL.producto.categoria]),
    // U.M. y peso los usa el remito (documenta cantidades y peso, no importes).
    um: valor(c[COL.producto.unidadMedida]),
    peso: numCol(c[COL.producto.peso]),
    fisico: numCol(c[COL.producto.stockFisico]),
    comercial: numCol(c[COL.producto.stockComercial]),
    disponible: numCol(c[COL.producto.stockDisponible]),
    // Ítem de stock del producto (para afectar el stock al cerrar la venta DIRECTA).
    stockId: c[COL.producto.stock]?.linked_items?.[0]?.id,
  }
}

/** Ítems por página. La búsqueda nunca baja el board entero: se pagina contra la API. */
export const PRODUCTOS_POR_PAGINA = 15

/** Una página de resultados: sus ítems y el cursor de la siguiente (null = última). */
export interface PaginaProductos {
  productos: Producto[]
  /** Cursor que devuelve Monday. Se guarda tal cual y se manda para pedir la página siguiente. */
  cursor: string | null
}

/** Columnas del producto que necesita la app, según la lista de precio del cliente. */
const columnasProducto = (lista: ListaPrecio): string =>
  JSON.stringify([
    COL.producto.codigo,
    COL.producto.rubro,
    COL.producto.subrubro,
    COL.producto.categoria,
    COL.producto.unidadMedida,
    COL.producto.peso,
    COL.producto.stockFisico,
    COL.producto.stockComercial,
    COL.producto.stockDisponible,
    COL.producto.proveedor,
    COL.producto.proveedorCodigo,
    COL.producto.tipoMercaderia,
    COL.producto.iva,
    COL.producto.stock,
    columnaPrecio(lista),
    ...(COL.margen[lista] ? [COL.margen[lista] as string] : []),
  ])

/**
 * Selección GraphQL de un producto: es la misma en la primera página y en las siguientes.
 * `display_value` trae el valor calculado de fórmulas (precio, márgenes, stock) y de las
 * mirror (el código del proveedor).
 */
const seleccionProducto = (lista: ListaPrecio): string => `
  id name
  column_values(ids: ${columnasProducto(lista)}) {
    id text
    ... on FormulaValue { display_value }
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { linked_items { id name } }
  }
`

/** Página tal como la devuelve la API, antes de mapear los ítems a `Producto`. */
interface PaginaCruda {
  cursor: string | null
  items: MondayItem[]
}

const mapPagina = (
  pagina: PaginaCruda | undefined,
  lista: ListaPrecio,
  conIva: boolean,
): PaginaProductos => ({
  productos: (pagina?.items ?? []).map((it) => mapProducto(it, lista, conIva)),
  cursor: pagina?.cursor ?? null,
})

/* ===== Constructor dinámico de la consulta (query_params) ===== */

/**
 * Una regla de `query_params`. Sólo se arman las de los criterios que el usuario eligió: un
 * criterio vacío NO genera regla (una regla con `compare_value: []` devuelve 0 resultados).
 */
interface ReglaBusqueda {
  column_id: string
  /** Lista de valores para `any_of`; texto suelto para `contains_text`. */
  compare_value: string | (string | number)[]
  operator: 'any_of' | 'contains_text'
}

/** `query_params` completo: las reglas válidas, todas intersectadas (AND entre criterios). */
interface QueryParamsProductos {
  rules: ReglaBusqueda[]
  operator: 'and'
}

/** Campo de filtro → columna dropdown del Maestro de Productos. */
const CAMPO_COLUMNA: Record<CampoFiltro, string> = {
  Rubro: COL.producto.rubro,
  Subrubro: COL.producto.subrubro,
  Categoría: COL.producto.categoria,
}

/** Sólo dígitos = código interno del producto. */
const esCodigo = (t: string): boolean => /^\d+$/.test(t)

/** label normalizado → id de la etiqueta, por campo. Es lo que aceptan las reglas de la API. */
type IndicesFiltros = Record<CampoFiltro, Record<string, number>>

/**
 * Reglas de taxonomía, una por criterio con valores elegidos:
 *   - OR dentro del criterio: todos sus valores en un mismo `any_of` (Rubro = A ó B).
 *   - AND entre criterios: cada criterio es una regla aparte bajo el `operator: and` raíz.
 *
 * Un criterio sin valores se OMITE por completo: no viaja como regla vacía.
 */
function reglasTaxonomia(filtros: Filtro[], indices: IndicesFiltros): ReglaBusqueda[] {
  const porCampo = new Map<CampoFiltro, number[]>()
  for (const f of filtros) {
    // Las columnas dropdown se filtran por el id de la etiqueta, no por su texto.
    const id = indices[f.campo]?.[norm(f.valor)]
    if (id === undefined) continue
    porCampo.set(f.campo, [...(porCampo.get(f.campo) ?? []), id])
  }
  const reglas: ReglaBusqueda[] = []
  for (const [campo, valores] of porCampo) {
    if (valores.length === 0) continue
    reglas.push({ column_id: CAMPO_COLUMNA[campo], compare_value: valores, operator: 'any_of' })
  }
  return reglas
}

/**
 * Arma el `query_params` de la búsqueda. Es 100% dinámico: sólo entran las columnas que el
 * usuario completó.
 *
 * - RAMA A · código interno: anula todo lo demás (nombre y filtros) y consulta por valor
 *   exacto contra "✋Codigo Interno". El código identifica un único producto.
 * - RAMA B · sólo filtros: no hace falta nombre; las reglas de taxonomía se mandan solas.
 * - RAMA C · híbrida: el nombre es un criterio más (`contains_text` sobre el nombre del ítem)
 *   que se intersecta con la taxonomía.
 *
 * Sin ningún criterio devuelve `undefined`: la consulta va sin `query_params` (el buscador ya
 * impide llegar acá sin término ni filtros).
 */
export function construirQueryProductos(
  termino: string,
  filtros: Filtro[],
  indices: IndicesFiltros,
): QueryParamsProductos | undefined {
  const t = termino.trim()
  if (esCodigo(t)) {
    return {
      rules: [{ column_id: COL.producto.codigo, compare_value: [t], operator: 'any_of' }],
      operator: 'and',
    }
  }
  const rules = reglasTaxonomia(filtros, indices)
  if (t) rules.push({ column_id: 'name', compare_value: t, operator: 'contains_text' })
  return rules.length > 0 ? { rules, operator: 'and' } : undefined
}

/** Primera página contra Monday: es la única consulta que lleva `query_params`. */
async function fetchPaginaProductos(
  queryParams: QueryParamsProductos | undefined,
  lista: ListaPrecio,
  conIva: boolean,
): Promise<PaginaProductos> {
  const data = await mondayApi<{ boards: { items_page: PaginaCruda }[] }>(
    `query ($limit: Int!, $qp: ItemsQuery) {
      boards(ids: [${BOARDS.productos}]) {
        items_page(limit: $limit, query_params: $qp) {
          cursor
          items { ${seleccionProducto(lista)} }
        }
      }
    }`,
    { limit: PRODUCTOS_POR_PAGINA, qp: queryParams ?? null },
  )
  return mapPagina(data.boards[0]?.items_page, lista, conIva)
}

/** Texto de la taxonomía del producto según el campo de filtro. */
const campoDeProducto = (p: Producto, campo: CampoFiltro): string =>
  campo === 'Rubro' ? p.rubro ?? '' : campo === 'Subrubro' ? p.subrubro ?? '' : p.categoria ?? ''

/**
 * Filtros de taxonomía en memoria: OR dentro de un mismo campo (Rubro A ó B) y AND entre campos.
 * Es el equivalente local de las reglas de `query_params` y se usa SÓLO en modo mock (sin token);
 * contra Monday la combinación la resuelve el servidor.
 */
function pasaFiltros(p: Producto, filtros: Filtro[]): boolean {
  if (filtros.length === 0) return true
  const porCampo = new Map<CampoFiltro, string[]>()
  for (const f of filtros) {
    porCampo.set(f.campo, [...(porCampo.get(f.campo) ?? []), f.valor.toLowerCase()])
  }
  for (const [campo, valores] of porCampo) {
    const tokens = campoDeProducto(p, campo)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (!valores.some((v) => tokens.includes(v))) return false
  }
  return true
}

/**
 * Página de resultados del catálogo. TODA la combinación de criterios y el corte de a
 * `PRODUCTOS_POR_PAGINA` los resuelve el servidor de Monday (`query_params` + `items_page`):
 * acá no se descarga el board para recortarlo después.
 *
 * - RAMA A · código interno (sólo dígitos): consulta directa y exacta por "✋Codigo Interno"
 *   (text_mm5ghnv7), ignorando nombre y filtros. El código es único por producto.
 * - RAMA B · sólo filtros: no exige nombre; alcanza con los criterios de taxonomía.
 * - RAMA C · híbrida: OR dentro de un mismo criterio (`any_of`) y AND entre criterios distintos
 *   (`operator: and` raíz), con el nombre como un criterio más.
 *
 * El precio sale de la columna de la lista del cliente (L1..L8). `conIva` agrega la alícuota
 * del producto: la pagan Monotributista, Consumidor Final y Exento, no el Resp. Inscripto.
 */
export async function buscarProductos(
  termino: string,
  lista: ListaPrecio,
  conIva: boolean,
  filtros: Filtro[] = [],
): Promise<PaginaProductos> {
  const t = termino.trim()
  // Sin conexión el prototipo sigue corriendo contra el mock, con las mismas ramas y páginas.
  if (!mondayHabilitado()) return primeraPaginaMock(t, filtros)
  const { indices } = await getTaxonomiaProductos()
  return fetchPaginaProductos(construirQueryProductos(t, filtros, indices), lista, conIva)
}

/**
 * Página siguiente. Va SÓLO con el cursor: Monday guarda en él la consulta original, así que
 * no se reenvían ni los filtros ni el término. Un cursor vence a la hora; agotado el listado,
 * la API deja de devolver cursor y la navegación se termina.
 */
export async function siguientePaginaProductos(
  cursor: string,
  lista: ListaPrecio,
  conIva: boolean,
): Promise<PaginaProductos> {
  if (!mondayHabilitado()) return siguientePaginaMock(cursor)
  const data = await mondayApi<{ next_items_page: PaginaCruda }>(
    `query ($limit: Int!, $cursor: String!) {
      next_items_page(limit: $limit, cursor: $cursor) {
        cursor
        items { ${seleccionProducto(lista)} }
      }
    }`,
    { limit: PRODUCTOS_POR_PAGINA, cursor },
  )
  return mapPagina(data.next_items_page, lista, conIva)
}

/* ===== 3b) Paginación del mock (modo local, sin token) ===== */

/** Resultado completo de la última búsqueda mock: de él salen las páginas siguientes. */
let mockResultados: Producto[] = []

/** Corta el resultado mock en páginas, con un cursor que sólo guarda el corrimiento. */
const paginaMock = (desde: number): PaginaProductos => {
  const productos = mockResultados.slice(desde, desde + PRODUCTOS_POR_PAGINA)
  const proximo = desde + PRODUCTOS_POR_PAGINA
  return { productos, cursor: proximo < mockResultados.length ? `mock:${proximo}` : null }
}

/** Mismas ramas que la consulta real, resueltas en memoria sobre el catálogo de ejemplo. */
function primeraPaginaMock(termino: string, filtros: Filtro[]): PaginaProductos {
  mockResultados = esCodigo(termino)
    ? PRODUCTOS.filter((p) => p.codigo.trim() === termino)
    : PRODUCTOS.filter(
        (p) => pasaFiltros(p, filtros) && (!termino || norm(p.nombre).includes(norm(termino))),
      )
  return paginaMock(0)
}

const siguientePaginaMock = (cursor: string): PaginaProductos =>
  paginaMock(Number(cursor.replace('mock:', '')) || 0)

/* ===== 3c) Opciones de los filtros (labels reales de las columnas dropdown) ===== */

/** Opciones disponibles para cada filtro de taxonomía. */
export type OpcionesFiltros = Record<CampoFiltro, string[]>

/** Taxonomía del Maestro: los labels que se muestran y los ids con los que se filtra. */
interface TaxonomiaProductos {
  opciones: OpcionesFiltros
  indices: IndicesFiltros
}

/** Etiquetas de una columna dropdown a partir de su `settings_str`. */
const etiquetasDropdown = (settingsStr: string): { id: number; name: string }[] => {
  const parsed = JSON.parse(settingsStr) as { labels?: { id: number; name: string }[] }
  return parsed.labels ?? []
}

const taxonomiaMock = (): TaxonomiaProductos => {
  const indices = { Rubro: {}, Subrubro: {}, Categoría: {} } as IndicesFiltros
  return { opciones: { Rubro: RUBROS, Subrubro: SUBRUBROS, Categoría: CATEGORIAS }, indices }
}

/** Se lee una sola vez por sesión: las etiquetas del board no cambian mientras se opera. */
let taxonomiaCache: Promise<TaxonomiaProductos> | null = null

/**
 * Lee las columnas dropdown de Rubro/Subrubro/Categoría del Maestro de Productos: de ahí salen
 * tanto los labels de los selectores como los IDS de etiqueta, que son los que aceptan las
 * reglas de `query_params` (una columna dropdown no se filtra por su texto).
 */
function getTaxonomiaProductos(): Promise<TaxonomiaProductos> {
  if (!mondayHabilitado()) return Promise.resolve(taxonomiaMock())
  if (taxonomiaCache) return taxonomiaCache
  taxonomiaCache = mondayApi<{ boards: { columns: { id: string; settings_str: string }[] }[] }>(
    `query {
      boards(ids: [${BOARDS.productos}]) {
        columns(ids: ["${COL.producto.rubro}","${COL.producto.subrubro}","${COL.producto.categoria}"]) {
          id settings_str
        }
      }
    }`,
  )
    .then((data) => {
      const cols = data.boards[0]?.columns ?? []
      const de = (id: string) => {
        const col = cols.find((c) => c.id === id)
        return col ? etiquetasDropdown(col.settings_str) : []
      }
      const opciones = {} as OpcionesFiltros
      const indices = {} as IndicesFiltros
      for (const [campo, columna] of Object.entries(CAMPO_COLUMNA) as [CampoFiltro, string][]) {
        const etiquetas = de(columna)
        opciones[campo] = etiquetas.map((l) => l.name)
        indices[campo] = Object.fromEntries(etiquetas.map((l) => [norm(l.name), l.id]))
      }
      return { opciones, indices }
    })
    .catch((e) => {
      // Un error no puede dejar cacheada una taxonomía vacía: se reintenta en la próxima búsqueda.
      taxonomiaCache = null
      throw e
    })
  return taxonomiaCache
}

/**
 * Opciones de Rubro/Subrubro/Categoría para poblar los selectores de filtro. Salen de las
 * mismas columnas dropdown que después se usan para filtrar del lado del servidor.
 */
export async function getOpcionesFiltros(): Promise<OpcionesFiltros> {
  return (await getTaxonomiaProductos()).opciones
}

/* ===== 4) Contactos del cliente (según "Para Enviar") ===== */

function mapContacto(item: MondayItem, documento: string): Contacto {
  const c = byId(item)
  const paraEnviar = c[COL.contacto.paraEnviar]?.text ?? ''
  // Acepta el documento si el nombre del documento está entre sus valores de "Para Enviar".
  const ok = norm(paraEnviar).includes(norm(documento))

  // El nombre se arma con las columnas Nombre + Apellido del board, no con el `name` del
  // ítem (que suele traer la empresa). Si ninguna vino cargada, se cae al nombre del ítem.
  const nombre = (c[COL.contacto.nombre]?.text ?? '').trim()
  const apellido = (c[COL.contacto.apellido]?.text ?? '').trim()
  const completo = [nombre, apellido].filter(Boolean).join(' ') || item.name

  return {
    id: c[COL.contacto.codigo]?.text || item.id,
    itemId: item.id,
    name: completo,
    phone: c[COL.contacto.telefono]?.text ?? '',
    email: c[COL.contacto.email]?.text ?? '',
    // Iniciales: la del nombre y la del apellido cuando existen.
    ini: completo
      .split(' ')
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase(),
    color: '#0073ea',
    status: ok ? `ACEPTA ${documento.toUpperCase()}` : `NO ACEPTA ${documento.toUpperCase()}`,
    ok,
  }
}

/**
 * Trae todos los contactos del cliente (columna conectada `account_contact`) y los clasifica
 * según si aceptan el documento a emitir. `documento` es "Presupuesto" / "Factura" / "Remito".
 */
export async function getContactosCliente(
  clienteId: string,
  documento = 'Presupuesto',
): Promise<Contacto[]> {
  if (!mondayHabilitado()) return CONTACTOS_INICIALES
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.cliente.contactos}"]) {
          ... on BoardRelationValue {
            linked_items {
              id name
              column_values(ids: ["${COL.contacto.codigo}","${COL.contacto.nombre}","${COL.contacto.apellido}","${COL.contacto.email}","${COL.contacto.telefono}","${COL.contacto.paraEnviar}"]) { id text }
            }
          }
        }
      }
    }`,
    { ids: [clienteId] },
  )
  const linked = data.items[0]?.column_values[0]?.linked_items ?? []
  return linked.map((it) => mapContacto(it, documento))
}

/* ===== 5) Presupuestos: leer estados y crear item ===== */

/** Lee (una vez) el mapa label→índice de la columna de estado del presupuesto. */
export async function getEstadoPresupuestoIndices(): Promise<Record<string, number>> {
  if (!mondayHabilitado()) return { Emitir: 4, 'Pend de Emitir': 5, Emitido: 6, Emitiendo: 7, 'Error Emision': 8 }
  const data = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.presupuestos}]) { columns(ids: ["${COL.presupuesto.estadoPdf}"]) { settings_str } } }`,
  )
  const labels = JSON.parse(data.boards[0].columns[0].settings_str).labels as Record<string, string>
  return Object.fromEntries(Object.entries(labels).map(([idx, label]) => [label, Number(idx)]))
}

/** Datos necesarios para materializar el presupuesto en Monday. Vienen del estado de la app. */
export interface DatosPresupuesto {
  cliente: Cliente
  vendedor: Vendedor | null
  lineas: LineaPresupuesto[]
  /** dd/MM/yyyy (formato del ERP). Se convierte a yyyy-MM-dd para Monday. */
  fechaEmision: string
  fechaVencimiento: string
  diasVigencia: number
  /** Rentabilidad general ponderada (%). */
  rentabilidad: number
  /** Moneda del presupuesto: define cuál de las dos fórmulas de subtotal se completa. */
  moneda: Moneda
}

/** dd/MM/yyyy → yyyy-MM-dd (formato que espera la columna date de Monday). */
const fechaMonday = (v: string): string | null => {
  const [d, m, y] = v.split('/')
  return d && m && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null
}

/** Productos por solicitud. Acota el costo de la mutation al presupuesto de complejidad. */
const SUBITEMS_POR_TANDA = 25

/** Resultado de crear el presupuesto: sirve para saber si quedó completo. */
export interface PresupuestoCreado {
  id: string
  /** Subelementos efectivamente creados; se compara contra la cantidad de productos. */
  subitemsCreados: number
  /** Productos que no se pudieron crear ni en el reintento. Vacío = presupuesto completo. */
  productosSinCrear: string[]
}

/** Renombrado de un subelemento: "<ID del presupuesto> - <ID del subelemento>". */
const renombradoSub = (
  sub: { id: string; column_values: { text: string | null }[] },
  pulsePadre: string,
): Renombrado => ({
  id: sub.id,
  boardId: BOARDS.presupuestosSub,
  nombre: `${pulsePadre} - ${sub.column_values[0]?.text || sub.id}`,
})

/**
 * Crea UN subelemento por su cuenta. Es el reintento de las líneas que la solicitud bulk no
 * devolvió: si vuelve a fallar se informa, pero no se corta la creación de las demás.
 */
async function crearSubitemSuelto(
  itemId: string,
  linea: LineaPresupuesto,
): Promise<{ id: string; column_values: { text: string | null }[] } | null> {
  const bulk = construirBulkSubitems([linea], 0)
  if (!bulk) return null
  try {
    const res = await mondayApi<
      Record<string, { id: string; column_values: { text: string | null }[] } | null>
    >(bulk.query, { ...bulk.variables, parentId: itemId })
    const sub = res[bulk.alias[0]]
    return sub?.id ? sub : null
  } catch {
    return null
  }
}

/**
 * Crea el presupuesto: el ítem en el board con su cabecera (vigencia "Vigente") y todos los
 * productos como subitems. Se dispara al confirmar desde "Continuar a emisión" y es el único
 * lugar donde nace el presupuesto; emitirlo es un paso aparte (`emitirPresupuesto`).
 *
 * Flujo (board real 18421035513):
 *   1. `create_item` con la cabecera y su pulse_id (pulse_id_mkwb5sj3) en la misma respuesta.
 *   2. UNA solicitud con todos los subitems (los fragmentos del carrito, con alias `s0`, `s1`…),
 *      que devuelve el pulse_id de cada uno (pulse_id_mkw8mfdg), más un reintento suelto por
 *      cada línea que no haya vuelto.
 *   3. UNA solicitud que renombra todo junto: el ítem con su ID ("PRESUP-009") y cada producto
 *      con "<ID del presupuesto> - <ID del subelemento>".
 *
 * Son 3 llamadas fijas en vez de 2 + 2n: 10 productos pasaban de 22 solicitudes a 3. Con más
 * de `SUBITEMS_POR_TANDA` productos, los pasos 2 y 3 se parten en tandas para no exceder el
 * presupuesto de complejidad de la API. El subtotal es fórmula: no se setea.
 */
export async function crearPresupuesto(datos: DatosPresupuesto): Promise<PresupuestoCreado> {
  if (!mondayHabilitado()) {
    return {
      id: `mock-${Date.now()}`,
      subitemsCreados: datos.lineas.length,
      productosSinCrear: [],
    }
  }
  const { cliente, lineas, fechaEmision, fechaVencimiento, diasVigencia, rentabilidad, moneda } =
    datos

  // Cabecera. El vendedor (person) se deja vacío: todavía no hay vendedores cargados en Monday.
  const emision = fechaMonday(fechaEmision)
  const vencimiento = fechaMonday(fechaVencimiento)
  const cabecera: Record<string, unknown> = {
    [COL.presupuesto.cliente]: { item_ids: [Number(cliente.id)] },
    [COL.presupuesto.diasVigencia]: String(diasVigencia),
    [COL.presupuesto.rentabilidad]: String(Math.round(rentabilidad)),
    [COL.presupuesto.vigencia]: { label: PRESUP_VIGENCIA_LABEL },
    // Un presupuesto recién creado no vendió nada: "0% Vendido" (por índice, no por label).
    [COL.presupuesto.estadoVenta]: { index: PRESUP_ESTADO_VENTA_INDEX.sinVender },
    // De esta columna dependen las fórmulas de subtotal: en "Dolares" se completa
    // formula_mm5f75gm ($u x prod) y en "Pesos", formula_mm58pwc ($ x prod).
    [COL.presupuesto.moneda]: { label: MONEDA_LABEL[moneda] },
  }
  if (emision) cabecera[COL.presupuesto.fechaEmision] = { date: emision }
  if (vencimiento) cabecera[COL.presupuesto.fechaVencimiento] = { date: vencimiento }

  // 1) Crear el ítem base y leer su pulse_id en la misma respuesta.
  const creado = await mondayApi<{
    create_item: { id: string; column_values: { id: string; text: string | null }[] }
  }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) {
        id
        column_values(ids: ["${COL.presupuesto.pulseId}"]) { id text }
      }
    }`,
    { boardId: BOARDS.presupuestos, name: cliente.name, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id
  // pulse_id_mkwb5sj3: el ID del board (p. ej. "PRESUP-009"). Es el nombre final del ítem.
  const pulsePadre = creado.create_item.column_values[0]?.text || itemId

  /* 2) Todos los subitems del carrito, en una sola solicitud por tanda.
     La respuesta se controla alias por alias: Monday puede devolver `null` en un
     `create_subitem` sin marcar la solicitud como fallida, y esa línea se perdía en silencio
     (un presupuesto de 3 productos quedaba con 2). Las que no volvieron se reintentan de a
     una, y las que sigan sin entrar se informan al final. */
  const renombrados: Renombrado[] = []
  const faltantes: LineaPresupuesto[] = []
  for (let desde = 0; desde < lineas.length; desde += SUBITEMS_POR_TANDA) {
    const tanda = lineas.slice(desde, desde + SUBITEMS_POR_TANDA)
    const bulk = construirBulkSubitems(tanda, desde)
    if (!bulk) continue

    const res = await mondayApi<
      Record<string, { id: string; column_values: { text: string | null }[] } | null>
    >(bulk.query, { ...bulk.variables, parentId: itemId })

    // El nombre definitivo necesita el pulse_id del subelemento (pulse_id_mkw8mfdg), que
    // recién ahora se conoce: queda "<ID del presupuesto> - <ID del subelemento>".
    bulk.alias.forEach((alias, i) => {
      const sub = res[alias]
      if (!sub?.id) {
        faltantes.push(tanda[i])
        return
      }
      renombrados.push(renombradoSub(sub, pulsePadre))
    })
  }

  // 2.b) Reintento de las líneas que no entraron, una por solicitud.
  const sinCrear: LineaPresupuesto[] = []
  for (const linea of faltantes) {
    const sub = await crearSubitemSuelto(itemId, linea)
    if (sub) renombrados.push(renombradoSub(sub, pulsePadre))
    else sinCrear.push(linea)
  }

  // 3) Renombrado final: el ítem y todos sus productos en la misma solicitud.
  const todos: Renombrado[] = [
    { id: itemId, boardId: BOARDS.presupuestos, nombre: pulsePadre },
    ...renombrados,
  ]
  for (let desde = 0; desde < todos.length; desde += SUBITEMS_POR_TANDA) {
    const bulk = construirBulkRenombrado(todos.slice(desde, desde + SUBITEMS_POR_TANDA))
    if (bulk) await mondayApi(bulk.query, bulk.variables)
  }

  return {
    id: itemId,
    subitemsCreados: renombrados.length,
    productosSinCrear: sinCrear.map((l) => l.producto.nombre),
  }
}

/**
 * Pone el estado del PDF en "Emitir" (color_mkw81a0d): dispara la automatización nativa de
 * Monday → escenario de Make.com que genera y sube el PDF a la columna file.
 */
export async function emitirPresupuesto(itemId: string): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: itemId,
      board: BOARDS.presupuestos,
      cv: JSON.stringify({ [COL.presupuesto.estadoPdf]: { label: PRESUP_ESTADO_EMITIR_LABEL } }),
    },
  )
}

/* ===== 7) Envío del presupuesto a los contactos ===== */

/**
 * Paso 1 del envío: deja en el presupuesto a quién y por dónde mandarlo — los contactos en la
 * columna conectada (board_relation_mm54hpns) y el medio en el dropdown (dropdown_mm5f5rhv).
 * No dispara nada todavía: eso lo hace `dispararEnvio`.
 */
export async function asignarDestinatarios(
  itemId: string,
  contactoItemIds: string[],
  medio: MedioEnvio,
): Promise<void> {
  if (!mondayHabilitado()) return
  const ids = contactoItemIds.map(Number).filter((n) => Number.isFinite(n))
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: itemId,
      board: BOARDS.presupuestos,
      cv: JSON.stringify({
        [COL.presupuesto.contactos]: { item_ids: ids },
        [COL.presupuesto.medioEnvio]: { labels: MEDIO_ENVIO_LABELS[medio] },
      }),
    },
  )
}

/**
 * Paso 2: pone el estado de envío en "A Enviar" (color_mm48mc2p, por índice porque el label
 * tiene doble espacio en el board). Ese cambio es el que dispara el envío.
 */
export async function dispararEnvio(itemId: string): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: itemId,
      board: BOARDS.presupuestos,
      cv: JSON.stringify({ [COL.presupuesto.estadoEnvio]: { index: PRESUP_ENVIO_INDEX } }),
    },
  )
}

/** Lee el estado de envío del presupuesto tal cual está en la columna. */
export async function getEstadoEnvio(itemId: string): Promise<string> {
  if (!mondayHabilitado()) return ENVIO_ESTADO.enviado
  const data = await mondayApi<{ items: { column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) { column_values(ids: ["${COL.presupuesto.estadoEnvio}"]) { text } }
    }`,
    { ids: [itemId] },
  )
  return data.items[0]?.column_values[0]?.text?.trim() ?? ''
}

/** Estados en los que el envío ya terminó: no tiene sentido seguir consultando. */
const ENVIO_FINALES: readonly string[] = [ENVIO_ESTADO.enviado, ENVIO_ESTADO.error]

/**
 * Sigue el estado de envío hasta que la automatización lo cierra ("Enviado" o "Error en
 * Envio"). Avisa cada cambio por `onEstado`, para poder reflejarlo en la interfaz. Devuelve
 * el último estado leído; si se agota la espera, devuelve el que haya quedado.
 */
export async function seguirEnvio(
  itemId: string,
  onEstado: (estado: string) => void,
  { intentos = 30, intervalo = 2000 }: { intentos?: number; intervalo?: number } = {},
): Promise<string> {
  if (!mondayHabilitado()) {
    onEstado(ENVIO_ESTADO.enviando)
    await esperar(1200)
    onEstado(ENVIO_ESTADO.enviado)
    return ENVIO_ESTADO.enviado
  }
  let ultimo = ''
  for (let i = 0; i < intentos; i++) {
    const estado = await getEstadoEnvio(itemId)
    if (estado && estado !== ultimo) {
      ultimo = estado
      onEstado(estado)
    }
    if (ENVIO_FINALES.includes(estado)) return estado
    await esperar(intervalo)
  }
  return ultimo
}

/* ===== 5.b) Próximo número de presupuesto ===== */

/** Formato del ID del board: prefijo + número con ceros (p. ej. "PRESUP-008"). */
const NRO_PRESUPUESTO_RE = /^(.*?)(\d+)$/

/**
 * Calcula el ID que va a llevar el próximo presupuesto: lee el `pulse_id` del último ítem
 * creado en el board y le suma uno, conservando prefijo y ceros ("PRESUP-008" → "PRESUP-009").
 *
 * Es una estimación: el ID definitivo lo asigna Monday recién al crear el ítem. Sirve para
 * mostrarlo en el resumen antes de emitir.
 */
export async function getProximoNroPresupuesto(): Promise<string | null> {
  if (!mondayHabilitado()) return null
  const data = await mondayApi<{
    boards: { items_page: { items: { column_values: { text: string | null }[] }[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.presupuestos}]) {
        items_page(limit: 1, query_params: {order_by: [{column_id: "__creation_log__", direction: desc}]}) {
          items { column_values(ids: ["${COL.presupuesto.pulseId}"]) { text } }
        }
      }
    }`,
  )
  const ultimo = data.boards[0]?.items_page?.items[0]?.column_values[0]?.text?.trim()
  if (!ultimo) return null

  const m = NRO_PRESUPUESTO_RE.exec(ultimo)
  if (!m) return null
  const [, prefijo, numero] = m
  return `${prefijo}${String(Number(numero) + 1).padStart(numero.length, '0')}`
}

/* ===== 5.c) Presupuestos vigentes del cliente (origen de la venta presupuestada) ===== */

/** Un presupuesto del cliente todavía vigente, con todos sus productos. */
export interface PresupuestoVigente {
  /** ID del ítem en Monday. */
  id: string
  /** ID del presupuesto tal como se ve en el board (el `name` del ítem). */
  nro: string
  /** "🤖Estado Vigencia" del board. */
  vigencia: string
  /** Fecha de vencimiento (yyyy-MM-dd). */
  vencimiento: string
  /** "🤖Rentabilidad % GENERAL" del board. */
  rentabilidad: number
  /** Importe total, sumado de los subelementos (las mirror de total no salen por la API). */
  importe: number
  productos: PresupuestoProducto[]
}

/** Importe de una línea del presupuesto: cantidad × precio unitario, ya bonificado. */
const importeLinea = (p: PresupuestoProducto): number =>
  round2(p.total * p.precio * (1 - (p.descuento ?? 0) / 100))

function mapPresupuestoProducto(sub: MondayItem): PresupuestoProducto {
  const c = byId(sub)
  const producto = c[COL.presupuestoSub.producto]?.linked_items?.[0]
  const prodCols = producto ? byId(producto) : {}
  const proveedor = prodCols[COL.producto.proveedor]?.linked_items?.[0]
  const presupuestada = numCol(c[COL.presupuestoSub.cantidad])
  const vendida = numCol(c[COL.presupuestoSub.cantVendida])
  return {
    /* El nombre viene del producto conectado en "📦Producto Seleccionado"
       (board_relation_mm57gxye), NUNCA del nombre del subítem —que se renombra con IDs
       ("12580972657 · 12580960919") y no dice nada al usuario—. Sin producto conectado se
       avisa que la línea del presupuesto no lo tiene, en vez de mostrar el ID. */
    nombre: producto?.name || 'Producto sin asignar',
    codigo: valor(prodCols[COL.producto.codigo]),
    total: presupuestada,
    vend: vendida,
    // Disponible = presupuestada − vendida. Nunca baja de cero.
    pend: Math.max(presupuestada - vendida, 0),
    precio: numCol(c[COL.presupuestoSub.precioUnit]),
    rent: numCol(c[COL.presupuestoSub.rentabilidad]),
    descuento: numCol(c[COL.presupuestoSub.descuento]),
    /* El tipo de mercadería sale de la mirror del subelemento; si no vino, del propio producto
       conectado. De él dependen los comprobantes: la consignada se factura aparte. */
    tipo: valor(c[COL.presupuestoSub.tipoMercaderia]) || valor(prodCols[COL.producto.tipoMercaderia]),
    iva: numCol(prodCols[COL.producto.iva]),
    proveedorId: proveedor?.id,
    proveedorNombre: proveedor?.name ?? '',
    estadoUso: c[COL.presupuestoSub.estadoUso]?.text ?? '',
    subitemId: sub.id,
    productoId: producto?.id,
    // Ítem de stock heredado del maestro al presupuestar: viaja a la venta CON PRESUPUESTO PREVIO.
    stockId: c[COL.presupuestoSub.stock]?.linked_items?.[0]?.id,
  }
}

/**
 * Ítems del board de presupuestos que apuntan al cliente, todavía no vencieron y les queda
 * algo por vender. El estado "100% Vendido" se descarta en la consulta y por índice: ese
 * presupuesto ya no tiene unidades disponibles, así que no debe llegar a la selección.
 * Los que no tienen el estado cargado sí pasan: sin dato no se asume que esté agotado.
 */
async function idsPresupuestosVigentes(clienteItemId: string): Promise<string[]> {
  const data = await mondayApi<{
    boards: { items_page: { items: { id: string; column_values: CV[] }[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.presupuestos}]) {
        items_page(
          limit: 200,
          query_params: {rules: [{
            column_id: "${COL.presupuesto.estadoVenta}",
            compare_value: [${PRESUP_ESTADO_VENTA_INDEX.totalmenteVendido}],
            operator: not_any_of
          }]}
        ) {
          items {
            id
            column_values(ids: ["${COL.presupuesto.cliente}","${COL.presupuesto.fechaVencimiento}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )
  const hoy = hoyIso()
  return (data.boards[0]?.items_page?.items ?? [])
    .filter((it) => {
      const c = byId(it)
      const linked = c[COL.presupuesto.cliente]?.linked_item_ids ?? []
      if (!linked.map(String).includes(String(clienteItemId))) return false
      // Sin fecha de vencimiento no se puede afirmar que siga vigente.
      const venc = c[COL.presupuesto.fechaVencimiento]?.text ?? ''
      return Boolean(venc) && venc >= hoy
    })
    .map((it) => it.id)
}

/**
 * Presupuestos del cliente cuya fecha de vencimiento todavía no se cumplió, con todos sus
 * productos (cantidad presupuestada, vendida, disponible, estado de uso y tipo de mercadería).
 *
 * Va en dos consultas: primero los ítems del board filtrando por cliente y vencimiento —el
 * filtro por `board_relation` no se puede delegar a `query_params`—, y después sólo esos ítems
 * con sus subelementos. El importe total se suma de los subelementos: las columnas mirror de
 * total del board ("🤖TOTAL $") vienen vacías por la API.
 */
export async function getPresupuestosVigentes(clienteItemId: string): Promise<PresupuestoVigente[]> {
  if (!mondayHabilitado()) {
    return PRESUPUESTOS.filter((p) => p.clienteId === clienteItemId && p.estado === 'En uso').map(
      (p) => ({
        id: p.id,
        nro: p.id,
        vigencia: 'Vigente',
        vencimiento: p.venc,
        rentabilidad: p.rent,
        importe: p.importe,
        productos: p.productos,
      }),
    )
  }

  const ids = await idsPresupuestosVigentes(clienteItemId)
  if (ids.length === 0) return []

  const data = await mondayApi<{ items: (MondayItem & { subitems: MondayItem[] })[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id name
        column_values(ids: ["${COL.presupuesto.rentabilidad}","${COL.presupuesto.vigencia}","${COL.presupuesto.fechaVencimiento}"]) { id text }
        subitems {
          id name
          column_values(ids: ["${COL.presupuestoSub.producto}","${COL.presupuestoSub.cantidad}","${COL.presupuestoSub.cantVendida}","${COL.presupuestoSub.estadoUso}","${COL.presupuestoSub.tipoMercaderia}","${COL.presupuestoSub.precioUnit}","${COL.presupuestoSub.rentabilidad}","${COL.presupuestoSub.descuento}","${COL.presupuestoSub.stock}"]) {
            id text
            ... on MirrorValue { display_value }
            ... on BoardRelationValue {
              linked_items {
                id name
                column_values(ids: ["${COL.producto.codigo}","${COL.producto.iva}","${COL.producto.tipoMercaderia}","${COL.producto.proveedor}"]) {
                  id text
                  ... on FormulaValue { display_value }
                  ... on BoardRelationValue { linked_items { id name } }
                }
              }
            }
          }
        }
      }
    }`,
    { ids },
  )

  return (data.items ?? []).map((it) => {
    const c = byId(it)
    const productos = (it.subitems ?? []).map(mapPresupuestoProducto)
    return {
      id: it.id,
      nro: it.name,
      vigencia: c[COL.presupuesto.vigencia]?.text ?? '',
      vencimiento: c[COL.presupuesto.fechaVencimiento]?.text ?? '',
      rentabilidad: num(c[COL.presupuesto.rentabilidad]?.text),
      importe: round2(productos.reduce((acc, p) => acc + importeLinea(p), 0)),
      productos,
    }
  })
}

/* ===== 6) Lectura del PDF generado (columna file) ===== */

/** PDF generado por Make.com y subido a la columna file del presupuesto. */
export interface PresupuestoPdf {
  /** URL pública temporal (S3, ~1h) del archivo, apta para embeber/descargar. */
  url: string
  nombre: string
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Lee la columna file del presupuesto (`file_mkse56g9`) y devuelve el PDF subido por el
 * escenario de Make.com, o `null` si todavía no hay archivo. Usa `assets` porque ahí viene
 * la `public_url` firmada, lista para mostrar sin autenticación.
 */
export async function getPresupuestoPdf(itemId: string): Promise<PresupuestoPdf | null> {
  if (!mondayHabilitado()) return null
  const data = await mondayApi<{
    items: { assets: { name: string; public_url: string }[] }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        assets(column_ids: ["${COL.presupuesto.pdf}"]) { name public_url }
      }
    }`,
    { ids: [itemId] },
  )
  const asset = data.items[0]?.assets?.[0]
  return asset?.public_url ? { url: asset.public_url, nombre: asset.name } : null
}

/**
 * Espera a que el PDF aparezca en la columna file: consulta cada `intervalo` ms hasta
 * `intentos` veces (el escenario de Make.com tarda unos segundos en generarlo y subirlo).
 * Devuelve el PDF apenas está disponible, o `null` si se agota la espera. En modo local
 * (sin token) simula la demora y no devuelve archivo.
 */
export async function esperarPresupuestoPdf(
  itemId: string,
  { intentos = 40, intervalo = 3000 }: { intentos?: number; intervalo?: number } = {},
): Promise<PresupuestoPdf | null> {
  if (!mondayHabilitado()) {
    await esperar(2500)
    return null
  }
  for (let i = 0; i < intentos; i++) {
    const pdf = await getPresupuestoPdf(itemId)
    if (pdf) return pdf
    await esperar(intervalo)
  }
  return null
}
