/**
 * Envío del presupuesto PDF a los contactos, por el escenario de Make.com.
 *
 * Igual que la lectura de comprobantes, NUNCA se pega directo al webhook: en producción pasa por
 * `api/make-comprobantes.ts` (`?escenario=envio-presupuesto`, con `MAKE_WEBHOOK_ENVIOS_URL`)
 * y en desarrollo por el proxy de Vite. La dirección del hook no llega al bundle.
 *
 * El cuerpo es JSON —no multipart— para que el webhook de Make lo reciba YA estructurado:
 * `appJobId`, `documento`, `cliente`, `vendedor`, `medio`, `destinatarios[]` y `pdf`. En un multipart
 * el JSON viajaría como un campo de texto que Make no desarma. El PDF va en `pdf.data` en base64
 * (pesa unos KB); en Make se pasa a archivo con `toBinary(pdf.data; "base64")`.
 *
 * El escenario CONTESTA cómo terminó el envío, con un módulo "Webhook response" (200 o 400) y este
 * JSON (ver `RespuestaEscenario`):
 *   { "operacion", "medio", "mensajeError", "enviosWhatsapp": [...], "enviosEmail": [...] }
 * Los dos arrays traen UN ítem por contacto: `{ envio_email }` y `{ envio_whatsapp, messageId }`.
 * El `messageId` es el del WhatsApp en 360Messenger: con él se confirma que salió de verdad
 * (`src/services/whatsapp/estadoMensaje.ts`). Un 200 NO alcanza para dar el envío por hecho: lo que
 * vale es cada ítem (`evaluarEnvio`).
 *
 * A diferencia de la lectura, acá NO se reintenta solo: si el escenario llegó a correr, reintentar
 * mandaría el presupuesto dos veces a los mismos contactos. El reintento lo decide el usuario.
 */
import { notificarErrorSeguridad } from '@/lib/errorSeguridad'
import type { EnvioPresupuestoMake, ResultadoEntrega, ResultadosEnvio } from '@/lib/envioPresupuesto'
import { cabeceraSesion, mensajeDelEscenario } from './sdk'

const ENDPOINT = import.meta.env.DEV
  ? '/make-envio-presupuesto'
  : '/api/make-comprobantes?escenario=envio-presupuesto'

/**
 * Techo de la espera. El envío es mandar un mail y un WhatsApp, no leer un documento: si en un
 * minuto no contestó, el escenario está trabado y no vale la pena dejar el botón girando.
 */
const TIMEOUT_MS = 60_000

/** Cómo terminó el envío, ya traducido para la pantalla. */
export type ResultadoEnvioMake =
  /**
   * El escenario contestó (200 o 400): el resultado de cada contacto por cada canal y, si falló
   * algo, su `mensajeError`. Si respondió sin el JSON, los arrays vienen vacíos: nada confirmado.
   */
  | { tipo: 'respuesta'; resultados: ResultadosEnvio; mensaje?: string }
  /** No se llegó a saber qué pasó del otro lado: sin conexión, sin configurar, apagado, vencido. */
  | { tipo: 'fallo'; mensaje: string }

/**
 * El JSON con el que contesta el escenario, en un 200 y en un 400:
 *   {
 *     "operacion": "ENVIO PRESUPUESTO",
 *     "medio": "Ambos",
 *     "mensajeError": null,
 *     "enviosWhatsapp": [{ "messageId": "f4376401-…", "envio_whatsapp": true }],
 *     "enviosEmail": [{ "envio_email": true }]
 *   }
 */
interface RespuestaEscenario {
  operacion?: unknown
  medio?: unknown
  mensajeError?: unknown
  enviosEmail?: unknown
  enviosWhatsapp?: unknown
}

/** El texto de un campo, o `''` si no vino, es `null` o no es texto. */
const campo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Una bandera del escenario. Make la puede mandar como booleano o, si se armó el JSON con texto,
 * como "true"/"false": las dos formas valen. Cualquier otra cosa —vacío, null, sin la clave— es
 * `false`: lo que el escenario no confirmó no se da por enviado.
 */
const bandera = (v: unknown): boolean => v === true || campo(v).toLowerCase() === 'true'

/**
 * Los ítems de un array del escenario. Acepta el array tal cual y también el array serializado como
 * texto (pasa si en el Webhook response se lo mapea entre comillas); un objeto suelto cuenta como
 * un ítem. Cualquier otra cosa es "sin resultados".
 */
