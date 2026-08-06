import type { BalancePago, ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente, TipoTarjetaCobro } from '@/types'
import { CabeceraCobro } from './CabeceraCobro'
import { FormularioTarjeta } from './FormularioTarjeta'
import { TablaTarjetas } from './TablaTarjetas'

interface CobroTarjetasProps {
  cliente: Cliente
  /** Débito o crédito, según la forma de pago elegida en la etapa anterior. */
  tipo: TipoTarjetaCobro
  resumen: ResumenCobro
  balances: BalancePago[]
  /** Lo que falta cobrar: >0 falta, <0 se cobró de más, 0 habilita el avance. */
  diferencia: number
  bloqueado?: boolean
}

/**
 * Cobro con tarjeta: misma estructura que el "Registrar cobro" de contado —cabecera de métricas,
 * formulario de carga y tabla de movimientos—, pero con los campos y las columnas del plástico.
 *
 * La cabecera NO muestra la condición de pago del cliente: acá manda la forma de pago de la
 * operación. Y no hay botón de "Confirmar cobro": el cobro se da por cerrado cuando la DIFERENCIA
 * llega a 0, que es además lo único que habilita el avance de etapa.
 */
export function CobroTarjetas({
  cliente,
  tipo,
  resumen,
  balances,
  diferencia,
  bloqueado = false,
}: CobroTarjetasProps) {
  const esCredito = tipo === 'CREDITO'
  /* Por qué el cobro todavía no cierra. Es el hint en vivo dentro de la card; el avance queda
     bloqueado hasta que la diferencia sea exactamente 0. */
  const bloqueoMsg =
    diferencia === 0
      ? null
      : diferencia < 0
        ? `El total cobrado supera el total de la venta en ${money(-diferencia)}: ajustá los importes.`
        : balances.length === 0
          ? `Cargá las tarjetas hasta cubrir los ${money(diferencia)} de la venta.`
          : `Todavía faltan ${money(diferencia)} para cerrar el cobro.`

  return (
    <div className="cobro-static">
      <CabeceraCobro cliente={cliente} resumen={resumen} mostrarCondicion={false} />

      <div className="cobro-card">
        <h3 className="cobro-card-title">
          Registrar cobro con tarjeta de {esCredito ? 'crédito' : 'débito'}
        </h3>
        <p className="cobro-card-desc">Cargá cada tarjeta con la que el cliente paga la venta</p>

        <FormularioTarjeta
          key={tipo}
          tipo={tipo}
          cargadas={balances.length}
          diferencia={diferencia}
          bloqueado={bloqueado}
        />

        <h4 className="cobro-card-sub">Tarjetas registradas ({balances.length})</h4>
        <TablaTarjetas balances={balances} esCredito={esCredito} bloqueado={bloqueado} />

        {bloqueoMsg && (
          <div className="cobro-card-acts">
            <span className="cobro-bloqueo-inline">
              <i className="fas fa-circle-exclamation" /> {bloqueoMsg}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
