/**
 * Mapeo de actividades a nivel ÍTEM en el documento que originan (no en la Actividad, que es
 * `asociarActividades` — ver `actividad.test.ts`):
 *   · PRESUPUESTAR   → "🤖Actividades" del presupuesto (board_relation_mm6w6mra)
 *   · VENTA          → "🤖Actividades" de la venta (board_relation_mm6wb3hw)
 *   · VENTA PROFORMA → "🤖Actividades" de la proforma (board_relation_mm6zc4fa)
 *
 * Cubre las dos mitades de la promesa:
 *   1) las tres mutaciones de creación (`crearPresupuesto`/`crearVenta`/`crearProforma`) escriben
 *      la columna correcta cuando se les pasan actividades, y la OMITEN sin ninguna;
 *   2) `actividadesDeLaVenta` (en `useCrearVenta`) resuelve QUÉ actividades le tocan a la venta en
 *      cada camino: las propias (DIRECTA) o las heredadas del documento que la originó (CON
 *      PRESUPUESTO PREVIO, directa o vía una proforma armada con presupuestos).
 *
 * Se corre con esbuild + node (`npm run test:actividades-documento`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { actividadesDeLaVenta } from '@/features/shared/useCrearVenta'
import { ventaItemUid, documentoDeVentaItem } from '@/lib/selectors'
import { COL } from '@/services/monday/columns'
import { crearPresupuesto } from '@/services/monday/presupuestar'
import { crearVenta } from '@/services/monday/venta'
import { crearProforma } from '@/services/monday/proformas'
import {
  getActividadesDePresupuestos,
  getActividadesDeProforma,
  getActividadesHeredadasDePresupuestos,
  getActividadesHeredadasDeProforma,
} from '@/services/monday/actividades'
import { initialState } from '@/state/appState'
import type { AppState } from '@/state/appState'
import type { Cliente, VentaItem } from '@/types'

const cliente = { id: '1', name: 'Cliente Test', list: 'L1' } as Cliente

/** Payload de la mutation `create_item` que salió en una corrida (la última que matchea). */
async function cabeceraCreada(
  disparar: (capturar: (body: string) => void) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  let cv: Record<string, unknown> = {}
  await disparar((body) => {
    const { query, variables } = JSON.parse(body) as {
      query: string
      variables: { cv?: string }
    }
    if (query.includes('create_item') && variables.cv) cv = JSON.parse(variables.cv)
  })
  return cv
}

/** `documentoDeVentaItem` es la inversa exacta de `ventaItemUid`: mismo id de ida y de vuelta. */
assert.equal(documentoDeVentaItem(ventaItemUid('12345', 3)), '12345')
assert.equal(documentoDeVentaItem(ventaItemUid('999', 0)), '999')

/* ==========================================================================================
   1) crearPresupuesto: escribe "🤖Actividades" (board_relation_mm6w6mra) con lo elegido.
   ========================================================================================== */
{
  const llamadas: string[] = []
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    llamadas.push(init.body)
    const { query } = JSON.parse(init.body) as { query: string }
    const data: Record<string, unknown> = {}
    if (query.includes('create_item')) data.create_item = { id: '900' }
    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch

  const cv = await cabeceraCreada(async (capturar) => {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      capturar(init.body)
      const { query } = JSON.parse(init.body) as { query: string }
      const data: Record<string, unknown> = {}
      if (query.includes('create_item')) data.create_item = { id: '900' }
      return { ok: true, json: async () => ({ data }) }
    }) as unknown as typeof fetch
    await crearPresupuesto({
      cliente,
      vendedor: null,
      lineas: [],
      fechaEmision: '04/09/2026',
      fechaVencimiento: '19/09/2026',
      diasVigencia: 15,
      rentabilidad: 30,
      moneda: 'Pesos',
      totalPesos: 1000,
      totalUsd: 0,
      actividadesIds: ['111', '222'],
    })
  })

  assert.deepEqual(
    cv[COL.presupuesto.actividades],
    { item_ids: [111, 222] },
    'el presupuesto escribe SU columna de actividades al crearse',
  )
  assert.equal(COL.presupuesto.actividades, 'board_relation_mm6w6mra')

  // Sin actividades elegidas, la columna NO se manda: vacía no es lo mismo que "sin gestión".
  const sinElegir = await cabeceraCreada(async (capturar) => {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      capturar(init.body)
      return { ok: true, json: async () => ({ data: { create_item: { id: '901' } } }) }
    }) as unknown as typeof fetch
    await crearPresupuesto({
      cliente,
      vendedor: null,
      lineas: [],
      fechaEmision: '04/09/2026',
      fechaVencimiento: '19/09/2026',
      diasVigencia: 15,
      rentabilidad: 30,
      moneda: 'Pesos',
      totalPesos: 1000,
      totalUsd: 0,
    })
  })
  assert.ok(
    !(COL.presupuesto.actividades in sinElegir),
    'sin actividadesIds, la columna no se escribe',
  )

  console.log('OK · crearPresupuesto escribe "🤖Actividades" (board_relation_mm6w6mra)')
}

