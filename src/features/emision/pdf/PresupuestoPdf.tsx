import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { descuentoUnitario } from '@/lib/descuentos'
import { pctDec, round2 } from '@/lib/format'
import { esUsd, totalDe, totalesPresupuesto } from '@/lib/presupuestoDoc'
import type { LineaPresupuesto } from '@/types'
import { alto, px } from './comun'

/** Lo que el documento necesita saber. Sale del estado de la app al emitir. */
export interface DatosPresupuestoPdf {
  /** ID del presupuesto ("PRESUP-009"). */
  numero: string
  /** Nombre del archivo, sin extensión: también es el título del documento (el de la pestaña). */
  nombre: string
  cliente: { name: string; cuit: string; addr: string }
  /** dd/MM/yyyy, como los muestra el resumen. */
  fechaEmision: string
  fechaVencimiento: string
  lineas: LineaPresupuesto[]
  /**
   * Leyenda de formas de pago y descuentos, con los % de la configuración del sistema. `null` o
   * ausente = el vendedor no tildó "¿Desea aplicar la leyenda de descuentos por forma de pago?" en la
   * etapa de productos, y el PDF sale sin ella.
   */
  leyendaPagos?: LeyendaPagos | null
  /**
   * Logo de la empresa. Es opcional porque en el navegador se pasa la ruta pública y en los tests
   * (Node) no hay de dónde bajarla.
   */
  logoSrc?: string
}

/** Los % de descuento por forma de pago que muestra la leyenda. */
export interface LeyendaPagos {
  /** Efectivo, transferencia o cheque al día. */
  contado: number
  debito: number
  credito: number
}

/*
 * La plantilla es el HTML del presupuesto que usaba el escenario de Make.com: misma estructura,
 * mismos colores y mismas medidas. El HTML mide en px CSS y react-pdf en puntos; `px()` hace la
 * misma conversión que el navegador al imprimir (96 px = 72 pt, ver `comun.ts`), así cada tamaño
 * sale igual.
 *
 * Diferencias forzadas por react-pdf:
 *   · Helvetica es la fuente estándar del PDF (la que el HTML usa de respaldo), y no tiene peso 500:
 *     los importes de la tabla van en peso normal.
 *   · El vencimiento del pie es un recuadro con borde y relleno, que un texto en línea no admite:
 *     la frase y el recuadro se alinean en una fila.
 */

const VIOLETA = '#5c4b8e'
const VERDE = '#00a859'

/* Importes: miles con punto y coma decimal, sin símbolo (el símbolo lo pone la plantilla). */
const AR = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number): string => AR.format(round2(n))

/** Precio unitario ya bonificado: el que multiplicado por la cantidad da el Total de la fila. */
const precioUnitDe = (l: LineaPresupuesto): number =>
  round2(descuentoUnitario(l.producto.precio, l.descuento).precioFinal)

/** Símbolo de la fila según la moneda del producto: los dólares con el mismo `U$S` del total. */
const simbolo = (l: LineaPresupuesto): string => (esUsd(l) ? 'U$S ' : '$')

