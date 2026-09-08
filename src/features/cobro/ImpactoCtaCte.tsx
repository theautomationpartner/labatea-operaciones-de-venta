import { estadoCtaCte, type ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'

interface ImpactoCtaCteProps {
  cliente: Cliente
  resumen: ResumenCobro
  /**
   * La operación se pasa de la línea de crédito. Lo decide QUIEN FRENA la operación y se recibe
   * como dato, en vez de volver a calcularlo acá.
   *
   * No es lo mismo: este panel sólo conoce el saldo resultante, y comparar ese saldo contra el
   * límite deja afuera la mercadería entregada y todavía no facturada, que SÍ toma línea. Con el
   * cálculo propio la card podía mostrar el número en negro mientras el botón de continuar
   * frenaba la venta por exceso —dos respuestas distintas a la misma pregunta, en la misma
   * pantalla—.
   */
  excedido: boolean
}

/**
 * Cómo queda la cuenta corriente del cliente después de esta venta.
 *
 * Se monta sólo en el camino que deja deuda —cuenta corriente sin cobro en el acto, ver
 * `mostrarImpactoCtaCte`—, así que lee de corrido: de dónde parte la cuenta, cuánto le suma
 * esta venta y en cuánto queda. La deuda va en verde porque es el número que el vendedor tiene
 * que reconocer antes de cerrar: es lo que se va a asentar en la cuenta del cliente.
 */
export function ImpactoCtaCte({ cliente, resumen, excedido }: ImpactoCtaCteProps) {
  const cta = estadoCtaCte(cliente, resumen.totalACobrar, resumen.cancelado)
  /* Mercadería ya entregada y todavía sin facturar. NO entra en el saldo resultante —no hay
     comprobante que lo respalde— pero SÍ toma línea de crédito, así que aparece aparte: sin
     nombrarla, el vendedor ve un resultante que entra en el límite y una operación frenada, sin
     nada que explique la diferencia. Sólo se monta cuando hay. */
  const remitos = cliente.remitosPendFacturar ?? 0
  const comprometida = cta.resultante + remitos

  return (
    /* MISMA caja que "¿Quién entrega la mercadería?": panel blanco con su cabecera separada por un
       filete. Lo que va adentro —las cuatro métricas— no cambia. */
    <div className="entrega-panel">
      <div className="entrega-panel-head">
        <h3 className="font-b cobro-imp-title">Impacto en cuenta corriente</h3>
      </div>

      <div className="entrega-panel-body">
      <div className="cobro-imp-row">
        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--gris">
            <i className="fas fa-id-card" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">N° de cuenta</span>
            <span className="cobro-imp-num">{cta.cuenta}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--gris">
            <i className="fas fa-wallet" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Saldo actual</span>
            <span className="cobro-imp-num">{money(cta.saldoPendiente)}</span>
          </div>
        </div>

        <span className="cobro-cab-sep" />

        {/* La deuda que genera esta venta: rótulo y valor en verde. */}
        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--verde">
            <i className="fas fa-file-invoice-dollar" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl cobro-cab-lbl--verde">Deuda</span>
            <span className="cobro-imp-num cobro-imp-num--verde">
              {money(resumen.totalACobrar)}
            </span>
          </div>
        </div>

        {remitos > 0 && (
          <>
            <span className="cobro-cab-sep" />
            <div className="cobro-imp-met">
              <span className="cobro-cab-ic cobro-cab-ic--gris">
                <i className="fas fa-truck-ramp-box" />
              </span>
              <div className="cobro-cab-campo">
                <span className="cobro-cab-lbl">Remitos pend. de facturar</span>
                <span className="cobro-imp-num">{money(remitos)}</span>
              </div>
            </div>
          </>
        )}

        <span className="cobro-cab-sep" />

        <div className="cobro-imp-met">
          <span className="cobro-cab-ic cobro-cab-ic--azul">
            <i className="fas fa-scale-balanced" />
          </span>
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">SALDO RESULTANTE</span>
            <span className={`cobro-imp-num cobro-imp-num--total ${excedido ? 'is-over' : ''}`}>
              {money(cta.resultante)}
            </span>
          </div>
        </div>

        {/* Contra qué se mide el límite en realidad: el resultante MÁS lo entregado sin facturar.
            Es el número que explica el rojo cuando el resultante, solo, parece entrar. */}
        {remitos > 0 && (
          <>
            <span className="cobro-cab-sep" />
            <div className="cobro-imp-met">
              <span className="cobro-cab-ic cobro-cab-ic--gris">
                <i className="fas fa-chart-line" />
              </span>
              <div className="cobro-cab-campo">
                <span className="cobro-cab-lbl">Línea comprometida</span>
                <span className={`cobro-imp-num ${excedido ? 'is-over' : ''}`}>
                  {money(comprometida)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
