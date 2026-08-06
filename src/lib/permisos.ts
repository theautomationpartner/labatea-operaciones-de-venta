/**
 * RBAC de la app: qué puede editar el usuario logueado, según su EQUIPO en Monday.
 *
 * Dos grupos, definidos por el nombre del equipo al que pertenece el usuario de la sesión:
 *   · "Administradores" (privilegiado): puede pisar el vendedor de la operación y el precio
 *     unitario de cada producto, sólo durante la SELECCIÓN DE PRODUCTOS de una VENTA o un
 *     PRESUPUESTO.
 *   · "Vendedores" (estándar): la app funciona igual que siempre, con todo eso en sólo lectura.
 *
 * Reglas puras (sin React ni servicios): se testean solas y las consume tanto el encabezado como
 * la tabla de productos, así los dos no pueden discrepar sobre quién puede editar qué.
 */
import { BONIFICACION_TOTAL, type TopesDescuento } from '@/lib/validaciones'
import type { Operacion, Paso, UsuarioActual } from '@/types'

/** Equipo de Monday cuyos miembros son administradores de la app (grupo privilegiado). */
export const EQUIPO_ADMINISTRADORES = 'Administradores'
/** Equipo de Monday cuyos miembros son vendedores (grupo estándar) y pueblan el selector. */
export const EQUIPO_VENDEDORES = 'Vendedores'

/**
 * IDs de usuarios de Monday que cuentan como administradores aunque no estén en el equipo
 * (Gerentes / Supervisores). Vacío = manda exclusivamente el equipo.
 */
export const IDS_ADMINISTRADOR: readonly string[] = []

export type RolUsuario = 'ADMINISTRADOR' | 'VENDEDOR'

/** ¿El usuario pertenece a este equipo? Por nombre, sin distinguir mayúsculas ni espacios. */
export const perteneceAEquipo = (u: UsuarioActual | null, equipo: string): boolean =>
  (u?.equipos ?? []).some((e) => e.trim().toLowerCase() === equipo.trim().toLowerCase())

/**
 * Rol del usuario de la sesión.
 *
 * Es ADMINISTRADOR si está en el equipo "Administradores", si figura en `IDS_ADMINISTRADOR`, o si
 * es admin de la CUENTA de Monday (`is_admin`): ése ya puede editar cualquier valor directo en los
 * tableros, así que bloquearlo en la app no protegería nada.
 *
 * SIN usuario (modo local sin token, o falló la lectura de la sesión) el rol es ADMINISTRADOR a
 * propósito: en desarrollo no hay sesión que consultar y trabar la app no aportaría nada. En
 * producción siempre hay `me`, así que el permiso real lo decide el equipo.
 */
export function rolUsuario(u: UsuarioActual | null): RolUsuario {
  if (!u) return 'ADMINISTRADOR'
  if (u.isAdmin) return 'ADMINISTRADOR'
  if (IDS_ADMINISTRADOR.includes(u.id)) return 'ADMINISTRADOR'
  return perteneceAEquipo(u, EQUIPO_ADMINISTRADORES) ? 'ADMINISTRADOR' : 'VENDEDOR'
}

export const esAdministrador = (u: UsuarioActual | null): boolean =>
  rolUsuario(u) === 'ADMINISTRADOR'

/**
 * Etapa de SELECCIÓN DE PRODUCTOS de una VENTA o un PRESUPUESTO: el único momento en que el
 * administrador puede pisar valores. Es el paso `productos`, que comparten PRESUPUESTAR y la
 * VENTA directa. La venta CON PRESUPUESTO PREVIO y la venta CON PROFORMA quedan afuera: sus
 * precios y descuentos vienen fijados por el documento de origen.
 */
export const esEtapaProductos = (paso: Paso, operacion: Operacion | null): boolean =>
  paso === 'productos' && (operacion === 'VENTA' || operacion === 'PRESUPUESTAR')

/**
 * ¿Se puede pisar el PRECIO UNITARIO de un producto? Sólo el administrador, y sólo en la
 * selección de productos de una venta o un presupuesto (MÓDULO 2, acción 2).
 */
export const puedeEditarPrecio = (
  u: UsuarioActual | null,
  paso: Paso,
  operacion: Operacion | null,
): boolean => esAdministrador(u) && esEtapaProductos(paso, operacion)

/**
 * ¿El usuario puede pasarse del tope de descuento del tablero? Sólo el administrador, y sólo en
 * la selección de productos: es él quien autoriza las excepciones. Para el vendedor rige el
 * máximo configurado, como siempre.
 */
export const puedeSuperarTopeDescuento = (
  u: UsuarioActual | null,
  paso: Paso,
  operacion: Operacion | null,
): boolean => esAdministrador(u) && esEtapaProductos(paso, operacion)

/**
 * Topes de descuento que rigen para este usuario: los del tablero, o hasta la bonificación total
 * (100%) si puede autorizar excepciones. Lo usan los dos campos de descuento —el de la carga de
 * producto y el de la fila de la tabla—, así los dos aceptan exactamente lo mismo.
 */
export const topesDescuentoDe = (
  topes: TopesDescuento,
  u: UsuarioActual | null,
  paso: Paso,
  operacion: Operacion | null,
): TopesDescuento =>
  puedeSuperarTopeDescuento(u, paso, operacion) ? { ...topes, max: BONIFICACION_TOTAL } : topes

/**
 * ¿Se puede cambiar el VENDEDOR de la operación? Sólo el administrador, en CUALQUIER etapa.
 *
 * A diferencia del precio, el vendedor no está atado a la selección de productos: el administrador
 * puede reasignarlo también con la operación ya confirmada (es el caso de uso real: se detecta a
 * mitad del circuito que la venta va a nombre de otro). Antes se limitaba a `inicio` y a la
 * selección de productos, y por eso el selector aparecía bloqueado en el resto de los pasos.
 *
 * `paso` y `operacion` se conservan en la firma para no tocar a los llamadores y porque el
 * permiso puede volver a acotarse por etapa sin cambiar la API.
 */
export const puedeElegirVendedor = (
  u: UsuarioActual | null,
  _paso: Paso,
  _operacion: Operacion | null,
): boolean => esAdministrador(u)
