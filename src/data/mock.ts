/**
 * Datos de prototipo. Único punto a reemplazar cuando entre la capa de servicio:
 * cada constante pasa a ser el resultado de una query al board de monday.
 */
import type {
  Chofer,
  Cliente,
  Comisionista,
  Contacto,
  Destino,
  Presupuesto,
  Producto,
  Remito,
  Vehiculo,
  Vendedor,
  VentaEntrega,
} from '@/types'

export const VENDEDORES: Vendedor[] = [
  { id: '1001', ini: 'LT', name: 'Luciano Torres', color: 'var(--avatar-orange)' },
  { id: '1002', ini: 'MS', name: 'María Silva', color: 'var(--red)' },
  { id: '1003', ini: 'JG', name: 'Javier Gómez', color: 'var(--green)' },
  { id: '1004', ini: 'PR', name: 'Paula Ríos', color: '#575ce5' },
  { id: '1005', ini: 'DC', name: 'Diego Cabrera', color: 'var(--primary-blue)' },
]

export const CLIENTES: Cliente[] = [
  {
    id: '4192',
    codigo: '4192',
    name: 'La Batea S.A.',
    cuit: '30-71234567-8',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L1',
    ret: 'IVA',
    // Sufre retenciones pero no es agente: puede facturar sin pasar por la otra app.
    agenteRetencion: false,
    condicionPago: 'CUENTA CORRIENTE',
    limit: 4_500_000,
    saldoCtaCte: 4_200_000,
    lineaUtilizada: 4_200_000,
    remitosPendFacturar: 0,
    disponible: 300_000,
    addr: 'Av. Siempre Viva 1234, CABA',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  },
  {
    id: '8271',
    codigo: '8271',
    name: 'Global Tech LLC',
    cuit: '30-55554444-1',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L2',
    ret: 'IIBB',
    agenteRetencion: true,
    // Liberado sin crédito: opera únicamente al contado.
    condicionPago: 'CONTADO',
    limit: 2_000_000,
    saldoCtaCte: 1_500_000,
    lineaUtilizada: 1_500_000,
    remitosPendFacturar: 0,
    disponible: 500_000,
    addr: 'Calle Falsa 123, CABA',
    activity: 'Activo',
    situation: 'Liberado sin crédito',
  },
  {
    id: '3948',
    codigo: '3948',
    name: 'Distribuidora Sur',
    cuit: '33-11223344-9',
    ptype: 'Persona Física',
    status: 'Monotributo',
    list: 'L3',
    ret: 'Ninguna',
    agenteRetencion: false,
    condicionPago: 'CONTADO',
    limit: 500_000,
    saldoCtaCte: 50_000,
    lineaUtilizada: 50_000,
    remitosPendFacturar: 0,
    disponible: 450_000,
    addr: 'Ruta 2 Km 40, Mar del Plata',
    activity: 'Inactivo',
    situation: 'Bloqueado',
  },
  {
    id: '5102',
    codigo: '5102',
    name: 'Constructora Mega',
    cuit: '30-99887766-5',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L1',
    ret: 'Ganancias e IVA',
    agenteRetencion: true,
    condicionPago: 'CUENTA CORRIENTE',
    limit: 10_000_000,
    saldoCtaCte: 6_000_000,
    lineaUtilizada: 6_000_000,
    remitosPendFacturar: 0,
    disponible: 4_000_000,
    addr: 'San Martín 400, Córdoba',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  },
  {
    id: '2865',
    codigo: '2865',
    name: '3 de Marzo S.A.',
    cuit: '30-70985412-3',
    ptype: 'Persona Jurídica',
    status: 'Responsable Inscripto',
    list: 'L2',
    ret: 'IVA',
    // No es agente: puede facturar sin pasar por la app de retenciones.
    agenteRetencion: false,
    // Opera al contado: el cobro es obligatorio para poder cerrar la venta.
    condicionPago: 'CONTADO',
    limit: 1_800_000,
    saldoCtaCte: 420_000,
    lineaUtilizada: 420_000,
    remitosPendFacturar: 0,
    disponible: 1_380_000,
    addr: 'Ruta 8 Km 245, Venado Tuerto, Santa Fe',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  },
  {
    id: '7384',
    codigo: '7384',
    name: 'Librería El Estudiante',
    cuit: '27-33445566-2',
    ptype: 'Persona Física',
    status: 'Exento',
    list: 'L3',
    ret: 'IIBB',
    agenteRetencion: true,
    condicionPago: 'CUENTA CORRIENTE',
    limit: 100_000,
    saldoCtaCte: 95_000,
    lineaUtilizada: 95_000,
    remitosPendFacturar: 0,
    disponible: 5_000,
    addr: 'Belgrano 10, Rosario',
    activity: 'Activo',
    situation: 'Liberado con crédito',
  },
]

