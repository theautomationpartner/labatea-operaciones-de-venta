/**
 * Un rechazo del borde SIEMPRE se ve en pantalla.
 *
 * El caso que motivó esto pasó en producción: el backend devolvía 500 a todas las consultas y la
 * app se veía entera pero sin datos —el selector de vendedor vacío, doce errores en la consola y
 * ni un cartel—. Los `catch` de cada pantalla están pensados para un fallo aislado, así que ante un
 * rechazo global no avisa nadie.
 *
 * La regla que se fija: el sdk, que es por donde pasan TODOS los pedidos, publica el rechazo en el
 * canal que mira la ventana emergente. Y publica el primero, no el décimo.
 *
 * Se corre con esbuild + node (`npm run test:aviso-seguridad`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { estadoSeguridadActual, reiniciarErrorSeguridad } from '@/lib/errorSeguridad'
import { mondayApi } from '@/services/monday/sdk'

/** Deja a `fetch` respondiendo con ese status y ese cuerpo. */
function responderCon(status: number, cuerpo: unknown = {}): void {
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  })) as unknown as typeof fetch
}

/** Corre una consulta que va a fallar y devuelve la clase de aviso que quedó publicada. */
async function claseTrasFallar(status: number, cuerpo: unknown = {}): Promise<string | undefined> {
  reiniciarErrorSeguridad()
  responderCon(status, cuerpo)
  await mondayApi('{ me { id } }').catch(() => null)
  return estadoSeguridadActual().error?.clase
}

assert.equal(await claseTrasFallar(401), 'sesion', '401 · no se pudo confirmar quién sos')
assert.equal(await claseTrasFallar(403), 'sinPermiso', '403 · sos vos, pero no estás habilitado')
assert.equal(await claseTrasFallar(429), 'demasiadosIntentos', '429 · límite de intentos')
assert.equal(
  await claseTrasFallar(403, { codigo: 'mfa' }),
  'segundoFactor',
  '403 con código mfa · es otra pantalla',
)
assert.equal(
  await claseTrasFallar(403, { codigo: 'no_habilitado' }),
  'sinPermiso',
  '403 no_habilitado · el usuario no está dado de alta',
)
/* Un 401 por falta de configuración NO es culpa del usuario: es la diferencia entre "pedile el
   alta a un administrador" y "avisale a soporte que falta una variable". */
assert.equal(
  await claseTrasFallar(401, { codigo: 'config' }),
  'configuracion',
  '401 config · al servidor le falta una variable',
)
assert.equal(await claseTrasFallar(500), 'servidor', '500 · el backend no puede trabajar')
assert.equal(await claseTrasFallar(502), 'servidor', '502 también')

// Un 200 no publica nada.
reiniciarErrorSeguridad()
globalThis.fetch = (async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { me: { id: '1' } } }),
})) as unknown as typeof fetch
await mondayApi('{ me { id } }')
assert.equal(estadoSeguridadActual().error, null, 'lo que sale bien no avisa nada')

/* Diez consultas en paralelo fallan igual: el aviso es UNO. Cambiarle el texto mientras se lee, o
   apilar diez ventanas, no informa más. */
reiniciarErrorSeguridad()
responderCon(403)
await Promise.all(Array.from({ length: 10 }, () => mondayApi('{ me { id } }').catch(() => null)))
assert.equal(estadoSeguridadActual().error?.clase, 'sinPermiso')

// Y el primero es el que queda: un 500 posterior no pisa el rechazo que ya se está mostrando.
responderCon(500)
await mondayApi('{ me { id } }').catch(() => null)
assert.equal(estadoSeguridadActual().error?.clase, 'sinPermiso', 'gana el primero hasta que se cierre')

reiniciarErrorSeguridad()
assert.equal(estadoSeguridadActual().error, null, 'al cerrarlo, el canal queda libre')

console.log('aviso-seguridad: OK')
