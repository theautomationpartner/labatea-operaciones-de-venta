import { COMISIONISTAS, DESTINOS, NRO_REMITO } from '@/data/mock'
import { useApp } from '@/state/hooks'

/** Visor del remito que recibiría el cliente. Maqueta: no genera el archivo. */
export function RemitoPdf() {
  const { cliente, fechaEmision, remito } = useApp()
  const { envio } = remito
  const destino = DESTINOS.find((d) => d.id === envio.destinoId)
  const comisionista = COMISIONISTAS.find((c) => c.id === envio.comisionistaId)

  return (
    <div className="pdfv">
      <div className="pdftool">
        <div>
          <span style={{ fontSize: 18 }}>≡</span>
          <span>1 / 1</span>
        </div>
        <div>
          <span>−</span>
          <span>100%</span>
          <span>+</span>
        </div>
        <div>
          <span>⬇</span>
          <span>⋮</span>
        </div>
      </div>

      <div className="pdfscroll">
        <div className="pdfdoc">
          <div className="pdfh">
            <div className="pdfh-left">
              <div className="pdflogo" />
              <div>
                <h2>{cliente?.name ?? '--'}</h2>
                <div className="xs">CUIT: {cliente?.cuit ?? '--'}</div>
                <div className="xs">{cliente?.addr ?? '--'}</div>
              </div>
            </div>
            <div className="pdfh-right">
              <h2>REMITO</h2>
              <div className="xs">N°: {NRO_REMITO}</div>
              <div className="xs">Fecha: {fechaEmision}</div>
              <div className="xs">Emisión: {remito.tipoEmision ?? '--'}</div>
            </div>
          </div>

          <div className="pdf-meta">
            <div>
              <div className="pdf-meta-t">Destinatario</div>
              <div className="xs">{cliente?.name ?? '--'}</div>
              <div className="xs">Condición: {cliente?.status ?? '--'}</div>
            </div>
            <div style={{ width: 250 }}>
              <div className="pdf-meta-t">Entrega</div>
              {envio.responsable === 'LA_BATEA' ? (
                <>
                  <div className="xs">La Batea — {destino?.nombre ?? '—'}</div>
                  <div className="xs">{destino?.direccion ?? cliente?.addr ?? '--'}</div>
                  {envio.cot && <div className="xs">COT: {envio.cot}</div>}
                </>
              ) : envio.responsable === 'COMISIONISTA' ? (
                <>
                  <div className="xs">Comisionista</div>
                  <div className="xs">{comisionista?.name ?? '—'}</div>
                </>
              ) : envio.responsable === 'CLIENTE' ? (
                <>
                  <div className="xs">Cliente responsable</div>
                  <div className="xs">{envio.responsableNombre || '—'}</div>
                </>
              ) : (
                <div className="xs">—</div>
              )}
            </div>
          </div>

          <table className="pdftab">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th className="ta-c">Cantidad</th>
                <th className="ta-c">U. medida</th>
              </tr>
            </thead>
            <tbody>
              {remito.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="pdftab-empty">
                    Sin productos para remitar.
                  </td>
                </tr>
              ) : (
                remito.items.map((it) => (
                  <tr key={it.uid}>
                    <td>{it.codigo}</td>
                    <td>{it.nombre}</td>
                    <td className="ta-c">{it.cantidad}</td>
                    <td className="ta-c">{it.um}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* El remito no lleva importes: es un documento de cantidades. */}
          <div className="pdf-remito-nota">
            Documento no válido como factura. Detalla las cantidades entregadas.
          </div>

          {remito.observaciones && (
            <div className="xs" style={{ marginTop: 16 }}>
              Observaciones: {remito.observaciones}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