export const PRODUCTOS: Producto[] = [
  {
    codigo: '2169',
    nombre: 'BANAMINE INYECTABLE x 10 Ml',
    precio: 24_500,
    rentabilidad: 28,
    provCod: '10045',
    provNombre: 'Agrovet Distribuciones S.A.',
    tipo: 'COM',
    um: 'Frasco',
    fisico: 150,
    comercial: 200,
    disponible: 150,
  },
  {
    codigo: '3187',
    nombre: 'AGUJA DESC. 50/8 CONO VERDE X UN.',
    precio: 120,
    rentabilidad: 26,
    provCod: '10045',
    provNombre: 'Agrovet Distribuciones S.A.',
    tipo: 'COM',
    um: 'Unidad',
    fisico: 500,
    comercial: 500,
    disponible: 450,
  },
  {
    codigo: '4321',
    nombre: 'A4 ZOOVET X 5 LITROS',
    precio: 18_900,
    rentabilidad: 24,
    provCod: '20100',
    provNombre: 'Zoovet S.A.',
    tipo: 'COM',
    um: 'Bidón',
    fisico: 50,
    comercial: 50,
    disponible: 50,
  },
  {
    codigo: '5412',
    nombre: 'ABORTO EQUINO X 5 Ds',
    precio: 15_600,
    rentabilidad: 25,
    provCod: '30500',
    provNombre: 'Equino Vet',
    tipo: 'VET',
    um: 'Caja',
    fisico: 10,
    comercial: 12,
    disponible: 10,
  },
  {
    codigo: '6547',
    nombre: 'ABRAZADERA DE 90 a 110 mm',
    precio: 850,
    rentabilidad: 22,
    provCod: '40010',
    provNombre: 'Ferretería Industrial',
    tipo: 'INS',
    um: 'Unidad',
    fisico: 1000,
    comercial: 1200,
    disponible: 1000,
  },
]

export const RUBROS = ['NUTRICION', 'SANIDAD']
export const SUBRUBROS = ['BOVINOS LECHE', 'PORCINOS']
export const CATEGORIAS = ['INYECTABLES']

