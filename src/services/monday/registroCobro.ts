/**
 * "Registrar Cobro" del cobro SIMULTÁNEO desde la app: lo que antes hacía el escenario de Make
 * "[TAP] Se crea un item en Recibo y Cobro Vta SIMULT -> Crear Movimiento de Caja/tarjetas/cheque",
 * disparado por "🤖Estado Registro de Cobro" en "Registrar". Es el mismo esquema que el registro de
 * la app de cobros y recibos (`registroCobro.ts` de labatea-registrar-cobro-recibos), con el alcance
 * del escenario simultáneo.
 *
 * Corre DESPUÉS de crear el recibo: el recibo y sus subelementos ya existen, y `registrarCobro`
 * (cobrar.ts) pasa cada subelemento con su id y de qué salió. Con eso se impacta cada tablero:
 *
 *   · CAJAS       · un movimiento por efectivo o transferencia, en la caja que corresponde —el
 *                   efectivo en la caja "Efectivo"; la transferencia en la caja de la cuenta
 *                   propia donde se acreditó—, con el saldo encadenado desde el último movimiento.
 *   · CHEQUES     · un ítem en "🧾Cheques/eCheq en Cartera" por cheque o eCheq.
 *   · TARJETAS    · un ítem en "💳Tarjetas Pend de Acreditar" por cupón, con su archivo.
 *   · RETENCIONES · un ítem en "🔃Retenciones" por retención, con su certificado.
 *   · ANTICIPO    · el excedente que queda a favor del cliente, y lo suma a "Anticipo pend de
 *                   Aplicar" de su cuenta corriente.
 *
 * Todo movimiento queda conectado con la venta y su factura, como en el escenario.
 *
 * Cada tablero es un flujo independiente y todos corren EN PARALELO. Dentro de una caja, los
 * movimientos viajan en UNA mutación, en orden: los campos raíz corren en serie, así que el saldo
 * inicial de cada uno es el final del anterior por construcción.
 *
 * No se escribe "🤖Estado Registro de Cobro" ni ningún update: si algo no entra, se informa en la
 * app (`ErrorRegistroCobro`) y nada más, igual que en la app de cobros y recibos. Tampoco se toca
 * "🤖Estado de Envio" (color_mkwbzd3f): sus etiquetas de emisión ("A emitir", "Emitido") ya no
 * existen en el tablero, sólo quedan las del envío.
 *
 * Sin token (modo local) no se escribe nada, igual que el resto de la capa de servicio.
 */
import { cuitCompleto, esRetencion, vencimientoCheque } from '@/lib/cobros'
import { aIso, hoyIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import type { MovimientoPago } from '@/types'
import {
  BOARDS,
  BOARDS_REGISTRO,
  CAJA_EFECTIVO_ID,
  CAJA_SUB_COBRADO_INDEX,
  CHEQUE_PENDIENTE_INDEX,
  COL,
  COL_REGISTRO,
  ANTICIPO_ESTADO_INDEX,
  RETENCION_SUFRIDA_ID,
  RETENCION_TIPO_INDEX,
  TARJETA_PEND_ACREDITACION_INDEX,
} from './columns'
import { mondayApiParcial, mondayHabilitado, mondaySubirArchivo, type ErrorParcial } from './sdk'

/* ===== Lo que llega de la creación del recibo ===== */

/** Un subelemento del recibo ya creado, con lo que lo originó. `id` vacío = no entró. */
export type LineaReciboCreada =
  /** Una forma de pago: efectivo, transferencia, cheque, tarjeta o retención. */
  | { id: string; clase: 'pago'; movimiento: MovimientoPago }
  /** El excedente que el cliente entregó de más y le queda a favor. */
  | { id: string; clase: 'anticipo'; importe: number }

export interface DatosRegistroCobro {
  /** El ítem en "➡️Recibos y Cobros". */
  reciboId: string
  /** El cliente (Personas). */
  clienteId: string
  /** La venta que se cobra ("📈Ventas"). */
  ventaId: string | null
  /** Los comprobantes de "🧾Facturación" que cancela el cobro. */
  facturaIds: readonly string[]
  /** Fecha del cobro (dd/MM/yyyy): la del cupón y la de la retención. */
  fechaCobro: string
  lineas: readonly LineaReciboCreada[]
}

/** Lo que no se pudo registrar, contado en términos del usuario. */
export class ErrorRegistroCobro extends Error {
  constructor(public readonly fallas: string[]) {
    super(`No se pudo registrar todo el cobro: ${fallas.join(' · ')}`)
    this.name = 'ErrorRegistroCobro'
  }
}

/** Con qué habla el registro con Monday. Se inyecta en las pruebas. */
export interface ConexionRegistro {
  api: typeof mondayApiParcial
  subir: typeof mondaySubirArchivo
}

/* ===== Helpers de valores ===== */

const relaciones = (ids: readonly (string | null | undefined)[]): { item_ids: number[] } | null => {
  const numeros = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  return numeros.length ? { item_ids: numeros } : null
}
const relacion = (id: string | null | undefined) => relaciones([id])
const fecha = (ddmmyyyy: string | undefined | null): { date: string } | null => {
  const iso = aIso(ddmmyyyy ?? '')
  return iso ? { date: iso } : null
}
const etiqueta = (texto: string | null | undefined): { labels: string[] } | null =>
  texto?.trim() ? { labels: [texto.trim()] } : null

/** Objeto de columnas sin las que no tienen valor: vacío se OMITE, no se manda en blanco. */
const columnas = (entradas: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entradas).filter(([, v]) => v !== null && v !== undefined && v !== ''))

