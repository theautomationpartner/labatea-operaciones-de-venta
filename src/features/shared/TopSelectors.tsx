import { useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { LogoEmpresa } from '@/components/ui/LogoEmpresa'
import { Modal } from '@/components/ui/Modal'
import { hoy } from '@/lib/dates'
import { OPERACIONES } from '@/lib/pasos'
import {
  excesosDeLaOperacion,
  hayExcesos,
  puedeElegirVendedor,
  usuarioDeLaOperacion,
} from '@/lib/permisos'
import { useApp, useDispatch } from '@/state/hooks'
import type { ExcesosDeLaOperacion } from '@/lib/permisos'
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
        <span className="tasa-card-lbl">Tipo de Cambio ({hoy()})</span>
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
  const {
    vendedor,
    vendedores,
    vendedoresCargando,
    usuarioActual,
    paso,
    operacion,
    lineas,
    topesDescuento,
    rentabForzadaActiva,
  } = useApp()
  const dispatch = useDispatch()

  /* Vendedor propuesto que todavía no se aplicó: hay cargado algo que él no habría podido
     autorizar, y se pregunta antes de recortarlo. */
  const [aConfirmar, setAConfirmar] = useState<Vendedor | null>(null)
  /* RBAC: sólo el equipo "Administradores" puede emitir a nombre de OTRO vendedor. El resto ve el
     selector bloqueado, fijo en el vendedor por defecto (su propio usuario). */
  const habilitado = puedeElegirVendedor(usuarioActual, paso, operacion)
  const bloqueado = vendedoresCargando || !habilitado
  /* El vendedor elegido se muestra con el MISMO ícono con el que figura en la lista: sin él, el
     selector cerrado era el único lugar donde el usuario aparecía sin su avatar.
     Mientras se traen los vendedores del board queda el placeholder de carga. */
  const etiqueta = vendedoresCargando ? (
    <span className="selbox-ph">Cargando vendedores...</span>
  ) : vendedor ? (
    /* Ícono y nombre van dentro de UN solo elemento: el botón reparte el espacio sobrante entre
       sus hijos, así que sueltos se separaban uno del otro en lugar de quedar juntos. */
    <span className="selbox-val">
      <Avatar ini={vendedor.ini} color={vendedor.color} size="sm" />
      <span className="selbox-val-txt">{vendedor.name}</span>
    </span>
  ) : (
    <span className="selbox-ph">Seleccionar...</span>
  )
  /* Lo que el vendedor PROPUESTO no habría podido firmar. Se calcula con él, no con quien opera. */
  const excesosDe = (v: Vendedor) =>
    excesosDeLaOperacion(
      lineas,
      topesDescuento,
      usuarioDeLaOperacion(usuarioActual, v),
      rentabForzadaActiva,
    )

  function elegir(v: Vendedor) {
    // Sin nada que ajustar, el cambio es directo: no se molesta con una pregunta sin contenido.
    if (!hayExcesos(excesosDe(v))) {
      dispatch({ type: 'setVendedor', vendedor: v })
      return
    }
    setAConfirmar(v)
  }

  /**
   * Aplica el cambio y recorta lo que sobra.
   *
   * El recorte pisa trabajo hecho, y por eso nunca pasa sin confirmar: los descuentos bajan al
   * tope del nuevo responsable y la rentabilidad forzada se apaga. Dejarlos como estaban sería
   * peor —la operación quedaría firmada por alguien que no puede autorizar eso— y bloquear el
   * cambio, también: el administrador no podría corregir una asignación equivocada.
   */
  function confirmarCambio() {
    const v = aConfirmar
    if (!v) return
    const excesos = excesosDe(v)

    dispatch({ type: 'setVendedor', vendedor: v })
    for (const linea of excesos.lineas) {
      dispatch({ type: 'setDescuentoLinea', id: linea.id, descuento: excesos.topeMax })
    }
    if (excesos.rentabForzada) dispatch({ type: 'toggleRentabForzada', porcentaje: 0 })
    setAConfirmar(null)
  }

  return (
    <span
      title={
        habilitado || vendedoresCargando
          ? undefined
          : 'Sólo un administrador puede cambiar el vendedor de la operación.'
      }
    >
      <Dropdown<Vendedor>
        label={etiqueta}
        items={vendedores}
        itemKey={(v) => v.id}
        disabled={bloqueado}
        renderItem={(v) => (
          <>
            <Avatar ini={v.ini} color={v.color} />
            {v.name}
          </>
        )}
        onSelect={elegir}
      />
      {aConfirmar && <ConfirmarCambioDeVendedor
        vendedor={aConfirmar}
        excesos={excesosDe(aConfirmar)}
        onCancelar={() => setAConfirmar(null)}
        onConfirmar={confirmarCambio}
      />}
    </span>
  )
}

/**
 * Aviso previo al cambio de vendedor: dice QUÉ se va a ajustar antes de tocar nada.
 *
 * El recorte pisa trabajo hecho, así que no puede pasar en silencio. Y la alternativa —bloquear el
 * cambio— sería peor: el administrador no podría corregir una asignación equivocada.
 */
function ConfirmarCambioDeVendedor({
  vendedor,
  excesos,
  onCancelar,
  onConfirmar,
}: {
  vendedor: Vendedor
  excesos: ExcesosDeLaOperacion
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <Modal
      title="Al cambiar de vendedor hay que ajustar la operación"
      icon={<i className="fas fa-triangle-exclamation modal-icon--warn" />}
      onClose={onCancelar}
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={onConfirmar}>
            Cambiar y ajustar
          </button>
          <button type="button" className="btn btn-secundario" onClick={onCancelar}>
            Cancelar
          </button>
        </>
      }
    >
      <p>
        La operación pasa a estar a nombre de <strong>{vendedor.name}</strong>, que puede autorizar
        hasta <strong>{excesos.topeMax}%</strong> de descuento. Lo que hay cargado excede eso, así
        que se ajusta:
      </p>
      <ul className="modal-faltantes">
        {/* Un renglón POR PRODUCTO, con su nombre: contar líneas obligaba a salir del aviso a
            buscar cuáles eran, que es justo lo que el aviso tendría que ahorrar. */}
        {excesos.lineas.map((l) => (
          <li key={l.id}>
            <i className="fas fa-circle-xmark" />
            <strong>{l.producto}</strong> tiene desc mayor al {excesos.topeMax}%
          </li>
        ))}
        {excesos.rentabForzada && (
          <li>
            <i className="fas fa-circle-xmark" />
            La rentabilidad forzada se apaga
          </li>
        )}
      </ul>
      <p className="modal-detalle">
        Si no querés ajustar nada, cancelá y la operación sigue con el vendedor actual.
      </p>
    </Modal>
  )
}

/**
 * Operación y vendedor: misma ubicación y diseño en todos los pasos de ambos flujos.
 * `children` deja sumar acciones a la derecha (el Confirmar del paso inicial).
 */
export function SelectoresOperacion({ children }: { children?: ReactNode }) {
  return (
    <div className="topsel">
      {/* La marca abre la barra, contra el margen izquierdo y separada de los controles. */}
      <LogoEmpresa />
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
