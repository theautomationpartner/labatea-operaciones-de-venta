import { nombreSinCodigo } from '@/lib/busquedaClientes'
import { round2 } from '@/lib/format'
import { faltaParaMedio } from '@/lib/validaciones'
import type { CanalEnvio, Contacto, MedioEnvio } from '@/types'

export type { CanalEnvio }

/**
 * Lo que recibe el escenario de Make que envía un documento a los contactos. Nació para el
 * presupuesto y lo usa igual el remito: `documento.tipo` dice cuál es.
 *
 * Viaja como JSON, con este objeto en la raíz y el PDF agregado en `pdf` (ver
 * `src/services/make/envioPresupuesto.ts`): el webhook de Make lo recibe ya estructurado.
 *
 * Está pensado para que el escenario NO tenga que decidir nada: cada destinatario ya trae por qué
 * canales se le manda (`canales`), así el escenario itera `destinatarios` y, por cada canal, manda el
 * mail o el WhatsApp. Las reglas —quién acepta el documento, qué dato exige cada medio, qué pasa con
 * "Ambos"— viven en la app, que es donde se valida y se le explica al usuario.
 *
 * `reenvio_email` / `reenvio_whatsapp` dicen por qué canal hay que mandar EN ESTE PEDIDO. En el
 * primer envío salen del medio elegido y nada más ("Ambos" → las dos en true); después de un envío
 * parcial, sólo va en `true` el canal que le faltó a ALGÚN contacto, y cada destinatario trae en
 * `canales` sólo lo suyo que faltó: así nadie recibe dos veces lo mismo.
 */
export interface EnvioPresupuestoMake {
  /** Identificador del envío: vuelve en el historial de Make y permite rastrear un envío puntual. */
  appJobId: string
  documento: {
    tipo: TipoDocumentoMake
    /** "PRESUP-009" / "0091-00000007". */
    numero: string
    /** yyyy-MM-dd: el formato que Make parsea sin configurar nada. */
    fechaEmision: string
    /** El remito no vence: `null`. */
    fechaVencimiento: string | null
    /** Nombre del PDF adjunto ("Razón social-PRESUP-009.pdf"): el mismo que la parte `pdf`. */
    archivo: string
    /** El remito no lleva importes: `null`. */
    totalPesos: number | null
    totalDolares: number | null
  }
  cliente: {
    /** Ítem del cliente en Monday. */
    pulseId: string
    /** El nombre del cliente SIN su código interno ("123 - Agropecuaria…" → "Agropecuaria…"). */
    razonSocial: string
    cuit: string
  }
  /** Quién emite (su usuario de Monday): puede ir de firma en el mail o de remitente. */
  vendedor: { pulseId: string; nombre: string } | null
  /** Lo que eligió el usuario en "Medio de envío". El detalle por contacto está en `canales`. */
  medio: MedioEnvio
  /** Hay que mandar por email en este pedido. */
  reenvio_email: boolean
  /** Hay que mandar por WhatsApp en este pedido. */
  reenvio_whatsapp: boolean
  destinatarios: DestinatarioMake[]
}

export interface DestinatarioMake {
  /** Ítem del contacto en Monday (el que se linkea). */
  pulseId: string
  nombre: string
  /** `null` cuando no hay dato: nunca un string vacío que el escenario tenga que interpretar. */
  email: string | null
  whatsapp: string | null
  /**
   * Por dónde se le manda EN ESTE PEDIDO, ya resuelto. Con "Ambos" y un solo dato cargado, va sólo
   * por ése (la misma regla que `sinViaDeEnvio`). En un reintento no incluye el canal que ya salió,
   * así que puede venir vacío: ese contacto no recibe nada esta vez.
   */
  canales: CanalEnvio[]
}

/** dd/MM/yyyy (como la app muestra las fechas) → yyyy-MM-dd. Si no se puede, queda como vino. */
export function fechaIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return d && m && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : ddmmyyyy
}

/** Los canales por los que se le puede mandar a un contacto con el medio elegido. */
export function canalesDe(contacto: Pick<Contacto, 'phone' | 'email'>, medio: MedioEnvio): CanalEnvio[] {
  const falta = faltaParaMedio(contacto, medio)
  const canales: CanalEnvio[] = []
  if ((medio === 'Email' || medio === 'Ambos') && !falta.email) canales.push('email')
  if ((medio === 'WhatsApp' || medio === 'Ambos') && !falta.telefono) canales.push('whatsapp')
  return canales
}

/** Qué documento se envía. El escenario lo usa para el texto del mensaje y dónde guardar el PDF. */
export type TipoDocumentoMake = 'PRESUPUESTO' | 'REMITO'

