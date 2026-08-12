import { useState } from 'react'
import { round2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { topesDescuentoDe } from '@/lib/permisos'
import { aplicarTecleoDescuento, BONIFICACION_TOTAL, validarDescuento } from '@/lib/validaciones'
import { useApp } from '@/state/hooks'
import { DetalleDescuentos } from './DetalleDescuentos'
import { FichaCostoForzada } from './FichaCostoForzada'
import { ProveedorLinea, StockPanel } from './StockPanel'
import type { FilaProducto } from './TablaProductos'

/**
 * Descuento por precio editable. Guarda lo tecleado para poder escribir "1," o "1.5" sin
 * saltos, y sólo avisa al padre cuando el valor es válido; si no, se marca en rojo.
 */
function InputDescuento({
  fila,
  onDescuento,
}: {
  fila: FilaProducto
  onDescuento: (id: string, descuento: number) => void
}) {
  const { topesDescuento: topesTablero, usuarioActual, paso, operacion } = useApp()
  /* Mismo tope que el campo de la carga de producto: el administrador puede pasarse del máximo
     del tablero, el vendedor no. Si no, un descuento autorizado por un admin quedaría marcado
     como inválido al editarlo desde la fila. */
  const topesDescuento = topesDescuentoDe(topesTablero, usuarioActual, paso, operacion)
  const [texto, setTexto] = useState(String(fila.descuento))
  // Aviso de la tecla rechazada por pasarse del máximo.
  const [rechazado, setRechazado] = useState('')
  // Si la fila cambia desde afuera (otra edición), el campo la sigue.
  const [ultimo, setUltimo] = useState(fila.descuento)
  if (ultimo !== fila.descuento) {
    setUltimo(fila.descuento)
    setTexto(String(fila.descuento))
  }

  const validacion = validarDescuento(texto, topesDescuento)
  const mensaje = rechazado || validacion.mensaje
  const ok = !rechazado && validacion.ok

  const cambiar = (valor: string) => {
    /* La tecla se resuelve en `aplicarTecleoDescuento`: lo que se pasa del tope no entra, y
       sólo se explica cuando el primer dígito ya se pasaba. */
    const tecleo = aplicarTecleoDescuento(texto, valor, topesDescuento)
    setRechazado(tecleo.mensaje)
    if (tecleo.texto === texto) return

    setTexto(tecleo.texto)
    const v = validarDescuento(tecleo.texto, topesDescuento)
    if (v.ok) {
      const n = Number(tecleo.texto) || 0
      setUltimo(n)
      onDescuento(fila.id, n)
    }
  }

  /**
   * Al salir del campo NUNCA queda vacío: sin número (o con algo que no llega a serlo, como un
   * "." suelto) se asienta un 0 explícito. El estado ya valía 0, pero el campo en blanco se lee
   * como "sin definir" y arrastra ese vacío a lo que se guarde después.
   */
  const alSalir = () => {
    const n = Number(texto.trim().replace(',', '.'))
    if (texto.trim() !== '' && Number.isFinite(n)) return
    setTexto('0')
    setRechazado('')
    setUltimo(0)
    onDescuento(fila.id, 0)
  }

  return (
    <span className={`dbox ${ok ? '' : 'dbox--error'}`} title={mensaje}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Descuento por precio de ${fila.nombre}: de 0 a ${topesDescuento.max}, o ${BONIFICACION_TOTAL} de bonificación total`}
        aria-invalid={!ok}
        value={texto}
        onChange={(e) => cambiar(e.target.value)}
        onBlur={alSalir}
      />
      <span className="dbox-suf">%</span>
      {mensaje && <span className="dbox-aviso">{mensaje}</span>}
    </span>
  )
}

interface LineaDetalleProps {
  fila: FilaProducto
  /** % de descuento de la forma de pago de la operación (0 cuando no aplica). */
  descFormaPago: number
  /** Descuento por forma de pago, en $ por unidad. */
  dtoPago: number
  /** Descuento manual por precio, en $ por unidad. */
  dtoPrecio: number
  /** Suma de los dos anteriores: lo bonificado por unidad. */
  dtoTotal: number
  /** Formato de importes: pesos, o dólares en el presupuesto bimonetario. */
  fmt: (n: number) => string
  /** Sin handler, el descuento por precio se muestra en lectura (venta con presupuesto/proforma). */
  onDescuento?: (id: string, descuento: number) => void
}

/**
 * Detalle desplegable de una línea: a la izquierda cómo se compone el descuento (forma de pago y
 * precio, cada uno con su % y su importe) y a la derecha el proveedor, el stock y la cobertura.
 */
export function LineaDetalle({
  fila,
  descFormaPago,
  dtoPago,
  dtoPrecio,
  dtoTotal,
  fmt,
  onDescuento,
}: LineaDetalleProps) {
  /* Rentabilidad forzada aplicada a la línea: el "Detalle" muestra el % forzado (la rentabilidad FINAL,
     NO la base) y el Nuevo Precio de Costo (= precio de venta × (1 − %/100), el costo implícito del
     margen forzado). El precio de venta y la rentabilidad base NO cambian con la forzada. */
  const rentabForzada = fila.rentabForzada
  const nuevoPrecioCosto =
    rentabForzada != null ? round2(fila.precio * (1 - rentabForzada / 100)) : undefined
  return (
    /* Sin ficha de catálogo no hay bloque de stock: el desglose ocupa una sola columna en vez
       de dejar media fila vacía. */
    <div className={`lindet ${fila.producto ? '' : 'lindet--solo'}`}>
      {/* Precio de Costo del maestro (y, con la rentabilidad forzada, el % y el Nuevo Precio de Costo). */}
      <FichaCostoForzada
        precioCosto={fila.producto?.precioCosto}
        prefijo={esDolar(fila.producto?.moneda) ? 'U$' : '$'}
        rentabForzada={rentabForzada}
        nuevoPrecioCosto={nuevoPrecioCosto}
        fmt={fmt}
      />

      <DetalleDescuentos
        descFormaPago={descFormaPago}
        dtoPago={dtoPago}
        descuentoManual={fila.descuento}
        dtoPrecio={dtoPrecio}
        dtoTotal={dtoTotal}
        notaCredito={fila.notaCredito}
        fmt={fmt}
        // En la tabla el % manual se edita acá mismo (en la carga de producto vive arriba).
        editorManual={
          onDescuento ? <InputDescuento fila={fila} onDescuento={onDescuento} /> : undefined
        }
      />

      {fila.producto && (
        <section className="lindet-stock">
          {/* El proveedor y el tipo de mercadería acompañan al título, contra el margen derecho:
              son la ficha del producto, no un dato de stock más. */}
          <div className="lindet-hrow">
            <h4 className="lindet-h">
              <i className="fas fa-cube lindet-h-ic" /> Stock
            </h4>
            <ProveedorLinea producto={fila.producto} />
          </div>
          <StockPanel producto={fila.producto} cantidad={fila.cantidad} conProveedor={false} />
        </section>
      )}
    </div>
  )
}
