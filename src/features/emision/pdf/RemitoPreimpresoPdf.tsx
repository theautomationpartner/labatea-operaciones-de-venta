import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { alto, px } from './comun'
import type { DatosRemitoPdf } from './datosRemito'

/*
 * Plantilla: el HTML del "Remito Preimpreso - La Batea" que usaba el escenario de Make.com. Es la
 * réplica del formulario preimpreso en papel: recuadros de borde negro redondeado, la letra R, la
 * zona de productos de alto fijo, la firma y el pie de la imprenta con el CAI.
 *
 * Mismas medidas (px → pt con `px()`). Arial se reemplaza por Helvetica (la estándar del PDF, que el
 * HTML usa de respaldo) y la "Times New Roman" del nombre sin logo, por Times.
 */

const s = StyleSheet.create({
  // @page { margin: 8mm 12mm 10mm 12mm } · body { font-size: 11px; color: #000 }
  page: {
    paddingTop: '8mm',
    paddingRight: '12mm',
    paddingBottom: '10mm',
    paddingLeft: '12mm',
    fontFamily: 'Helvetica',
    fontSize: px(11),
    color: '#000',
    backgroundColor: '#fff',
  },
  bold: { fontFamily: 'Helvetica-Bold' },

  // .aviso-top
  avisoTop: { textAlign: 'center', fontSize: px(10), fontFamily: 'Helvetica-Bold', marginBottom: px(2) },

  // Recuadro de borde negro redondeado (header, cliente, tabla, observaciones, imprenta).
  marco: { borderWidth: px(1), borderColor: '#000', borderRadius: px(10) },

  // .header
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: px(10), marginBottom: px(10) },
  headerLeft: { width: '42%', fontSize: px(10), paddingLeft: px(5) },
  izqLinea: { lineHeight: alto(10, 1.35) },
  // <img style="max-width: 180px; max-height: 45px"> — el logo (315 × 110) lo limita el alto.
  logo: { width: px((45 * 315) / 110), height: px(45), marginBottom: px(3) },
  // .logo-text: sin logo, el nombre en cursiva negrita.
  logoTexto: { fontFamily: 'Times-BoldItalic', fontSize: px(20), marginBottom: px(3) },

  // .afip-box
  afipBox: { width: '16%', alignItems: 'center' },
  letra: {
    width: px(45),
    height: px(45),
    borderWidth: px(2),
    borderColor: '#000',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: px(2),
  },
  letraTexto: { fontFamily: 'Helvetica-Bold', fontSize: px(32) },
  codigo: { fontFamily: 'Helvetica-Bold', fontSize: px(9) },

  // .header-right
  headerRight: { width: '42%', textAlign: 'right', fontSize: px(10), paddingRight: px(5) },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: px(20), letterSpacing: px(1), marginBottom: px(4) },
  derLinea: { lineHeight: alto(10, 1.35) },

  // .cliente-container
  cliente: { flexDirection: 'row', paddingVertical: px(8), paddingHorizontal: px(15), marginBottom: px(10) },
  clienteIzq: { width: '60%' },
  clienteDer: { width: '40%' },
  clienteLinea: { fontSize: px(11), lineHeight: alto(11, 1.6) },

  // .tabla-container { min-height: 380px }
  tablaMarco: { padding: px(10), marginBottom: px(10), minHeight: px(380) },
  // table.tabla-items { width: 85%; margin: 0 auto }
  tabla: { width: '85%', alignSelf: 'center' },
  fila: { flexDirection: 'row' },
  th: { fontFamily: 'Helvetica-Bold', fontSize: px(10), paddingVertical: px(6), paddingHorizontal: px(4), textAlign: 'center' },
  td: { fontSize: px(11), paddingVertical: px(4), paddingHorizontal: px(5) },
  izq: { textAlign: 'left' },
  cen: { textAlign: 'center' },
  der: { textAlign: 'right' },
  c10: { width: '10%' },
  c15: { width: '15%' },
  c45: { width: '45%' },

  // .caja-observaciones
  observaciones: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: px(6),
    paddingHorizontal: px(15),
    fontSize: px(10),
    marginBottom: px(8),
  },
  obsIzq: { width: '60%', lineHeight: alto(10, 1.5) },
  obsDer: { width: '40%', alignItems: 'center' },
  // .firma-box
  firma: {
    width: px(180),
    marginTop: px(15),
    paddingTop: px(3),
    borderTopWidth: px(1),
    borderTopStyle: 'dashed',
    borderTopColor: '#000',
    fontSize: px(10),
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },

  // .imprenta-marco
  imprenta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: px(6),
    paddingHorizontal: px(15),
    fontSize: px(9),
  },
  impLinea: { lineHeight: alto(9, 1.3) },
  imp1: { width: '35%' },
  imp2: { width: '35%', textAlign: 'center' },
  imp3: { width: '30%', textAlign: 'right' },
  printel: { fontFamily: 'Helvetica-Bold', fontSize: px(11), lineHeight: alto(11, 1.3) },
  chico: { fontSize: px(8), lineHeight: alto(8, 1.3) },
  duplicado: { fontSize: px(8), fontFamily: 'Helvetica-Bold', marginTop: px(3) },
})

/**
 * Remito PREIMPRESO: la réplica del formulario en papel, para imprimir y firmar. No se le envía al
 * cliente (a él le llega el Remito VENTA); se guarda en "🤖RTO PDF PREIMPRESO" del remito.
 */