/** Los nombres se arman con lo que haya: una parte vacía no deja un " -  - " colgando. */
const nombre = (...partes: (string | null | undefined)[]): string =>
  partes.map((p) => p?.trim()).filter(Boolean).join(' - ')

/**
 * Banco del selector de la app → etiqueta de los tableros. El catálogo nombra a todos los bancos con
 * la palabra adelante ("Banco HSBC"); los tableros coinciden en casi todos y estos dos son las
 * excepciones. Se traducen para no dar de alta una etiqueta duplicada al lado de la existente.
 */
const BANCO_LABEL: Record<string, string> = { 'Banco HSBC': 'HSBC', 'Banco BBVA': 'BBVA' }
const bancoDelTablero = (banco: string | null | undefined): string => {
  const b = (banco ?? '').trim()
  return BANCO_LABEL[b] ?? b
}

const erroresATexto = (errores: readonly ErrorParcial[]): string =>
  errores.map((e) => e.message).join(' · ') || 'Monday no respondió'

type CV = { id: string; text?: string | null; linked_item_ids?: (string | number)[] }
const idsDe = (cv: CV | undefined): string[] => (cv?.linked_item_ids ?? []).map(String)
const numero = (t: string | null | undefined): number => {
  const n = Number(String(t ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/* ===== Lo que se lee antes de escribir ===== */

interface SubitemLeido {
  id: string
  created_at: string
  column_values: CV[]
}

export interface ContextoRegistro {
  /** "🤖ID Recibo" ("RECIBO-124"). */
  nroRecibo: string
  /** "🤖ID Mov Recibo" de cada subelemento, por id. */
  idMov: Record<string, string>
  /** "🤖ID Venta" ("VENTA-012"). */
  nroVenta: string
  /** La cuenta corriente del cliente y su "Anticipo pend de Aplicar". */
  ctaCte: { id: string; anticipoPend: number } | null
  /** Caja de cada cuenta bancaria propia (ítem de Configuración → ítem de Cajas). */
  cajaDeCuenta: Record<string, string | null>
  /** Saldo final del último movimiento de cada caja involucrada. */
  saldoCaja: Record<string, number>
}

/**
 * El saldo con el que quedó el último movimiento, como lo calculaba Make: inicial + ingresos −
 * egresos. El "último" es el de creación más reciente (y, a igual fecha, el de id más alto): el orden
 * en que Monday devuelve los subelementos no se puede garantizar.
 */
export function saldoDelUltimo(subitems: readonly SubitemLeido[]): number {
  if (subitems.length === 0) return 0
  const s = COL_REGISTRO.cajaSub
  const ultimo = [...subitems].sort((a, b) => {
    const orden = String(a.created_at).localeCompare(String(b.created_at))
    return orden !== 0 ? orden : Number(a.id) - Number(b.id)
  })[subitems.length - 1]
  const cv = Object.fromEntries(ultimo.column_values.map((c) => [c.id, c.text]))
  return round2(numero(cv[s.saldoInicial]) + numero(cv[s.ingresos]) - numero(cv[s.egresos]))
}

const lista = (ids: readonly string[]) =>
  ids.map(Number).filter((n) => Number.isFinite(n) && n > 0).join(', ')

async function leerContexto(datos: DatosRegistroCobro, cx: ConexionRegistro): Promise<ContextoRegistro> {
  const pagosLeidos = datos.lineas.flatMap((l) => (l.clase === 'pago' ? [l.movimiento] : []))
  const cuentaIds = [
    ...new Set(
      pagosLeidos.flatMap((m) => (m.formaPago === 'Transferencia' && m.cuentaPropiaId ? [m.cuentaPropiaId] : [])),
    ),
  ]
  const hayEfectivo = pagosLeidos.some((m) => m.formaPago === 'Efectivo')
  const hayAnticipo = datos.lineas.some((l) => l.clase === 'anticipo' && l.id)

  const partes = [
    `recibo: items(ids: [${Number(datos.reciboId)}]) {
      id
      column_values(ids: ["${COL.cobro.pulseId}"]) { id text }
      subitems { id column_values(ids: ["${COL_REGISTRO.recibo.idMov}"]) { id text } }
    }`,
    datos.ventaId
      ? `venta: items(ids: [${Number(datos.ventaId)}]) { id column_values(ids: ["${COL.venta.idVta}"]) { id text } }`
      : '',
    hayAnticipo
      ? `cta: boards(ids: [${BOARDS_REGISTRO.ctaCte}]) {
          items_page(limit: 1, query_params: {rules: [
            {column_id: "${COL_REGISTRO.ctaCte.cliente}", compare_value: [${Number(datos.clienteId)}], operator: any_of}
          ]}) { items { id column_values(ids: ["${COL_REGISTRO.ctaCte.anticiposPendAplicar}"]) { id text } } }
        }`
      : '',
    cuentaIds.length
      ? `config: items(ids: [${lista(cuentaIds)}]) {
          id
          column_values(ids: ["${COL_REGISTRO.config.caja}"]) { id ... on BoardRelationValue { linked_item_ids } }
        }`
      : '',
  ].filter(Boolean)

  type ItemCrudo = { id: string; column_values: CV[]; subitems?: { id: string; column_values: CV[] }[] | null }
  const { data, errores } = await cx.api<{
    recibo: ItemCrudo[]
    venta: ItemCrudo[]
    cta: { items_page: { items: ItemCrudo[] } }[]
    config: ItemCrudo[]
  }>(`query { ${partes.join('\n')} }`)
  if (errores.length) {
    throw new ErrorRegistroCobro([`No se pudieron leer los datos para registrar: ${erroresATexto(errores)}`])
  }

  const recibo = data.recibo?.[0]
  const nroRecibo = recibo?.column_values[0]?.text?.trim() ?? ''
  const idMov = Object.fromEntries((recibo?.subitems ?? []).map((s) => [s.id, s.column_values[0]?.text?.trim() ?? '']))
  const nroVenta = data.venta?.[0]?.column_values[0]?.text?.trim() ?? ''
  const cta = data.cta?.[0]?.items_page.items?.[0]
  const cajaDeCuenta: Record<string, string | null> = {}
  for (const c of data.config ?? []) cajaDeCuenta[c.id] = idsDe(c.column_values[0])[0] ?? null

  /* Segunda lectura: el último movimiento de cada caja. Depende de la primera —la caja de una
     transferencia sale de la cuenta propia—, por eso no viaja en el mismo documento. */
  const cajaIds = [
    ...new Set([
      ...(hayEfectivo ? [CAJA_EFECTIVO_ID] : []),
      ...Object.values(cajaDeCuenta).filter((x): x is string => !!x),
    ]),
  ]
  const saldoCaja: Record<string, number> = {}
  if (cajaIds.length) {
    const s = COL_REGISTRO.cajaSub
    const leido = await cx.api<{ cajas: { id: string; subitems?: SubitemLeido[] | null }[] }>(
      `query { cajas: items(ids: [${lista(cajaIds)}]) {
        id
        subitems { id created_at column_values(ids: ["${s.saldoInicial}", "${s.ingresos}", "${s.egresos}"]) { id text } }
      } }`,
    )
    if (leido.errores.length) {
      throw new ErrorRegistroCobro([`No se pudieron leer los saldos de las cajas: ${erroresATexto(leido.errores)}`])
    }
    for (const caja of leido.data.cajas ?? []) saldoCaja[caja.id] = saldoDelUltimo(caja.subitems ?? [])
  }

  return {
    nroRecibo,
    idMov,
    nroVenta,
    ctaCte: cta ? { id: cta.id, anticipoPend: numero(cta.column_values[0]?.text) } : null,
    cajaDeCuenta,
    saldoCaja,
  }
}

/* ===== Las escrituras ===== */

/** Una escritura: crea un subelemento, crea un ítem o cambia columnas de un ítem existente. */
export type Escritura =
  | { tipo: 'subitem'; padre: string; nombre: string; columnas: Record<string, unknown> }
  | { tipo: 'item'; board: number; nombre: string; columnas: Record<string, unknown> }
  | { tipo: 'columnas'; board: number; itemId: string; columnas: Record<string, unknown> }

export interface Unidad {
  /** Cómo se la nombra si falla. */
  descripcion: string
  escritura: Escritura
  /** Archivo a subir al ítem creado, cuando entró. */
  archivo?: { archivo: File; columna: string }
}

interface Ejecucion {
  fallas: string[]
  cx: ConexionRegistro
}

/**
 * Ejecuta un lote de escrituras en UNA mutación, en el orden dado, y después sube sus archivos.
 * Devuelve `true` si TODAS entraron (los archivos no cortan: se informan aparte).
 */
async function ejecutar(unidades: readonly Unidad[], ej: Ejecucion): Promise<boolean> {
  if (!unidades.length) return true
  let todas = true
  const creados: (string | null)[] = unidades.map(() => null)

  const variables: Record<string, unknown> = {}
  const declaraciones: string[] = []
  const campos = unidades.map((u, i) => {
    const e = u.escritura
    variables[`c${i}`] = JSON.stringify(e.columnas)
    declaraciones.push(`$c${i}: JSON!`)
    if (e.tipo === 'columnas') {
      variables[`i${i}`] = e.itemId
      declaraciones.push(`$i${i}: ID!`)
      return `u${i}: change_multiple_column_values(item_id: $i${i}, board_id: ${e.board}, column_values: $c${i}) { id }`
    }
    variables[`n${i}`] = e.nombre
    declaraciones.push(`$n${i}: String!`)
    if (e.tipo === 'subitem') {
      variables[`p${i}`] = e.padre
      declaraciones.push(`$p${i}: ID!`)
      return `u${i}: create_subitem(parent_item_id: $p${i}, item_name: $n${i}, column_values: $c${i}, create_labels_if_missing: true) { id }`
    }
    return `u${i}: create_item(board_id: ${e.board}, item_name: $n${i}, column_values: $c${i}, create_labels_if_missing: true) { id }`
  })

  try {
    const { data, errores } = await ej.cx.api<Record<string, { id: string } | null>>(
      `mutation (${declaraciones.join(', ')}) { ${campos.join('\n')} }`,
      variables,
    )
    unidades.forEach((u, i) => {
      const creado = data[`u${i}`]
      if (creado?.id) {
        creados[i] = String(creado.id)
        return
      }
      todas = false
      const propios = errores.filter((e) => e.path?.[0] === `u${i}`)
      ej.fallas.push(`${u.descripcion}: ${erroresATexto(propios.length ? propios : errores)}`)
    })
  } catch (e) {
    const motivo = e instanceof Error && e.message ? e.message : 'sin respuesta de Monday'
    unidades.forEach((u) => ej.fallas.push(`${u.descripcion}: ${motivo}`))
    return false
  }

  /* Los archivos van al ítem ya creado —las columnas `file` no viajan en `column_values`—. */
  await Promise.all(
    unidades.flatMap((u, i) => {
      const id = Number(creados[i])
      if (!u.archivo || !Number.isFinite(id) || id <= 0) return []
      return [
        ej.cx
          .subir(
            `mutation ($file: File!) { add_file_to_column(item_id: ${id}, column_id: "${u.archivo.columna}", file: $file) { id } }`,
            u.archivo.archivo,
          )
          .then(() => undefined)
          .catch((e: unknown) => {
            ej.fallas.push(`Comprobante de ${u.descripcion}: ${e instanceof Error ? e.message : 'no se pudo subir'}`)
          }),
      ]
    }),
  )
  return todas
}

/* ===== El plan: qué se escribe en cada tablero ===== */

interface Entorno {
  datos: DatosRegistroCobro
  ctx: ContextoRegistro
  hoy: { date: string }
}

const pagos = (lineas: readonly LineaReciboCreada[]) =>
  lineas.flatMap((l) => (l.clase === 'pago' && l.id ? [{ id: l.id, m: l.movimiento }] : []))

const esTarjeta = (forma: string) => forma === 'Tarjeta de débito' || forma === 'Tarjeta de crédito'

/** CAJAS: un movimiento por efectivo o transferencia, agrupados por caja para encadenar el saldo. */
export function planCajas(en: Entorno): { porCaja: Map<string, Unidad[]>; fallas: string[] } {
  const porCaja = new Map<string, Unidad[]>()
  const fallas: string[] = []
  const s = COL_REGISTRO.cajaSub
  for (const { id, m } of pagos(en.datos.lineas)) {
    if (m.formaPago !== 'Efectivo' && m.formaPago !== 'Transferencia') continue
    const descripcion = `Movimiento de caja (${m.formaPago})`
    let cajaId: string | null = CAJA_EFECTIVO_ID
    if (m.formaPago === 'Transferencia') {
      cajaId = m.cuentaPropiaId ? (en.ctx.cajaDeCuenta[m.cuentaPropiaId] ?? null) : null
      if (!cajaId) {
        fallas.push(
          m.cuentaPropiaId
            ? `${descripcion}: la cuenta "${m.cuentaPropia ?? m.cuentaPropiaId}" no tiene una caja conectada en Configuración`
            : `${descripcion}: la transferencia no tiene la cuenta propia donde se acreditó`,
        )
        continue
      }
    }
    const unidades = porCaja.get(cajaId) ?? []
    unidades.push({
      descripcion,
      escritura: {
        tipo: 'subitem',
        padre: cajaId,
        nombre: nombre(m.formaPago, en.ctx.nroRecibo, en.ctx.idMov[id]),
        // El saldo inicial se completa al encadenar (ver `encadenar`).
        columnas: columnas({
          [s.fecha]: en.hoy,
          [s.ingresos]: round2(m.importe),
          [s.cobrado]: { index: CAJA_SUB_COBRADO_INDEX },
          [s.bancoEmisor]: etiqueta(bancoDelTablero(m.bancoEmisor)),
          [s.ventas]: relacion(en.datos.ventaId),
          [s.comprobanteOrigen]: relaciones(en.datos.facturaIds),
        }),
      },
      archivo:
        m.formaPago === 'Transferencia' && m.comprobanteArchivo
          ? { archivo: m.comprobanteArchivo, columna: s.comprobante }
          : undefined,
    })
    porCaja.set(cajaId, unidades)
  }
  return { porCaja, fallas }
}

/**
 * Encadena el saldo de los movimientos de UNA caja: el primero arranca del saldo leído y cada uno
 * del final del anterior.
 */
export function encadenar(unidades: readonly Unidad[], saldo: number): Unidad[] {
  const s = COL_REGISTRO.cajaSub
  let actual = saldo
  return unidades.map((u) => {
    const conSaldo = { ...u, escritura: { ...u.escritura, columnas: { ...u.escritura.columnas, [s.saldoInicial]: actual } } }
    actual = round2(actual + numero(String(u.escritura.columnas[s.ingresos] ?? 0)))
    return conSaldo as Unidad
  })
}

/** CHEQUES: un ítem en la cartera por cheque o eCheq. */
export function planCheques(en: Entorno): { unidades: Unidad[]; fallas: string[] } {
  const c = COL_REGISTRO.cheque
  const fallas: string[] = []
  const unidades: Unidad[] = []
  for (const { id, m } of pagos(en.datos.lineas)) {
    if (m.formaPago !== 'Cheque') continue
    const descripcion = `Cheque ${m.numeroCheque?.trim() || ''}`.trim()
    const banco = bancoDelTablero(m.bancoEmisor)
    const vencimiento = vencimientoCheque(m.chequeFechaPago)
    /* Lo mismo que exigía el escenario: sin emisión, fecha de pago, vencimiento o banco, el cheque no
       se puede dar de alta en la cartera. Se informa en vez de saltearlo en silencio. */
    const faltan = [
      !fecha(m.fechaEmisionCheque) && 'fecha de emisión',
      !fecha(m.chequeFechaPago) && 'fecha de pago',
      !banco && 'banco',
    ].filter(Boolean)
    if (faltan.length) {
      fallas.push(`${descripcion}: faltan datos (${faltan.join(', ')})`)
      continue
    }
    const origen = m.formatoCheque === 'eCheq' ? 'eCheq' : 'Cheque'
    unidades.push({
      descripcion,
      escritura: {
        tipo: 'item',
        board: BOARDS.chequesCartera,
        nombre: nombre(origen, banco, aIso(vencimiento), en.ctx.nroVenta),
        columnas: columnas({
          [c.numero]: m.numeroCheque?.trim(),
          [c.cuitEmisor]: cuitCompleto(m.cuitEmisor) ? m.cuitEmisor : null,
          [c.estado]: { index: CHEQUE_PENDIENTE_INDEX },
          [c.emision]: fecha(m.fechaEmisionCheque),
          [c.vencimiento]: fecha(vencimiento),
          [c.fechaPago]: fecha(m.chequeFechaPago),
          [c.importe]: round2(m.importe),
          [c.tipo]: { labels: [origen] },
          [c.banco]: etiqueta(banco),
          [c.persona]: relacion(en.datos.clienteId),
          [c.ventas]: relacion(en.datos.ventaId),
          [c.subRecibo]: relacion(id),
        }),
      },
    })
  }
  return { unidades, fallas }
}

/** TARJETAS: un ítem por cupón, con su archivo. */
export function planTarjetas(en: Entorno): Unidad[] {
  const t = COL_REGISTRO.tarjeta
  return pagos(en.datos.lineas).flatMap(({ id, m }) => {
    if (!esTarjeta(m.formaPago)) return []
    const debito = m.formaPago === 'Tarjeta de débito'
    const banco = bancoDelTablero(m.bancoTarjeta)
    return [
      {
        descripcion: `Cupón de ${m.formaPago.toLowerCase()} ${m.numeroCupon?.trim() || ''}`.trim(),
        escritura: {
          tipo: 'item' as const,
          board: BOARDS_REGISTRO.tarjetas,
          nombre: nombre(debito ? 'Tarjeta de Debito' : 'Tarjeta de Crédito', banco, en.ctx.nroVenta),
          columnas: columnas({
            [t.fechaEmision]: fecha(en.datos.fechaCobro) ?? en.hoy,
            [t.nroCupon]: m.numeroCupon?.trim(),
            [t.titular]: m.titularTarjeta?.trim(),
            [t.estado]: { index: TARJETA_PEND_ACREDITACION_INDEX },
            [t.monto]: round2(m.importe),
            [t.tipo]: { labels: [debito ? 'DEBITO' : 'CRÉDITO'] },
            [t.bancoEmisor]: etiqueta(banco),
            [t.tipoTarjeta]: etiqueta(m.tipoTarjeta),
            [t.subRecibo]: relacion(id),
            [t.ventas]: relacion(en.datos.ventaId),
            [t.persona]: relacion(en.datos.clienteId),
          }),
        },
        archivo: m.comprobanteArchivo ? { archivo: m.comprobanteArchivo, columna: t.cupon } : undefined,
      },
    ]
  })
}

/** RETENCIONES: un ítem por retención, con su certificado. */
export function planRetenciones(en: Entorno): Unidad[] {
  const r = COL_REGISTRO.retencion
  return pagos(en.datos.lineas).flatMap(({ id, m }) => {
    if (!esRetencion(m.formaPago)) return []
    const tipo = RETENCION_TIPO_INDEX[m.formaPago]
    return [
      {
        descripcion: `${m.formaPago} ${m.nroComprobanteRetencion?.trim() || ''}`.trim(),
        escritura: {
          tipo: 'item' as const,
          board: BOARDS_REGISTRO.retenciones,
          nombre: nombre(m.formaPago, m.anioRetencion, en.ctx.nroRecibo, en.ctx.nroVenta),
          columnas: columnas({
            [r.nro]: m.nroComprobanteRetencion?.trim(),
            [r.tipo]: tipo === undefined ? null : { index: tipo },
            [r.sufridaAplicada]: { ids: [RETENCION_SUFRIDA_ID] },
            [r.monto]: round2(m.importe),
            [r.fecha]: fecha(en.datos.fechaCobro),
            [r.subRecibo]: relacion(id),
            [r.sujeto]: relacion(en.datos.clienteId),
            [r.ventas]: relacion(en.datos.ventaId),
          }),
        },
        archivo: m.comprobanteArchivo ? { archivo: m.comprobanteArchivo, columna: r.pdf } : undefined,
      },
    ]
  })
}

/** ANTICIPO: el excedente que el cliente entregó de más, a su favor. */
export function planAnticipos(en: Entorno): Unidad[] {
  const a = COL.anticipo
  return en.datos.lineas.flatMap((l) =>
    l.clase === 'anticipo' && l.id
      ? [
          {
            descripcion: 'Anticipo a favor del cliente',
            escritura: {
              tipo: 'item' as const,
              board: BOARDS.anticipos,
              nombre: nombre('Anticipo', en.ctx.nroRecibo),
              columnas: columnas({
                [a.cliente]: relacion(en.datos.clienteId),
                [a.estado]: { index: ANTICIPO_ESTADO_INDEX.pendDeAplicar },
                [a.importe]: round2(l.importe),
                [a.fecha]: en.hoy,
                [COL_REGISTRO.anticipo.subRecibo]: relacion(l.id),
              }),
            },
          },
        ]
      : [],
  )
}

/**
 * ANTICIPO → CUENTA CORRIENTE: se crea el anticipo y, si entró, se suma a "Anticipo pend de Aplicar".
 * Se escribe UNA vez con el total: Make lo sumaba línea por línea sobre el valor leído al principio,
 * y con dos anticipos en el mismo recibo el segundo pisaba al primero.
 */
async function flujoAnticipo(en: Entorno, ej: Ejecucion): Promise<void> {
  const anticipos = planAnticipos(en)
  if (!anticipos.length) return
  if (!(await ejecutar(anticipos, ej))) return
  const cta = en.ctx.ctaCte
  if (!cta) {
    ej.fallas.push('Cuenta corriente: el cliente no tiene una cuenta corriente conectada en Monday')
    return
  }
  const total = round2(en.datos.lineas.reduce((acc, l) => acc + (l.clase === 'anticipo' && l.id ? l.importe : 0), 0))
  await ejecutar(
    [
      {
        descripcion: 'Anticipo pendiente de aplicar de la cuenta corriente',
        escritura: {
          tipo: 'columnas',
          board: BOARDS_REGISTRO.ctaCte,
          itemId: cta.id,
          columnas: { [COL_REGISTRO.ctaCte.anticiposPendAplicar]: round2(cta.anticipoPend + total) },
        },
      },
    ],
    ej,
  )
}

/**
 * Registra el cobro simultáneo en todos los tableros que impacta. Lanza `ErrorRegistroCobro` con lo
 * que no entró; lo que sí entró queda registrado. No toca el estado de registro del recibo.
 */
export async function registrarCobroSimultaneo(
  datos: DatosRegistroCobro,
  conexion?: ConexionRegistro,
): Promise<void> {
  if (!conexion && !mondayHabilitado()) return
  const cx = conexion ?? { api: mondayApiParcial, subir: mondaySubirArchivo }
  const fallas: string[] = []
  /* Lo mismo que frenaba al escenario: sin cliente o sin factura, el cobro no se puede registrar. */
  if (!Number(datos.clienteId)) fallas.push('Falta vincular la Persona del recibo')
  if (!datos.facturaIds.some((id) => Number(id))) fallas.push('Falta vincular la FACTURA del recibo')

  if (!fallas.length) {
    try {
      const ctx = await leerContexto(datos, cx)
      const en: Entorno = { datos, ctx, hoy: { date: hoyIso() } }
      const ej: Ejecucion = { fallas, cx }
      const cajas = planCajas(en)
      const cheques = planCheques(en)
      fallas.push(...cajas.fallas, ...cheques.fallas)
      /* Todos los tableros a la vez: ninguno depende de otro. */
      await Promise.all([
        ...[...cajas.porCaja].map(([cajaId, unidades]) =>
          ejecutar(encadenar(unidades, ctx.saldoCaja[cajaId] ?? 0), ej),
        ),
        ejecutar(cheques.unidades, ej),
        ejecutar(planTarjetas(en), ej),
        ejecutar(planRetenciones(en), ej),
        flujoAnticipo(en, ej),
      ])
    } catch (e) {
      fallas.push(...(e instanceof ErrorRegistroCobro ? e.fallas : [e instanceof Error ? e.message : 'error inesperado']))
    }
  }

  if (fallas.length) throw new ErrorRegistroCobro(fallas)
}
