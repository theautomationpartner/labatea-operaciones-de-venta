/**
 * RBAC por equipo de Monday: quién puede cambiar el vendedor de la operación y pisar el precio
 * unitario, y en qué etapa. Cubre los tres módulos:
 *   1. clasificación del usuario logueado según sus equipos;
 *   2. desbloqueo de la UI para "Administradores" en la selección de productos de VENTA/PRESUPUESTO;
 *   3. bloqueo estándar para el resto (y para cualquier otra etapa u operación).
 *
 * Incluye el override de precio en el reducer y lo que efectivamente renderiza la tabla.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@/state/AppProvider'
import { CargaLinea } from '@/features/productos/CargaLinea'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import {
  esAdministrador,
  puedeEditarPrecio,
  puedeElegirVendedor,
  rolUsuario,
  topesDescuentoDe,
  TEAM_ADMINISTRADORES,
  TEAM_VENDEDORES,
} from '@/lib/permisos'
import { round2 } from '@/lib/format'
import { costoDe, rentabilidadDe } from '@/lib/selectors'
import { TOPES_DESCUENTO_DEFAULT } from '@/lib/validaciones'
import { initialState, reducer, type AppState } from '@/state/appState'
import { DispatchContext, StateContext } from '@/state/context'
import type { Producto, UsuarioActual } from '@/types'

const usuario = (equiposIds: string[], isAdmin = false): UsuarioActual => ({
  id: '1001',
  name: 'Test',
  isAdmin,
  equiposIds,
})

const ADMIN = usuario([TEAM_ADMINISTRADORES, TEAM_VENDEDORES])
const VENDEDOR = usuario([TEAM_VENDEDORES])

// ---------- MÓDULO 1: clasificación por equipo ----------
assert.equal(rolUsuario(ADMIN), 'ADMINISTRADOR', 'el equipo Administradores manda')
assert.equal(rolUsuario(VENDEDOR), 'VENDEDOR', 'sólo Vendedores → grupo estándar')
assert.equal(rolUsuario(usuario([])), 'VENDEDOR', 'sin equipos no hay privilegio')
assert.equal(rolUsuario(usuario([], true)), 'ADMINISTRADOR', 'el admin de la cuenta es privilegiado')
assert.equal(rolUsuario(null), 'ADMINISTRADOR', 'sin sesión (modo local) no se bloquea')
/* El equipo se identifica por ID y no por nombre. Es la diferencia entre un permiso estable y uno
   que se cae solo: renombrar el equipo en Monday son dos clics, y con nombres eso dejaba a toda
   su gente sin privilegios sin que nadie tocara el código. */
assert.ok(!esAdministrador(usuario(['Administradores'])), 'el NOMBRE del equipo ya no habilita')
assert.ok(esAdministrador(usuario([TEAM_ADMINISTRADORES])), 'el ID sí')
assert.ok(!esAdministrador(usuario([TEAM_ADMINISTRADORES + '9'])), 'un ID parecido NO alcanza')

// ---------- MÓDULO 2: desbloqueo del administrador ----------
for (const op of ['VENTA', 'PRESUPUESTAR'] as const) {
  assert.ok(puedeEditarPrecio(ADMIN, 'productos', op), `precio editable en ${op}`)
}
/* El vendedor NO está atado a la selección de productos: el administrador lo puede reasignar en
   cualquier etapa, también con la operación ya confirmada. */
for (const paso of ['inicio', 'cliente', 'productos', 'venta', 'cobro', 'factura'] as const) {
  assert.ok(puedeElegirVendedor(ADMIN, paso, 'VENTA'), `el admin cambia el vendedor en ${paso}`)
}
assert.ok(puedeElegirVendedor(ADMIN, 'inicio', null), 'el admin elige vendedor en el inicio')
// Tampoco depende de la operación: vale para todas.
for (const op of ['REMITO', 'VENTA PROFORMA', 'PRESUPUESTAR'] as const) {
  assert.ok(puedeElegirVendedor(ADMIN, 'cobro', op), `el admin cambia el vendedor en ${op}`)
}

