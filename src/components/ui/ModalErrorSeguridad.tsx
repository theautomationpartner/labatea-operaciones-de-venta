import { Modal } from './Modal'
import { limpiarErrorSeguridad, type ErrorSeguridad } from '@/lib/errorSeguridad'

/**
 * ÚNICA forma en que la app comunica que el borde rechazó el pedido.
 *
 * Es distinta de `ModalErrorMonday` a propósito. Ese avisa que Monday no contestó: se espera y se
 * reintenta. Esto no se arregla reintentando —la sesión no vale, el usuario no está habilitado,
 * falta el segundo factor— y decir "probá de nuevo" mandaría a la persona a golpear una puerta que
 * no se va a abrir. Cada caso dice qué pasó y qué hacer al respecto.
 */
export function ModalErrorSeguridad({ error }: { error: ErrorSeguridad }) {
  const { titulo, cuerpo, recargar } = TEXTOS[error.clase]

  return (
    <Modal
      title={titulo}
      icon={<i className="fas fa-shield-halved modal-icon--warn" />}
      onClose={limpiarErrorSeguridad}
      actions={
        <>
          {recargar && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
          )}
          <button type="button" className="btn btn-secundario" onClick={limpiarErrorSeguridad}>
            Entendido
          </button>
        </>
      }
    >
      {cuerpo}
      <p className="modal-detalle">
        Código {error.status}. Si tenés que reportarlo, mencioná este número.
      </p>
    </Modal>
  )
}

const TEXTOS: Record<
  ErrorSeguridad['clase'],
  { titulo: string; cuerpo: JSX.Element; recargar: boolean }
> = {
  sesion: {
    titulo: 'No se pudo confirmar tu sesión',
    recargar: true,
    cuerpo: (
      <>
        <p>
          El servidor <strong>no pudo verificar quién sos</strong>. Suele pasar cuando la app quedó
          abierta mucho tiempo y la sesión de Monday venció.
        </p>
        <p>
          Recargá para que Monday emita una sesión nueva. Si el error vuelve enseguida, la app no
          está recibiendo la sesión del contenedor: avisale a soporte de TAP.
        </p>
      </>
    ),
  },
  sinPermiso: {
    titulo: 'Tu usuario no está habilitado',
    recargar: false,
    cuerpo: (
      <>
        <p>
          Tu sesión es válida, pero <strong>tu usuario no figura como habilitado</strong> para usar
          esta app.
        </p>
        <p>
          El alta la da un administrador desde Monday y tarda menos de un minuto en hacer efecto.
          Pedísela y volvé a intentar.
        </p>
      </>
    ),
  },
  segundoFactor: {
    titulo: 'Falta verificar el segundo factor',
    recargar: true,
    cuerpo: (
      <>
        <p>
          Para seguir hace falta <strong>verificar el código de tu app de autenticación</strong>. O
          nunca lo configuraste, o la confianza de este dispositivo venció.
        </p>
        <p>Recargá la app para hacer la verificación.</p>
      </>
    ),
  },
  demasiadosIntentos: {
    titulo: 'Demasiados intentos',
    recargar: false,
    cuerpo: (
      <p>
        Se superó el límite de intentos fallidos. Por seguridad, la verificación queda bloqueada{' '}
        <strong>durante 15 minutos</strong>. Esperá y volvé a probar: insistir ahora no cambia nada.
      </p>
    ),
  },
  servidor: {
    titulo: 'El servicio no está respondiendo',
    recargar: true,
    cuerpo: (
      <>
        <p>
          El servidor de la app <strong>falló al procesar el pedido</strong>. No es un problema de
          tus datos ni de tu conexión.
        </p>
        <p>
          Suele ser una configuración faltante del lado del servidor. Reportalo a soporte de TAP:
          hasta que se corrija, la app no va a poder leer ni escribir en Monday.
        </p>
      </>
    ),
  },
}