export const PRESUPUESTOS: Presupuesto[] = [
  {
    id: 'IDPRESUP-001',
    clienteId: '4192',
    estado: 'En uso',
    rent: 28,
    importe: 137_940,
    prodVend: 5,
    prodTot: 12,
    emis: '17/07/2026',
    venc: '17/08/2026',
    uso: 40,
    desc: 9,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', total: 1, vend: 1, pend: 0, precio: 24_500, rent: 28 },
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', total: 10, vend: 4, pend: 6, precio: 120, rent: 26 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', total: 2, vend: 2, pend: 0, precio: 18_900, rent: 24 },
      { nombre: 'ABORTO EQUINO x 5 Ds', codigo: '5412', total: 1, vend: 0, pend: 1, precio: 15_600, rent: 25 },
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', total: 5, vend: 3, pend: 2, precio: 850, rent: 22 },
    ],
  },
  {
    id: 'IDPRESUP-002',
    clienteId: '4192',
    estado: 'Vencido',
    rent: 21,
    importe: 215_300,
    prodVend: 8,
    prodTot: 15,
    emis: '02/06/2026',
    venc: '02/07/2026',
    uso: 60,
    desc: 5,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', total: 4, vend: 4, pend: 0, precio: 24_500, rent: 21 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', total: 6, vend: 4, pend: 2, precio: 18_900, rent: 22 },
    ],
  },
  {
    id: 'IDPRESUP-003',
    clienteId: '4192',
    estado: 'En uso',
    rent: 18,
    importe: 84_600,
    prodVend: 3,
    prodTot: 8,
    emis: '10/07/2026',
    venc: '10/08/2026',
    uso: 25,
    desc: 0,
    productos: [
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', total: 8, vend: 3, pend: 5, precio: 850, rent: 18 },
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', total: 20, vend: 10, pend: 10, precio: 120, rent: 19 },
    ],
  },
  {
    id: 'IDPRESUP-004',
    clienteId: '4192',
    estado: 'Completado',
    rent: 32,
    importe: 312_500,
    prodVend: 10,
    prodTot: 20,
    emis: '01/05/2026',
    venc: '01/06/2026',
    uso: 100,
    desc: 12,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', total: 10, vend: 10, pend: 0, precio: 24_500, rent: 32 },
    ],
  },
  {
    id: 'IDPRESUP-005',
    clienteId: '4192',
    estado: 'Vencido',
    rent: 15,
    importe: 0,
    prodVend: 6,
    prodTot: 6,
    emis: '15/04/2026',
    venc: '15/05/2026',
    uso: 100,
    desc: 0,
    productos: [
      { nombre: 'ABORTO EQUINO x 5 Ds', codigo: '5412', total: 6, vend: 6, pend: 0, precio: 15_600, rent: 15 },
    ],
  },
  {
    id: 'IDPRESUP-006',
    clienteId: '4192',
    estado: 'En uso',
    rent: 24,
    importe: 98_200,
    prodVend: 2,
    prodTot: 9,
    emis: '12/07/2026',
    venc: '12/08/2026',
    uso: 15,
    desc: 3,
    productos: [
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', total: 4, vend: 1, pend: 3, precio: 18_900, rent: 24 },
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', total: 6, vend: 2, pend: 4, precio: 850, rent: 23 },
    ],
  },
  {
    id: 'IDPRESUP-007',
    clienteId: '4192',
    estado: 'En uso',
    rent: 30,
    importe: 156_000,
    prodVend: 4,
    prodTot: 10,
    emis: '14/07/2026',
    venc: '14/08/2026',
    uso: 35,
    desc: 6,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', total: 6, vend: 2, pend: 4, precio: 24_500, rent: 30 },
    ],
  },

  /* 3 de Marzo S.A.: tres presupuestos en uso, de 1, 3 y 5 líneas.
     Importe, rentabilidad y avance salen de sus propias líneas. */
  {
    id: 'IDPRESUP-008',
    clienteId: '2865',
    estado: 'En uso',
    rent: 28,
    importe: 196_000,
    prodVend: 2,
    prodTot: 8,
    emis: '06/07/2026',
    venc: '06/08/2026',
    uso: 25,
    desc: 0,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', total: 8, vend: 2, pend: 6, precio: 24_500, rent: 28 },
    ],
  },
  {
    id: 'IDPRESUP-009',
    clienteId: '2865',
    estado: 'En uso',
    rent: 24,
    importe: 91_800,
    prodVend: 5,
    prodTot: 66,
    emis: '11/07/2026',
    venc: '11/08/2026',
    uso: 8,
    desc: 0,
    productos: [
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', total: 50, vend: 0, pend: 50, precio: 120, rent: 26 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', total: 4, vend: 1, pend: 3, precio: 18_900, rent: 24 },
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', total: 12, vend: 4, pend: 8, precio: 850, rent: 22 },
    ],
  },
  {
    id: 'IDPRESUP-010',
    clienteId: '2865',
    estado: 'En uso',
    rent: 25,
    importe: 287_200,
    prodVend: 27,
    prodTot: 133,
    emis: '15/07/2026',
    venc: '15/08/2026',
    uso: 20,
    desc: 4,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', total: 4, vend: 0, pend: 4, precio: 24_500, rent: 28 },
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', total: 100, vend: 20, pend: 80, precio: 120, rent: 26 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', total: 6, vend: 2, pend: 4, precio: 18_900, rent: 24 },
      { nombre: 'ABORTO EQUINO x 5 Ds', codigo: '5412', total: 3, vend: 0, pend: 3, precio: 15_600, rent: 25 },
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', total: 20, vend: 5, pend: 15, precio: 850, rent: 22 },
    ],
  },
]