// ---------- MÓDULO 3: bloqueo estándar ----------
// a) Vendedor no admin: nada editable, en ninguna etapa.
for (const paso of ['inicio', 'productos', 'venta', 'cobro'] as const) {
  assert.ok(!puedeEditarPrecio(VENDEDOR, paso, 'VENTA'), `precio bloqueado en ${paso}`)
  assert.ok(!puedeElegirVendedor(VENDEDOR, paso, 'VENTA'), `vendedor bloqueado en ${paso}`)
}
// b) Admin pero fuera de la etapa de selección de productos.
for (const paso of ['cliente', 'venta', 'venta-proforma', 'cobro', 'factura'] as const) {
  assert.ok(!puedeEditarPrecio(ADMIN, paso, 'VENTA'), `el admin no edita precio en ${paso}`)
}
// c) Admin en la etapa correcta pero con otra operación: el PRECIO sigue bloqueado.
for (const op of ['REMITO', 'VENTA PROFORMA'] as const) {
  assert.ok(!puedeEditarPrecio(ADMIN, 'productos', op), `sin override en ${op}`)
}

// ---------- Override de precio en el reducer ----------
const producto = {
  codigo: '150',
  nombre: 'CLORO GRANULADO x 1 KG.',
  precio: 10000,
  rentabilidad: 40, // costo = 6000
  iva: 21,
  fisico: 0,
  comercial: 0,
  disponible: 0,
  provCod: '',
  provNombre: '',
  tipo: 'COM',
  moneda: 'ARS',
} as unknown as Producto

const conLinea = reducer(initialState, {
  type: 'addLinea',
  producto,
  cantidad: 2,
  descuento: 0,
})
const idLinea = conLinea.lineas[0].id
/* El costo sale de `costoDe`: del "🤖Costo Final" si el maestro lo trajo y, si no, despejado del
   precio y el margen ORIGINALES. Al pisar el precio queda fijado, así que ya no se puede volver a
   despejar del margen —que a propósito NO se recalcula—. */
const costo = (s: typeof conLinea) => round2(costoDe(s.lineas[0].producto))

const costoOriginal = costo(conLinea)
const pisado = reducer(conLinea, { type: 'setPrecioLinea', id: idLinea, precio: 8000 })
assert.equal(pisado.lineas[0].producto.precio, 8000, 'el precio no se aplicó')
assert.equal(costo(pisado), costoOriginal, 'el costo del producto no puede cambiar al pisar el precio')
/* La rentabilidad BASE del maestro NO se toca al pisar el precio: es el dato de referencia. Lo que
   cambia es la FINAL, que se deriva del precio vigente contra el costo. */
assert.equal(
  pisado.lineas[0].producto.rentabilidad,
  conLinea.lineas[0].producto.rentabilidad,
  'pisar el precio movió la rentabilidad BASE',
)
assert.equal(
  rentabilidadDe(pisado.lineas[0].producto.precioSinIva!, costoOriginal),
  round2((8000 / costoOriginal - 1) * 100),
  'la rentabilidad FINAL no siguió al precio pisado',
)
// Pisarlo dos veces equivale a pisarlo una sola con el valor final (el costo se conserva).
const dosVeces = reducer(pisado, { type: 'setPrecioLinea', id: idLinea, precio: 12000 })
const unaVez = reducer(conLinea, { type: 'setPrecioLinea', id: idLinea, precio: 12000 })
/* Se comparan redondeados: los dos caminos hacen distinta cantidad de multiplicaciones en punto
   flotante, así que difieren en el orden de 1e-14 (68 vs 67.99999999999997). Lo que importa es que
   describan el mismo margen, no que compartan los últimos bits. */
assert.equal(
  round2(dosVeces.lineas[0].producto.precioSinIva ?? 0),
  round2(unaVez.lineas[0].producto.precioSinIva ?? 0),
  'el override no es idempotente: el precio neto se arrastra',
)
assert.equal(costo(dosVeces), costoOriginal, 'el costo se corrió tras dos overrides')
// Un precio inválido se ignora: el estado queda tal cual.
assert.equal(
  reducer(pisado, { type: 'setPrecioLinea', id: idLinea, precio: 0 }),
  pisado,
  'un precio en cero no debería aplicarse',
)
// El catálogo no se toca: el override es de la línea.
assert.equal(producto.precio, 10000, 'se mutó el producto del catálogo')

