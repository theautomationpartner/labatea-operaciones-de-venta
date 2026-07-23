import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { VENDEDORES } from '@/data/mock'
import { OPERACIONES } from '@/lib/pasos'
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

function OperacionSelector() {
  const { operacion } = useApp()
  const dispatch = useDispatch()
  return (
    <Dropdown<Operacion>
      label={<span className={operacion ? '' : 'selbox-ph'}>{operacion ?? 'Seleccionar...'}</span>}
      items={OPERACIONES}
      itemKey={(op) => op}
      renderItem={(op) => op}
      itemClassName="dditem--strong"
      onSelect={(op) => dispatch({ type: 'setOperacion', operacion: op })}
    />
  )
}

function VendedorSelector() {
  const { vendedor } = useApp()
  const dispatch = useDispatch()
  return (
    <Dropdown<Vendedor>
      label={
        <span className={vendedor ? '' : 'selbox-ph'}>{vendedor?.name ?? 'Seleccionar...'}</span>
      }
      items={VENDEDORES}
      itemKey={(v) => v.ini}
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
      {children}
    </div>
  )
}