export function RemitoPreimpresoPdf({
  numero,
  nombre,
  fechaEmision,
  cliente,
  cot,
  lineas,
  imprenta,
  logoSrc,
}: DatosRemitoPdf) {
  return (
    <Document title={nombre} author="La Batea S.A." subject={`Remito preimpreso ${numero}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.avisoTop}>Documento no válido como factura</Text>

        <View style={[s.marco, s.header]}>
          <View style={s.headerLeft}>
            {logoSrc ? <Image style={s.logo} src={logoSrc} /> : <Text style={s.logoTexto}>La Batea s.a.</Text>}
            <Text style={s.izqLinea}>Colectora Macaya 1273 - Tel.Fax: (0249) 444 2646</Text>
            <Text style={s.izqLinea}>7000 Tandil - Pcia. Bs As - Argentina</Text>
            <Text style={s.izqLinea}>E-mail: info@labatea.biz</Text>
            <Text style={[s.izqLinea, s.bold]}>RESPONSABLE INSCRIPTO</Text>
          </View>

          <View style={s.afipBox}>
            <View style={s.letra}>
              <Text style={s.letraTexto}>R</Text>
            </View>
            <Text style={s.codigo}>Código 91</Text>
          </View>

          <View style={s.headerRight}>
            <Text style={s.h1}>REMITO</Text>
            <Text style={[s.derLinea, s.bold]}>{`N° ${numero}`}</Text>
            {/* <br><br>: un renglón en blanco antes de la fecha. */}
            <Text style={s.derLinea}> </Text>
            <Text style={s.derLinea}>
              <Text style={s.bold}>Fecha:</Text> {fechaEmision}
            </Text>
            <Text style={s.derLinea}>
              <Text style={s.bold}>CUIT:</Text> 30-70906788-1
            </Text>
            <Text style={s.derLinea}>
              <Text style={s.bold}>ING BRUTOS:</Text> 30-70906788-1
            </Text>
            <Text style={s.derLinea}>
              <Text style={s.bold}>INICIO DE ACTIV.:</Text> 12/01/05
            </Text>
          </View>
        </View>

        <View style={[s.marco, s.cliente]}>
          <View style={s.clienteIzq}>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>Señor(es):</Text> {cliente.name}
            </Text>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>Domicilio:</Text> {cliente.addr}
            </Text>
          </View>
          <View style={s.clienteDer}>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>CUIT:</Text> {cliente.cuit}
            </Text>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>I.V.A.:</Text> {cliente.condicionIva}
            </Text>
          </View>
        </View>

        <View style={[s.marco, s.tablaMarco]}>
          <View style={s.tabla}>
            <View style={s.fila} fixed>
              <Text style={[s.th, s.c15]}>CÓDIGO INT.</Text>
              <Text style={[s.th, s.c45, s.izq]}>DESCRIPCIÓN</Text>
              {/* Columna de la factura: sin título, como en el formulario. */}
              <Text style={[s.th, s.c15]}> </Text>
              <Text style={[s.th, s.c10]}>UNIDAD</Text>
              <Text style={[s.th, s.c15, s.der]}>CANTIDAD</Text>
            </View>
            {lineas.map((l, i) => (
              <View key={i} style={s.fila} wrap={false}>
                <Text style={[s.td, s.c15, s.cen]}>{l.codigo}</Text>
                <Text style={[s.td, s.c45, s.izq]}>{l.descripcion}</Text>
                <Text style={[s.td, s.c15, s.cen]}>{l.factura}</Text>
                <Text style={[s.td, s.c10, s.cen]}>{l.unidad}</Text>
                <Text style={[s.td, s.c15, s.der]}>{l.cantidad}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[s.marco, s.observaciones]} wrap={false}>
          <View style={s.obsIzq}>
            <Text>
              <Text style={s.bold}>COT:</Text> {cot}
            </Text>
          </View>
          <View style={s.obsDer}>
            <Text style={s.firma}>Recibí conforme</Text>
          </View>
        </View>

        <View style={[s.marco, s.imprenta]} wrap={false}>
          <View style={s.imp1}>
            <Text style={s.printel}>Printel</Text>
            <Text style={s.impLinea}>IMPRESIONES GRÁFICAS</Text>
            <Text style={s.chico}>de Mauricio Gallego</Text>
            <Text style={s.chico}>Paz 1531 - Tel.: 442 5142 - CUIT: 20-22066493-7</Text>
          </View>
          <View style={s.imp2}>
            <Text style={[s.impLinea, s.bold]}>{`Fecha de impresión ${imprenta.fechaImpresion}`}</Text>
            <Text style={[s.impLinea, s.bold]}>{`Habilitación de Imprenta ${imprenta.habilitacionImprenta}`}</Text>
            <Text style={[s.impLinea, s.bold]}>{`${imprenta.desde} al ${imprenta.hasta}`}</Text>
          </View>
          <View style={s.imp3}>
            <Text style={[s.impLinea, s.bold]}>{`C.A.I.: ${imprenta.cai}`}</Text>
            <Text style={[s.impLinea, s.bold]}>{`Fecha Vto.: ${imprenta.vencimientoCai}`}</Text>
            <Text style={s.duplicado}>ORIGINAL BLANCO - DUPLICADO COLOR</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