const s = StyleSheet.create({
  // @page { margin: 10mm 15mm 10mm 15mm } · body { font-size: 11px; color: #333 }
  page: {
    paddingTop: '10mm',
    paddingRight: '15mm',
    paddingBottom: '10mm',
    paddingLeft: '15mm',
    fontFamily: 'Helvetica',
    fontSize: px(11),
    color: '#333',
    backgroundColor: '#fff',
  },
  bold: { fontFamily: 'Helvetica-Bold' },

  // .header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: px(2),
    borderBottomColor: VIOLETA,
    paddingBottom: px(8),
    marginBottom: px(12),
  },
  headerCelda: { flex: 1 },
  // .logo img { max-width: 190px; height: auto } — el logo del documento mide 315 × 110.
  logo: { width: px(190), height: px((190 * 110) / 315) },
  // .empresa-info
  empresaInfo: { flex: 1, textAlign: 'right', fontSize: px(10), lineHeight: alto(10, 1.4), color: '#555' },
  // El nombre va en peso normal, como en el documento de referencia (no en la negrita del <h2>).
  empresaNombre: {
    color: '#333',
    fontSize: px(13),
    marginBottom: px(3),
  },

  // .titulo-seccion
  tituloSeccion: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: px(12),
  },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: px(24), color: '#222', letterSpacing: px(1) },
  noValido: { fontSize: px(9), color: '#888' },
  // .fechas-box
  fechasBox: { flex: 1, textAlign: 'right', fontSize: px(11) },
  strong: { fontFamily: 'Helvetica-Bold', color: '#000' },

  // .cliente-box
  clienteBox: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderLeftWidth: px(4),
    borderLeftColor: VERDE,
    paddingVertical: px(8),
    paddingHorizontal: px(15),
    marginBottom: px(15),
  },
  clienteCol: { width: '50%' },
  clienteLinea: { lineHeight: alto(11, 1.5) },
  clienteStrong: { fontFamily: 'Helvetica-Bold' },

  // table.productos
  tabla: { marginBottom: px(15) },
  thFila: {
    flexDirection: 'row',
    backgroundColor: '#f1f1f1',
    borderBottomWidth: px(2),
    borderBottomColor: '#ccc',
  },
  th: {
    fontFamily: 'Helvetica-Bold',
    color: '#333',
    fontSize: px(10),
    textTransform: 'uppercase',
    paddingVertical: px(6),
    paddingHorizontal: px(5),
    textAlign: 'center',
  },
  tdFila: { flexDirection: 'row', borderBottomWidth: px(1), borderBottomColor: '#eee' },
  td: {
    paddingVertical: px(5),
    paddingHorizontal: px(5),
    textAlign: 'center',
    color: '#444',
  },
  // Anchos de columna: la tabla del HTML es automática; el producto se lleva el resto.
  cProd: { flex: 1, textAlign: 'left' },
  cCant: { width: px(70) },
  cNum: { width: px(120), textAlign: 'right' },

  // .totales-container / .totales-box
  totalesBox: { alignSelf: 'flex-end', width: px(280), marginBottom: px(20) },
  totalesFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: px(4),
    fontSize: px(13),
  },
  // .total-pesos
  totalPesos: {
    borderTopWidth: px(2),
    borderTopColor: VIOLETA,
    fontFamily: 'Helvetica-Bold',
    color: '#000',
    paddingTop: px(6),
    marginTop: px(4),
    fontSize: px(15),
  },
  // .total-dolares
  totalDolares: { fontFamily: 'Helvetica-Bold', color: VERDE, paddingTop: px(4), fontSize: px(15) },
  // .leyenda-iva
  leyendaIva: {
    textAlign: 'right',
    fontSize: px(10),
    color: '#666',
    marginTop: px(4),
    fontFamily: 'Helvetica-Oblique',
  },

  // .footer { line-height: 1.5 }
  footer: {
    alignItems: 'center',
    paddingTop: px(10),
    borderTopWidth: px(1),
    borderTopColor: '#eee',
    color: '#555',
  },
  importante: {
    fontSize: px(10),
    fontFamily: 'Helvetica-Bold',
    color: '#333',
    marginBottom: px(8),
    textAlign: 'center',
    lineHeight: alto(10, 1.5),
  },
  // .texto-validez { margin-bottom: 12px }
  validez: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: px(12) },
  textoValidez: { fontSize: px(13), color: '#222', lineHeight: alto(13, 1.5) },
  // .vencimiento
  vencimiento: {
    color: '#d00000',
    fontSize: px(16),
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#fff5f5',
    borderWidth: px(1),
    borderColor: '#ffd6d6',
    paddingVertical: px(2),
    paddingHorizontal: px(6),
    borderRadius: px(4),
    marginLeft: px(6),
    // Hereda el line-height 1.5 del footer, igual que el inline-block del HTML.
    lineHeight: alto(16, 1.5),
  },

  // .condiciones-pago — ocupa el ancho del pie y alinea a la izquierda, aunque el pie va centrado.
  condiciones: {
    alignSelf: 'stretch',
    backgroundColor: '#fbfbfb',
    borderWidth: px(1),
    borderColor: '#eaeaea',
    borderRadius: px(5),
    paddingVertical: px(10),
    paddingHorizontal: px(15),
    fontSize: px(9),
    color: '#444',
    textAlign: 'left',
  },
  // .condiciones-pago h3
  condicionesTitulo: {
    fontFamily: 'Helvetica-Bold',
    fontSize: px(10),
    color: '#222',
    marginBottom: px(8),
    textTransform: 'uppercase',
    borderBottomWidth: px(1),
    borderBottomStyle: 'dashed',
    borderBottomColor: '#ccc',
    paddingBottom: px(4),
  },
  // .aclaracion-iva
  aclaracionIva: { color: '#d00000', marginBottom: px(8), fontSize: px(10), lineHeight: alto(10, 1.5) },
  // .condiciones-pago li { display: flex; align-items: baseline; margin-bottom: 6px }
  pago: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: px(6) },
  // li::before { content: "•"; color: #5c4b8e; font-size: 14px; margin-right: 6px; line-height: 1 }
  vineta: {
    fontFamily: 'Helvetica-Bold',
    color: VIOLETA,
    fontSize: px(14),
    marginRight: px(6),
    lineHeight: 1,
  },
  pagoTexto: { lineHeight: alto(9, 1.5) },
  // .pago-titulo
  pagoTitulo: { fontFamily: 'Helvetica-Bold', color: '#000', fontSize: px(9.5) },
  // .desc-highlight
  descuento: {
    backgroundColor: '#e6f7ef',
    color: '#008a49',
    fontFamily: 'Helvetica-Bold',
    paddingVertical: px(1),
    paddingHorizontal: px(4),
    borderRadius: px(3),
    borderWidth: px(1),
    borderColor: '#b3e6ce',
    marginLeft: px(4),
    lineHeight: alto(9, 1.3),
  },
  // .condiciones-pago p
  condicionesNota: {
    /* En el HTML, el margin-bottom de 6px del último <li> y este margin-top de 8px colapsan en 8px;
       react-pdf no colapsa márgenes y los sumaría, así que acá va la diferencia. */
    marginTop: px(8 - 6),
    color: '#666',
    fontFamily: 'Helvetica-Oblique',
    fontSize: px(8.5),
    borderTopWidth: px(1),
    borderTopStyle: 'dashed',
    borderTopColor: '#ccc',
    paddingTop: px(6),
    lineHeight: alto(8.5, 1.5),
  },
})