/* ==========================================================================================
   2) crearVenta: escribe "🤖Actividades" (board_relation_mm6wb3hw).
   ========================================================================================== */
{
  const cv = await cabeceraCreada(async (capturar) => {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      capturar(init.body)
      const { query } = JSON.parse(init.body) as { query: string }
      const data: Record<string, unknown> = {}
      if (query.includes('create_item')) data.create_item = { id: '950' }
      return { ok: true, json: async () => ({ data }) }
    }) as unknown as typeof fetch
    await crearVenta({
      clienteId: cliente.id,
      nombre: cliente.name,
      tipoVenta: 'DIRECTA',
      tipoEntrega: 'SIMULTANEA',
      tipoPago: 'SIMULTANEO',
      rentabilidad: 30,
      lineas: [],
      actividadesIds: ['333'],
    } as never)
  })
  assert.deepEqual(cv[COL.venta.actividades], { item_ids: [333] })
  assert.equal(COL.venta.actividades, 'board_relation_mm6wb3hw')

  const sinActividad = await cabeceraCreada(async (capturar) => {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      capturar(init.body)
      return { ok: true, json: async () => ({ data: { create_item: { id: '951' } } }) }
    }) as unknown as typeof fetch
    await crearVenta({
      clienteId: cliente.id,
      nombre: cliente.name,
      tipoVenta: 'DIRECTA',
      tipoEntrega: 'SIMULTANEA',
      tipoPago: 'SIMULTANEO',
      rentabilidad: 30,
      lineas: [],
    } as never)
  })
  assert.ok(!(COL.venta.actividades in sinActividad))

  console.log('OK · crearVenta escribe "🤖Actividades" (board_relation_mm6wb3hw)')
}

/* ==========================================================================================
   3) crearProforma: escribe "🤖Actividades" (board_relation_mm6zc4fa) SÓLO si se le pasan
      (la DIRECTA nace sin ellas: se eligen recién en "Registrar Actividad", en la venta).
   ========================================================================================== */
{
  const cv = await cabeceraCreada(async (capturar) => {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      capturar(init.body)
      const { query } = JSON.parse(init.body) as { query: string }
      const data: Record<string, unknown> = {}
      if (query.includes('create_item')) data.create_item = { id: '970' }
      // "3) Trigger PDF": sin columnas, indiceEstadoProforma devuelve null y no dispara mutation.
      if (query.includes('settings_str')) data.boards = []
      return { ok: true, json: async () => ({ data }) }
    }) as unknown as typeof fetch
    await crearProforma({
      clienteId: cliente.id,
      tipoVenta: 'CON PRESUPUESTO PREVIO',
      tipoEntrega: 'SIMULTANEA',
      rentabilidad: 30,
      lineas: [],
      actividadesIds: ['444', '555'],
    })
  })
  assert.deepEqual(cv[COL.proforma.actividades], { item_ids: [444, 555] })
  assert.equal(COL.proforma.actividades, 'board_relation_mm6zc4fa')

  const directa = await cabeceraCreada(async (capturar) => {
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      capturar(init.body)
      const { query } = JSON.parse(init.body) as { query: string }
      const data: Record<string, unknown> = {}
      if (query.includes('create_item')) data.create_item = { id: '971' }
      if (query.includes('settings_str')) data.boards = []
      return { ok: true, json: async () => ({ data }) }
    }) as unknown as typeof fetch
    await crearProforma({
      clienteId: cliente.id,
      tipoVenta: 'DIRECTA',
      tipoEntrega: 'SIMULTANEA',
      rentabilidad: 30,
      lineas: [],
    })
  })
  assert.ok(
    !(COL.proforma.actividades in directa),
    'la proforma DIRECTA nace sin actividad propia',
  )

  console.log('OK · crearProforma escribe "🤖Actividades" (board_relation_mm6zc4fa)')
}

