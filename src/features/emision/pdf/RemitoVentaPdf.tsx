import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { alto, px } from './comun'
import type { DatosRemitoPdf } from './datosRemito'

/*
 * Plantilla: el HTML del "Remito - La Batea" que usaba el escenario de Make.com. Mismas medidas
 * (px → pt con `px()`), colores y estructura. Diferencias forzadas por react-pdf: Helvetica no tiene
 * peso 500 (los importes van en normal), y el interlineado se da en absoluto (`alto()`).
 */

const VIOLETA = '#5c4b8e'
const VERDE = '#00a859'

const s = StyleSheet.create({
  // @page { margin: 10mm 15mm 15mm 15mm } · body { font-size: 11px; color: #333 }
  page: {
    paddingTop: '10mm',
    paddingRight: '15mm',
    paddingBottom: '15mm',
    paddingLeft: '15mm',
    fontFamily: 'Helvetica',
    fontSize: px(11),
    color: '#333',
    backgroundColor: '#fff',
  },
  bold: { fontFamily: 'Helvetica-Bold' },
  negro: { fontFamily: 'Helvetica-Bold', color: '#000' },

  // .header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: px(2),
    borderBottomColor: VIOLETA,
    paddingBottom: px(10),
    marginBottom: px(15),
  },
  headerLeft: { width: '40%' },
  // .logo img { max-width: 190px } — el logo mide 315 × 110.
  logo: { width: px(190), height: px((190 * 110) / 315), marginBottom: px(5) },
  empresaInfo: { fontSize: px(10), color: '#555' },
  empresaLinea: { lineHeight: alto(10, 1.4) },

  // .afip-box
  afipBox: { width: '20%', alignItems: 'center' },
  letra: {
    width: px(42),
    height: px(42),
    borderWidth: px(2),
    borderColor: '#333',
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: px(3),
  },
  letraTexto: { fontFamily: 'Helvetica-Bold', fontSize: px(28), color: '#333' },
  codigo: { fontFamily: 'Helvetica-Bold', fontSize: px(9), color: '#555' },

  // .header-right
  headerRight: { width: '40%', textAlign: 'right', fontSize: px(10), color: '#555' },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: px(22), color: '#222', letterSpacing: px(1), marginBottom: px(5) },
  derLinea: { lineHeight: alto(10, 1.4) },

  // .cliente-box
  clienteBox: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderLeftWidth: px(4),
    borderLeftColor: VERDE,
    paddingVertical: px(10),
    paddingHorizontal: px(15),
    marginBottom: px(20),
  },
  clienteCol: { width: '50%' },
  clienteLinea: { fontSize: px(11), lineHeight: alto(11, 1.6) },

  // table.productos
  tabla: { marginBottom: px(25) },
  thFila: { flexDirection: 'row', backgroundColor: '#f1f1f1', borderBottomWidth: px(2), borderBottomColor: '#ccc' },
  th: {
    fontFamily: 'Helvetica-Bold',
    color: '#333',
    fontSize: px(10),
    textTransform: 'uppercase',
    paddingVertical: px(8),
    paddingHorizontal: px(6),
    textAlign: 'center',
  },
  tdFila: { flexDirection: 'row', borderBottomWidth: px(1), borderBottomColor: '#eee' },
  td: { paddingVertical: px(8), paddingHorizontal: px(6), textAlign: 'center', color: '#444', fontSize: px(11) },
  izq: { textAlign: 'left' },
  num: { textAlign: 'right' },
  c15: { width: '15%' },
  c40: { width: '40%' },

  // .resumen-cot
  resumenCot: {
    borderWidth: px(1),
    borderColor: '#e0e0e0',
    borderRadius: px(4),
    paddingVertical: px(8),
    paddingHorizontal: px(12),
    marginBottom: px(20),
    fontSize: px(11),
    color: '#444',
    lineHeight: alto(11, 1.5),
  },

  // .imprenta-box
  imprentaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: px(1),
    borderColor: '#333',
    borderRadius: px(8),
    paddingVertical: px(10),
    paddingHorizontal: px(15),
    marginTop: px(15),
    fontSize: px(10),
    color: '#000',
  },
  imprentaCol: { width: '50%' },
  imprentaLinea: { lineHeight: alto(10, 1.5) },
})

/**
 * Remito VENTA: el que recibe el cliente. Encabezado con el logo y los datos fiscales de La Batea,
 * la letra R (código 91), el cliente, la mercadería (sin importes), el COT y el pie de imprenta con
 * el CAI del talonario.
 */
