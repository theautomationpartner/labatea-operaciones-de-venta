/**
 * Registro del cobro SIMULTÁNEO desde la app (`registrarCobroSimultaneo`): lo que antes hacía el
 * escenario de Make "Se crea un item en Recibo y Cobro Vta SIMULT". Se inyecta una conexión que
 * contesta las lecturas y anota cada escritura, y se verifica qué va a cada tablero.
 *
 * Se corre con esbuild + node (`npm run test:registro-cobro-simultaneo`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  ErrorRegistroCobro,
  registrarCobroSimultaneo,
  type ConexionRegistro,
  type DatosRegistroCobro,
} from '@/services/monday/registroCobro'
import type { MovimientoPago } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.deepEqual(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

interface Escrito {
  tipo: string
  board?: number
  padre?: string
  item?: string
  nombre?: string
  cv: Record<string, unknown>
}

/** Una conexión falsa: contesta las lecturas con `saldos` y anota las escrituras. */
function conexion(opciones: { sinCajaEnCuenta?: boolean; fallaCheque?: boolean } = {}) {
  const escritos: Escrito[] = []
  const subidas: string[] = []
  const updates: string[] = []
  let n = 900
  const api = (async (query: string, variables: Record<string, unknown> = {}) => {
    if (query.startsWith('query')) {
      if (query.includes('cajas: items')) {
        return {
          data: {
            cajas: [
              // Efectivo: el último movimiento (por fecha) deja 1000 + 500 − 200 = 1300.
              {
                id: '12476858661',
                subitems: [
                  { id: '1', created_at: '2026-01-01', column_values: [{ id: 'numeric_mksexfxq', text: '0' }, { id: 'numeric_mkse4dzs', text: '1000' }, { id: 'numeric_mksetyds', text: '' }] },
                  { id: '2', created_at: '2026-02-01', column_values: [{ id: 'numeric_mksexfxq', text: '1000' }, { id: 'numeric_mkse4dzs', text: '500' }, { id: 'numeric_mksetyds', text: '200' }] },
                ],
              },
              { id: '555', subitems: [] },
            ],
          },
          errores: [],
        }
      }
      return {
        data: {
          recibo: [
            {
              id: 'R1',
              column_values: [{ id: 'pulse_id_mkwb9111', text: 'RECIBO-124' }],
              subitems: [
                { id: '1001', column_values: [{ id: 'pulse_id_mkwbrvf5', text: 'MOV-1' }] },
                { id: '1002', column_values: [{ id: 'pulse_id_mkwbrvf5', text: 'MOV-2' }] },
              ],
            },
          ],
          venta: [{ id: '77', column_values: [{ id: 'x', text: 'VENTA-012' }] }],
          cta: [{ items_page: { items: [{ id: 'CTA9', column_values: [{ id: 'numeric_mm67j0rv', text: '100' }] }] } }],
          config: [{ id: '44', column_values: [{ id: 'c', linked_item_ids: opciones.sinCajaEnCuenta ? [] : ['555'] }] }],
        },
        errores: [],
      }
    }
    // Mutaciones: create_update o un lote de alias u0, u1…
    if (query.includes('create_update')) {
      updates.push(String(variables.body))
      return { data: {}, errores: [] }
    }
    const data: Record<string, { id: string }> = {}
    const errores: { message: string; path: string[] }[] = []
    const alias = [...query.matchAll(/u(\d+): (\w+)\(/g)]
    if (!alias.length) {
      escritos.push({ tipo: 'estado', item: String(variables.item), cv: JSON.parse(String(variables.cv)) })
      return { data: {}, errores: [] }
    }
    for (const [, i, op] of alias) {
      const cv = JSON.parse(String(variables[`c${i}`]))
      const board = Number(query.match(new RegExp(`u${i}: \\w+\\([^)]*board_id: (\\d+)`))?.[1] ?? 0) || undefined
      const e: Escrito = {
        tipo: op,
        board,
        padre: variables[`p${i}`] as string | undefined,
        item: variables[`i${i}`] as string | undefined,
        nombre: variables[`n${i}`] as string | undefined,
        cv,
      }
      if (opciones.fallaCheque && board === 18425237398) {
        errores.push({ message: 'columna inválida', path: [`u${i}`] })
        continue
      }
      escritos.push(e)
      data[`u${i}`] = { id: String(n++) }
    }
    return { data, errores }
  }) as unknown as ConexionRegistro['api']
  const subir = (async (query: string) => {
    subidas.push(query.match(/column_id: "([^"]+)"/)?.[1] ?? '')
    return {}
  }) as unknown as ConexionRegistro['subir']
  return { cx: { api, subir }, escritos, subidas, updates }
}

const mov = (formaPago: MovimientoPago['formaPago'], importe: number, extra: Partial<MovimientoPago> = {}): MovimientoPago =>
  ({ id: formaPago, formaPago, importe, chequeFechaPago: '', ...extra }) as MovimientoPago

const archivo = new File([new Uint8Array([1])], 'comp.pdf', { type: 'application/pdf' })

const datos: DatosRegistroCobro = {
  reciboId: 'R1',
  clienteId: '10',
  ventaId: '77',
  facturaIds: ['300'],
  fechaCobro: '28/09/2026',
  lineas: [
    { id: '1001', clase: 'pago', movimiento: mov('Efectivo', 400) },
    { id: '1002', clase: 'pago', movimiento: mov('Efectivo', 100) },
    { id: '1003', clase: 'pago', movimiento: mov('Transferencia', 250, { cuentaPropiaId: '44', comprobanteArchivo: archivo }) },
    {
      id: '1004',
      clase: 'pago',
      movimiento: mov('Cheque', 900, {
        numeroCheque: '123',
        fechaEmisionCheque: '20/09/2026',
        chequeFechaPago: '30/09/2026',
        bancoEmisor: 'Banco HSBC',
        formatoCheque: 'eCheq',
        cuitEmisor: '20-45037195-6',
      }),
    },
    { id: '1005', clase: 'pago', movimiento: mov('Tarjeta de débito', 300, { numeroCupon: '777', titularTarjeta: 'JUAN PEREZ', bancoTarjeta: 'Banco Galicia', comprobanteArchivo: archivo }) },
    { id: '1006', clase: 'pago', movimiento: mov('Retencion IIBB', 50, { nroComprobanteRetencion: '0001-1', anioRetencion: '2026', comprobanteArchivo: archivo }) },
    { id: '1007', clase: 'anticipo', importe: 80 },
  ],
}

async function main() {
  console.log('Caso 1 · Un cobro con todos los medios impacta cada tablero:')
  const { cx, escritos, subidas } = conexion()
  await registrarCobroSimultaneo(datos, cx)

  const estados = escritos.filter((e) => e.tipo === 'estado').map((e) => e.cv)
  igual(estados, [], 'no toca ningún estado del recibo (ni el de registro ni "🤖Estado de Envio")')

  const efectivo = escritos.filter((e) => e.tipo === 'create_subitem' && e.padre === '12476858661')
  igual(
    efectivo.map((e) => [e.nombre, e.cv.numeric_mksexfxq, e.cv.numeric_mkse4dzs]),
    [
      ['Efectivo - RECIBO-124 - MOV-1', 1300, 400],
      ['Efectivo - RECIBO-124 - MOV-2', 1700, 100],
    ],
    'efectivo: en la caja Efectivo, con el saldo encadenado desde el último movimiento (1300)',
  )
  igual(
    [efectivo[0].cv.color_mkwb3v95, efectivo[0].cv.board_relation_mm5yexr3, efectivo[0].cv.board_relation_mm5x77s6],
    [{ index: 1 }, { item_ids: [77] }, { item_ids: [300] }],
    'como "✋Cobrado" y conectado a la venta y a su factura',
  )
  const transf = escritos.find((e) => e.tipo === 'create_subitem' && e.padre === '555')
  igual([transf?.cv.numeric_mksexfxq, transf?.cv.numeric_mkse4dzs], [0, 250], 'transferencia: en la caja de la cuenta propia donde se acreditó')

  const cheque = escritos.find((e) => e.board === 18425237398)
  igual(cheque?.nombre, 'eCheq - HSBC - 2026-10-30 - VENTA-012', 'cheque: en la cartera, nombrado como en el escenario')
  igual(
    [cheque?.cv.color_mm5y74q2, cheque?.cv.dropdown_mm5zgtbe, cheque?.cv.board_relation_mm5ysy5w, cheque?.cv.board_relation_mm643x5f],
    [{ index: 17 }, { labels: ['HSBC'] }, { item_ids: [1004] }, { item_ids: [10] }],
    '"Pendiente", el banco con la etiqueta del tablero, y conectado a su movimiento del recibo y al cliente',
  )

  const tarjeta = escritos.find((e) => e.board === 18425243669)
  igual(
    [tarjeta?.nombre, tarjeta?.cv.dropdown_mm5ybkgf, tarjeta?.cv.color_mm5ykwtq, tarjeta?.cv.numeric_mm5yt61n, tarjeta?.cv.text_mm5zvdjj, tarjeta?.cv.dropdown_mm5z9jz3],
    ['Tarjeta de Debito - Banco Galicia - VENTA-012', { labels: ['DEBITO'] }, { index: 0 }, 300, 'JUAN PEREZ', { labels: ['Banco Galicia'] }],
    'tarjeta: el cupón "Pend de Acreditacion", con titular y banco emisor',
  )
  const retencion = escritos.find((e) => e.board === 18426092199)
  igual(
    [retencion?.nombre, retencion?.cv.color_mm65rxsy, retencion?.cv.dropdown_mm6n5vw, retencion?.cv.text_mm79nmzs],
    ['Retencion IIBB - 2026 - RECIBO-124 - VENTA-012', { index: 3 }, { ids: [1] }, '0001-1'],
    'retención: "Sufrida", con su tipo y número',
  )
  const anticipo = escritos.find((e) => e.board === 18426066447)
  igual([anticipo?.nombre, anticipo?.cv.numeric_mm64h18, anticipo?.cv.color_mm64qza0], ['Anticipo - RECIBO-124', 80, { index: 17 }], 'anticipo: nace "Pend de Aplicar"')
  const cta = escritos.find((e) => e.tipo === 'change_multiple_column_values' && e.item === 'CTA9')
  igual(cta?.cv, { numeric_mm67j0rv: 180 }, 'y suma a "Anticipo pend de Aplicar" de la cuenta (100 + 80)')
  igual(subidas.sort(), ['file_mm5xmpnc', 'file_mm5ybwj8', 'file_mm64e4d8'], 'comprobantes: transferencia, cupón y certificado')

  console.log('\nCaso 2 · Lo que no entra se informa en la app, sin estados ni updates en Monday:')
  const f = conexion({ sinCajaEnCuenta: true, fallaCheque: true })
  await assert.rejects(registrarCobroSimultaneo(datos, f.cx), (e: unknown) => {
    igual(e instanceof ErrorRegistroCobro, true, 'lanza ErrorRegistroCobro')
    const fallas = (e as ErrorRegistroCobro).fallas
    igual(fallas.some((x) => x.includes('no tiene una caja conectada')), true, 'la transferencia sin caja en Configuración')
    igual(fallas.some((x) => x.startsWith('Cheque 123: columna inválida')), true, 'y el cheque que Monday rechazó, con su motivo')
    return true
  })
  igual(f.escritos.filter((e) => e.tipo === 'estado').length, 0, 'no escribe ningún estado del recibo')
  igual(f.updates.length, 0, 'ni deja un update')
  igual(f.escritos.some((e) => e.board === 18425243669), true, 'lo demás se registró igual (la tarjeta entró)')

  console.log('\nCaso 3 · Sin factura no se registra nada, como frenaba el escenario:')
  const g = conexion()
  await assert.rejects(registrarCobroSimultaneo({ ...datos, facturaIds: [] }, g.cx))
  igual(g.escritos.length, 0, 'ni una escritura en Monday')

  console.log(`\nOK · registro del cobro simultáneo (${asserts} verificaciones)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