/** Lo que hace falta para armar el envío. Sale del estado de la app. */
export interface DatosEnvioPresupuesto {
  jobId: string
  /** Por defecto, "PRESUPUESTO". */
  tipo?: TipoDocumentoMake
  numero: string
  fechaEmision: string
  fechaVencimiento: string | null
  archivo: string
  totalPesos: number | null
  totalDolares: number | null
  cliente: { id: string; name: string; cuit: string }
  vendedor: { id: string; name: string } | null
  medio: MedioEnvio
  contactos: readonly Contacto[]
  /** Lo que YA salió, por contacto (envío parcial anterior). No se vuelve a pedir. */
  yaEnviados?: EnviadosPorContacto
}

/** Canales por los que el presupuesto ya le llegó a cada contacto, por su `pulseId`. */
export type EnviadosPorContacto = Record<string, CanalEnvio[]>

/** El id con el que un contacto viaja al escenario (`pulseId`): el de su ítem en Monday. */
export const pulseIdDe = (c: Pick<Contacto, 'id' | 'itemId'>): string => c.itemId ?? c.id

/**
 * Al contacto ya le llegó TODO lo que pide el medio elegido. Es el tilde verde de su fila: a él no se
 * le vuelve a mandar nada y no se lo puede quitar de la lista.
 */
export function recibioTodo(
  c: Pick<Contacto, 'id' | 'itemId' | 'phone' | 'email'>,
  medio: MedioEnvio,
  enviados: EnviadosPorContacto,
): boolean {
  const recibio = enviados[pulseIdDe(c)] ?? []
  const pide = canalesDe(c, medio)
  return pide.length > 0 && pide.every((canal) => recibio.includes(canal))
}

/** Arma la estructura que recibe el webhook. */
export function armarEnvioPresupuesto(d: DatosEnvioPresupuesto): EnvioPresupuestoMake {
  const dato = (v: string): string | null => v.trim() || null
  const yaEnviados = d.yaEnviados ?? {}
  /* Sólo los contactos a los que les falta algo: en un reintento, al que ya le llegó todo no se lo
     manda, ni siquiera sin canales (el escenario no tiene que saltearlo). */
  const destinatarios = d.contactos
    .map((c) => {
      const pulseId = pulseIdDe(c)
      const recibio = yaEnviados[pulseId] ?? []
      return {
        pulseId,
        nombre: c.name,
        email: dato(c.email),
        whatsapp: dato(c.phone),
        canales: canalesDe(c, d.medio).filter((canal) => !recibio.includes(canal)),
      }
    })
    .filter((x) => x.canales.length > 0)
  /* Primer envío: los canales del medio elegido, tal cual. Reintento (ya salió algo): sólo los que
     le faltaron a algún contacto. */
  const reintento = Object.values(yaEnviados).some((c) => c.length > 0)
  const delMedio = (canal: CanalEnvio) =>
    d.medio === 'Ambos' || (canal === 'email' ? d.medio === 'Email' : d.medio === 'WhatsApp')
  const pide = (canal: CanalEnvio) =>
    reintento ? destinatarios.some((x) => x.canales.includes(canal)) : delMedio(canal)
  return {
    appJobId: d.jobId,
    documento: {
      tipo: d.tipo ?? 'PRESUPUESTO',
      numero: d.numero,
      fechaEmision: fechaIso(d.fechaEmision),
      fechaVencimiento: d.fechaVencimiento == null ? null : fechaIso(d.fechaVencimiento),
      archivo: d.archivo,
      totalPesos: d.totalPesos == null ? null : round2(d.totalPesos),
      totalDolares: d.totalDolares == null ? null : round2(d.totalDolares),
    },
    // El código del cliente es un dato interno: no viaja.
    cliente: { pulseId: d.cliente.id, razonSocial: nombreSinCodigo(d.cliente.name), cuit: d.cliente.cuit },
    vendedor: d.vendedor ? { pulseId: d.vendedor.id, nombre: d.vendedor.name } : null,
    medio: d.medio,
    reenvio_email: pide('email'),
    reenvio_whatsapp: pide('whatsapp'),
    destinatarios,
  }
}

/** Los canales que se le piden al escenario en este pedido. */
export const canalesPedidos = (e: EnvioPresupuestoMake): CanalEnvio[] => [
  ...(e.reenvio_email ? (['email'] as const) : []),
  ...(e.reenvio_whatsapp ? (['whatsapp'] as const) : []),
]

/** Cómo lo nombra el usuario. */
export const NOMBRE_CANAL: Record<CanalEnvio, string> = { email: 'email', whatsapp: 'WhatsApp' }

