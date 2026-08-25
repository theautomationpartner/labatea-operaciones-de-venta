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

/** Un usuario tal como lo devuelve la consulta de abajo. */
interface UsuarioMonday {
  id: string
  name: string
  /** `admin` = admin de la CUENTA, que manda aunque no esté en el equipo de administradores. */
  kind?: string
  teams?: { id: string }[]
}

interface RespuestaUsuarios {
  users?: UsuarioMonday[]
}

/**
 * Los equipos de TODOS los habilitados, no sólo los del usuario de la sesión.
 *
 * Hacen falta porque el permiso de la operación lo decide el VENDEDOR ASIGNADO y no quien está
 * logueado: un administrador puede emitir a nombre de otra persona, y en ese caso rigen los topes
 * de esa persona. Sin esto, la app dejaba que un admin aplicara un descuento del 20% a nombre de
 * un vendedor que sólo puede llegar al 5%.
 *
 * `kind` distingue al admin de la cuenta, que manda aunque no esté en el equipo de administradores.
 */
const QUERY_USUARIOS = `
  query ($ids: [ID!]) {
    users(ids: $ids) {
      id
      name
      kind
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
    let porId = new Map<string, UsuarioMonday>()
    let rolesLeidos = false

    try {
      /* Una sola consulta para todos: el de la sesión y cada habilitado del tablero. */
      const ids = [...new Set([sesion.userId, ...vendedores.map((v) => v.id)])]
      const data = await mondayServidor<RespuestaUsuarios>(QUERY_USUARIOS, { ids })
      porId = new Map((data.users ?? []).map((u) => [String(u.id), u]))
      rolesLeidos = true

      const usuario = porId.get(sesion.userId)
      if (usuario) {
        nombre = usuario.name || nombre
        equiposIds = (usuario.teams ?? []).map((t) => String(t.id))
      }
    } catch (e) {
      /* No frena la operación —quién puede entrar ya se decidió en el guardián— pero TAMPOCO se
         traga: sin equipos, todos quedan con el rol más restrictivo, y un administrador que de golpe
         no puede pisar un precio no tiene forma de saber por qué. Se avisa por las dos vías: al log
         del servidor y al cliente, que lo escribe en la consola. */
      console.warn('[vendedores] no se pudieron leer los equipos:', (e as Error).message)
    }

    return {
      /* Si esto es `false`, los roles que van abajo son los más restrictivos por defecto y no los
         reales. Distinguirlo evita confundir "no tenés permiso" con "no se pudo averiguar". */
      rolesLeidos,
      vendedores: vendedores.map((v) => {
        const enMonday = porId.get(v.id)
        return {
          ...v,
          equiposIds: (enMonday?.teams ?? []).map((t) => String(t.id)),
          /*
           * Para el usuario de la SESIÓN manda el token firmado, no la consulta.
           *
           * `sesion.isAdmin` lo declara Monday con su firma: no se puede falsear y no depende de que
           * la consulta de usuarios funcione. Si esa consulta falla —o si el token del servidor no
           * puede leer algún campo—, sin esto el propio administrador que está usando la app se
           * queda sin sus permisos al asignarse a sí mismo como vendedor, que es un síntoma
           * desconcertante: los privilegios desaparecen sin que nada cambie.
           */
          esAdminDeCuenta:
            (v.id === sesion.userId && sesion.isAdmin) || enMonday?.kind === 'admin',
        }
      }),
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
