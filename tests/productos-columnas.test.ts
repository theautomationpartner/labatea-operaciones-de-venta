/**
 * El catálogo del SERVIDOR y el de la APP tienen que leer las mismas columnas y armar el mismo
 * producto.
 *
 * Por qué existe este test: `api/` es autocontenido —`scripts/verificar-funciones.mjs` lo compila
 * con `tsconfig.api.json` para reproducir lo que hace Vercel, y un import que cruce a `src/` le
 * mueve el árbol de salida—, así que los ids de columna viven en DOS lugares: `api/_productos.ts` y
 * `src/services/monday/columns.ts`. Ese es el precio de la decisión, y este test es la forma de
 * pagarlo: la divergencia rompe acá, no en producción.
 *
 * El daño que evita es directo y caro. Si el cron leyera el precio de la lista L3 de una columna
 * que ya no es esa, el catálogo se llenaría de productos a precio 0 o al precio de otra lista, y la
 * app los ofrecería con total naturalidad: el cron seguiría diciendo OK y el presupuesto saldría
 * mal cotizado. Por eso no alcanza con comparar los ids —parte 1—: las partes 3 y 4 corren los DOS
 * caminos sobre el MISMO ítem de Monday y exigen el mismo `Producto`.
 *
 * Se corre con `npm run test:productos-columnas`; vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  COL_MARGEN,
  COL_PRECIO_LISTA,
  COL_PRODUCTO,
  mapProductoCache,
  type ItemMonday,
} from '../api/_productos'
import { COL } from '@/services/monday/columns'
import { buscarProductos } from '@/services/monday/presupuestar'
import { productoDesdeCache } from '@/services/monday/catalogoProductos'
import type { ListaPrecio, Producto } from '@/types'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/* ---------- 1) Los ids de columna son los mismos ---------- */

console.log('Caso 1 · Los ids de columna del servidor y de la app coinciden:')

assert.deepEqual(
  { ...COL_PRODUCTO },
  { ...COL.producto },
  'los ids de columna del producto del servidor (api/_productos.ts) se fueron de los de la app ' +
    '(src/services/monday/columns.ts)',
)
ok('las columnas del producto son las mismas', true)

assert.deepEqual(
  { ...COL_PRECIO_LISTA },
  { ...COL.precioLista },
  'las columnas de precio por lista del servidor se fueron de las de la app',
)
ok('las ocho columnas de precio de lista son las mismas', true)

assert.deepEqual(
  { ...COL_MARGEN },
  { ...COL.margen },
  'las columnas de margen por lista del servidor se fueron de las de la app',
)
ok('las columnas de margen son las mismas', true)

/* ---------- 2) El caché guarda TODAS las listas, no una ---------- */

console.log('\nCaso 2 · El caché es lista-agnóstico:')

/**
 * Un ítem con un precio DISTINTO en cada lista. Es el caso que detecta el error más peligroso de
 * todos: que el mapeo del servidor confunda dos columnas de precio y sirva la lista equivocada. Con
 * todos los precios iguales, ese error pasaría invisible.
 */
const PRECIOS: Record<ListaPrecio, number> = {
  L1: 1451.43,
  L2: 1393.37,
  L3: 1320.8,
  L4: 1200,
  L5: 1100.5,
  L6: 1000,
  L7: 778.89,
  L8: 858.96,
}
const MARGENES = { L1: 99.39, L2: 91.41, L3: 81.44 }

const cv = (id: string, texto: string) => ({ id, text: texto })
/** Las fórmulas del maestro traen el valor en `display_value`, no en `text`. */
const formula = (id: string, valor: string) => ({ id, text: '', display_value: valor })

