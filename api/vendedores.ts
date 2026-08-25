/**
 * `POST /api/vendedores` — quiénes pueden vender, y quién está usando la app.
 *
 * Los vendedores salen del tablero PRIVADO de la lista blanca, no de los usuarios de la cuenta de
 * Monday. Son la misma lista que la de quién puede entrar, y eso es el punto: antes el selector se
 * armaba con el equipo "Vendedores" de la cuenta, así que se podía ofrecer como vendedor a alguien
 * que la app no dejaba entrar —o al revés—. Con una sola fuente, esa contradicción no existe.
 *
 * El tablero es privado y sólo lo lee el token del servidor: la consulta se arma acá y el cliente
 * nunca ve el id del tablero ni puede reescribirla.
 *
 * Devuelve además QUIÉN es el usuario, tomado del session token ya verificado. No de la query `me`:
 * esa viaja por el proxy, que inyecta el token del SERVIDOR, así que `me` contesta quién es el
 * dueño de ese token y no quién abrió la app. Con una sola cuenta de servicio para todos, la app
 * creía que todos eran esa persona —y el rol de esa persona—.
 */
import type { ServerResponse } from 'node:http'
import { endpointMfa, type Pedido } from './_http.js'
import { listarHabilitados } from './_whitelist.js'
import { mondayServidor } from './_mondayApi.js'

interface RespuestaUsuarios {
  users?: { id: string; name: string; teams?: { id: string }[] }[]
}

const QUERY_USUARIO = `
  query ($ids: [ID!]) {
    users(ids: $ids) {
      id
      name
      teams {
        id
      }
    }
  }
`

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  /* Firma + lista blanca, SIN exigir el segundo factor, y es a propósito: éste es el pedido del
     PASO 1 —saber si el usuario está habilitado y quién es—, y el segundo factor es el paso 3.
     Exigirlo acá invertiría el orden y haría imposible llegar al muro de MFA.
     Lo que se expone es la lista de habilitados a alguien que YA está en esa lista; los datos de
     verdad viven detrás de /api/monday, que sí exige el segundo factor. */
  await endpointMfa(req, res, async ({ sesion }) => {
    const vendedores = await listarHabilitados(sesion)

    /* El nombre y los equipos del usuario REAL (el de la sesión, no el del token del servidor).
       Los equipos son los que deciden el rol en la app; ver `src/lib/permisos.ts`. Van por ID:
       un equipo se renombra en dos clics y el ID no cambia nunca.
       Si la consulta falla, la app sigue: se usa el nombre del tablero y ningún equipo, que es el
       rol más restrictivo. Un problema para leer equipos no tiene por qué frenar una venta. */
    let nombre = vendedores.find((v) => v.id === sesion.userId)?.nombre ?? ''
    let equiposIds: string[] = []

    try {
      const data = await mondayServidor<RespuestaUsuarios>(QUERY_USUARIO, { ids: [sesion.userId] })
      const usuario = data.users?.[0]
      if (usuario) {
        nombre = usuario.name || nombre
        equiposIds = (usuario.teams ?? []).map((t) => String(t.id))
      }
    } catch {
      /* Silencio a propósito: es un dato de presentación y de rol, no de autorización. Quién puede
         entrar ya se decidió en el guardián, contra el tablero. */
    }

    return {
      vendedores,
      usuario: {
        id: sesion.userId,
        nombre,
        /* Del token firmado, no de una consulta: es lo que Monday declara de ESTE usuario. */
        isAdmin: sesion.isAdmin,
        equiposIds,
      },
    }
  })
}
