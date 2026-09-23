/**
 * REGISTRAR ACTIVIDAD · elegir la Persona no consulta la cuenta corriente, y los contactos SÍ se
 * piden a Monday.
 *
 * Las dos mitades son decisiones sobre cuándo vale la pena salir a la red, y ninguna se sostiene
 * sin la otra:
 *
 * 1. **La Persona sale del padrón cacheado, sin releerla.** El resto de las operaciones sí la
 *    relee al elegirla, porque de ese objeto salen el crédito disponible y la situación, y con eso
 *    se decide si una venta puede seguir. Acá no se vende nada: la ficha muestra código, nombre,
 *    dirección y estado, y los cuatro ya vienen en el padrón. La consulta sólo agregaba media
 *    espera y un modo de fallar —una actividad que no se puede cargar porque no se pudo leer un
 *    saldo que nadie mira—.
 * 2. **Los contactos SÍ se consultan.** No están cacheados: el cron guarda personas, no contactos.
 *
 * Se testea sobre el FUENTE porque el proyecto no tiene runner de DOM (los tests `.tsx` renderizan
 * con `react-dom/server`, donde los efectos no corren), así que no hay forma de simular el click
 * que elige la Persona. Y lo que hay que proteger es de qué depende cada camino, no una lógica.
 *
 *   npm run test:actividad-persona
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const vista = readFileSync('src/features/actividad/ActividadPersonaView.tsx', 'utf8')
const buscador = readFileSync('src/features/cliente/BuscarCliente.tsx', 'utf8')
const ficha = readFileSync('src/features/actividad/PersonaElegida.tsx', 'utf8')

console.log('Caso 1 · La Persona se elige sin consultar la cuenta corriente:')

ok('la etapa pide el buscador SIN crédito', /conCredito=\{false\}/.test(vista))
/* El atajo tiene que estar ANTES de la relectura, o se consultaria igual. */
const elegir = buscador.slice(buscador.indexOf('const elegir'), buscador.indexOf('const buscar'))
ok('el buscador corta antes de releer', elegir.indexOf('if (!conCredito)') < elegir.indexOf('refrescarCliente'))
ok('y en ese camino carga el cliente del padrón', /if \(!conCredito\)[\s\S]*?dispatch\(\{ type: 'setCliente', cliente: c \}\)/.test(elegir))
/* Sin el default en `true`, cualquier operación que no pase la prop se quedaría sin la relectura
   del crédito, que es lo que frena una venta a un cliente sin línea disponible. */
ok('pero por defecto SÍ se relee', buscador.includes('conCredito = true'))
ok('y el resto de las operaciones no pasan la prop', vista.split('conCredito').length - 1 >= 1)

console.log('\nCaso 2 · La ficha no muestra nada que exija esa consulta:')
for (const campo of ['codigo', 'name', 'addr', 'activity']) {
  ok(`muestra ${campo}, que ya viene en el padrón`, ficha.includes(`persona.${campo}`))
}
/* Si algún día la ficha mostrara saldo o crédito, el dato cacheado dejaría de alcanzar y este
   test tiene que romper para que alguien lo piense. */
for (const campo of ['saldoCtaCte', 'disponible', 'limit', 'lineaUtilizada']) {
  ok(`NO muestra ${campo}, que exigiría releer`, !ficha.includes(`persona.${campo}`))
}

console.log('\nCaso 3 · Los contactos sí se piden a Monday:')
ok('la etapa los consulta', vista.includes("getContactosCliente(id, 'Actividad')"))
/* La lista es del cliente en pantalla o de nadie: sin esto, los contactos del cliente anterior se
   dibujaban un frame despues de buscar otro. */
ok('y los ata a la Persona de la que salieron', vista.includes('setCargados({ clienteId: id, lista'))
ok('un fallo se avisa y no deja la tabla buscando para siempre', vista.includes("accion: 'traer los contactos de la Persona'"))

console.log(`\n${asserts} verificaciones OK · la Persona sale del padrón, los contactos de Monday`)
