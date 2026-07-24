import type { ReactNode } from 'react'
import { aplicaCredito, motivoCreditoIgnorado, tieneValoresCredito } from '@/lib/credito'
import { money } from '@/lib/format'
import { creditoCliente } from '@/lib/selectors'
import type { Cliente } from '@/types'

const colorActividad = (c: Cliente) => (c.activity === 'Activo' ? 'var(--green)' : 'var(--red)')

const colorSituacion = (c: Cliente) => {
  switch (c.situation) {
    case 'Liberado con crédito':
      return 'var(--yellow)'
    case 'Liberado sin crédito':
      return 'var(--green)'
    default:
      return 'var(--red)'
  }
}

/** Muestra el valor o «Sin especificar» si viene vacío. */
const oSinEsp = (v: string | null | undefined) => (v && v.trim() ? v : 'Sin especificar')

interface ClienteFichaProps {
  cliente: Cliente
  /** Contenido opcional debajo del separador. */
  children?: ReactNode
}

/**
 * Ficha del cliente: cabecera (código, nombre, dirección) con el estado comercial a la derecha,
 * los datos fiscales como badges, los KPIs financieros (crédito disponible, límite, saldo y
 * condición de pago) y la barra horizontal de uso del límite de crédito.
 */
export function ClienteFicha({ cliente, children }: ClienteFichaProps) {
  const credito = creditoCliente(cliente)
  const claseImporte = credito.bloqueado ? 'v-gray' : ''
  /* El límite pesa en la operación sólo si la venta va a cuenta corriente y el cliente está
     liberado con crédito. Si no, los valores se muestran igual, apagados. */
  const rigeCredito = aplicaCredito(cliente)
  const muestraValores = rigeCredito || tieneValoresCredito(cliente)
  const motivoIgnorado = motivoCreditoIgnorado(cliente)
  const tieneRetenciones = !!cliente.ret && cliente.ret.trim() !== '' && cliente.ret !== 'Ninguna'
  const faltaLista = !cliente.list

  return (
    <div className={`card no-radius ${credito.bloqueado ? 'card--bloqueado' : ''}`}>
      <div className="client-header">
        <div>
          <span className="client-id">Código: {cliente.codigo}</span>
          <h2 className="client-name">{cliente.name}</h2>

          <span className="client-address">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--c-primary)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Dirección Fiscal: {oSinEsp(cliente.addr)}
          </span>

          <div className="badges">
            <span className="badge badge-gray">CUIT: {oSinEsp(cliente.cuit)}</span>
            <span className="badge badge-gray">{oSinEsp(cliente.ptype)}</span>
            <span className="badge badge-green">{oSinEsp(cliente.status)}</span>
            <span className={`badge badge-blue ${faltaLista ? 'badge--falta' : ''}`}>
              Lista: {cliente.list ?? 'Sin especificar'}
            </span>
            {/* La condición de pago manda sobre todo el flujo: viaja con el resto de los
                datos del cliente, con su color propio pero al tamaño de las etiquetas. */}
            <span className="badge badge--cond">
              Condicion de Pago: <strong>{cliente.condicionPago ?? 'Sin asignar'}</strong>
            </span>
            {tieneRetenciones && (
              <span className="badge badge-purple">Retenciones: {cliente.ret}</span>
            )}
          </div>
        </div>

        {/* Estado comercial, arriba a la derecha. */}
        <div className="status-indicators">
          <div className="status-indicator">
            <span className="status-dot" style={{ background: colorActividad(cliente) }} />
            {cliente.activity}
          </div>
          <div className="status-indicator">
            <span className="status-dot" style={{ background: colorSituacion(cliente) }} />
            {cliente.situation}
          </div>
        </div>
      </div>

      <hr className="divider" />

      {/* Valores de crédito. Se muestran siempre que estén cargados; el gris avisa que en
          esta operación no van a usarse. */}
      {muestraValores && (
        <>
          <section className={`credito-grupo ${rigeCredito ? '' : 'credito-grupo--off'}`}>
            <div className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Límite asignado</span>
                <span className={`kpi-value ${claseImporte}`}>{money(cliente.limit)}</span>
              </div>
              {/* Informativo: no entra en el cálculo del uso del crédito. */}
              <div className="kpi-card">
                <span className="kpi-label">Remito Pends de Facturar</span>
                <span className={`kpi-value ${claseImporte}`}>
                  {money(cliente.remitosPendFacturar)}
                </span>
              </div>
              {/* "Linea Utilizada" de la Cta Cte: saldo + remitos pendientes de facturar. */}
              <div className="kpi-card">
                <span className="kpi-label">Línea utilizada</span>
                <span className={`kpi-value ${claseImporte || credito.clase}`}>
                  {money(cliente.lineaUtilizada)}
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Crédito disponible</span>
                <span className={`kpi-value ${claseImporte || 'v-green'}`}>
                  {money(credito.disponible)}
                </span>
              </div>
            </div>
          </section>

          {/* Por qué el límite no va a pesar en esta operación. */}
          {motivoIgnorado && <p className="credito-nota-off">{motivoIgnorado}</p>}
        </>
      )}

      {rigeCredito && (
        <>
          <hr className="divider" />

          <div className="progress-section">
            <div className="progress-header">
              <span>Uso de límite de crédito</span>
              <strong>{credito.usadoPct}% Utilizado</strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  // La barra no puede pasarse aunque el saldo supere el límite.
                  width: `${Math.min(Math.max(credito.usadoPct, 0), 100)}%`,
                  background: credito.color,
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* Debajo del separador: contenido extra, si se pasa. */}
      {children && (
        <>
          <hr className="divider" />
          {children}
        </>
      )}
    </div>
  )
}
