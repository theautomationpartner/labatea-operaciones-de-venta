import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { alto, px } from './comun'

/** Una línea de la proforma, con los importes ya formateados. */
export interface LineaProformaPdf {
  codigo: string
  producto: string
  cantidad: string
  um: string
  unitario: string
  impBonif: string
  subtotal: string
}

/** Lo que necesita el PDF de la proforma. Sale del estado de la venta al emitir. */
export interface DatosProformaPdf {
  /** "PROFORMA-037" (anticipado). El template no lo muestra: va en el título del documento. */
  numero: string
  /** Nombre del archivo, sin extensión: también es el título del documento. */
  nombre: string
  /** dd/MM/yyyy. */
  fechaEmision: string
  cliente: {
    /** Código del cliente ("7000"). */
    codigo: string
    /** Razón social, sin el código. */
    razonSocial: string
    addr: string
    condicionIva: string
    cuit: string
  }
  vendedor: string
  /** "Posterior" / "Anterior" / "Simultánea". */
  tipoEntrega: string
  /** Condición de venta ("Contado"). */
  condicion: string
  lineas: LineaProformaPdf[]
  /** Totales ya formateados. */
  gravado: string
  iva: string
  percIb: string
  total: string
  /** Tasa de cambio del dólar de la operación, formateada. */
  tipoCambio: string
}

/*
 * Plantilla: el HTML de la "Factura Proforma - La Batea" que usaba el escenario de Make.com. Mismas
 * medidas (px → pt con `px()`), marcos y tipografías: Arial → Helvetica, y los importes y la tabla en
 * "Courier New" negrita → Courier-Bold, las dos estándar del PDF. Los `&nbsp;` del template se
 * mantienen como espacios duros.
 */

/** `&nbsp;` repetido: los espacios de alineación del template. */
const nb = (n: number): string => ' '.repeat(n)

const s = StyleSheet.create({
  // @page { margin: 8mm 10mm 10mm 10mm } · body { font-size: 11px; color: #000 }
  page: {
    paddingTop: '8mm',
    paddingRight: '10mm',
    paddingBottom: '10mm',
    paddingLeft: '10mm',
    fontFamily: 'Helvetica',
    fontSize: px(11),
    color: '#000',
    backgroundColor: '#fff',
  },
  bold: { fontFamily: 'Helvetica-Bold' },
  mono: { fontFamily: 'Courier-Bold' },

  // .container
  container: { borderWidth: px(1), borderColor: '#000' },

  // .header-non-fiscal
  noFiscal: {
    textAlign: 'center',
    fontSize: px(11),
    fontFamily: 'Helvetica-Bold',
    borderBottomWidth: px(1),
    borderBottomColor: '#000',
    paddingVertical: px(3),
    letterSpacing: px(0.5),
    textTransform: 'uppercase',
    backgroundColor: '#f0f0f0',
  },

  // .header-table
  header: { flexDirection: 'row', borderBottomWidth: px(1), borderBottomColor: '#000' },
  colLeft: { width: '45%', padding: px(8), fontSize: px(10) },
  linea10: { lineHeight: alto(10, 1.4) },
  companyTitle: { fontSize: px(18), fontFamily: 'Helvetica-Bold', marginBottom: px(8) },
  colCenter: { width: '10%', padding: px(8), alignItems: 'center', justifyContent: 'center' },
  letterBox: {
    width: px(48),
    borderWidth: px(2),
    borderColor: '#000',
    paddingVertical: px(3),
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  letter: { fontSize: px(32), fontFamily: 'Helvetica-Bold', lineHeight: 1 },
  code: { fontSize: px(7), fontFamily: 'Helvetica-Bold', marginTop: px(2) },
  colRight: { width: '45%', padding: px(8), fontSize: px(10) },
  docTitle: { fontSize: px(18), fontFamily: 'Helvetica-Bold', letterSpacing: px(1), marginBottom: px(6) },

  // .box-cliente
  cliente: { flexDirection: 'row', borderBottomWidth: px(1), borderBottomColor: '#000', padding: px(8) },
  clienteCol1: { width: '60%' },
  clienteCol2: { width: '40%' },
  linea105: { fontSize: px(10.5), lineHeight: alto(10.5, 1.5) },
  vendedor: { color: '#555' },

  // .box-condicion
  condicion: {
    borderBottomWidth: px(1),
    borderBottomColor: '#000',
    paddingVertical: px(6),
    paddingHorizontal: px(8),
    fontSize: px(10.5),
  },

  // .tabla-container { min-height: 380px }
  tablaMarco: { minHeight: px(380), borderBottomWidth: px(1), borderBottomColor: '#000' },
  thFila: { flexDirection: 'row', backgroundColor: '#ccc', borderBottomWidth: px(1), borderBottomColor: '#000' },
  th: { fontSize: px(10), fontFamily: 'Helvetica-Bold', padding: px(5), textAlign: 'left' },
  tdFila: { flexDirection: 'row' },
  td: { fontSize: px(10), fontFamily: 'Courier-Bold', paddingVertical: px(6), paddingHorizontal: px(5) },
  num: { textAlign: 'right' },
  c8: { width: '8%' },
  c10: { width: '10%' },
  c42: { width: '42%' },

  // .obs-totales-container
  obsTotales: { flexDirection: 'row' },
  // .obs-left
  obs: { width: '65%', padding: px(10), fontSize: px(10), fontFamily: 'Courier-Bold' },
  obsLinea: { lineHeight: alto(10, 1.4) },
  cambio: { textAlign: 'right', paddingRight: px(20) },
  // .totales-right
  totales: {
    width: '35%',
    borderLeftWidth: px(1),
    borderLeftColor: '#000',
    paddingVertical: px(8),
    paddingHorizontal: px(10),
    fontSize: px(11),
  },
  totFila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(3) },
  totValor: { fontFamily: 'Courier-Bold', textAlign: 'right' },
  // .total-final
  totFinal: { fontSize: px(13), marginTop: px(5) },
  // <br> entre IVA y la percepción.
  salto: { height: alto(11, 1.2) },
})