/* ==========================================================================================
   4) Lectura de lo YA conectado: ids-only y registro completo, con deduplicado entre documentos.
   ========================================================================================== */
{
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { variables } = JSON.parse(init.body) as { variables: { ids: string[] } }
    // Dos presupuestos que comparten una actividad (id "10") y aportan una propia cada uno.
    const porId: Record<string, string[]> = {
      '100': ['10', '20'],
      '200': ['10', '30'],
      '500': ['77'], // la proforma
    }
    const items = variables.ids.map((id) => ({
      column_values: [{ linked_item_ids: porId[id] ?? [] }],
    }))
    return { ok: true, json: async () => ({ data: { items } }) }
  }) as unknown as typeof fetch

  const dePresupuestos = await getActividadesDePresupuestos(['100', '200'])
  assert.deepEqual(
    [...dePresupuestos].sort(),
    ['10', '20', '30'],
    'unión de las actividades de los dos presupuestos, sin repetir la compartida',
  )

  const deProforma = await getActividadesDeProforma('500')
  assert.deepEqual(deProforma, ['77'])

  assert.deepEqual(await getActividadesDePresupuestos([]), [], 'sin presupuestos, sin consulta')

  console.log('OK · getActividadesDePresupuestos / getActividadesDeProforma leen y deduplican')
}

/* Los registros COMPLETOS (nombre, fecha, estado): primero resuelve los ids conectados y con esos
   ids pide el detalle — dos consultas encadenadas, ambas contra el mismo mock. */
{
  let consulta = 0
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    consulta++
    const { query, variables } = JSON.parse(init.body) as {
      query: string
      variables: { ids: string[] }
    }
    /* Se distinguen por lo que PIDEN, no por traer `linked_item_ids`: el detalle también lo pide
       ahora (los contactos de la actividad viajan como relación). */
    if (!query.includes(COL.actividad.tipo)) {
      return {
        ok: true,
        json: async () => ({
          data: { items: [{ column_values: [{ linked_item_ids: ['61', '62'] }] }] },
        }),
      }
    }
    // Segunda consulta: el detalle de esos ids.
    const items = variables.ids.map((id) => ({
      id,
      name: `Actividad ${id}`,
      column_values: [
        { id: COL.actividad.fecha, text: '2026-09-01' },
        { id: COL.actividad.estado, text: 'Completado' },
        { id: COL.actividad.resolucion, text: '' },
      ],
    }))
    return { ok: true, json: async () => ({ data: { items } }) }
  }) as unknown as typeof fetch

  const heredadas = await getActividadesHeredadasDePresupuestos(['100'])
  assert.equal(consulta, 2, 'primero resuelve los ids, después el detalle')
  assert.deepEqual(
    heredadas.map((a) => a.id).sort(),
    ['61', '62'],
    'trae el registro completo de cada actividad heredada',
  )
  assert.ok(heredadas.every((a) => a.nombre.startsWith('Actividad')))

  console.log('OK · getActividadesHeredadasDePresupuestos trae el registro completo')
}