function items(v: unknown): Record<string, unknown>[] {
  let valor = v
  if (typeof valor === 'string' && /^\s*[[{]/.test(valor)) valor = parsear(valor)
  const lista = Array.isArray(valor) ? valor : valor && typeof valor === 'object' ? [valor] : []
  return lista.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
}

/** Un ítem del escenario → el resultado de ese envío. `clave`: "envio_email" o "envio_whatsapp". */
function entrega(item: Record<string, unknown>, clave: string): ResultadoEntrega {
  const pulseId = campo(item.pulseId) || (typeof item.pulseId === 'number' ? String(item.pulseId) : '')
  const messageId = campo(item.messageId)
  const motivo = campo(item.mensajeError) || campo(item.motivo)
  return {
    ok: bandera(item[clave]),
    ...(pulseId ? { pulseId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(motivo ? { motivo } : {}),
  }
}

/** Lee lo que contestó el escenario: el resultado de cada envío y, si trae, el motivo del error. */
function leerRespuesta(cuerpo: unknown): ResultadoEnvioMake {
  const r = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as RespuestaEscenario
  /* Con la clave del contrato presente —aunque venga en null, como en un 200— manda ella. Sin la
     clave, se busca el motivo en las claves genéricas (`error`, `mensaje`…). */
  const mensaje = 'mensajeError' in r ? campo(r.mensajeError) : mensajeDelEscenario(cuerpo)
  // La operación no se muestra: sirve para cruzar el aviso con el historial del escenario.
  if (mensaje && campo(r.operacion)) console.warn(`Envío por Make falló en: ${campo(r.operacion)}`)
  return {
    tipo: 'respuesta',
    resultados: {
      email: items(r.enviosEmail).map((i) => entrega(i, 'envio_email')),
      whatsapp: items(r.enviosWhatsapp).map((i) => entrega(i, 'envio_whatsapp')),
    },
    ...(mensaje ? { mensaje } : {}),
  }
}

/** El cuerpo como JSON, o `null` si no lo era. */
function parsear(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** El PDF dentro del JSON: su nombre, su tipo y el contenido en base64. */
export interface PdfAdjunto {
  name: string
  mime: string
  data: string
}

/** Lo que viaja al webhook: la estructura del envío con el PDF adjunto. */
export type CuerpoEnvioPresupuesto = EnvioPresupuestoMake & { pdf: PdfAdjunto }

/** Bytes → base64, por tandas: `String.fromCharCode(...bytes)` de un archivo entero rompe la pila. */
function aBase64(bytes: Uint8Array): string {
  let binario = ''
  const TANDA = 0x8000
  for (let i = 0; i < bytes.length; i += TANDA) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TANDA))
  }
  return btoa(binario)
}

/** Arma el cuerpo: los datos del envío en la raíz y el PDF en `pdf`. */
export async function cuerpoEnvioPresupuesto(
  datos: EnvioPresupuestoMake,
  pdf: File,
): Promise<CuerpoEnvioPresupuesto> {
  const data = aBase64(new Uint8Array(await pdf.arrayBuffer()))
  return { ...datos, pdf: { name: pdf.name, mime: pdf.type || 'application/pdf', data } }
}

/** Dispara el escenario y espera su respuesta. Sólo lanza por un rechazo de acceso (401/403). */
export async function enviarPresupuestoMake(
  datos: EnvioPresupuestoMake,
  pdf: File,
): Promise<ResultadoEnvioMake> {
  const ctrl = new AbortController()
  let vencio = false
  const reloj = setTimeout(() => {
    vencio = true
    ctrl.abort()
  }, TIMEOUT_MS)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(await cuerpoEnvioPresupuesto(datos, pdf)),
      headers: { 'Content-Type': 'application/json', ...(await cabeceraSesion()) },
      signal: ctrl.signal,
    })
    const texto = await res.text()
    // 200 o 400: el escenario corrió y dice, canal por canal, qué salió.
    if (res.ok || res.status === 400) return leerRespuesta(parsear(texto))

    if (res.status === 401 || res.status === 403) {
      notificarErrorSeguridad(res.status === 401 ? 'sesion' : 'sinPermiso', res.status)
      throw new Error('No tenés acceso habilitado a esta app. Pedile el alta al administrador.')
    }
    // Sin la variable del webhook la ruta no existe (desarrollo) o el proxy lo dice (producción).
    if (res.status === 404) {
      return { tipo: 'fallo', mensaje: 'El servicio de envío de presupuestos no está configurado.' }
    }
    // El escenario está apagado: no corrió nada, así que reintentar más tarde es seguro.
    if (res.status === 410) {
      return {
        tipo: 'fallo',
        mensaje: 'El servicio de envío no está disponible en este momento. Probá de nuevo en unos minutos.',
      }
    }
    /* Cualquier otro código es de la plataforma, no del escenario: su cuerpo (HTML, diagnóstico)
       no se muestra. */
    return { tipo: 'fallo', mensaje: 'El envío no se pudo completar. Probá de nuevo en unos minutos.' }
  } catch (e) {
    if (vencio) {
      return {
        tipo: 'fallo',
        mensaje:
          'El servicio de envío tardó demasiado en responder. Revisá en unos minutos si el presupuesto llegó antes de reintentar.',
      }
    }
    // `fetch` sólo rechaza con TypeError cuando no hubo conexión: no llegó a correr nada.
    if (e instanceof TypeError) {
      return { tipo: 'fallo', mensaje: 'No se pudo conectar con el servidor. Revisá la conexión y reintentá.' }
    }
    throw e
  } finally {
    clearTimeout(reloj)
  }
}
