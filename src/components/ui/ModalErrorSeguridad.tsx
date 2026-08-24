import { Modal } from './Modal'
import { cerrarAvisoSeguridad, type ErrorSeguridad } from '@/lib/errorSeguridad'

/**
 * ÚNICA forma en que la app comunica que el borde rechazó el pedido.
 *
 * Es distinta de `ModalErrorMonday` a propósito. Ese avisa que Monday no contestó: se espera y se
 * reintenta. Esto no se arregla reintentando —el dominio no está autorizado, el usuario no está
 * habilitado, falta el segundo factor— y decir "probá de nuevo" mandaría a la persona a golpear una
 * puerta que no se va a abrir.
 *
 * Por eso cada caso ofrece SÓLO lo que sirve. El rechazo por dominio no lleva "Recargar": recargar
 * desde afuera de Monday da exactamente el mismo rechazo, y ese botón sería una invitación a
 * insistir con algo que no depende de quien lo aprieta.
 */
export function ModalErrorSeguridad({ error }: { error: ErrorSeguridad }) {
  const { titulo, cuerpo, recargar, mostrarCodigo } = TEXTOS[error.clase]

  return (
    <Modal
      title={titulo}
      icon={<i className="fas fa-shield-halved modal-icon--warn" />}
      onClose={cerrarAvisoSeguridad}
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
          <button
            type="button"
            className={recargar ? 'btn btn-secundario' : 'btn btn-primary'}
            onClick={cerrarAvisoSeguridad}
          >
            Entendido
          </button>
        </>
      }
    >
      {cuerpo}
      {mostrarCodigo && (
        <p className="modal-detalle">
          Código {error.status}. Si tenés que reportarlo, mencioná este número.
        </p>
      )}
    </Modal>
  )
}

const TEXTOS: Record<
  ErrorSeguridad['clase'],
  { titulo: string; cuerpo: JSX.Element; recargar: boolean; mostrarCodigo: boolean }
> = {
  /* El caso de alguien que consiguió el enlace y lo abre fuera de Monday. El código va en el título
     y el mensaje es una sola línea: no hay nada que explicar ni ninguna acción que ofrecer. */
  sesion: {
    titulo: 'ERROR 401 NO Autorizado',
    recargar: false,
    mostrarCodigo: false,
    cuerpo: <p>Su dominio no está autorizado a utilizar la aplicación.</p>,
  },
  sinPermiso: {
    titulo: 'Tu usuario no está habilitado',
    recargar: false,
    mostrarCodigo: true,
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
    mostrarCodigo: true,
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
    mostrarCodigo: true,
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
    mostrarCodigo: true,
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
