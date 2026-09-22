/**
 * El orden del buscador de clientes en local.
 *
 * Lo que se prueba acá no es "encuentra al cliente" sino "lo pone PRIMERO". Es toda la diferencia
 * entre el buscador nuevo y el viejo: la lista se rearma en cada tecla, así que el que la
 * encabeza es el que el usuario va a elegir sin leer el resto.
 *
 * El caso que manda es el del código. En este tablero los clientes se llaman "7001 - La Batea S.A"
 * —el código va adentro del nombre— y hay CUIT que terminan con los mismos dígitos: buscar "7001"
 * tiene que traer al 7001 arriba, no al cliente cuyo CUIT termina en 7001. Esa confusión ya se
 * pagó una vez contra Monday (ver `tests/busqueda-cliente-exacta.test.ts`) y el buscador local no
 * la puede reintroducir por la ventana.
 *
 * Se corre con `npm run test:busqueda-local`; vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { buscarEnPadron, indexarPadron, nombreSinCodigo } from '@/lib/busquedaClientes'
import type { Cliente } from '@/types'

/** Un cliente con lo mínimo que mira el buscador; el resto no interviene en el orden. */
const cliente = (
  id: string,
  codigo: string,
  name: string,
  cuit = '',
  categorias?: Cliente['categorias'],
): Cliente =>
  ({
    id,
    codigo,
    name,
    cuit,
    categorias,
    ptype: '',
    status: '',
    list: null,
    ret: 'Ninguna',
    agenteRetencion: false,
    condicionPago: null,
    aceptaCheques: true,
    limit: 0,
    saldoCtaCte: 0,
    lineaUtilizada: 0,
    remitosPendFacturar: 0,
    disponible: 0,
    addr: '',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  }) as Cliente

const PADRON = indexarPadron([
  cliente('1', '7001', '7001 - La Batea S.A TEST'),
  // Su CUIT TERMINA en 7001: es el que se colaba cuando la comparación era por subcadena.
  cliente('2', '2385', '2385 - GANADERA DEL SUR S.A.', '30619677001'),
  cliente('3', '2', '2 - ZUBIAURRE S.A.'),
  cliente('4', '4077', '4077 - RAYCLE S.A. (LA GLICINA)'),
  cliente('5', '82', '82 - RAYCLE S.A.'),
  cliente('6', '912', '912 - ORO ROJO S.A.', '30-71234567-8'),
  cliente('7', '823', '823 - SUCESION DE INZA JOSE HUGO'),
  cliente('8', '292', '292 - FERNANDEZ ABEL'),
  cliente('9', '693', '693 - MARTÍNEZ HNOS'),
  cliente('10', '756', '756 - LEGRIS HNOS.S.H.'),
])

const primero = (t: string): string => {
  const { clientes } = buscarEnPadron(PADRON, t)
  assert.ok(clientes.length > 0, `"${t}" no devolvió ningún resultado`)
  return clientes[0].codigo
}

/* ---------- 1) El código exacto manda, por encima de un CUIT que termina igual ---------- */

assert.equal(
  primero('7001'),
  '7001',
  'buscar un código tiene que traer ESE código primero, no al cliente cuyo CUIT termina igual',
)

/* Y el otro igual aparece —no se lo esconde—, pero detrás. */
const porCodigo = buscarEnPadron(PADRON, '7001').clientes.map((c) => c.codigo)
assert.deepEqual(porCodigo, ['7001'], 'un código exacto no arrastra parecidos a la lista')

/* ---------- 2) El CUIT, con y sin guiones ---------- */

assert.equal(primero('30619677001'), '2385', 'el CUIT sin guiones encuentra a su cliente')
assert.equal(primero('30-71234567-8'), '912', 'y con guiones, también')
assert.equal(primero('30712345678'), '912', 'el mismo CUIT escrito de las dos formas es el mismo')

/* ---------- 3) El nombre: prefijo por encima de "contiene" ---------- */

/* "RAYCLE" encabeza la razón social del 82 y aparece en el medio de la del 4077. El que empieza
   con lo buscado va primero. */
const raycle = buscarEnPadron(PADRON, 'RAYCLE').clientes.map((c) => c.codigo)
assert.deepEqual(raycle, ['82', '4077'], 'empezar con lo buscado pesa más que contenerlo')

/* El nombre trae el código adelante ("82 - RAYCLE S.A."): sin sacarlo, ningún nombre empezaría
   nunca con la razón social y esta capa no serviría para nada. */