/** "email", "WhatsApp" o "email y WhatsApp". */
export const nombrarCanales = (canales: readonly CanalEnvio[]): string =>
  canales.map((c) => NOMBRE_CANAL[c]).join(' y ')

/**
 * Cómo le fue a UN envío (un contacto por un canal), según el escenario. Es un ítem de
 * `enviosEmail` / `enviosWhatsapp`, ya leído (ver `src/services/make/envioPresupuesto.ts`).
 */
export interface ResultadoEntrega {
  ok: boolean
  /** A qué contacto corresponde. Sin él, el ítem se empareja por orden (ver `repartir`). */
  pulseId?: string
  /** Id del WhatsApp en 360Messenger, para confirmarlo. */
  messageId?: string
  /** Por qué no salió, en palabras del usuario. */
  motivo?: string
}

/** Lo que dijo el escenario de cada canal: un ítem por contacto. */
export type ResultadosEnvio = Record<CanalEnvio, readonly ResultadoEntrega[]>

/** Un envío que no salió. */
export interface Falla {
  pulseId: string
  nombre: string
  canal: CanalEnvio
  motivo?: string
}

/** Cómo terminó el envío, contacto por contacto. */
export type EvaluacionEnvio =
  /** Salió todo lo que se pidió. `enviados`: lo que recibió cada contacto, contando lo de antes. */
  | { estado: 'ok'; enviados: EnviadosPorContacto }
  /** Algo salió (ahora o en un intento anterior) y algo no. */
  | { estado: 'parcial'; enviados: EnviadosPorContacto; fallas: Falla[] }
  /** No salió nada. */
  | { estado: 'error'; fallas: Falla[] }

/**
 * Empareja los resultados de un canal con los destinatarios que lo pidieron. Si los ítems traen
 * `pulseId`, por él; si no, por ORDEN: el primer ítem es el del primer destinatario que pidió ese
 * canal, y así. Un destinatario sin ítem cuenta como no enviado: lo que el escenario no confirmó no
 * se da por hecho.
 */
export function repartir(
  destinatarios: readonly DestinatarioMake[],
  canal: CanalEnvio,
  items: readonly ResultadoEntrega[],
): Map<string, ResultadoEntrega> {
  const pidieron = destinatarios.filter((d) => d.canales.includes(canal))
  const porId = items.some((i) => i.pulseId)
  const reparto = new Map<string, ResultadoEntrega>()
  pidieron.forEach((d, i) => {
    const item = porId ? items.find((x) => x.pulseId === d.pulseId) : items[i]
    reparto.set(d.pulseId, item ?? { ok: false })
  })
  return reparto
}

/**
 * Evalúa la respuesta del escenario. Un 200 NO alcanza: el envío es exitoso sólo si cada contacto
 * recibió cada canal que se le pidió.
 *
 * Es parcial cuando algo salió —en este pedido o en uno anterior— y algo no: con "Ambos", el email
 * llegó y el WhatsApp no; o el WhatsApp le llegó a un contacto y a otro no.
 */
export function evaluarEnvio(
  envio: EnvioPresupuestoMake,
  resultados: ResultadosEnvio,
  yaEnviados: EnviadosPorContacto = {},
): EvaluacionEnvio {
  const enviados: EnviadosPorContacto = Object.fromEntries(
    Object.entries(yaEnviados).map(([id, canales]) => [id, [...canales]]),
  )
  const fallas: Falla[] = []
  for (const canal of ['email', 'whatsapp'] as const) {
    for (const [pulseId, r] of repartir(envio.destinatarios, canal, resultados[canal])) {
      if (r.ok) {
        enviados[pulseId] = [...new Set([...(enviados[pulseId] ?? []), canal])]
      } else {
        const nombre = envio.destinatarios.find((d) => d.pulseId === pulseId)?.nombre ?? pulseId
        fallas.push({ pulseId, nombre, canal, ...(r.motivo ? { motivo: r.motivo } : {}) })
      }
    }
  }
  if (fallas.length === 0) return { estado: 'ok', enviados }
  if (Object.values(enviados).some((c) => c.length > 0)) return { estado: 'parcial', enviados, fallas }
  return { estado: 'error', fallas }
}

/**
 * Los contactos que fallaron, por `pulseId`, con el motivo de su primera falla: es la cruz roja de su
 * fila, y el reintento se les manda sólo a ellos.
 */