const ITEM: ItemMonday = {
  id: '12599506593',
  name: 'ABRAZADERA TALA 8/16',
  updated_at: '2026-09-20T10:00:00Z',
  column_values: [
    cv(COL_PRODUCTO.codigo, '301'),
    cv(COL_PRODUCTO.rubro, 'FERRETERIA'),
    cv(COL_PRODUCTO.subrubro, 'BULONFER'),
    cv(COL_PRODUCTO.categoria, 'ARTICULOS RURALES'),
    cv(COL_PRODUCTO.unidadMedida, 'Unidad'),
    cv(COL_PRODUCTO.peso, '1.25'),
    cv(COL_PRODUCTO.tipoMercaderia, 'COM'),
    cv(COL_PRODUCTO.moneda, 'Pesos'),
    cv(COL_PRODUCTO.iva, '21'),
    cv(COL_PRODUCTO.comisionable, 'SI'),
    cv(COL_PRODUCTO.rentabForzada, 'Con Rentab Forzada'),
    formula(COL_PRODUCTO.precioCosto, '727.935'),
    /* El código del proveedor es una MIRROR: sin `display_value` vuelve vacío. */
    { id: COL_PRODUCTO.proveedorCodigo, text: null, display_value: '7003' },
    {
      id: COL_PRODUCTO.proveedor,
      text: null,
      linked_items: [{ id: '12904387847', name: 'PROVEEDOR TEST' }],
    },
    {
      id: COL_PRODUCTO.stock,
      text: null,
      linked_items: [{ id: '12642355157', name: 'STOCK ABRAZADERA' }],
    },
    /* L1 del margen es `numeric` (viene en `text`); L2 y L3 son fórmulas. */
    cv(COL_MARGEN.L1, String(MARGENES.L1)),
    formula(COL_MARGEN.L2, String(MARGENES.L2)),
    formula(COL_MARGEN.L3, String(MARGENES.L3)),
    ...Object.entries(COL_PRECIO_LISTA).map(([lista, id]) =>
      formula(id, String(PRECIOS[lista as ListaPrecio])),
    ),
  ],
}

const cache = mapProductoCache(ITEM)

assert.deepEqual(
  cache.precios,
  PRECIOS,
  'el caché no guardó las ocho listas de precio, o las cruzó entre sí',
)
ok('las ocho listas de precio se guardan cada una en la suya', true)
ok('el margen sale de la columna de cada lista', cache.margenes.L2 === MARGENES.L2)
ok('el ítem de stock viaja sólo como id, sin cantidades', cache.stockId === '12642355157')
ok('el proveedor sale del ítem conectado', cache.provNombre === 'PROVEEDOR TEST')
ok('el código del proveedor sale de la mirror', cache.provCod === '7003')

/* ---------- 3) Los dos caminos arman el MISMO producto ---------- */

/**
 * La app puede llegar al mismo producto por dos caminos: el botón Buscar (Monday → `mapProducto`) y
 * el live search (cron → caché → `productoDesdeCache`). Tienen que dar lo mismo, o el precio de un
 * presupuesto dependería de cómo se buscó el producto.
 *
 * Se intercepta `fetch` —la única salida de `mondayApi`— para que la búsqueda directa devuelva
 * EXACTAMENTE el mismo ítem que se le dio al mapeador del servidor.
 */
async function productoDeMonday(lista: ListaPrecio, conIva: boolean): Promise<Producto> {
  const original = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      data: { boards: [{ items_page: { cursor: null, items: [ITEM] } }] },
    }),
  })) as unknown as typeof fetch
  try {
    const pagina = await buscarProductos('301', lista, conIva)
    return pagina.productos[0]
  } finally {
    globalThis.fetch = original
  }
}

/** El stock no se compara: el caché no lo trae a propósito (ver `api/_productos.ts`). */
const sinStock = (p: Producto) => {
  const {
    ingresos,
    egresos,
    pendEntregaVta,
    pendRecepcionCompra,
    fisico,
    comercial,
    disponible,
    ...resto
  } = p
  return resto
}

console.log('\nCaso 3 · Buscar en Monday y buscar en el caché dan el mismo producto:')

for (const lista of Object.keys(PRECIOS) as ListaPrecio[]) {
  for (const conIva of [false, true]) {
    const deMonday = await productoDeMonday(lista, conIva)
    const deCache = productoDesdeCache(cache, lista, conIva)
    assert.deepEqual(
      sinStock(deCache),
      sinStock(deMonday),
      `el producto del caché difiere del de Monday en ${lista} con conIva=${conIva}`,
    )
  }
  ok(`${lista}: mismo producto por los dos caminos, con y sin IVA`, true)
}

/* ---------- 4) El precio es el de SU lista, no el de otra ---------- */

console.log('\nCaso 4 · Cada lista cobra su precio:')

for (const lista of Object.keys(PRECIOS) as ListaPrecio[]) {
  const p = productoDesdeCache(cache, lista, false)
  ok(`${lista} cotiza ${PRECIOS[lista]}`, p.precio === PRECIOS[lista])
}

/* El IVA del producto se suma cuando el cliente lo paga; nunca al precio sin IVA. */
const conIva = productoDesdeCache(cache, 'L1', true)
ok('con IVA, el precio lleva la alícuota del producto', conIva.precio === 1756.23)
ok('el precio sin IVA queda limpio para medir rentabilidad', conIva.precioSinIva === PRECIOS.L1)

console.log(`\n${asserts} verificaciones OK`)