/** Una fila de totales: la etiqueta en negrita a la izquierda y el importe en Courier a la derecha. */
function Total({
  etiqueta,
  detalle,
  valor,
  final = false,
}: {
  etiqueta: string
  /** Lo que sigue a la etiqueta, sin negrita (el "21.00 %" del IVA). */
  detalle?: string
  valor: string
  final?: boolean
}) {
  return (
    <View style={[s.totFila, final ? s.totFinal : {}]}>
      <Text>
        <Text style={s.bold}>{etiqueta}</Text>
        {detalle ?? ''}
      </Text>
      <Text style={s.totValor}>{valor}</Text>
    </View>
  )
}

/**
 * Factura Proforma: documento no fiscal (letra X, código 901) de la venta CONTADO. Encabezado con los
 * datos fiscales de La Batea, el cliente con su vendedor, la condición de venta, los productos con sus
 * importes y los totales con el IVA.
 */
export function ProformaPdf({
  numero,
  nombre,
  fechaEmision,
  cliente,
  vendedor,
  tipoEntrega,
  condicion,
  lineas,
  gravado,
  iva,
  percIb,
  total,
  tipoCambio,
}: DatosProformaPdf) {
  return (
    <Document title={nombre} author="La Batea S.A." subject={`Factura proforma ${numero}`}>
      <Page size="A4" style={s.page}>
        <View style={s.container}>
          <Text style={s.noFiscal}>Documento No Válido como Factura</Text>

          <View style={s.header}>
            <View style={s.colLeft}>
              <Text style={s.companyTitle}>La Batea S.A.</Text>
              <Text style={s.linea10}>
                <Text style={s.bold}>Domicilio Comercial:</Text> Macaya 1273 - 7000 TANDIL
              </Text>
              <Text style={[s.linea10, s.bold]}>Tel.0249-4442646 Email: info@labatea.biz</Text>
              <Text style={[s.linea10, s.bold]}>Condición frente al IVA: Responsable Inscripto</Text>
            </View>
            <View style={s.colCenter}>
              <View style={s.letterBox}>
                <Text style={s.letter}>X</Text>
                <Text style={s.code}>COD. 901</Text>
              </View>
            </View>
            <View style={s.colRight}>
              <Text style={s.docTitle}>FACTURA PROFORMA</Text>
              <Text style={s.linea10}>
                <Text style={s.bold}>Punto de Venta:</Text> 0099
              </Text>
              <Text style={s.linea10}>
                <Text style={s.bold}>Fecha de Emisión:</Text> {fechaEmision}
              </Text>
              <Text style={s.linea10}>
                <Text style={s.bold}>CUIT:</Text> 30-70906788-1
              </Text>
              <Text style={s.linea10}>
                <Text style={s.bold}>Ingresos Brutos:</Text> 30-70906788-1
              </Text>
              <Text style={s.linea10}>
                <Text style={s.bold}>Fecha de Inicio de Actividades:</Text> 12/01/2005
              </Text>
            </View>
          </View>

          <View style={s.cliente}>
            <View style={s.clienteCol1}>
              <Text style={s.linea105}>
                <Text style={s.bold}>Señor / es:</Text>
                {` ${nb(6)} ${cliente.codigo} ${nb(2)} ${cliente.razonSocial}`}
              </Text>
              <Text style={s.linea105}>
                <Text style={s.bold}>Domicilio:</Text>
                {` ${nb(9)} ${cliente.addr}`}
              </Text>
              <Text style={s.linea105}>
                <Text style={s.bold}>Condición frente al IVA:</Text> {cliente.condicionIva}
              </Text>
              <Text style={s.linea105}>
                <Text style={s.bold}>Entrega:</Text>
                {` ${nb(12)} ${tipoEntrega}`}
              </Text>
            </View>
            <View style={s.clienteCol2}>
              <Text style={[s.linea105, s.vendedor]}>{`(${vendedor})`}</Text>
              {/* <br><br>: un renglón en blanco antes del CUIT. */}
              <Text style={s.linea105}> </Text>
              <Text style={s.linea105}>
                <Text style={s.bold}>CUIT:</Text> {cliente.cuit}
              </Text>
            </View>
          </View>

          <View style={s.condicion}>
            <Text>
              <Text style={s.bold}>Condición:</Text>
              {` ${nb(8)} ${condicion}`}
            </Text>
          </View>

          <View style={s.tablaMarco}>
            {/* Como el <thead> al imprimir: se repite en cada página. */}
            <View style={s.thFila} fixed>
              <Text style={[s.th, s.c10]}>Codigo</Text>
              <Text style={[s.th, s.c42]}>Producto / Servicio</Text>
              <Text style={[s.th, s.c10, s.num]}>Cantidad</Text>
              <Text style={[s.th, s.c10]}>U.Medida</Text>
              <Text style={[s.th, s.c10, s.num]}>Unitario</Text>
              <Text style={[s.th, s.c8, s.num]}>Imp.Bonif.</Text>
              <Text style={[s.th, s.c10, s.num]}>Subtotal</Text>
            </View>
            {lineas.map((l, i) => (
              <View key={i} style={s.tdFila} wrap={false}>
                <Text style={[s.td, s.c10]}>{l.codigo}</Text>
                <Text style={[s.td, s.c42]}>{l.producto}</Text>
                <Text style={[s.td, s.c10, s.num]}>{l.cantidad}</Text>
                <Text style={[s.td, s.c10]}>{l.um}</Text>
                <Text style={[s.td, s.c10, s.num]}>{l.unitario}</Text>
                <Text style={[s.td, s.c8, s.num]}>{l.impBonif}</Text>
                <Text style={[s.td, s.c10, s.num]}>{l.subtotal}</Text>
              </View>
            ))}
          </View>

          <View style={s.obsTotales} wrap={false}>
            <View style={s.obs}>
              <Text style={s.obsLinea}>Recordamos que se encuentra vigente el descuento</Text>
              <Text style={s.obsLinea}>en factura del 6% por pago anticipado o cdo.</Text>
              <Text style={s.obsLinea}> </Text>
              <Text style={[s.obsLinea, s.cambio]}>{`(Cambio: ${tipoCambio})`}</Text>
              <Text style={s.obsLinea}>
                {`PAGO CHEQUE ELECTRONICO O TRANSFERENCIA BANCARIA ${nb(2)} CBU 1910136355013600290214`}
              </Text>
            </View>
            <View style={s.totales}>
              <Total etiqueta="Subtotal: $" valor={gravado} />
              <Total etiqueta="Exento: $" valor="0,00" />
              <Total etiqueta="Gravado: $" valor={gravado} />
              <Total etiqueta="IVA:" detalle={` ${nb(4)} 21.00 %`} valor={iva} />
              <View style={s.salto} />
              <Total etiqueta="Perc. Is. Bs.: $" valor={percIb} />
              <Total etiqueta="TOTAL: $" valor={total} final />
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