/** Una forma de pago de la leyenda: viñeta, nombre en negrita, aclaración y el descuento resaltado. */
function FormaPagoLeyenda({
  titulo,
  aclaracion,
  descuento,
  sinDescuento,
}: {
  titulo: string
  aclaracion?: string
  descuento?: number
  /** Texto en lugar del recuadro de descuento (la cuenta corriente va a precio de lista). */
  sinDescuento?: string
}) {
  return (
    <View style={s.pago}>
      <Text style={s.vineta}>•</Text>
      <Text style={s.pagoTexto}>
        <Text style={s.pagoTitulo}>{titulo}</Text>
        {aclaracion ? ` ${aclaracion}` : ''}
        {sinDescuento ? ` ${sinDescuento}` : ''}
      </Text>
      {descuento != null && <Text style={s.descuento}>{`${pctDec(descuento)} de descuento`}</Text>}
    </View>
  )
}

/**
 * "Formas de pago y descuentos", al pie del presupuesto. Sale sólo si el vendedor tildó la leyenda
 * en la etapa de productos. Los % son los de la configuración del sistema: los mismos con los que
 * después se factura cada forma de pago.
 */
function CondicionesPago({ contado, debito, credito }: LeyendaPagos) {
  return (
    <View style={s.condiciones} wrap={false}>
      <Text style={s.condicionesTitulo}>Formas de pago y descuentos</Text>
      <Text style={s.aclaracionIva}>
        Todos los valores expresados en este documento son <Text style={s.bold}>MÁS IVA</Text>.
      </Text>
      <FormaPagoLeyenda
        titulo="CONTADO"
        aclaracion="(Efectivo, Transferencia o Cheque al día):"
        descuento={contado}
      />
      <FormaPagoLeyenda titulo="TARJETA DE DÉBITO:" descuento={debito} />
      <FormaPagoLeyenda titulo="TARJETA DE CRÉDITO:" descuento={credito} />
      <FormaPagoLeyenda
        titulo="CUENTA CORRIENTE"
        aclaracion="(Vto. a 30 días):"
        sinDescuento="Precio de lista del presupuesto (sin descuento)."
      />
      <Text style={s.condicionesNota}>
        Los descuentos mencionados se aplican sobre el total del presupuesto y no son acumulables entre
        sí.
      </Text>
    </View>
  )
}

/**
 * El PDF del presupuesto, con la plantilla del escenario de Make.com: encabezado con el logo y los
 * datos de La Batea, título con número y fecha, recuadro del cliente, tabla de productos, totales
 * en pesos y en dólares, y el pie con la validez.
 *
 * Los importes salen de las mismas funciones que la card "Presupuesto a generar"
 * (`lib/presupuestoDoc`), así el documento dice lo mismo que vio el vendedor. Es BIMONETARIO: los
 * dólares no se convierten ni se suman a los pesos.
 */