/* Remitos pendientes de facturar: la venta directa con entrega ANTERIOR parte de acá. */
export const REMITOS: Remito[] = [
  {
    id: 'REM-000123',
    fecha: '17/07/2025',
    estado: 'Pend. de facturar',
    prodFacturados: 5,
    prodTotal: 12,
    descuento: 1_500,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', cantRemito: 1, cantFacturada: 1, pendiente: 0, precio: 24_500, rent: 28 },
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', cantRemito: 10, cantFacturada: 4, pendiente: 6, precio: 120, rent: 26 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', cantRemito: 2, cantFacturada: 0, pendiente: 2, precio: 18_900, rent: 24 },
      { nombre: 'ABORTO EQUINO x 5 Ds', codigo: '5412', cantRemito: 1, cantFacturada: 0, pendiente: 1, precio: 15_600, rent: 25 },
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', cantRemito: 5, cantFacturada: 1, pendiente: 4, precio: 850, rent: 22 },
    ],
  },
  {
    id: 'REM-000122',
    fecha: '16/07/2025',
    estado: 'Pend. de facturar',
    prodFacturados: 8,
    prodTotal: 15,
    descuento: 0,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', cantRemito: 4, cantFacturada: 4, pendiente: 0, precio: 24_500, rent: 21 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', cantRemito: 6, cantFacturada: 4, pendiente: 2, precio: 18_900, rent: 22 },
    ],
  },
  {
    id: 'REM-000121',
    fecha: '15/07/2025',
    estado: 'Sin facturar',
    prodFacturados: 0,
    prodTotal: 8,
    descuento: 0,
    productos: [
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', cantRemito: 8, cantFacturada: 0, pendiente: 8, precio: 850, rent: 18 },
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', cantRemito: 20, cantFacturada: 0, pendiente: 20, precio: 120, rent: 19 },
    ],
  },
  {
    id: 'REM-000120',
    fecha: '14/07/2025',
    estado: 'Pend. de facturar',
    prodFacturados: 10,
    prodTotal: 20,
    descuento: 2_000,
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', cantRemito: 10, cantFacturada: 6, pendiente: 4, precio: 24_500, rent: 32 },
    ],
  },
  {
    id: 'REM-000119',
    fecha: '13/07/2025',
    estado: 'Sin facturar',
    prodFacturados: 0,
    prodTotal: 6,
    descuento: 0,
    productos: [
      { nombre: 'ABORTO EQUINO x 5 Ds', codigo: '5412', cantRemito: 6, cantFacturada: 0, pendiente: 6, precio: 15_600, rent: 15 },
    ],
  },
]

export const CONTACTOS_INICIALES: Contacto[] = [
  {
    id: 'C-001',
    name: 'María Fernanda Gómez',
    phone: '+54 9 11 2345 6789',
    email: 'maria.gomez@clinicasol.com.ar',
    ini: 'MG',
    color: '#8a2be2',
    status: 'ACEPTA PRESUPUESTO',
    ok: true,
  },
  {
    id: 'C-002',
    name: 'Juan Pablo López',
    phone: '+54 9 11 9876 5432',
    email: 'juan.lopez@clinicasol.com.ar',
    ini: 'JL',
    color: '#0073ea',
    status: 'ACEPTA PRESUPUESTO',
    ok: true,
  },
  {
    id: 'C-003',
    name: 'Ana Pérez',
    phone: '+54 9 11 1122 3344',
    email: 'compras@clinicasol.com.ar',
    ini: 'AP',
    color: '#ff8c00',
    status: 'NO ACEPTA PRESUPUESTO',
    ok: false,
  },
]

export const CONTACTOS_DISPONIBLES: Contacto[] = [
  {
    id: 'C-004',
    name: 'Carlos Rodríguez',
    phone: '+54 9 11 3344 5566',
    email: 'carlos@empresa.com.ar',
    ini: 'CR',
    color: '#00ca72',
    status: 'ACEPTA PRESUPUESTO',
    ok: true,
  },
  {
    id: 'C-005',
    name: 'Laura Martínez',
    phone: '+54 9 11 4455 6677',
    email: 'laura@clinica.com',
    ini: 'LM',
    color: '#ff3d57',
    status: 'ACEPTA PRESUPUESTO',
    ok: true,
  },
  {
    id: 'C-006',
    name: 'Diego Fernández',
    phone: '+54 9 11 5566 7788',
    email: 'diego@salud.org',
    ini: 'DF',
    color: '#0073ea',
    status: 'PENDIENTE',
    ok: true,
  },
  {
    id: 'C-007',
    name: 'Sofía Castro',
    phone: '+54 9 11 6677 8899',
    email: 'sofia@medicos.com',
    ini: 'SC',
    color: '#8a2be2',
    status: 'ACEPTA PRESUPUESTO',
    ok: true,
  },
  {
    id: 'C-008',
    name: 'Martín Iglesias',
    phone: '+54 9 11 7788 9900',
    email: 'martin@iglesias.com',
    ini: 'MI',
    color: '#ffcb00',
    status: 'NO ACEPTA PRESUPUESTO',
    ok: false,
  },
]

export const NRO_PRESUPUESTO = 'PR-000245'
export const FECHA_EMISION_INICIAL = '08/07/2026'
export const DIAS_VIGENCIA_INICIAL = 14

/* ===== Operación REMITO ===== */

export const NRO_REMITO = 'RM-000312'

/**
 * Ventas ya facturadas con entrega pendiente: origen del remito de emisión ANTERIOR.
 * Se listan por cliente y traen anidada la factura que las respalda.
 */