export function RemitoVentaPdf({ numero, nombre, fechaEmision, cliente, cot, lineas, imprenta, logoSrc }: DatosRemitoPdf) {
  return (
    <Document title={nombre} author="La Batea S.A." subject={`Remito ${numero}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            {logoSrc ? <Image style={s.logo} src={logoSrc} /> : null}
            <View style={s.empresaInfo}>
              <Text style={[s.empresaLinea, s.bold]}>La Batea S.A.</Text>
              <Text style={s.empresaLinea}>Colectora Macaya 1273 - Tel/Fax: (0249) 444 2646</Text>
              <Text style={s.empresaLinea}>7000 Tandil - Pcia. Bs. As. - Argentina</Text>
              <Text style={s.empresaLinea}>E-mail: info@labatea.biz</Text>
              <Text style={[s.empresaLinea, s.bold]}>RESPONSABLE INSCRIPTO</Text>
            </View>
          </View>

          <View style={s.afipBox}>
            <View style={s.letra}>
              <Text style={s.letraTexto}>R</Text>
            </View>
            <Text style={s.codigo}>Código 91</Text>
          </View>

          <View style={s.headerRight}>
            <Text style={s.h1}>REMITO</Text>
            <Text style={[s.derLinea, s.negro]}>{`Nº ${numero}`}</Text>
            <Text style={s.derLinea}>
              <Text style={s.negro}>Fecha:</Text> {fechaEmision}
            </Text>
            {/* <br><br>: un renglón en blanco antes de los datos fiscales. */}
            <Text style={s.derLinea}> </Text>
            <Text style={s.derLinea}>
              <Text style={s.negro}>CUIT:</Text> 30-70906788-1
            </Text>
            <Text style={s.derLinea}>
              <Text style={s.negro}>ING. BRUTOS:</Text> 30-70906788-1
            </Text>
            <Text style={s.derLinea}>
              <Text style={s.negro}>INICIO DE ACTIV.:</Text> 12/01/05
            </Text>
          </View>
        </View>

        <View style={s.clienteBox}>
          <View style={s.clienteCol}>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>Cliente:</Text> {cliente.name}
            </Text>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>Domicilio:</Text> {cliente.addr}
            </Text>
          </View>
          <View style={s.clienteCol}>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>Condición Frente al IVA:</Text> {cliente.condicionIva}
            </Text>
            <Text style={s.clienteLinea}>
              <Text style={s.bold}>CUIT:</Text> {cliente.cuit}
            </Text>
          </View>
        </View>

        <View style={s.tabla}>
          {/* Como el <thead> al imprimir: se repite en cada página. */}
          <View style={s.thFila} fixed>
            <Text style={[s.th, s.c15, s.izq]}>Código Int.</Text>
            <Text style={[s.th, s.c40, s.izq]}>Descripción</Text>
            {/* Columna reservada para la factura: sin título, como en el template. */}
            <Text style={[s.th, s.c15]}> </Text>
            <Text style={[s.th, s.c15]}>Unidad</Text>
            <Text style={[s.th, s.c15, s.num]}>Cantidad</Text>
          </View>
          {lineas.map((l, i) => (
            <View key={i} style={s.tdFila} wrap={false}>
              <Text style={[s.td, s.c15, s.izq]}>{l.codigo}</Text>
              <Text style={[s.td, s.c40, s.izq]}>{l.descripcion}</Text>
              <Text style={[s.td, s.c15]}>{l.factura}</Text>
              <Text style={[s.td, s.c15]}>{l.unidad}</Text>
              <Text style={[s.td, s.c15, s.num]}>{l.cantidad}</Text>
            </View>
          ))}
        </View>

        <View style={s.resumenCot} wrap={false}>
          <Text>
            <Text style={s.bold}>COT:</Text> {cot}
          </Text>
        </View>

        <View style={s.imprentaBox} wrap={false}>
          <View style={s.imprentaCol}>
            <Text style={s.imprentaLinea}>
              <Text style={s.bold}>Fecha de impresión:</Text> {imprenta.fechaImpresion}
            </Text>
            <Text style={s.imprentaLinea}>
              <Text style={s.bold}>Habilitación de Imprenta:</Text> {imprenta.habilitacionImprenta}
            </Text>
            <Text style={[s.imprentaLinea, s.bold]}>{`${imprenta.desde} al ${imprenta.hasta}`}</Text>
          </View>
          <View style={[s.imprentaCol, { textAlign: 'right' }]}>
            <Text style={s.imprentaLinea}>
              <Text style={s.bold}>C.A.I.:</Text> {imprenta.cai}
            </Text>
            <Text style={s.imprentaLinea}>
              <Text style={s.bold}>Fecha Vto.:</Text> {imprenta.vencimientoCai}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
