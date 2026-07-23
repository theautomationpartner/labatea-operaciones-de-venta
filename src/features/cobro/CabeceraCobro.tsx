import type { ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'

interface CabeceraCobroProps {
  cliente: Cliente
  resumen: ResumenCobro
}

/** Métrica de la cabecera: icono en pastilla, rótulo y cifra. */
function Metrica({
  icono,
  tono,
  rotulo,
  valor,
  nota,
}: {
  icono: string
  tono: 'azul' | 'verde' | 'rojo'
  rotulo: string
  valor: string
  /** Aclaración al pie de la cifra, cuando el número solo no explica la cuenta. */
  nota?: string
}) {
  return (
    <div className="cobro-cab-met">
      <span className={`cobro-cab-ic cobro-cab-ic--${tono}`}>
        <i className={`fas ${icono}`} />
      </span>
      <div className="cobro-cab-campo">
        <span className="cobro-cab-lbl cobro-cab-lbl--met">{rotulo}</span>
        <span className={`cobro-cab-num cobro-cab-num--${tono}`}>{valor}</span>
        {nota && <span className="cobro-cab-nota">{nota}</span>}
      </div>
    </div>
  )
}

/**
 * Cabecera del cierre de venta: de quién es la venta, bajo qué condición se cobra y los tres
 * números que resumen el cobro. Vive dentro del desplegable, arriba del formulario, para que
 * al cargar cada pago se vea cuánto falta.
 */
export function CabeceraCobro({ cliente, resumen }: CabeceraCobroProps) {
  /* Sin recortar en cero: si lo cargado se pasa del total, el número tiene que decirlo.
     `resumen.pendiente` sí está recortado, porque es lo que le queda a deber el cliente. */
  const restante = resumen.totalACobrar - resumen.cancelado

  return (
    <div className="cobro-cab">
      <div className="cobro-cab-cli">
        <span className="cobro-cab-av">
          <i className="fas fa-user" />
        </span>
        <div className="cobro-cab-campo">
          <span className="cobro-cab-lbl">Cliente</span>
          <span className="cobro-cab-val">{cliente.name}</span>
        </div>
        <div className="cobro-cab-campo">
          <span className="cobro-cab-lbl">Condición de pago</span>
          {/* Mismo tratamiento que en la ficha del cliente: es el dato que manda acá. */}
          <span className="cobro-cab-cond">{cliente.condicionPago}</span>
        </div>
      </div>

      <span className="cobro-cab-sep" />

      <div className="cobro-cab-mets">
        <Metrica
          icono="fa-file-invoice-dollar"
          tono="azul"
          rotulo="TOTAL A COBRAR"
          valor={money(resumen.totalACobrar)}
        />
        {/* Los descuentos cancelan igual que la plata: sin la nota, la resta no cierra. */}
        <Metrica
          icono="fa-hand-holding-dollar"
          tono="verde"
          rotulo="TOTAL COBRADO"
          valor={money(resumen.totalCobrado)}
          nota={
            resumen.descuentoTotal > 0
              ? `+ ${money(resumen.descuentoTotal)} en descuentos`
              : undefined
          }
        />
        <Metrica
          icono="fa-receipt"
          tono="rojo"
          rotulo="RESTANTE"
          valor={restante < 0 ? `- ${money(-restante)}` : money(restante)}
          nota={restante < 0 ? 'Se pasa del total a cobrar' : undefined}
        />
      </div>
    </div>
  )
}