// ---------- Lo que renderiza la tabla ----------
const fila: FilaProducto = {
  id: 'l1',
  codigo: producto.codigo,
  nombre: producto.nombre,
  cantidad: 1,
  precio: 10000,
  descuento: 0,
  rentabilidad: 40,
  producto,
}
const render = (onPrecio?: (id: string, precio: number) => void) =>
  renderToStaticMarkup(
    createElement(
      AppProvider,
      null,
      createElement(TablaProductos, {
        titulo: 'Productos seleccionados',
        filas: [fila],
        onRemove: () => {},
        onCantidad: () => {},
        onDescuento: () => {},
        onPrecio,
        cantidadMin: 1,
      }),
    ),
  )

const conOverride = render(() => {})
const sinOverride = render(undefined)
assert.ok(conOverride.includes('pbox'), 'el admin no ve el precio editable')
assert.ok(
  conOverride.includes('aria-label="Precio unitario de CLORO GRANULADO x 1 KG."'),
  'el input de precio no es accesible',
)
assert.ok(!sinOverride.includes('pbox'), 'el precio quedó editable sin permiso')
assert.ok(!sinOverride.includes('Precio unitario de'), 'quedó un input de precio en modo lectura')

// ---------- Tope de descuento según el rol ----------
const TOPES = TOPES_DESCUENTO_DEFAULT
// El administrador puede autorizar excepciones: su tope es la bonificación total.
assert.equal(
  topesDescuentoDe(TOPES, ADMIN, 'productos', 'VENTA').max,
  100,
  'el admin tiene que poder pasarse del 5%',
)
// El vendedor sigue con el máximo del tablero, y el admin también fuera de la etapa.
assert.equal(topesDescuentoDe(TOPES, VENDEDOR, 'productos', 'VENTA').max, TOPES.max, 'tope vendedor')
assert.equal(topesDescuentoDe(TOPES, ADMIN, 'cobro', 'VENTA').max, TOPES.max, 'tope fuera de etapa')
assert.equal(topesDescuentoDe(TOPES, ADMIN, 'productos', 'REMITO').max, TOPES.max, 'tope en remito')
// El piso del tablero no se toca en ningún caso.
assert.equal(topesDescuentoDe(TOPES, ADMIN, 'productos', 'VENTA').min, TOPES.min, 'el piso no cambia')

// ---------- Carga de producto: precio editable sólo para el administrador ----------
/* Se monta con el estado ya puesto en la etapa correcta (los contextos directos, sin el provider,
   que arranca siempre en el paso inicial). */
const estado = (usuarioActual: UsuarioActual): AppState => ({
  ...initialState,
  paso: 'productos',
  operacion: 'VENTA',
  usuarioActual,
})
const renderCarga = (u: UsuarioActual) =>
  renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      { value: estado(u) },
      createElement(
        DispatchContext.Provider,
        { value: () => {} },
        createElement(CargaLinea, { producto, onAdd: () => {}, descFormaPago: 6 }),
      ),
    ),
  )

const cargaAdmin = renderCarga(ADMIN)
const cargaVendedor = renderCarga(VENDEDOR)

assert.ok(cargaAdmin.includes('id="pprecio"'), 'el admin tiene que poder editar el precio unitario')
assert.ok(
  cargaAdmin.includes('aria-label="Precio unitario de CLORO GRANULADO x 1 KG."'),
  'el input de precio de la carga no es accesible',
)
assert.ok(!cargaVendedor.includes('id="pprecio"'), 'el vendedor no debería editar el precio')
assert.ok(cargaVendedor.includes('cl-kpi-v'), 'el vendedor tiene que ver el precio como dato')

// El descuento en $ es derivado: no se modifica, para ningún rol.
for (const [quien, html] of [
  ['admin', cargaAdmin],
  ['vendedor', cargaVendedor],
] as const) {
  const campo = html.slice(html.indexOf('id="pdescm"'), html.indexOf('id="pdescm"') + 300)
  assert.ok(campo.includes('readonly'), `el descuento en $ debe ser de sólo lectura (${quien})`)
  assert.ok(campo.includes('disabled'), `el descuento en $ debe estar deshabilitado (${quien})`)
  // El de porcentaje, en cambio, sigue siendo editable para los dos.
  const pct = html.slice(html.indexOf('id="pdesc"'), html.indexOf('id="pdesc"') + 300)
  assert.ok(!pct.includes('readonly'), `el descuento en % tiene que editarse (${quien})`)
}

console.log('OK · RBAC por equipo, tope de descuento y override de precio')
