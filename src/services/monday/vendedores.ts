/**
 * Usuarios de Monday y sus EQUIPOS. De acá salen las dos cosas que necesita la app:
 *
 *   · el selector "Seleccionar Vendedor": los usuarios del equipo "Vendedores";
 *   · el rol del usuario logueado (`me`), que es lo que habilita o bloquea la UI (ver
 *     `lib/permisos`): pertenecer al equipo "Administradores" o al de "Vendedores".
 *
 * Filtros del selector:
 *   · Equipo: sólo los miembros del team llamado "Vendedores".
 *   · Rol: se excluyen Visores (is_view_only) e Invitados (is_guest); quedan los miembros
 *     (y admins) activos. El id numérico del usuario viaja como valor para asignar la venta.
 */
import { VENDEDORES } from '@/data/mock'
import { EQUIPO_VENDEDORES } from '@/lib/permisos'
import type { UsuarioActual, Vendedor } from '@/types'
import { mondayApi, mondayHabilitado } from './sdk'

/** Tope de usuarios que trae la consulta. La cuenta es chica; alcanza y evita paginar. */
const LIMITE_USUARIOS = 500

/**
 * Usuario logueado en Monday (query `me`), CON sus equipos: son los que definen el rol y, con él,
 * qué puede editar en la app. Sin token (modo local) devuelve null: no hay sesión.
 */
export async function getUsuarioActual(): Promise<UsuarioActual | null> {
  if (!mondayHabilitado()) return null
  const data = await mondayApi<{ me: MondayMe | null }>(
    `query {
      me {
        id
        name
        is_admin
        teams { id name }
      }
    }`,
  )
  const me = data.me
  if (!me) return null
  return {
    id: String(me.id),
    name: me.name,
    isAdmin: Boolean(me.is_admin),
    equipos: nombresDeEquipos(me.teams),
  }
}

/** Paleta de colores para el avatar del vendedor, asignada por posición. */
const COLORES_VENDEDOR = [
  'var(--avatar-orange)',
  'var(--red)',
  'var(--green)',
  '#575ce5',
  'var(--primary-blue)',
  'var(--purple)',
] as const

/** Iniciales del nombre: la primera letra de las dos primeras palabras, en mayúscula. */
const iniciales = (nombre: string): string =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

/** Equipo tal como lo devuelve la API: acá sólo interesa el nombre. */
interface MondayTeam {
  id: string
  name: string
}

/** Usuario de la cuenta, YA con los equipos a los que pertenece. */
interface MondayUser {
  id: string
  name: string
  enabled?: boolean | null
  is_guest?: boolean | null
  is_view_only?: boolean | null
  teams?: MondayTeam[] | null
}

interface MondayMe extends MondayUser {
  is_admin?: boolean | null
}

/** Nombres de equipo normalizados (sin espacios sobrantes y sin vacíos). */
const nombresDeEquipos = (teams: MondayTeam[] | null | undefined): string[] =>
  (teams ?? []).map((t) => (t.name ?? '').trim()).filter(Boolean)

/** ¿El usuario pertenece a este equipo? Comparación por nombre, sin distinguir mayúsculas. */
const enEquipo = (u: MondayUser, equipo: string): boolean =>
  nombresDeEquipos(u.teams).some((n) => n.toLowerCase() === equipo.toLowerCase())

/**
 * Usuarios del equipo "Vendedores", ya filtrados por rol (sin visores ni invitados) y mapeados
 * al `Vendedor` que consume la interfaz. Sin token (modo local) devuelve el mock.
 *
 * Se consulta `users` con SUS equipos (antes se traían todos los `teams` con sus usuarios): es la
 * misma entidad que necesita el RBAC, así que un solo modelo alcanza para el selector y para el rol.
 */
export async function getVendedores(): Promise<Vendedor[]> {
  if (!mondayHabilitado()) return VENDEDORES

  const data = await mondayApi<{ users: MondayUser[] }>(
    `query ($limite: Int!) {
      users(limit: $limite) {
        id
        name
        enabled
        is_guest
        is_view_only
        teams { id name }
      }
    }`,
    { limite: LIMITE_USUARIOS },
  )

  // El filtro por nombre del equipo se resuelve en memoria: la API no filtra usuarios por equipo.
  return (data.users ?? [])
    .filter((u) => enEquipo(u, EQUIPO_VENDEDORES))
    // Rol: se excluyen Visores (is_view_only) e Invitados (is_guest); sólo usuarios activos.
    .filter((u) => !u.is_guest && !u.is_view_only && u.enabled !== false)
    .map((u, i) => ({
      id: String(u.id),
      name: u.name,
      ini: iniciales(u.name),
      color: COLORES_VENDEDOR[i % COLORES_VENDEDOR.length],
    }))
}