export const fallidosDe = (fallas: readonly Falla[]): Record<string, string> =>
  Object.fromEntries(
    [...new Set(fallas.map((f) => f.pulseId))].map((id) => {
      const falla = fallas.find((f) => f.pulseId === id)
      return [id, falla?.motivo ?? `no se pudo enviar por ${NOMBRE_CANAL[falla?.canal ?? 'email']}`]
    }),
  )

/** Los canales de una lista de fallas, sin repetir y en orden fijo (email primero). */
const canalesDeFallas = (fallas: readonly Falla[]): CanalEnvio[] =>
  (['email', 'whatsapp'] as const).filter((c) => fallas.some((f) => f.canal === c))

/** Nombres en castellano: "Ana", "Ana y Beto", "Ana, Beto y Caro". */
const enumerar = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`

/** Cada falla en una frase: "Caro por WhatsApp (el número no tiene WhatsApp)". */
export const detalleFallas = (fallas: readonly Falla[]): string =>
  enumerar(fallas.map((f) => `${f.nombre} por ${NOMBRE_CANAL[f.canal]}${f.motivo ? ` (${f.motivo})` : ''}`))

/** La primera letra en mayúscula: el motivo abre una oración. */
const capitalizar = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

/** Un motivo del escenario, con punto final y un espacio adelante; vacío si no hay. */
const conMotivo = (motivo?: string): string => (motivo ? ` ${motivo.replace(/\.?$/, '.')}` : '')

/**
 * El aviso de un envío parcial, en palabras del usuario.
 *
 * Si lo que falló es un canal ENTERO —no le llegó a nadie por ahí— y otro sí salió, se dice así:
 * "se envió por email, pero no por WhatsApp". Si falló para algunos contactos y no para otros, se
 * dice a quién le faltó y por dónde.
 */
export function mensajeParcial(
  fallas: readonly Falla[],
  enviados: EnviadosPorContacto,
  motivo?: string,
): string {
  const ok = (['email', 'whatsapp'] as const).filter((c) => Object.values(enviados).some((l) => l.includes(c)))
  const faltan = canalesDeFallas(fallas)
  const porCanal = faltan.every((c) => !ok.includes(c))
  if (porCanal) {
    /* Sin un mensaje del escenario, se dice el motivo de las fallas (el de 360Messenger, p. ej.)
       cuando es uno solo: si difieren por contacto, no entran en una frase por canal. */
    const motivos = [...new Set(fallas.map((f) => f.motivo).filter((m): m is string => Boolean(m)))]
    const porque = motivo || (motivos.length === 1 ? capitalizar(motivos[0]) : undefined)
    return `El presupuesto se envió por ${nombrarCanales(ok)}, pero no por ${nombrarCanales(faltan)}.${conMotivo(
      porque,
    )} Volvé a tocar el botón para completar el envío por ${nombrarCanales(faltan)}: por ${nombrarCanales(ok)} no se manda de nuevo.`
  }
  return `El presupuesto no les llegó a todos. Faltó: ${detalleFallas(fallas)}.${conMotivo(
    motivo,
  )} Volvé a tocar el botón para reintentar sólo lo que faltó: lo que ya salió no se manda de nuevo.`
}

/** Título del error cuando no salió nada: "No se pudo enviar por WhatsApp". */
export const tituloError = (fallas: readonly Falla[]): string =>
  `No se pudo enviar por ${nombrarCanales(canalesDeFallas(fallas))}`

/**
 * Qué tiene que corregir el usuario antes de enviar: un renglón por problema, con el nombre del
 * contacto adelante para saber a quién tocar. Vacío = se puede enviar.
 *
 *   · El contacto no acepta el documento (su "Para Enviar" no lo incluye).
 *   · No tiene el dato que pide el medio: email para "Email", WhatsApp para "WhatsApp", y al menos
 *     uno de los dos para "Ambos".
 */
export function problemasDeContactos(
  contactos: readonly Contacto[],
  medio: MedioEnvio,
  documento: string,
): string[] {
  return contactos.flatMap((c) => {
    const problemas: string[] = []
    if (!c.ok) problemas.push(`${c.name}: no acepta recibir ${documento}s. Quitalo de la lista.`)
    if (canalesDe(c, medio).length === 0) {
      const dato =
        medio === 'Email'
          ? 'un email'
          : medio === 'WhatsApp'
            ? 'un número de WhatsApp'
            : 'ni email ni número de WhatsApp'
      problemas.push(
        medio === 'Ambos'
          ? `${c.name}: no tiene ${dato} cargado. Cargale uno en Monday o quitalo de la lista.`
          : `${c.name}: no tiene ${dato} cargado. Cargáselo en Monday, cambiá el medio de envío o quitalo de la lista.`,
      )
    }
    return problemas
  })
}
