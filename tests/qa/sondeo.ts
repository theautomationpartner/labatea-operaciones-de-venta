/** Sondeo previo: datos reales de la cuenta con los que se arman los casos. */
import './base'
import {
  buscarClientes,
  buscarProductos,
  getComisionesVenta,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getTopesDescuento,
  getTasaCambioHoy,
  getVendedores,
  getUsuarioActual,
  getContactosCliente,
} from '@/services/monday'

const j = (x: unknown) => JSON.stringify(x, null, 1)

for (const termino of ['7001', '7000']) {
  const { personas } = await buscarClientes(termino)
  console.log(`--- CLIENTE ${termino} ---`)
  console.log(j(personas))
  if (personas[0]) {
    const cts = await getContactosCliente(personas[0].id)
    console.log(`contactos: ${j(cts)}`)
  }
}

console.log('--- CONFIG ---')
console.log('diasVigencia', await getDiasVigencia())
console.log('diasVencFactura', await getDiasVencimientoFactura())
console.log('topes', j(await getTopesDescuento()))
console.log('descuentosPago', j(await getDescuentosPago()))
console.log('comisiones', j(await getComisionesVenta()))
console.log('tasaCambio', await getTasaCambioHoy())
console.log('vendedores', j(await getVendedores()))
console.log('usuarioActual', j(await getUsuarioActual()))

console.log('--- PRODUCTOS (L1, sin iva) ---')
const pag = await buscarProductos('', 'L1', false, [])
console.log(j(pag.productos.map((p) => ({
  id: p.id, codigo: p.codigo, nombre: p.nombre, precio: p.precio, moneda: p.moneda,
  tipo: p.tipo, prov: p.provNombre, provId: p.provId, iva: p.iva, um: p.um,
  comisionable: p.comisionable, conRentabForzada: p.conRentabForzada,
  stockId: p.stockId, disponible: p.disponible, rent: p.rentabilidad, costo: p.precioCosto,
}))))
