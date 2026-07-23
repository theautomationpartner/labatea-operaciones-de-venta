/** Fechas en formato dd/MM/yyyy, tal como las maneja el ERP. */

const pad = (n: number) => String(n).padStart(2, '0')

export function parseDate(value: string): Date | null {
  const [d, m, y] = value.split('/')
  if (!d || !m || !y) return null
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** La emisión no se edita: siempre es el día en que se opera. */
export const hoy = (): string => formatDate(new Date())

/** El mismo día, en yyyy-MM-dd: es el formato de las columnas date de Monday. */
export function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** dd/MM/yyyy → yyyy-MM-dd, el formato que piden los `input[type=date]` y Monday. */
export function aIso(value: string): string {
  const date = parseDate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** yyyy-MM-dd → dd/MM/yyyy. Devuelve '' si no viene una fecha completa. */
export function desdeIso(value: string): string {
  const [y, m, d] = (value ?? '').split('-')
  return y && m && d ? `${d}/${m}/${y}` : ''
}

/** Vencimiento = emisión + días de vigencia. Devuelve '--' si la emisión es inválida. */
export function addDays(value: string, days: number): string {
  const date = parseDate(value)
  if (!date) return '--'
  date.setDate(date.getDate() + days)
  return formatDate(date)
}