export function PresupuestoPdf({
  numero,
  nombre,
  cliente,
  fechaEmision,
  fechaVencimiento,
  lineas,
  leyendaPagos,
  logoSrc,
}: DatosPresupuestoPdf) {
  const { totalPesos, totalUsd } = totalesPresupuesto(lineas)

  return (
    <Document title={nombre} author="La Batea S.A." subject={`Presupuesto ${numero}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerCelda}>{logoSrc ? <Image style={s.logo} src={logoSrc} /> : null}</View>
          <View style={s.empresaInfo}>
            <Text style={s.empresaNombre}>La Batea S.A.</Text>
            <Text>Macaya 1273 - 7000 TANDIL</Text>
            <Text>Tel. 0249-4442646</Text>
            <Text>Email: info@labatea.biz</Text>
          </View>
        </View>

        <View style={s.tituloSeccion}>
          <View style={s.headerCelda}>
            <Text style={s.h1}>PRESUPUESTO</Text>
            <Text style={s.noValido}>Documento no válido como factura</Text>
          </View>
          <View style={s.fechasBox}>
            <Text>
              <Text style={s.strong}>Nº de Presupuesto:</Text> {numero}
            </Text>
            <Text>
              <Text style={s.strong}>Fecha de Emisión:</Text> {fechaEmision}
            </Text>
          </View>
        </View>

        <View style={s.clienteBox}>
          <View style={s.clienteCol}>
            <Text style={s.clienteLinea}>
              <Text style={s.clienteStrong}>Cliente:</Text> {cliente.name}
            </Text>
            <Text style={s.clienteLinea}>
              <Text style={s.clienteStrong}>Dirección:</Text> {cliente.addr}
            </Text>
          </View>
          <View style={s.clienteCol}>
            <Text style={s.clienteLinea}>
              <Text style={s.clienteStrong}>CUIT:</Text> {cliente.cuit}
            </Text>
          </View>
        </View>

        <View style={s.tabla}>
          {/* Como el <thead> al imprimir: se repite en cada página cuando la tabla no entra en una. */}
          <View style={s.thFila} fixed>
            <Text style={[s.th, s.cProd]}>Producto</Text>
            <Text style={[s.th, s.cCant]}>Cant.</Text>
            <Text style={[s.th, s.cNum]}>Precio Unit.</Text>
            <Text style={[s.th, s.cNum]}>Total</Text>
          </View>
          {lineas.map((l) => (
            // tr { page-break-inside: avoid }
            <View key={l.id} style={s.tdFila} wrap={false}>
              <Text style={[s.td, s.cProd]}>{l.producto.nombre}</Text>
              <Text style={[s.td, s.cCant]}>{String(l.cantidad)}</Text>
              <Text style={[s.td, s.cNum]}>{`${simbolo(l)}${num(precioUnitDe(l))}`}</Text>
              <Text style={[s.td, s.cNum]}>{`${simbolo(l)}${num(totalDe(l))}`}</Text>
            </View>
          ))}
        </View>

        {/* .totales-container { page-break-inside: avoid } */}
        <View style={s.totalesBox} wrap={false}>
          <View style={[s.totalesFila, s.totalPesos]}>
            <Text>TOTAL PESOS:</Text>
            <Text>{`$ ${num(totalPesos)}`}</Text>
          </View>
          <View style={[s.totalesFila, s.totalDolares]}>
            <Text>TOTAL DÓLARES:</Text>
            <Text>{`U$S ${num(totalUsd)}`}</Text>
          </View>
          <Text style={s.leyendaIva}>VALORES + IVA</Text>
        </View>

        <View style={s.footer} wrap={false}>
          <Text style={s.importante}>
            LOS IMPORTES EN DÓLARES SERÁN CONVERTIDOS A PESOS AL CAMBIO AL MOMENTO DE FACTURAR.
          </Text>
          <View style={s.validez}>
            <Text style={s.textoValidez}>Este presupuesto tiene validez hasta el día</Text>
            <Text style={s.vencimiento}>{fechaVencimiento}</Text>
          </View>
          {leyendaPagos && <CondicionesPago {...leyendaPagos} />}
        </View>
      </Page>
    </Document>
  )
}