export const VENTAS_ENTREGA: VentaEntrega[] = [
  {
    id: 'VD-000188',
    clienteId: '4192',
    fecha: '15/07/2026',
    estado: 'Pend. de Entregar',
    factura: { nro: 'FC-0001-00018842', fecha: '15/07/2026', total: 296_450 },
    productos: [
      { nombre: 'BANAMINE INYECTABLE x 10 ml', codigo: '2169', um: 'Frasco', vendida: 10, entregada: 0, pendiente: 10 },
    ],
  },
  {
    id: 'VD-000185',
    clienteId: '4192',
    fecha: '12/07/2026',
    estado: 'Parcialmente entregada',
    factura: { nro: 'FC-0001-00018790', fecha: '12/07/2026', total: 184_300 },
    productos: [
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', um: 'Bidón', vendida: 6, entregada: 2, pendiente: 4 },
      { nombre: 'AGUJA DESC. 50/8 CONO VERDE x un.', codigo: '3187', um: 'Unidad', vendida: 40, entregada: 40, pendiente: 0 },
      { nombre: 'ABRAZADERA DE 90 a 110 mm', codigo: '6547', um: 'Unidad', vendida: 20, entregada: 8, pendiente: 12 },
    ],
  },
  {
    id: 'VD-000172',
    clienteId: '2865',
    fecha: '10/07/2026',
    estado: 'Parcialmente entregada',
    factura: { nro: 'FC-0001-00018651', fecha: '10/07/2026', total: 98_400 },
    productos: [
      { nombre: 'ABORTO EQUINO x 5 Ds', codigo: '5412', um: 'Caja', vendida: 4, entregada: 1, pendiente: 3 },
      { nombre: 'A4 ZOOVET x 5 litros', codigo: '4321', um: 'Bidón', vendida: 3, entregada: 0, pendiente: 3 },
    ],
  },
]

/** Destinos de entrega por cliente: alimentan el dropdown de destino del envío. */
export const DESTINOS: Destino[] = [
  { id: 'D-01', clienteId: '4192', nombre: 'Depósito Central', direccion: 'Av. Siempre Viva 1234, CABA' },
  { id: 'D-02', clienteId: '4192', nombre: 'Sucursal Norte', direccion: 'Ruta 9 Km 52, Escobar' },
  { id: 'D-03', clienteId: '4192', nombre: 'Campo La Rosada', direccion: 'Ruta 41 Km 8, Capitán Sarmiento' },
  { id: 'D-04', clienteId: '2865', nombre: 'Planta Venado Tuerto', direccion: 'Ruta 8 Km 245, Venado Tuerto' },
  { id: 'D-05', clienteId: '2865', nombre: 'Acopio Sur', direccion: 'Ruta 33 Km 112, Rufino' },
]

/** Choferes de La Batea S.A. (empresa transportista propia). */
export const CHOFERES: Chofer[] = [
  { id: 'CH-1', name: 'Ramón Aguirre', cuit: '20-24567891-3' },
  { id: 'CH-2', name: 'Sergio Duarte', cuit: '20-30122456-7' },
  { id: 'CH-3', name: 'Miguel Sosa', cuit: '20-27889013-1' },
]

export const VEHICULOS: Vehiculo[] = [
  { id: 'V-1', name: 'Camión Mercedes-Benz 1114', patente: 'AE 412 RT', descripcion: 'Camión Mercedes-Benz 1114' },
  { id: 'V-2', name: 'Furgón Iveco Daily', patente: 'AD 889 KL', descripcion: 'Furgón Iveco Daily' },
  { id: 'V-3', name: 'Camión Ford Cargo 1722', patente: 'AF 205 MN', descripcion: 'Camión Ford Cargo 1722' },
]

/** Comisionistas de transporte cargados en el sistema (traslado tercerizado). */
export const COMISIONISTAS: Comisionista[] = [
  { id: 'CM-1', name: 'Transportes del Litoral S.R.L.', cuit: '30-68455112-9', zona: 'Litoral / NEA' },
  { id: 'CM-2', name: 'Logística Pampeana', cuit: '30-71099234-4', zona: 'Buenos Aires / La Pampa' },
  { id: 'CM-3', name: 'Fletes Córdoba Centro', cuit: '30-70455889-2', zona: 'Córdoba / Centro' },
  { id: 'CM-4', name: 'Cargas del Sur', cuit: '30-69877145-6', zona: 'Patagonia' },
]

/** Empresa transportista: es siempre La Batea S.A. (flota propia). */
export const TRANSPORTISTA = 'La Batea S.A.'