assert.equal(nombreSinCodigo('82 - RAYCLE S.A.'), 'RAYCLE S.A.')
assert.equal(nombreSinCodigo('Labatea TEST'), 'Labatea TEST', 'sin código adelante, queda igual')

/* ---------- 4) Acentos ---------- */

assert.equal(primero('MARTINEZ'), '693', 'buscar sin acento tiene que encontrar al acentuado')
assert.equal(primero('martínez'), '693', 'y con acento y en minúsculas, también')

/* ---------- 5) Prefijo de código, sólo para términos numéricos ---------- */

const por40 = buscarEnPadron(PADRON, '40').clientes.map((c) => c.codigo)
assert.deepEqual(por40, ['4077'], 'tipear el principio de un código lo encuentra')

/* ---------- 6) Palabra del medio ---------- */

/* "HNOS" no encabeza ningún nombre pero sí una palabra del medio de dos de ellos. Los dos entran,
   y como empatan en la misma capa el desempate es alfabético —estable, que es lo que importa: si
   el orden dependiera del recorrido del padrón, la lista cambiaría sola entre búsquedas iguales—. */
const hnos = buscarEnPadron(PADRON, 'HNOS').clientes.map((c) => c.codigo)
assert.deepEqual(hnos, ['756', '693'], 'una palabra que empieza en el medio del nombre cuenta')

/* ---------- 7) Lo que no coincide, no aparece ---------- */

assert.equal(
  buscarEnPadron(PADRON, 'ZZZZQQQ').clientes.length,
  0,
  'un término sin coincidencias no puede traer resultados por similitud floja',
)
assert.equal(buscarEnPadron(PADRON, '   ').clientes.length, 0, 'sólo espacios no es una búsqueda')

/* ---------- 8) El tope se AVISA ---------- */

const muchos = indexarPadron(
  Array.from({ length: 50 }, (_, i) => cliente(`m${i}`, `9${i}`, `9${i} - MARIA DE LOS ANGELES`)),
)
const cortado = buscarEnPadron(muchos, 'MARIA', 10)
assert.equal(cortado.clientes.length, 10, 'se entregan sólo los del tope')
assert.ok(
  cortado.truncado,
  'y se avisa que quedaron afuera: callarlo es lo que hacía creer que el cliente no existía',
)

const entra = buscarEnPadron(muchos, 'MARIA', 50)
assert.ok(!entra.truncado, 'si entran todos, no se avisa de nada')

/* ---------- 9) El orden es estable ---------- */

assert.deepEqual(
  buscarEnPadron(muchos, 'MARIA', 10).clientes.map((c) => c.id),
  buscarEnPadron(muchos, 'MARIA', 10).clientes.map((c) => c.id),
  'dos búsquedas iguales tienen que devolver el mismo orden, o la lista salta al tipear',
)

/* ---------- 10) Un proveedor NO se puede ofrecer como cliente ----------
   El padrón del servidor guarda clientes y proveedores, y el endpoint ya entrega sólo los
   clientes. Esto es el segundo cerrojo, y el motivo por el que existe no es de estilo: ofrecer un
   proveedor como cliente de una venta es facturarle a quien nos vende. */

const mixto = indexarPadron([
  cliente('p1', '5001', '5001 - DISTRIBUIDORA NORTE', '', ['proveedor']),
  cliente('c1', '5002', '5002 - DISTRIBUIDORA SUR', '', ['cliente']),
  // Cliente Y proveedor a la vez: sigue siendo cliente, así que SÍ se puede elegir.
  cliente('a1', '5003', '5003 - DISTRIBUIDORA ESTE', '', ['cliente', 'proveedor']),
  // Sin categorías: es lo que devuelven el mock y la búsqueda directa a Monday, y ahí ya se sabe
  // que lo que llegó es un cliente.
  cliente('s1', '5004', '5004 - DISTRIBUIDORA OESTE'),
])

assert.deepEqual(
  buscarEnPadron(mixto, 'DISTRIBUIDORA').clientes.map((c) => c.codigo).sort(),
  ['5002', '5003', '5004'],
  'un proveedor NO puede aparecer en el buscador de clientes: elegirlo sería facturarle a quien ' +
    'nos vende',
)

assert.equal(
  buscarEnPadron(mixto, '5001').clientes.length,
  0,
  'ni siquiera buscándolo por su código exacto',
)

console.log('búsqueda local: OK · el que más matchea va primero, y ningún proveedor se ofrece')
