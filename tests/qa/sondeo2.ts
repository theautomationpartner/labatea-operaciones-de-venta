/** Sondeo 2: documentos vivos de cada cliente (presupuestos, proformas, pendientes). */
import './base'
import {
  buscarClientes,
  getPresupuestosVigentes,
  getProformasCliente,
  getVentasPendientesFacturar,
  getVentasEntregaPendiente,
  getActividadesSinAsignar,
  getActividadesPendientes,
  getRutasEntrega,
  getDestinosCliente,
  getTransportistas,
} from '@/services/monday'

const j = (x: unknown) => JSON.stringify(x, null, 1)

for (const t of ['7001', '7000']) {
  const { personas } = await buscarClientes(t)
  const c = personas[0]
  console.log(`\n##### CLIENTE ${t} (${c.id}) #####`)
  const pres = await getPresupuestosVigentes(c.id)
  console.log(`presupuestos vigentes: ${pres.length}`)
  console.log(j(pres.slice(0, 3)))
  const prof = await getProformasCliente(c.id)
  console.log(`proformas: ${prof.length}`)
  console.log(j(prof.slice(0, 3)))
  const pend = await getVentasPendientesFacturar(c.id)
  console.log(`vtas pend de facturar: ${pend.length}`)
  console.log(j(pend.slice(0, 2)))
  const entrega = await getVentasEntregaPendiente(c.id)
  console.log(`ventas con entrega pendiente: ${entrega.length}`)
  console.log(j(entrega.slice(0, 2)))
  console.log('destinos:', j((await getDestinosCliente(c.id)).slice(0, 3)))
  // Las actividades sin asignar son POR CLIENTE: se sondean acá, no en el bloque global.
  const sin = await getActividadesSinAsignar(c.id)
  console.log(`actividades sin asignar: ${sin.length}`)
  console.log(j(sin.slice(0, 5)))
}

console.log('\n##### GLOBAL #####')
console.log('rutas:', j(await getRutasEntrega()))
console.log('transportistas:', j((await getTransportistas()).slice(0, 3)))
const pendAct = await getActividadesPendientes()
console.log(`actividades pendientes: ${pendAct.length}`)
console.log(j(pendAct.slice(0, 3)))
