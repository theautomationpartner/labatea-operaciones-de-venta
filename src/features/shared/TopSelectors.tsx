import { useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { Modal } from '@/components/ui/Modal'
import { hoy } from '@/lib/dates'
import { OPERACIONES } from '@/lib/pasos'
import { puedeElegirVendedor } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Operacion, Vendedor } from '@/types'

/** Item de la barra: etiqueta arriba, selector abajo. */
function TopSel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="topsel-item">
      <span className="topsel-lbl">{label}</span>
      {children}
    </div>
  )
}

/** Formato del valor de la tasa: mismo estilo de miles/decimales que el resto de la app. */
const TASA_FMT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Tasa de cambio del día, leída al iniciar la app. Tarjeta estática (no editable): ícono de peso,
 * título con la fecha de hoy y el valor debajo. Vive a la derecha del selector de vendedor y sólo
 * aparece una vez confirmada la operación (fuera del paso inicial).
 */
function TasaCambio() {
  const { tasaCambio, paso } = useApp()
  // En el paso inicial todavía no se confirmó la operación: la tarjeta no se muestra.
  if (paso === 'inicio') return null
  return (
    <div className="tasa-card" role="group" aria-label="Tasa de cambio del día">
      <span className="tasa-card-ic">
        <i className="fas fa-dollar-sign" />
      </span>
      <div className="tasa-card-body">
        <span className="tasa-card-lbl">Tasa de Cambio ({hoy()})</span>
        <span className="tasa-card-val">
          {tasaCambio != null ? `$ ${TASA_FMT.format(tasaCambio)}` : '—'}
        </span>
      </div>
    </div>
  )
}

function OperacionSelector() {
  const state = useApp()
  const { operacion } = state
  const dispatch = useDispatch()
  // Operación elegida que espera confirmación en el modal de advertencia.
  const [pendiente, setPendiente] = useState<Operacion | null>(null)

  /* Hay datos de la operación en curso cuando ya se eligió un cliente o se cargó algún ítem o
     cobro: cambiar de operación los perdería, así que el cambio se intercepta con una advertencia. */
  const hayDatos =
    state.cliente !== null ||
    state.lineas.length > 0 ||
    state.ventaItems.length > 0 ||
    state.facturaItems.length > 0 ||
    state.cobro.movimientos.length > 0

  const elegir = (op: Operacion) => {
    if (op === operacion) return
    // Sin datos (por ejemplo, en el inicio): se aplica directo, sin modal ni reset.
    if (!hayDatos) {
      dispatch({ type: 'setOperacion', operacion: op })
      return
    }
    // Con datos cargados: se intercepta y se pide confirmación antes del deep reset.
    setPendiente(op)
  }

  return (
    <>
      <Dropdown<Operacion>
        label={<span className={operacion ? '' : 'selbox-ph'}>{operacion ?? 'Seleccionar...'}</span>}
        items={OPERACIONES}
        itemKey={(op) => op}
        renderItem={(op) => op}
        itemClassName="dditem--strong"
        onSelect={elegir}
      />

      {pendiente && (
        <Modal
          title="¿Cambiar de operación?"
          icon={<i className="fas fa-triangle-exclamation modal-icon--warn" />}
          onClose={() => setPendiente(null)}
          actions={
            <>
              <button type="button" className="btn btn-out" onClick={() => setPendiente(null)}>
                Volver
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const op = pendiente
                  setPendiente(null)
                  // Deep reset: descarta todo y arranca la nueva operación desde "Selección de Cliente".
                  dispatch({ type: 'cambiarOperacion', operacion: op })
                }}
              >
                Aceptar
              </button>
            </>
          }
        >
          Al cambiar de operación, todos los datos ingresados actualmente se perderán. ¿Deseas
          continuar?
        </Modal>
      )}
    </>
  )
}

function VendedorSelector() {
  const { vendedor, vendedores, vendedoresCargando, usuarioActual } = useApp()
  const dispatch = useDispatch()
  // Mientras se traen los vendedores del board, el selector queda deshabilitado con el placeholder.
  const etiqueta = vendedoresCargando
    ? 'Cargando vendedores...'
    : (vendedor?.name ?? 'Seleccionar...')
  /* RBAC: sólo los admins (o ids privilegiados) pueden emitir a nombre de OTRO vendedor. El resto
     ve el selector bloqueado, fijo en el vendedor por defecto (su propio usuario). */
  const bloqueado = vendedoresCargando || !puedeElegirVendedor(usuarioActual)
  return (
    <Dropdown<Vendedor>
      label={<span className={vendedor ? '' : 'selbox-ph'}>{etiqueta}</span>}
      items={vendedores}
      itemKey={(v) => v.id}
      disabled={bloqueado}
      renderItem={(v) => (
        <>
          <Avatar ini={v.ini} color={v.color} />
          {v.name}
        </>
      )}
      onSelect={(v) => dispatch({ type: 'setVendedor', vendedor: v })}
    />
  )
}

/**
 * Operación y vendedor: misma ubicación y diseño en todos los pasos de ambos flujos.
 * `children` deja sumar acciones a la derecha (el Confirmar del paso inicial).
 */
export function SelectoresOperacion({ children }: { children?: ReactNode }) {
  return (
    <div className="topsel">
      <TopSel label="Seleccionar tipo de operación:">
        <OperacionSelector />
      </TopSel>
      <TopSel label="Seleccionar vendedor:">
        <VendedorSelector />
      </TopSel>
      {/* Tasa de cambio del día, a la derecha del selector de vendedor. */}
      <TasaCambio />
      {children}
    </div>
  )
}
