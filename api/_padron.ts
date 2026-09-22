/**
 * El padrón de PERSONAS leído por el SERVIDOR: qué columnas se piden, qué persona entra y cómo se
 * arma el objeto que consume la app.
 *
 * Guarda CLIENTES Y PROVEEDORES. La app de ventas pide los clientes; otra app pide los proveedores
 * contra la misma base. Por eso cada registro lleva sus `categorias`: la categoría de Monday es
 * multi-valor y el solapamiento es real —hay una persona que es las dos cosas—, así que no se puede
 * guardar "la" categoría de nadie.
 *
 * ── Por qué esto no importa de `src/` ──
 * `api/` es autocontenido a propósito. `scripts/verificar-funciones.mjs` lo compila con
 * `tsconfig.api.json` (`module: nodenext`) para reproducir lo que hace Vercel, y ese script existe
 * por un fallo que llegó a producción: imports de `api/` que no resolvían y devolvían 500 antes de
 * correr una línea. Un import que cruce a `src/` mueve la raíz común que tsc calcula y le cambia el
 * árbol de salida abajo de los pies.
 *
 * El precio de esa decisión es que los ids de columna viven en DOS lugares: acá y en
 * `src/services/monday/columns.ts`. Ese precio se paga con un test —`npm run test:personas-columnas`—
 * que compara los dos mapas y, además, corre los dos mapeadores sobre el mismo ítem y exige que
 * devuelvan el MISMO `Cliente`. Si alguien toca un id de un lado y no del otro, rompe el test; no
 * rompe una venta.
 */

/** Tablero "Personas". El mismo que lee la app. */
export const BOARD_PERSONAS = 18420688238

/**
 * Ids de columna del cliente. Espejo EXACTO de `COL.cliente`
 * (`src/services/monday/columns.ts`); lo verifica `test:personas-columnas`.
 */
export const COL_CLIENTE = {
  categoria: 'dropdown_mm54e5ag',
  codigo: 'text_mm542r9d',
  cuit: 'text_mm54btnd',
  dirFiscal: 'location_mm54jt1g',
  tipoPersona: 'color_mm54k8hr',
  condFiscal: 'color_mm54yakw',
  listaPrecio: 'dropdown_mm582vqy',
  agenteRet: 'dropdown_mm54fnwn',
  situacion: 'color_mm58nd7b',
  estado: 'color_mm588vd6',
  condPago: 'dropdown_mm54yq06',
  aceptaCheques: 'color_mm5yb27h',
  limite: 'numeric_mm57tw48',
  ctaCte: 'board_relation_mm5ep5qd',
  contactos: 'account_contact',
} as const

/** Ids de columna de la Cta Cte conectada. Espejo de `COL.ctaCte`. */
export const COL_CTA_CTE = {
  totalVentas: 'lookup_mm5g2exg',
  totalCobros: 'lookup_mm5gx0d5',
  remitosPendFacturar: 'numeric_mm5f2npa',
  limite: 'lookup_mm585jgv',
} as const

export const CLIENTE_ACTIVO_INDEX = 1
export const CATEGORIA_CLIENTE_INDEX = 1

/**
 * Índice de "Proveedores" en "✋Categoria". Las etiquetas reales del board son 1 Clientes,
 * 2 Proveedores, 3 Transporte, 6 Comisionistas, 8 Terceros y 9 Vendedores: al padrón entran sólo
 * las dos primeras.
 */
export const CATEGORIA_PROVEEDOR_INDEX = 2

/** Qué puede ser una persona del padrón. Una misma puede ser las dos cosas. */
export type Categoria = 'cliente' | 'proveedor'

const CATEGORIAS: ReadonlyArray<{ indice: number; nombre: Categoria }> = [
  { indice: CATEGORIA_CLIENTE_INDEX, nombre: 'cliente' },
  { indice: CATEGORIA_PROVEEDOR_INDEX, nombre: 'proveedor' },
]

