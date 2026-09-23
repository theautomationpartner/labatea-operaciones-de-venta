/**
 * Dos trampas de las consultas que hace el SERVIDOR contra Monday, las dos pagadas en producción y
 * las dos invisibles: no rompen la pantalla, la dejan mintiendo.
 *
 * ── 1. Campos que no existen en la versión de API fijada ──
 * La app fija `API-Version: 2024-10` (ver `api/_mondayApi.ts`). Monday NO ignora un campo
 * desconocido: rechaza el DOCUMENTO ENTERO. `/api/vendedores` pedía `User.kind`, que en 2024-10 no
 * existe, así que fallaba la lectura de equipos COMPLETA —no sólo el dato del admin—, el `catch`
 * dejaba `rolesLeidos: false` y todo el mundo, administradores incluidos, quedaba con el rol más
 * restrictivo. En pantalla eso se veía como "de golpe no puedo pisar un precio", y en la consola
 * como una advertencia que es fácil pasar por alto.
 *
 * ── 2. El cupo POR CAMPO y por minuto ──
 * Aparte del límite general de la cuenta, Monday corta por campo, y el que se agota primero es
 * `display_value`: el único que devuelve el valor calculado de una fórmula o una mirror. Los dos
 * crones lo piden a lo largo de miles de ítems. Sin reintento, la corrida muere a mitad del barrido
 * y la tabla queda CARGADA A MEDIAS —peor que vacía: el buscador no encuentra clientes que existen
 * y nada dice por qué—. Por eso las consultas de los crones van por `mondayServidorConEspera`.
 *
 * Se testea sobre el FUENTE porque las dos son cuestiones de qué se escribe en la consulta y con
 * qué función se manda; no hay lógica que ejercitar, y sin red no hay forma de que Monday las
 * rechace acá.
 *
 *   npm run test:consultas-servidor
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const vendedores = readFileSync('api/vendedores.ts', 'utf8')
const personas = readFileSync('api/cron/personas.ts', 'utf8')
const productos = readFileSync('api/cron/productos.ts', 'utf8')
const mondayApi = readFileSync('api/_mondayApi.ts', 'utf8')

console.log('Caso 1 · Sólo campos que existen en la versión de API fijada:')

ok('la versión de API sigue siendo la fijada', mondayApi.includes("API_VERSION = '2024-10'"))
/* El campo por el que se pagó. Si alguien lo vuelve a poner, Monday rechaza la consulta entera y
   todos pierden sus permisos sin que nada se rompa a la vista. */
ok(
  'la consulta de usuarios NO pide `kind`, que no existe en 2024-10',
  !/\bkind\b/.test(vendedores.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
)
ok('pide `is_admin`, que sí existe', /users\(ids: \$ids\)[\s\S]*?is_admin/.test(vendedores))
ok('y lo lee como booleano, no comparándolo con un texto', vendedores.includes('is_admin === true'))

console.log('\nCaso 2 · Los crones aguantan el cupo por campo:')

for (const [nombre, fuente] of [
  ['personas', personas],
  ['productos', productos],
] as const) {
  /* Lo que importa es que NINGUNA consulta del cron vaya por la versión sin reintento: alcanza una
     sola para que el barrido muera a mitad y la tabla quede incompleta. */
  const sinEspera = /\bmondayServidor</.test(fuente)
  ok(`el cron de ${nombre} no usa mondayServidor sin espera`, !sinEspera)
  ok(`el cron de ${nombre} usa mondayServidorConEspera`, fuente.includes('mondayServidorConEspera<'))
}

/* Y el que reintenta tiene que seguir reintentando: sin el `catch` que lee los segundos, la función
   se llamaría igual pero no esperaría nada. */
ok('la espera sale del propio servidor', mondayApi.includes('retry_in_seconds'))
ok('y se reintenta un número acotado de veces', /intentos = \d+/.test(mondayApi))

console.log('\nCaso 3 · Un padrón roto se dice, no se disimula:')

const padron = readFileSync('src/services/monday/padronPersonas.ts', 'utf8')
ok('si el servidor reporta un error, se avisa en la consola', padron.includes('[padrón] el servidor no pudo actualizarlo'))
ok('y si el padrón llega vacío, también', padron.includes('[padrón] llegó VACÍO'))

/* La trampa que dejaba el buscador muerto para siempre: un espejo VACÍO restaurado CON su versión
   convierte el pedido siguiente en un delta, el servidor contesta —con razón— que no cambió nada,
   y recargar no arregla nada porque cada recarga repite el mismo delta. */
ok(
  'un espejo vacío no se restaura con su versión',
  padron.includes('if (guardado.clientes.length === 0) return'),
)
const restaura = padron.slice(padron.indexOf('function desdeSesion'), padron.indexOf('function guardarEnSesion'))
ok(
  'y el corte va ANTES de tomar la versión guardada',
  restaura.indexOf('guardado.clientes.length === 0') < restaura.indexOf('version = guardado.version'),
)

console.log('\nCaso 4 · Se puede ver el estado del padrón sin abrir la base:')
const cron = readFileSync('api/cron/personas.ts', 'utf8')
ok('existe `?modo=estado`', cron.includes("forzado === 'estado'"))
/* De SÓLO LECTURA: si tomara el lock, consultar el estado bloquearía la corrida siguiente, y si
   barriera, "mirar cómo está" cambiaría lo que se está mirando. */
const antesDelLock = cron.slice(0, cron.indexOf('await tomarLock()'))
ok('y se responde ANTES de tomar el lock', antesDelLock.includes("forzado === 'estado'"))
const db = readFileSync('api/_padronDb.ts', 'utf8')
ok('informa cuántas filas entrega la app', db.includes('entregaALaApp'))
ok('y cuántas quedaron sin categoría, que es el fallo mudo', db.includes('sinCategoria'))

console.log(`\n${asserts} verificaciones OK · las consultas del servidor piden lo que existe y aguantan el cupo`)