/* ==========================================================================================
   5) actividadesDeLaVenta: qué actividades le tocan a la venta, según de dónde sale.
   ========================================================================================== */
{
  const base: AppState = { ...initialState }

  // VENTA DIRECTA: las tildadas en "Registrar Actividad" de ESTA operación.
  const directa: AppState = {
    ...base,
    operacion: 'VENTA',
    tipoVenta: 'DIRECTA',
    actividadesDocumento: [
      { id: '5', nombre: 'Llamada', fecha: '', estado: '', resolucion: '' },
    ],
  }
  assert.deepEqual(await actividadesDeLaVenta(directa), ['5'])

  // VENTA CON PRESUPUESTO PREVIO: hereda de los presupuestos detrás de `ventaItems`.
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { variables } = JSON.parse(init.body) as { variables: { ids: string[] } }
    const porId: Record<string, string[]> = { '700': ['81'], '800': ['82'] }
    const items = variables.ids.map((id) => ({
      column_values: [{ linked_item_ids: porId[id] ?? [] }],
    }))
    return { ok: true, json: async () => ({ data: { items } }) }
  }) as unknown as typeof fetch

  const conPresupuesto: AppState = {
    ...base,
    operacion: 'VENTA',
    tipoVenta: 'CON PRESUPUESTO PREVIO',
    // Dos líneas del MISMO presupuesto (700) y una de otro (800): tres líneas, dos presupuestos.
    ventaItems: [
      { uid: ventaItemUid('700', 0) },
      { uid: ventaItemUid('700', 1) },
      { uid: ventaItemUid('800', 0) },
    ] as VentaItem[],
  }
  assert.deepEqual(
    [...(await actividadesDeLaVenta(conPresupuesto))].sort(),
    ['81', '82'],
    'hereda de los DOS presupuestos que aportaron productos, sin repetir el propio presupuesto',
  )

  // VENTA PROFORMA · proforma DIRECTA: elige acá mismo, como cualquier DIRECTA.
  const proformaDirecta: AppState = {
    ...base,
    operacion: 'VENTA PROFORMA',
    proformaTipoVenta: 'DIRECTA',
    actividadesDocumento: [
      { id: '9', nombre: 'Visita', fecha: '', estado: '', resolucion: '' },
    ],
  }
  assert.deepEqual(await actividadesDeLaVenta(proformaDirecta), ['9'])

  // VENTA PROFORMA · proforma CON PRESUPUESTO PREVIO: hereda de LA PROFORMA (no de los ventaItems:
  // ahí el prefijo del uid es el id de la proforma, no el de un presupuesto).
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { variables } = JSON.parse(init.body) as { variables: { ids: string[] } }
    assert.deepEqual(variables.ids, ['600'], 'consulta LA PROFORMA, no los ventaItems')
    return {
      ok: true,
      json: async () => ({ data: { items: [{ column_values: [{ linked_item_ids: ['91'] }] }] } }),
    }
  }) as unknown as typeof fetch

  const proformaConPresupuesto: AppState = {
    ...base,
    operacion: 'VENTA PROFORMA',
    proformaTipoVenta: 'CON PRESUPUESTO PREVIO',
    proformaId: '600',
    ventaItems: [{ uid: ventaItemUid('600', 0) }] as VentaItem[],
  }
  assert.deepEqual(await actividadesDeLaVenta(proformaConPresupuesto), ['91'])

  // Sin proforma elegida todavía: no hay de dónde heredar, y no se dispara ninguna consulta.
  let fetches = 0
  globalThis.fetch = (async () => {
    fetches++
    throw new Error('no debería consultar sin proformaId')
  }) as unknown as typeof fetch
  const sinProforma: AppState = {
    ...base,
    operacion: 'VENTA PROFORMA',
    proformaTipoVenta: 'CON PRESUPUESTO PREVIO',
    proformaId: null,
  }
  assert.deepEqual(await actividadesDeLaVenta(sinProforma), [])
  assert.equal(fetches, 0)

  console.log('OK · actividadesDeLaVenta resuelve las tres rutas: propia, heredada y vía proforma')
}

console.log(
  '\nOK · actividades por documento: las tres columnas se escriben al crear, y la herencia' +
    ' (presupuesto → venta, presupuesto → proforma → venta) trae exactamente lo que corresponde.',
)
