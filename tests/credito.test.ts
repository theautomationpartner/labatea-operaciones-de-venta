/**
 * Test aislado de la lógica de crédito. No depende de React ni de la red: ejercita las funciones
 * puras de `@/lib/credito` (y `resumenVenta`, para la base del importe). Se corre con esbuild +
 * node (`npm run test:credito`); no forma parte del build de la app (vive fuera de `src/`).
 *
 * Cubre:
 *   1. La fórmula del crédito disponible nunca queda negativa (clamp en 0).
 *   2. VENTA a CUENTA CORRIENTE: se frena al excederse el crédito.
 *   3. PRESUPUESTO: el exceso avisa pero NO frena (se puede guardar).
 *   4. Quién decide que el crédito rija: la FORMA DE PAGO de la venta, no la condición del cliente.
 *   5. La entrega ANTERIOR no se mide: lo que factura ya tomó línea al salir el remito.
 *   6. Sobre qué importe se mide: total CON IVA en la venta, neto en el presupuesto.
 *   7. Los remitos pendientes de facturar cuentan como línea tomada en las dos operaciones.
 */
import assert from 'node:assert/strict'
import type { Cliente, VentaItem } from '@/types'
import {
  clienteOperaACredito,
  creditoDisponibleProyectado,
  creditoResultante,
  excedeCredito,
  frenaPorCredito,
  lineaResultante,
  type OperacionCredito,
} from '@/lib/credito'
import { resumenVenta } from '@/lib/selectors'

/** Cliente mínimo para el cálculo de crédito (sólo importan límite, saldo, remitos y estado). */
function clienteBase(over: Partial<Cliente> = {}): Cliente {
  return {
    id: '1',
    name: 'Cliente Test',
    cuit: '',
    ptype: '',
    status: '',
    list: 'L1',
    ret: '',
    agenteRetencion: false,
    condicionPago: 'CUENTA CORRIENTE',
    limit: 1000,
    codigo: '',
    saldoCtaCte: 600,
    lineaUtilizada: 700,
    remitosPendFacturar: 100, // usado = 600 + 100 = 700 → disponible actual = 300
    disponible: 300,
    addr: '',
    activity: 'Activo',
    situation: 'Liberado con crédito',
    ...over,
  } as Cliente
}

/** Las operaciones, en lo único que le importa al crédito. */
const VENTA_CTA_CTE: OperacionCredito = { operacion: 'VENTA', formaPago: 'CUENTA CORRIENTE' }
const VENTA_CONTADO: OperacionCredito = { operacion: 'VENTA', formaPago: 'CONTADO' }
const VENTA_DEBITO: OperacionCredito = { operacion: 'VENTA', formaPago: 'TARJETA DE DEBITO' }
const VENTA_SIN_FORMA: OperacionCredito = { operacion: 'VENTA', formaPago: null }
/** VENTA con entrega ANTERIOR: se facturan Vtas Pends de Facturar que ya tomaron línea. */
const VENTA_ANTERIOR: OperacionCredito = {
  operacion: 'VENTA',
  formaPago: 'CUENTA CORRIENTE',
  tipoEntrega: 'ANTERIOR',
}
const VENTA_POSTERIOR: OperacionCredito = {
  operacion: 'VENTA',
  formaPago: 'CUENTA CORRIENTE',
  tipoEntrega: 'POSTERIOR',
}
const PRESUPUESTO: OperacionCredito = { operacion: 'PRESUPUESTAR', formaPago: null }
const PROFORMA: OperacionCredito = { operacion: 'VENTA PROFORMA', formaPago: null }
const REMITO: OperacionCredito = { operacion: 'REMITO', formaPago: null }

