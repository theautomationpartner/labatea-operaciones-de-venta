import { importeATexto, pctDec } from '@/lib/format'

interface FichaCostoForzadaProps {
  /** Precio de costo ORIGINAL del producto ("Costo Final" del maestro). Sin él, no se renderiza nada. */
  precioCosto?: number
  /** Símbolo de la moneda para el input del costo ("$" o "U$"), igual que el del Precio Unitario. */
  prefijo: string
  /** % de rentabilidad forzada aplicado. Junto con `nuevoPrecioCosto`, agrega las filas de contraste. */
  rentabForzada?: number
  /** Nuevo precio de costo derivado (Precio Unit × (1 − %/100)). */
  nuevoPrecioCosto?: number
  /** Formato de importes: pesos o dólares, para las filas de la rentabilidad forzada. */
  fmt: (n: number) => string
}

/**
 * Ficha de costo de un producto: el "Precio de Costo" original del maestro —mostrado como un input
 * NO editable, con el mismo estilo que el Precio Unitario— y, cuando la rentabilidad forzada está
 * activa sobre un producto que la acepta, el % forzado y el "Nuevo Precio de Costo" debajo, para el
 * contraste. Se ubica encima del precio unitario.
 */
export function FichaCostoForzada({
  precioCosto,
  prefijo,
  rentabForzada,
  nuevoPrecioCosto,
  fmt,
}: FichaCostoForzadaProps) {
  if (precioCosto == null) return null
  const forzada = rentabForzada != null && nuevoPrecioCosto != null
  return (
    <div className="costo-ficha">
      <div className="costo-row">
        <span className="costo-lbl">Precio de Costo</span>
        {/* Input de sólo lectura (mismo cuerpo que el Precio Unitario), no editable. */}
        <span className="pbox pbox--ro">
          <span className="pbox-pre">{prefijo}</span>
          <input
            type="text"
            value={importeATexto(precioCosto)}
            readOnly
            disabled
            tabIndex={-1}
            aria-label="Precio de costo (no editable)"
          />
        </span>
      </div>
      {forzada && (
        <>
          <div className="costo-row costo-row--forzada">
            <span className="costo-lbl">Rentab. Forzada</span>
            <span className="costo-val">{pctDec(rentabForzada)}</span>
          </div>
          <div className="costo-row costo-row--forzada">
            <span className="costo-lbl">Nuevo Precio de Costo</span>
            <span className="costo-val">{fmt(nuevoPrecioCosto)}</span>
          </div>
        </>
      )}
    </div>
  )
}
