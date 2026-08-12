import type { ResumenCobro } from '@/lib/cobros'
import { money } from '@/lib/format'
import type { Cliente } from '@/types'
import { MetricaCobro } from './MetricaCobro'

interface CabeceraCobroProps {
  cliente: Cliente
  resumen: ResumenCobro
  /**
   * Mostrar la condición de pago del cliente. En el cobro con tarjeta NO se muestra: la forma de
   * pago de la operación ya la eligió el vendedor y la condición pactada no gobierna nada acá.
   */
  mostrarCondicion?: boolean
}

/**
 * Cabecera del cierre de venta: de quién es la venta, bajo qué condición se cobra y los números
 * que resumen el cobro. Vive dentro del desplegable, arriba del formulario, para que al cargar
 * cada pago se vea cuánto falta. Las tres métricas van juntas: TOTAL VENTA, TOTAL COBRADO y
 * DIFERENCIA.
 */
export function CabeceraCobro({
  cliente,
  resumen,
  mostrarCondicion = true,
}: CabeceraCobroProps) {
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
        {mostrarCondicion && (
          <div className="cobro-cab-campo">
            <span className="cobro-cab-lbl">Condición de pago</span>
            {/* Mismo tratamiento que en la ficha del cliente: es el dato que manda acá. */}
            <span className="cobro-cab-cond">{cliente.condicionPago}</span>
          </div>
        )}
      </div>

      <span className="cobro-cab-sep" />

      <div className="cobro-cab-mets">
        <MetricaCobro
          icono="fa-file-invoice-dollar"
          tono="azul"
          rotulo="TOTAL VENTA"
          valor={money(resumen.totalACobrar)}
        />
        <MetricaCobro
          icono="fa-hand-holding-dollar"
          tono="verde"
          rotulo="TOTAL COBRADO"
          valor={money(resumen.totalCobrado)}
        />
        {/* Cobrado de más, la cifra sale en negativo y NADA la aclara al pie: el exceso ya lo
            explica el aviso que frena el "Continuar" ("el total cobrado supera el total de la
            venta"). Un texto acá repetía el mismo mensaje dos veces y movía la altura de la
            métrica según el resultado. */}
        <MetricaCobro
          icono="fa-receipt"
          tono="rojo"
          rotulo="DIFERENCIA"
          valor={restante < 0 ? `- ${money(-restante)}` : money(restante)}
        />
      </div>
    </div>
  )
}
