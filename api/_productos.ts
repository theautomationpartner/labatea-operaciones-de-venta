/**
 * El Maestro de Productos leído por el SERVIDOR: qué columnas se piden y cómo se arma el
 * `ProductoCache` que consume el buscador de la app.
 *
 * ── Por qué esto no importa de `src/` ──
 * Mismo motivo que `_padron.ts`: `api/` es autocontenido a propósito, porque un import que cruce a
 * `src/` le mueve a tsc la raíz común y le cambia el árbol de salida abajo de los pies (ver el
 * comentario largo en `api/_padron.ts`). El precio es que los ids de columna viven en DOS lugares,
 * y se paga con `npm run test:productos-columnas`, que compara los dos mapas y corre los dos
 * mapeadores sobre el mismo ítem.
 *
 * ── Lo que este caché NO trae: el stock ──
 * El maestro no tiene las cantidades; son fórmulas del ítem conectado en "🧮Stock y Movimientos", y
 * se mueven con cada venta. Cachearlas sería mostrar un disponible que ya se vendió. Acá viaja sólo
 * el `stockId`, y la app lee el stock fresco contra Monday al ELEGIR el producto: una consulta por
 * selección en vez de una por tecla.
 *
 * Traerlas además saldría caro por otro lado: pedir `display_value` de las fórmulas anidadas es lo
 * que hace que el barrido tarde 29 s en vez de 10, y lo que lo acerca al límite por minuto de ese
 * campo (ver `PAGINA` en `api/cron/productos.ts`).
 */

/** Tablero "Maestro de Productos". El mismo que lee la app. */
export const BOARD_PRODUCTOS = 18421035535

/**
 * Ids de columna del producto. Espejo EXACTO de `COL.producto`
 * (`src/services/monday/columns.ts`); lo verifica `test:productos-columnas`.
 */
export const COL_PRODUCTO = {
  codigo: 'text_mm5ghnv7',
  rubro: 'dropdown_mm509v8g',
  subrubro: 'dropdown_mm51jz35',
  categoria: 'dropdown_mm50pcb8',
  unidadMedida: 'dropdown_mm4vhc0h',
  peso: 'numeric_mm4d54r6',
  proveedor: 'board_relation_mm4812az',
  proveedorCodigo: 'lookup_mm5fh97p',
  tipoMercaderia: 'color_mm48hm74',
  precioCosto: 'formula_mm54qnz9',
  flete: 'numeric_mm589hex',
  rentabForzada: 'color_mm60m95h',
  moneda: 'color_mm4kwdj6',
  iva: 'numeric_mm5gyrnb',
  comisionable: 'color_mm51p0wn',
  stock: 'board_relation_mm57jgks',
} as const

/** Las ocho listas de precio (columnas fórmula). Espejo de `COL.precioLista`. */
export const COL_PRECIO_LISTA = {
  L1: 'formula_mm51ch66',
  L2: 'formula_mm51yc26',
  L3: 'formula_mm51jtgz',
  L4: 'formula_mm515gb3',
  L5: 'formula_mm51s99p',
  L6: 'formula_mm51vaca',
  L7: 'formula_mm512bhw',
  L8: 'formula_mm513rvw',
} as const

/** "Margen" por lista. Espejo de `COL.margen`: por ahora sólo L1–L3 existen en el board. */
export const COL_MARGEN = {
  L1: 'numeric_mm58135k',
  L2: 'formula_mm51nqvz',
  L3: 'formula_mm51fjf5',
} as const

export type ListaPrecio = keyof typeof COL_PRECIO_LISTA

/* ── Lectura de los `column_values` que devuelve Monday ─────────────────────────────────────── */