export const SITUACION_CLIENTE_INDEX = {
  liberadoConCredito: 0,
  liberadoSinCredito: 1,
  bloqueado: 2,
} as const

/* ── Lectura de los `column_values` que devuelve Monday ─────────────────────────────────────── */

export interface CV {
  id: string
  text: string | null
  display_value?: string | null
  /** Índice de la etiqueta de una columna status. Más estable que su texto. */
  index?: number | null
  /** Etiquetas elegidas en un dropdown multi-valor, con su id (que es el índice). */
  values?: { id: string }[]
  linked_items?: { id: string; name: string; column_values?: CV[] }[]
}

export interface ItemMonday {
  id: string
  name: string
  updated_at?: string
  column_values: CV[]
}

const byId = (item: { column_values?: CV[] }): Record<string, CV> =>
  Object.fromEntries((item.column_values ?? []).map((c) => [c.id, c]))

const valor = (cv?: CV): string => cv?.display_value ?? cv?.text ?? ''

const num = (t?: string | null): number => {
  const n = Number(String(t ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const numCol = (cv?: CV): number => num(valor(cv))

/**
 * Suma una mirror que refleja VARIOS ítems: su `display_value` llega como lista separada por comas
 * ("236663.67, 362793.82"). Pasarla por `num()` de una borra las comas y las concatena en un número
 * gigante. Idéntico a `sumaMirror` de `src/services/monday/parse.ts`.
 */
const sumaMirror = (cv?: CV): number =>
  String(cv?.display_value ?? cv?.text ?? '')
    .split(',')
    .reduce((acc, parte) => acc + num(parte), 0)

/* ── La consulta ────────────────────────────────────────────────────────────────────────────── */

const COLUMNAS = Object.values(COL_CLIENTE)

/**
 * Campos de cada persona, con la Cta Cte conectada ANIDADA: el crédito sale de ahí y traerlo en la
 * misma consulta evita una segunda vuelta por persona.
 *
 * `updated_at` es lo que hace posible la corrida incremental: con él se sabe hasta dónde llegó la
 * sincronización anterior.
 */
export const CAMPOS_PERSONA = `
  id name updated_at
  column_values(ids: ${JSON.stringify(COLUMNAS)}) {
    id text
    ... on StatusValue { index }
    ... on DropdownValue { values { id } }
    ... on BoardRelationValue {
      linked_items {
        id name
        column_values(ids: ["${COL_CTA_CTE.totalVentas}","${COL_CTA_CTE.totalCobros}","${COL_CTA_CTE.remitosPendFacturar}","${COL_CTA_CTE.limite}"]) {
          id text
          ... on MirrorValue { display_value }
        }
      }
    }
  }`

/**
 * Las reglas que definen a una persona del padrón: categoría "Clientes" **o** "Proveedores", y
 * estado ACTIVO. `any_of` sobre las dos etiquetas es la unión, no la intersección: entra quien
 * tenga cualquiera de las dos.
 *
 * Van por índice de etiqueta y no por texto, igual que en la app: aguantan que en el board
 * renombren "Activo" o "Clientes" sin que el padrón se vacíe de golpe.
 */
export const REGLAS_OPERABLE = [
  `{column_id: "${COL_CLIENTE.estado}", compare_value: [${CLIENTE_ACTIVO_INDEX}], operator: any_of}`,
  `{column_id: "${COL_CLIENTE.categoria}", compare_value: [${CATEGORIAS.map((c) => c.indice).join(', ')}], operator: any_of}`,
].join(', ')

/* ── Mapeo ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * La forma de la persona que consume la app. Los campos son espejo de `Cliente` en `src/types.ts`
 * —el mapeo tiene que dar exactamente lo mismo que `mapCliente`, y eso lo verifica
 * `test:personas-columnas`— más las categorías, que dicen si esta persona es cliente, proveedor o
 * las dos cosas.
 */
export interface PersonaCache {
  id: string
  name: string
  cuit: string
  ptype: string
  status: string
  list: string | null
  ret: string
  agenteRetencion: boolean
  condicionPago: string | null
  aceptaCheques: boolean
  limit: number
  codigo: string
  saldoCtaCte: number
  lineaUtilizada: number
  remitosPendFacturar: number
  disponible: number
  addr: string
  activity: 'Activo' | 'Inactivo'
  situation: 'Liberado con crédito' | 'Liberado sin crédito' | 'Bloqueado'
  /**
   * Qué es esta persona. Viaja DENTRO del registro y no sólo como columna de la tabla para que el
   * dato se explique solo: quien lee un registro suelto —de la base, de una respuesta, de un log—
   * tiene que poder saber si está mirando un cliente o un proveedor sin ir a buscarlo a otro lado.
   * Es el único campo que `Cliente` (en `src/types.ts`) no tiene.
   */
  categorias: Categoria[]
}

function situacionDe(indice: number | null | undefined): PersonaCache['situation'] {
  switch (indice) {
    case SITUACION_CLIENTE_INDEX.liberadoConCredito:
      return 'Liberado con crédito'
    case SITUACION_CLIENTE_INDEX.bloqueado:
      return 'Bloqueado'
    default:
      return 'Liberado sin crédito'
  }
}

/**
 * Qué es esta persona, según su columna de categoría.
 *
 * Devuelve TODAS las que tiene, no la primera: la categoría es un dropdown MULTI-VALOR y el
 * solapamiento existe de verdad —hay una persona que es cliente y proveedor—. Quedarse con una
 * sola la dejaría afuera de una de las dos listas.
 *
 * Se compara por el ID de la etiqueta y no por su texto, que es exactamente lo que hace la regla
 * `any_of` de la consulta (ver `REGLAS_OPERABLE`): así, si en el board renombran "Clientes", las
 * dos mitades siguen coincidiendo en vez de discrepar en silencio.
 */
export function categoriasDe(item: ItemMonday): Categoria[] {
  const etiquetas = byId(item)[COL_CLIENTE.categoria]?.values ?? []
  const ids = new Set(etiquetas.map((v) => Number(v.id)))
  return CATEGORIAS.filter((c) => ids.has(c.indice)).map((c) => c.nombre)
}

/**
 * ¿Esta persona entra al padrón? Activa, y cliente o proveedor.
 *
 * Hace falta acá —y no sólo como regla de la consulta— porque la corrida INCREMENTAL pide lo
 * modificado SIN filtrar, justamente para enterarse de quiénes dejaron de entrar. Ver
 * `api/cron/personas.ts`.
 */
export function esOperable(item: ItemMonday): boolean {
  if (byId(item)[COL_CLIENTE.estado]?.index !== CLIENTE_ACTIVO_INDEX) return false
  return categoriasDe(item).length > 0
}

/**
 * Arma el `Cliente` desde el ítem de Monday. Réplica exacta de `mapCliente`
 * (`src/services/monday/presupuestar.ts`), incluido el cálculo del crédito:
 *
 *   saldo           = total ventas − total cobros
 *   línea utilizada = saldo + remitos pendientes de facturar
 *   disponible      = límite − línea utilizada
 *
 * El crédito se calcula con las columnas BASE y no con las fórmulas del board, para no depender de
 * que el board las tenga al día.
 */
/** Qué hacer con una página de la corrida incremental. Ver `clasificarPagina`. */
export interface Clasificacion {
  /** Personas operables: entran o se actualizan en el padrón. */
  entran: PersonaCache[]
  /** Dejaron de ser operables (inactivas, o fuera de la categoría): salen del padrón. */
  salen: string[]
  /** Se llegó a lo ya procesado en corridas anteriores: desde acá para atrás no hay nada que hacer. */
  alcanzado: boolean
  /** La fecha de modificación más nueva vista hasta acá, incluyendo lo que venía de antes. */
  masNueva: string | null
}

/**
 * Decide qué hacer con cada persona de una página de la corrida incremental.
 *
 * Es la lógica del cron sin la base ni la red, para poder testearla (`npm run test:padron-sync`).
 *
 * Dos cosas que parecen detalles y no lo son:
 *
 * · Un ítem NO operable no se ignora: se da de baja. La consulta incremental va sin filtro
 *   justamente para enterarse de los que dejaron de serlo; si acá se los salteara, el cliente que
 *   pasa a INACTIVO quedaría vivo en el padrón para siempre, elegible para venderle.
 * · `masNueva` se calcula sobre TODOS los ítems, incluidos los que caen del otro lado del corte.
 *   Es lo que hace que la marca avance aunque una corrida no tenga nada que procesar.
 */
export function clasificarPagina(
  items: readonly ItemMonday[],
  corteMs: number,
  masNueva: string | null = null,
): Clasificacion {
  const salida: Clasificacion = { entran: [], salen: [], alcanzado: false, masNueva }

  for (const item of items) {
    if (item.updated_at && (!salida.masNueva || item.updated_at > salida.masNueva)) {
      salida.masNueva = item.updated_at
    }
    /* La página viene ordenada por fecha de modificación descendente, así que el primero que cae
       por debajo del corte marca el final del trabajo: todo lo que sigue ya se procesó. Es lo que
       convierte 27 páginas en una. */
    const cuando = Date.parse(item.updated_at ?? '')
    if (Number.isFinite(cuando) && cuando <= corteMs) {
      salida.alcanzado = true
      break
    }
    if (esOperable(item)) salida.entran.push(mapPersonaCache(item))
    else salida.salen.push(item.id)
  }

  return salida
}

export function mapPersonaCache(item: ItemMonday): PersonaCache {
  const c = byId(item)
  const cta = c[COL_CLIENTE.ctaCte]?.linked_items?.[0]
  const ctaCols = cta ? byId(cta) : {}
  const limiteCliente = num(c[COL_CLIENTE.limite]?.text)
  const totalVentas = sumaMirror(ctaCols[COL_CTA_CTE.totalVentas])
  const totalCobros = sumaMirror(ctaCols[COL_CTA_CTE.totalCobros])
  const remitosPendFacturar = numCol(ctaCols[COL_CTA_CTE.remitosPendFacturar])
  /* El límite es una mirror de UN SOLO valor: va con `numCol`, no con `sumaMirror` —que lo sumaría
     consigo mismo y duplicaría la línea de crédito—. */
  const limite = numCol(ctaCols[COL_CTA_CTE.limite]) || limiteCliente
  const saldoCtaCte = totalVentas - totalCobros
  const lineaUtilizada = saldoCtaCte + remitosPendFacturar
  const agente = c[COL_CLIENTE.agenteRet]?.text ?? ''
  return {
    id: item.id,
    codigo: c[COL_CLIENTE.codigo]?.text?.trim() || item.id,
    name: item.name,
    cuit: c[COL_CLIENTE.cuit]?.text ?? '',
    ptype: c[COL_CLIENTE.tipoPersona]?.text ?? '',
    status: c[COL_CLIENTE.condFiscal]?.text ?? '',
    list: c[COL_CLIENTE.listaPrecio]?.text || null,
    ret: agente || 'Ninguna',
    agenteRetencion: agente.trim().length > 0,
    condicionPago: c[COL_CLIENTE.condPago]?.text?.trim() || null,
    aceptaCheques: (c[COL_CLIENTE.aceptaCheques]?.text ?? '').trim().toUpperCase() !== 'NO',
    limit: limite,
    saldoCtaCte,
    lineaUtilizada,
    remitosPendFacturar,
    /* Sin Cta Cte conectada queda el límite completo: sin movimientos no se puede asumir deuda. */
    disponible: cta ? limite - lineaUtilizada : limite,
    addr: c[COL_CLIENTE.dirFiscal]?.text ?? '',
    activity: c[COL_CLIENTE.estado]?.index === CLIENTE_ACTIVO_INDEX ? 'Activo' : 'Inactivo',
    situation: situacionDe(c[COL_CLIENTE.situacion]?.index),
    categorias: categoriasDe(item),
  }
}