let asserts = 0
function ok(nombre: string, cond: boolean) {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const c = clienteBase() // límite 1000, usado 700 (saldo 600 + remitos 100), disponible actual 300

/** Una línea de venta, con la alícuota estándar. */
const item = (precio: number): VentaItem =>
  ({ uid: 'u', precio, aVender: 1, desc: 0, rent: 40, iva: 21 }) as VentaItem

console.log('Caso 1 · La fórmula del crédito disponible nunca queda negativa (clamp en 0):')
ok('disponible actual (importe 0) = 300', creditoDisponibleProyectado(c, 0) === 300)
ok('con importe 250 → 50', creditoDisponibleProyectado(c, 250) === 50)
ok('con importe 300 (justo) → 0', creditoDisponibleProyectado(c, 300) === 0)
ok('con importe 500 (excede) → 0, NUNCA negativo', creditoDisponibleProyectado(c, 500) === 0)
ok('el resultante SÍ puede ser negativo (señal de exceso)', creditoResultante(c, 500) === -200)

console.log('Caso 2 · VENTA a CUENTA CORRIENTE (bloqueante): se frena al excederse el crédito:')
ok('importe 300 (justo, resultante 0) NO frena', frenaPorCredito(c, 300, VENTA_CTA_CTE, true) === false)
ok('importe 301 (excede) frena', frenaPorCredito(c, 301, VENTA_CTA_CTE, true) === true)
ok('excedeCredito coincide con el freno', excedeCredito(c, 301, VENTA_CTA_CTE) === true)

console.log('Caso 3 · PRESUPUESTO (no bloqueante): el exceso avisa pero NO frena:')
ok('importe 500 (excede) NO frena en presupuesto', frenaPorCredito(c, 500, PRESUPUESTO, false) === false)
ok('importe 5000 (excede fuerte) NO frena', frenaPorCredito(c, 5000, PRESUPUESTO, false) === false)
ok('igual sigue detectando el exceso para poder avisar', excedeCredito(c, 500, PRESUPUESTO) === true)

console.log('Caso 4 · Decide la FORMA DE PAGO de la venta, no la condición de pago del cliente:')
ok('CUENTA CORRIENTE consume línea', excedeCredito(c, 5000, VENTA_CTA_CTE) === true)
ok('CONTADO no consume: se cobra en el acto', excedeCredito(c, 5000, VENTA_CONTADO) === false)
ok('TARJETA tampoco consume', excedeCredito(c, 5000, VENTA_DEBITO) === false)
ok('sin forma de pago elegida todavía no se mide nada', excedeCredito(c, 5000, VENTA_SIN_FORMA) === false)
ok('la VENTA PROFORMA se cobra siempre en el acto: nunca consume', excedeCredito(c, 5000, PROFORMA) === false)
ok('el REMITO sí: la mercadería entregada queda pendiente de facturar', excedeCredito(c, 5000, REMITO) === true)
/* Un cliente de PROVEED 45 DIAS sólo puede operar de CONTADO (`formasPagoDeCliente`): su condición
   habilita el crédito, pero la venta que efectivamente arma no lo consume. */
const proveedor = clienteBase({ condicionPago: 'PROVEED 45 DIAS' })
ok('cliente PROVEED 45: la ficha sí lo muestra como cliente a crédito', clienteOperaACredito(proveedor))
ok(
  'cliente PROVEED 45 vendiendo de CONTADO: no se le mide el límite',
  excedeCredito(proveedor, 5000, VENTA_CONTADO) === false,
)
// El estado del board sigue mandando por encima de todo lo demás.
const sinCredito = clienteBase({ situation: 'Liberado sin crédito' })
ok('"Liberado sin crédito" no tiene tope que superar', excedeCredito(sinCredito, 5000, VENTA_CTA_CTE) === false)
const bloqueado = clienteBase({ situation: 'Bloqueado' })
ok('el cliente bloqueado no se mide por crédito (se frena aparte)', excedeCredito(bloqueado, 5000, VENTA_CTA_CTE) === false)
const contado = clienteBase({ condicionPago: 'CONTADO' })
ok('cliente de CONTADO: su presupuesto no proyecta consumo', excedeCredito(contado, 5000, PRESUPUESTO) === false)

console.log('Caso 5 · La entrega ANTERIOR no se mide: lo que factura ya tomó línea al salir el remito:')
/* Cliente con 800 de mercadería entregada y sin facturar. Facturarla no agrega exposición: mueve
   el importe de "Remito Pends de Facturar" al saldo. Medirla encima de `creditoUsado` —que ya la
   contiene— la contaba dos veces y frenaba una venta que entra en la línea. */
const conRemito = clienteBase({ saldoCtaCte: 0, remitosPendFacturar: 800, lineaUtilizada: 800, disponible: 200 })
ok('facturar el remito NO frena, por más que "no entre"', excedeCredito(conRemito, 968, VENTA_ANTERIOR) === false)
ok('con importe 0 tampoco (es lo que pasa la vista)', excedeCredito(conRemito, 0, VENTA_ANTERIOR) === false)
ok('la MISMA venta con entrega POSTERIOR sí se mide', excedeCredito(conRemito, 968, VENTA_POSTERIOR) === true)
ok('la entrega ANTERIOR nunca frena, ni con importes absurdos', frenaPorCredito(conRemito, 999999, VENTA_ANTERIOR, true) === false)
/* El resumen de la factura tampoco proyecta una baja del disponible que no va a ocurrir. */
const factAnterior = resumenVenta([item(800)], conRemito, 'DIRECTA', 0, undefined, VENTA_ANTERIOR)
ok('el "Crédito disponible" de la card queda en el actual (200)', factAnterior.resultante === 200)
ok('y no se marca uso de línea', factAnterior.usadoPct === 0)

console.log('Caso 6 · La VENTA se mide sobre el TOTAL CON IVA (es lo que se asienta en la cuenta):')
/* Venta de 300 netos con 21% de IVA = 363. El neto entra justo en la línea (disponible 300), pero
   el importe que se va a asentar en la cuenta corriente no: es lo que tiene que frenar. */
const venta = resumenVenta([item(300)], c, 'CON PRESUPUESTO PREVIO', 0, undefined, VENTA_CTA_CTE)
ok('el neto de la venta es 300', venta.total === 300)
ok('el total con IVA es 363', venta.iva === 63)
ok('el resultante se mide con IVA: 1000 − 700 − 363 = −63', venta.resultante === -63)
ok('y por eso la venta excede', excedeCredito(c, venta.total + venta.iva, VENTA_CTA_CTE) === true)
ok('medida sobre el neto NO habría excedido (el bug que esto corrige)', excedeCredito(c, venta.total, VENTA_CTA_CTE) === false)

console.log('Caso 7 · Los remitos pendientes de facturar toman línea en las dos operaciones:')
const sinRemitos = clienteBase({ remitosPendFacturar: 0, lineaUtilizada: 600, disponible: 400 })
ok('con 100 de remitos, 301 excede', excedeCredito(c, 301, VENTA_CTA_CTE) === true)
ok('sin remitos, ese mismo importe entra', excedeCredito(sinRemitos, 301, VENTA_CTA_CTE) === false)
ok('el presupuesto los cuenta igual', excedeCredito(c, 301, PRESUPUESTO) === true)
ok('línea comprometida tras consumir 250 = 700 + 250 = 950', lineaResultante(c, 250) === 950)
ok('la línea comprometida es lo que se compara con el límite', lineaResultante(c, 301) > c.limit)

console.log(`\nOK · ${asserts} asserts pasaron.`)