export interface CV {
  id: string
  text: string | null
  /** Valor calculado de una fórmula o de una mirror. Sin esto, las dos vuelven vacías. */
  display_value?: string | null
  linked_items?: { id: string; name: string }[]
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

/* ── La consulta ────────────────────────────────────────────────────────────────────────────── */

const COLUMNAS = [
  ...Object.values(COL_PRODUCTO),
  ...Object.values(COL_PRECIO_LISTA),
  ...Object.values(COL_MARGEN),
]

/**
 * Campos de cada producto.
 *
 * Las relaciones se piden SIN sus `column_values`: del proveedor alcanza con el id y el nombre, y
 * del ítem de stock alcanza con el id —las cantidades no se cachean—. Es lo que mantiene la
 * consulta barata; anidar las fórmulas de stock triplicaba el tiempo del barrido.
 *
 * `updated_at` es lo que hace posible la corrida incremental: con él se sabe hasta dónde llegó la
 * sincronización anterior.
 */
export const CAMPOS_PRODUCTO = `
  id name updated_at
  column_values(ids: ${JSON.stringify(COLUMNAS)}) {
    id text
    ... on FormulaValue { display_value }
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { linked_items { id name } }
  }`

/* ── Mapeo ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * El producto tal como viaja al navegador: SIN lista de precio elegida y SIN stock.
 *
 * No es el `Producto` que consume la app, y esa diferencia es deliberada. `Producto` tiene UN
 * precio y UNA rentabilidad, los de la lista del cliente de esa operación; el caché es uno solo
 * para todos los clientes, así que guarda las ocho listas y la app materializa la que toca al
 * elegir el producto (`productoDesdeCache`, en `services/monday/catalogoProductos.ts`).
 */
export interface ProductoCache {
  id: string
  codigo: string
  nombre: string
  /** Precio de lista SIN IVA, por lista. La alícuota se suma después, según el cliente. */
  precios: Record<ListaPrecio, number>
  /** "Margen" por lista. Es un MARKUP SOBRE EL COSTO, no la rentabilidad (ver `mapProducto`). */
  margenes: Partial<Record<ListaPrecio, number>>
  /** "Costo Final" (fórmula): el costo del producto, SIN IVA y SIN flete. Base de la rentabilidad. */
  precioCosto: number
  /** "✋️Flete": costo de flete por unidad, SIN IVA. Se resta del resultado de la venta. */
  flete: number
  /** Alícuota de IVA del producto, en %. */
  iva: number
  moneda: string
  /** Tipo de mercadería: 'CO' (consignada) o 'COM' (común). */
  tipo: string
  comisionable: boolean
  conRentabForzada: boolean
  rubro: string
  subrubro: string
  categoria: string
  um: string
  peso: number
  provCod: string
  provNombre: string
  provId?: string
  /** Ítem de "Stock y Movimientos". El caché NO trae las cantidades: sólo por dónde pedirlas. */
  stockId?: string
}

export function mapProductoCache(item: ItemMonday): ProductoCache {
  const c = byId(item)
  const precios = {} as Record<ListaPrecio, number>
  for (const [lista, columna] of Object.entries(COL_PRECIO_LISTA)) {
    precios[lista as ListaPrecio] = numCol(c[columna])
  }
  const margenes: Partial<Record<ListaPrecio, number>> = {}
  for (const [lista, columna] of Object.entries(COL_MARGEN)) {
    margenes[lista as ListaPrecio] = numCol(c[columna])
  }
  const proveedor = c[COL_PRODUCTO.proveedor]?.linked_items?.[0]
  return {
    id: item.id,
    codigo: valor(c[COL_PRODUCTO.codigo]),
    nombre: item.name,
    precios,
    margenes,
    precioCosto: numCol(c[COL_PRODUCTO.precioCosto]),
    flete: numCol(c[COL_PRODUCTO.flete]),
    iva: numCol(c[COL_PRODUCTO.iva]),
    moneda: valor(c[COL_PRODUCTO.moneda]),
    tipo: valor(c[COL_PRODUCTO.tipoMercaderia]),
    /* El producto SÓLO dice si comisiona ("SI"); la tasa es única por tipo de venta y vive en el
       tablero de configuración. */
    comisionable: valor(c[COL_PRODUCTO.comisionable]).trim().toUpperCase() === 'SI',
    /* Sólo el label exacto habilita la rentabilidad forzada (nota de crédito x comisión). */
    conRentabForzada: valor(c[COL_PRODUCTO.rentabForzada]).trim() === 'Con Rentab Forzada',
    rubro: valor(c[COL_PRODUCTO.rubro]),
    subrubro: valor(c[COL_PRODUCTO.subrubro]),
    categoria: valor(c[COL_PRODUCTO.categoria]),
    um: valor(c[COL_PRODUCTO.unidadMedida]),
    peso: numCol(c[COL_PRODUCTO.peso]),
    provCod: valor(c[COL_PRODUCTO.proveedorCodigo]),
    provNombre: proveedor?.name ?? '',
    provId: proveedor?.id,
    stockId: c[COL_PRODUCTO.stock]?.linked_items?.[0]?.id,
  }
}

/* ── Corrida incremental ────────────────────────────────────────────────────────────────────── */

/** Qué hacer con una página de la corrida incremental. Ver `clasificarPagina`. */
export interface Clasificacion {
  /** Productos a insertar o actualizar en el caché. */
  entran: ProductoCache[]
  /** Se llegó a lo ya procesado en corridas anteriores: desde acá para atrás no hay nada que hacer. */
  alcanzado: boolean
  /** La fecha de modificación más nueva vista hasta acá, incluyendo lo que venía de antes. */
  masNueva: string | null
}

/**
 * Decide qué hacer con cada producto de una página de la corrida incremental.
 *
 * Es la lógica del cron sin la base ni la red, para poder testearla (`npm run test:productos-sync`).
 *
 * A diferencia del padrón de clientes, acá NO hay ítems que "dejen de ser operables": el maestro no
 * tiene un estado que saque a un producto del catálogo, así que todo lo que llega entra. Las bajas
 * existen igual —un producto se puede ELIMINAR del tablero— pero eso sólo lo puede ver el barrido
 * completo, que es el único que ve el catálogo entero.
 *
 * `masNueva` se calcula sobre TODOS los ítems, incluidos los que caen del otro lado del corte: es
 * lo que hace que la marca avance aunque una corrida no tenga nada que procesar.
 */
export function clasificarPagina(
  items: readonly ItemMonday[],
  corteMs: number,
  masNueva: string | null = null,
): Clasificacion {
  const salida: Clasificacion = { entran: [], alcanzado: false, masNueva }

  for (const item of items) {
    if (item.updated_at && (!salida.masNueva || item.updated_at > salida.masNueva)) {
      salida.masNueva = item.updated_at
    }
    /* La página viene ordenada por fecha de modificación descendente, así que el primero que cae
       por debajo del corte marca el final del trabajo: todo lo que sigue ya se procesó. Es lo que
       convierte 6 páginas en una. */
    const cuando = Date.parse(item.updated_at ?? '')
    if (Number.isFinite(cuando) && cuando <= corteMs) {
      salida.alcanzado = true
      break
    }
    salida.entran.push(mapProductoCache(item))
  }

  return salida
}
