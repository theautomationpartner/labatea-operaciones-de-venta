/** Métrica destacada del cobro: icono en pastilla, rótulo y cifra. Se usa en la cabecera del
 *  cierre y debajo de la tabla de cobros registrados. */
export function MetricaCobro({
  icono,
  tono,
  rotulo,
  valor,
}: {
  icono: string
  tono: 'azul' | 'verde' | 'rojo'
  rotulo: string
  valor: string
}) {
  return (
    <div className="cobro-cab-met">
      <span className={`cobro-cab-ic cobro-cab-ic--${tono}`}>
        <i className={`fas ${icono}`} />
      </span>
      <div className="cobro-cab-campo">
        <span className="cobro-cab-lbl cobro-cab-lbl--met">{rotulo}</span>
        <span className={`cobro-cab-num cobro-cab-num--${tono}`}>{valor}</span>
      </div>
    </div>
  )
}
