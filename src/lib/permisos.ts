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
import type { Operacion, Paso, UsuarioActual, Vendedor } from '@/types'

/**
 * Equipos de Monday, POR ID.
 *
 * Los IDs y no los nombres: un equipo se renombra en dos clics y el ID no cambia nunca. Cuando
 * esto miraba nombres, renombrar el equipo dejaba a toda su gente sin permisos sin que nadie
 * tocara una línea de código —y el síntoma, campos que dejan de poder editarse, no delata la causa.
 */
export const TEAM_ADMINISTRADORES = '1480182'
export const TEAM_VENDEDORES = '1487023'

/**
 * IDs de usuarios de Monday que cuentan como administradores aunque no estén en el equipo
 * (Gerentes / Supervisores). Vacío = manda exclusivamente el equipo.
 */
export const IDS_ADMINISTRADOR: readonly string[] = []

export type RolUsuario = 'ADMINISTRADOR' | 'VENDEDOR'

/** ¿El usuario pertenece a este equipo? Comparación exacta por ID. */
export const perteneceAEquipo = (u: UsuarioActual | null, equipo: string): boolean =>
  (u?.equiposIds ?? []).includes(equipo)

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
  return perteneceAEquipo(u, TEAM_ADMINISTRADORES) ? 'ADMINISTRADOR' : 'VENDEDOR'
}

export const esAdministrador = (u: UsuarioActual | null): boolean =>
  rolUsuario(u) === 'ADMINISTRADOR'

/**
 * Quién manda para los permisos de la OPERACIÓN: el VENDEDOR ASIGNADO, no quien está logueado.
 *
 * La operación se asienta a nombre del vendedor elegido, así que los topes que rigen son los
 * suyos. Sin esta distinción, un administrador podía elegir a un vendedor y, con SUS propios
 * privilegios, aplicar un descuento del 20% o forzar rentabilidad en una operación que queda
 * firmada por alguien que no puede hacer ninguna de las dos cosas. El permiso no viaja con quien
 * opera la pantalla: viaja con quien queda como responsable.
 *
 * Elegir el vendedor sigue siendo atributo de quien está logueado (`puedeElegirVendedor`), o el
 * administrador quedaría encerrado apenas asigna a otro.
 *
 * Sin sesión (desarrollo local sin token) devuelve `null`, que es el caso permisivo de siempre:
 * ahí no hay a quién consultarle y trabar la app no aporta nada.
 */
export const usuarioDeLaOperacion = (
  logueado: UsuarioActual | null,
  vendedor: Vendedor | null,
): UsuarioActual | null => {
  if (!logueado || !vendedor) return logueado
  return {
    id: vendedor.id,
    name: vendedor.name,
    isAdmin: vendedor.esAdminDeCuenta,
    equiposIds: vendedor.equiposIds,
  }
}

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
