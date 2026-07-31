/**
 * Vendedores autorizados: los usuarios del equipo "Vendedores" de Monday. Se lee una vez, al
 * iniciar la app, y puebla el selector "Seleccionar Vendedor".
 *
 * Filtros:
 *   · Equipo: sólo los miembros del team llamado "Vendedores".
 *   · Rol: se excluyen Visores (is_view_only) e Invitados (is_guest); quedan los miembros
 *     (y admins) activos. El id numérico del usuario viaja como valor para asignar la venta.
 */
import { VENDEDORES } from '@/data/mock'
import type { Vendedor } from '@/types'
import { mondayApi, mondayHabilitado } from './sdk'

/** Nombre del equipo de Monday cuyos usuarios son los vendedores. */
const TEAM_VENDEDORES = 'Vendedores'

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

interface MondayUser {
  id: string
  name: string
  enabled?: boolean | null
  is_guest?: boolean | null
  is_view_only?: boolean | null
}

interface MondayTeam {
  id: string
  name: string
  users: MondayUser[]
}

/**
 * Usuarios del equipo "Vendedores", ya filtrados por rol (sin visores ni invitados) y mapeados
 * al `Vendedor` que consume la interfaz. Sin token (modo local) devuelve el mock.
 */
export async function getVendedores(): Promise<Vendedor[]> {
  if (!mondayHabilitado()) return VENDEDORES

  const data = await mondayApi<{ teams: MondayTeam[] }>(
    `query {
      teams {
        id
        name
        users {
          id
          name
          enabled
          is_guest
          is_view_only
        }
      }
    }`,
  )

  // El filtro por nombre del equipo se resuelve en memoria: la API no filtra teams por nombre.
  const equipo = (data.teams ?? []).find(
    (t) => t.name.trim().toLowerCase() === TEAM_VENDEDORES.toLowerCase(),
  )
  if (!equipo) return []

  return equipo.users
    // Rol: se excluyen Visores (is_view_only) e Invitados (is_guest); sólo usuarios activos.
    .filter((u) => !u.is_guest && !u.is_view_only && u.enabled !== false)
    .map((u, i) => ({
      id: String(u.id),
      name: u.name,
      ini: iniciales(u.name),
      color: COLORES_VENDEDOR[i % COLORES_VENDEDOR.length],
    }))
}
