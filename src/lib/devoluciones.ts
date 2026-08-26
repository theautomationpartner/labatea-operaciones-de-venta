/**
 * Reglas de la DEVOLUCIÓN de ventas. Es un módulo PURO —no habla con Monday ni con React—, así
 * que las tres decisiones que definen la operatoria se pueden leer y probar juntas:
 *
 *   1) Qué producto NO se puede devolver nunca (biológicos: rompen la cadena de frío).
 *   2) Qué remito de entrega es elegible (30 días corridos entre su emisión y la devolución).
 *   3) Cómo se reparte la cantidad devuelta entre esos remitos (del más nuevo hacia atrás).
 *
 * La imputación es AUTOMÁTICA: el operador declara cliente, producto y cantidad, y el sistema
 * decide contra qué remitos se imputa. Lo que no entra por el plazo NO se descuenta en silencio:
 * queda cargado sobre la última línea consumida, que así excede lo que ese remito podía devolver
 * y obliga a corregirla a mano antes de cerrar (ver `lineaInvalida`).
 */
import { formatDate, parseDate } from '@/lib/dates'
import { round2 } from '@/lib/format'

/** Días corridos máximos entre la emisión del remito de entrega y la devolución. */
export const DIAS_MAX_DEVOLUCION = 30

/** Texto comparable: sin tildes y en mayúsculas, para que "Biológicos" y "BIOLOGICOS" empaten. */
const normalizar = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

/** Mensaje único del rechazo por cadena de frío: lo muestran el buscador y la tabla. */
export const MOTIVO_BIOLOGICO =
  'Los productos biológicos requieren cadena de frío: no se aceptan devoluciones.'

/**
 * El producto es un biológico según el Maestro. La marca vive en la taxonomía del catálogo
 * ("BIOLOGICOS" está tanto en el Rubro como en la Categoría), y las dos columnas son multi-valor,
 * así que alcanza con que la etiqueta aparezca en cualquiera de las dos.
 */
export const esBiologico = (p: { rubro?: string; categoria?: string }): boolean =>
  normalizar(`${p.rubro ?? ''} ${p.categoria ?? ''}`).includes('BIOLOGICO')

/**
 * Días corridos (calendario) entre dos fechas dd/MM/yyyy. Devuelve null si alguna no se puede
 * leer. Se redondea porque `parseDate` arma medianoche LOCAL y un cambio de huso horario en el
 * medio dejaría una diferencia de 23 o 25 horas.
 */
export function diasCorridos(desde: string, hasta: string): number | null {
  const a = parseDate(desde)
  const b = parseDate(hasta)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/* ===== Lo que entra a la imputación ===== */

/** Una línea de un remito de entrega ya emitido, con lo que todavía se puede devolver de ella. */
export interface LineaRemitoEntrega {
  /** Subelemento del remito (board 18421035607): es lo que se actualiza al devolver. */
  subitemId: string
  /** Producto del Maestro que se entregó en la línea. */
  productoId: string
  /** "✋Cant a Entregada": unidades que salieron en ese remito. */
  entregada: number
  /** "🤖Cant Devuelta": unidades de esa misma línea que ya volvieron en devoluciones anteriores. */
  devuelta: number
  /**
   * ANTERIOR: subelemento de la VENTA del que salió esta línea, alcanzado por su pendiente de
   * entrega. Es lo que hace que el precio sea el de ESTA línea y no el "del producto en el
   * remito": el mismo producto puede venir de dos ventas distintas, con dos precios distintos.
   */
  ventaSubitemId?: string
}

/** Un remito de entrega del cliente, con sus líneas de mercadería. */
export interface RemitoEntrega {
  id: string
  /** ID visible del remito ("RTOVTA-04"). */
  nro: string
  /** Fecha de emisión en dd/MM/yyyy. Sin ella el remito no se considera emitido. */
  fecha: string
  /** Ventas de las que salió la mercadería: de ahí sale el precio para la nota de crédito. */
  ventaIds: string[]
  /**
   * Remito POSTERIOR: sus "Vtas Pends de Facturar". La venta de un remito posterior no existe
   * hasta que el pendiente se factura, así que el precio se busca por acá y no por `ventaIds`.
   */
  vtaPendIds?: string[]
  lineas: LineaRemitoEntrega[]
}

/** Un producto que el operador declaró devolver, con su cantidad. */
export interface ProductoADevolver {
  uid: string
  productoId?: string
  codigo: string
  nombre: string
  um: string
  cantidad: number
}

/* ===== Lo que sale de la imputación ===== */

/** Por qué un remito con unidades disponibles quedó afuera. */
export type MotivoDescarte = 'PLAZO' | 'SIN_FECHA'

export interface RemitoDescartado {
  remitoId: string
  remitoNro: string
  fecha: string
  /** Días corridos desde la emisión; null si la fecha no se pudo leer. */
  dias: number | null
  disponible: number
  motivo: MotivoDescarte
}

/** Cuántas unidades del producto absorbe un remito concreto. */
export interface ImputacionLinea {
  remitoId: string
  remitoNro: string
  fecha: string
  /** Días corridos entre la emisión del remito y la devolución. */
  dias: number
  subitemId: string
  ventaIds: string[]
  /** Unidades entregadas en ese remito. */
  entregada: number
  /** Unidades que todavía se podían devolver de esa línea (entregada − ya devuelta). */
  disponible: number
  /** Unidades que esta devolución consume de esa línea. */
  imputada: number
}

/** El reparto completo de un producto a devolver. */
export interface ImputacionProducto extends ProductoADevolver {
  /** Lo que pidió el operador. */
  solicitada: number
  /** Lo que efectivamente se puede devolver (Σ imputada). */
  imputada: number
  /** Lo que quedó sin poder imputarse a NINGÚN remito: no se emite remito de devolución por eso. */
  sinCubrir: number
  lineas: ImputacionLinea[]
  /** Remitos con stock devolvible que quedaron afuera (informativo, para explicar el faltante). */
  descartados: RemitoDescartado[]
}

/**
 * Reparte la cantidad a devolver de cada producto entre los remitos de entrega del cliente.
 *
 * Los candidatos se ordenan del MÁS NUEVO al más antiguo y se consumen en ese orden hasta cubrir
 * la cantidad; de cada línea sólo se puede tomar lo que todavía no se devolvió (entregada − ya
 * devuelta), así un remito nunca se imputa dos veces entre devoluciones sucesivas. Un remito
 * emitido hace más de `DIAS_MAX_DEVOLUCION` días no es elegible y se informa aparte; lo que quede
 * sin cubrir por eso se carga sobre la última línea consumida para que salte a la vista.
 */
export function imputarDevolucion(
  productos: ProductoADevolver[],
  remitos: RemitoEntrega[],
  fechaDevolucion: string,
): ImputacionProducto[] {
  return productos.map((prod) => {
    const candidatos: (ImputacionLinea & { motivo: MotivoDescarte | null })[] = []

    for (const remito of remitos) {
      for (const linea of remito.lineas) {
        if (!prod.productoId || linea.productoId !== prod.productoId) continue
        const disponible = round2(linea.entregada - linea.devuelta)
        // Línea agotada: ya se devolvió todo lo que había salido. No aporta ni informa nada.
        if (disponible <= 0) continue
        const dias = diasCorridos(remito.fecha, fechaDevolucion)
        candidatos.push({
          remitoId: remito.id,
          remitoNro: remito.nro,
          fecha: remito.fecha,
          dias: dias ?? 0,
          subitemId: linea.subitemId,
          ventaIds: remito.ventaIds,
          entregada: linea.entregada,
          disponible,
          imputada: 0,
          /* El plazo corre entre la emisión del remito y HOY. Sin fecha legible no hay plazo que
             medir, y sin plazo no se puede afirmar que el remito esté dentro de los 30 días. */
          motivo: dias === null ? 'SIN_FECHA' : dias > DIAS_MAX_DEVOLUCION ? 'PLAZO' : null,
        })
      }
    }

    // Del más nuevo al más antiguo. A igual fecha manda el ID del remito, que es correlativo.
    candidatos.sort((a, b) => {
      const fa = parseDate(a.fecha)?.getTime() ?? 0
      const fb = parseDate(b.fecha)?.getTime() ?? 0
      return fb - fa || b.remitoNro.localeCompare(a.remitoNro, 'es', { numeric: true })
    })

    const descartados: RemitoDescartado[] = candidatos
      .filter((c) => c.motivo !== null)
      .map((c) => ({
        remitoId: c.remitoId,
        remitoNro: c.remitoNro,
        fecha: c.fecha,
        dias: c.motivo === 'SIN_FECHA' ? null : c.dias,
        disponible: c.disponible,
        motivo: c.motivo as MotivoDescarte,
      }))

    // Consumo desde el remito más nuevo hacia atrás, hasta cubrir la cantidad declarada.
    let restante = prod.cantidad
    const lineas: ImputacionLinea[] = []
    for (const c of candidatos) {
      if (restante <= 0) break
      if (c.motivo !== null) continue
      const imputada = round2(Math.min(c.disponible, restante))
      if (imputada <= 0) continue
      restante = round2(restante - imputada)
      const { motivo: _motivo, ...linea } = c
      lineas.push({ ...linea, imputada })
    }

    /* Lo que no entró por el plazo NO se esconde: se carga sobre la última línea consumida, que
       así queda por encima de lo que ese remito podía devolver y la pantalla la marca en rojo para
       que el operador la corrija a mano. Antes se descontaba en silencio como "sin cubrir", y la
       devolución se registraba por menos unidades de las que el cliente había devuelto sin que
       nadie tuviera que enterarse. Sin ninguna línea consumida no hay dónde cargarlo: ahí sí queda
       como sin cubrir, y no se emite remito de devolución. */
    if (restante > 0 && lineas.length > 0) {
      const ultima = lineas[lineas.length - 1]
      lineas[lineas.length - 1] = { ...ultima, imputada: round2(ultima.imputada + restante) }
      restante = 0
    }

    const imputada = round2(lineas.reduce((acc, l) => acc + l.imputada, 0))
    return {
      ...prod,
      solicitada: prod.cantidad,
      imputada,
      sinCubrir: round2(Math.max(prod.cantidad - imputada, 0)),
      lineas,
      descartados,
    }
  })
}

/** Hay al menos una unidad imputada: sin esto no se emite ningún remito de devolución. */
export const hayImputacion = (imp: ImputacionProducto[]): boolean =>
  imp.some((p) => p.imputada > 0)

/**
 * La línea devuelve más de lo que su remito todavía podía recibir. Se mide contra lo DISPONIBLE
 * (entregada − ya devuelta), no contra lo entregado: un remito del que ya volvieron unidades no
 * puede volver a darlas. Con devoluciones previas en cero —el caso normal— son el mismo número.
 *
 * No se corrige sola: la pantalla la marca y no deja cerrar la operación hasta que se ajuste.
 */
export const lineaInvalida = (l: ImputacionLinea): boolean => l.imputada > l.disponible

/** Alguna línea quedó imposible: la devolución no se puede registrar así. */
export const hayLineasInvalidas = (imp: ImputacionProducto[]): boolean =>
  imp.some((p) => p.lineas.some(lineaInvalida))

/* ===== Nota de crédito (sólo se CONSTRUYE: todavía no se escribe en ningún tablero) ===== */

/**
 * El precio con el que se vendió UNA línea de remito, con los datos de su comprobante. La clave es
 * el subelemento del REMITO —no el producto—: dos líneas del mismo producto en el mismo remito
 * pueden venir de ventas distintas, y cada una vale lo que valía en SU venta.
 */
export interface PrecioLinea {
  /** Subelemento del remito al que corresponde este precio. */
  subitemId: string
  ventaId?: string
  /** ID visible de la venta ("VTA-016"). */
  ventaNro?: string
  /** Precio unitario ya bonificado, en la moneda del comprobante. */
  precioUnitario: number
  /** Alícuota de IVA de la línea, en %. */
  iva: number
  /** Vencimiento del pago de la factura de esa venta, en dd/MM/yyyy. */
  vencimientoFactura?: string
  /** La factura se emitió en dólares: la nota de crédito hereda su tipo de cambio. */
  enDolares?: boolean
  /** Tipo de cambio de la factura original. Sólo aplica en dólares. */
  tipoCambio?: number
}

export interface LineaNotaCredito {
  remitoId: string
  remitoNro: string
  ventaId?: string
  ventaNro?: string
  productoId?: string
  codigo: string
  nombre: string
  um: string
  cantidad: number
  precioUnitario: number
  moneda: 'Pesos' | 'Dólares'
  /** Tipo de cambio de la factura original; sólo en dólares. */
  tipoCambio?: number
  /** Alícuota de IVA, en %. */
  iva: number
  subtotal: number
  ivaImporte: number
  total: number
  /** Vencimiento de la nota de crédito, en dd/MM/yyyy. */
  vencimiento: string
  /** La factura original ya estaba vencida: se tomó el vencimiento del día. */
  vencimientoDelDia: boolean
  /** No se encontró el precio del producto en la venta del remito: la línea queda en 0. */
  sinPrecio: boolean
}

export interface NotaCreditoPendiente {
  lineas: LineaNotaCredito[]
  /** Total de las líneas facturadas en pesos. */
  totalPesos: number
  /** Total de las líneas facturadas en dólares, en su moneda. */
  totalDolares: number
  /** Alguna línea quedó sin precio: la NC no se puede emitir tal cual está. */
  incompleta: boolean
}

/**
 * Arma el ítem pendiente de emisión de nota de crédito a partir de la imputación: una línea por
 * LÍNEA DE REMITO imputada, con el precio unitario con el que ese producto se vendió en la venta
 * de la que salió esa línea.
 *
 * La clave es el subelemento del remito y no el producto: si un remito entregó el mismo producto
 * dos veces, viniendo de dos ventas distintas, cada línea se acredita a su propio precio. Es la
 * única forma de garantizar que se acredita lo que el cliente efectivamente pagó.
 *
 * El vencimiento es el de la factura de esa venta; si ya venció, el del día en que se registra la
 * devolución. Facturado en dólares, la línea conserva su moneda y arrastra el tipo de cambio de la
 * factura original —no el del día—, que es lo que ata la NC al comprobante que corrige.
 *
 * Sólo CONSTRUYE el documento: no lo escribe en Monday. El tablero destino todavía no está
 * definido, así que el resultado se muestra en pantalla y nada más.
 */
export function construirNotaCredito(
  imputaciones: ImputacionProducto[],
  precios: PrecioLinea[],
  fechaDevolucion: string,
): NotaCreditoPendiente {
  const porLinea = new Map(precios.map((p) => [p.subitemId, p]))
  const lineas: LineaNotaCredito[] = []

  for (const prod of imputaciones) {
    for (const l of prod.lineas) {
      const venta = porLinea.get(l.subitemId)
      const precioUnitario = venta?.precioUnitario ?? 0
      const iva = venta?.iva ?? 0
      const subtotal = round2(l.imputada * precioUnitario)
      const ivaImporte = round2(subtotal * (iva / 100))

      /* Vencimiento: el de la factura de la venta. Vencido (o desconocido) se usa el del día,
         que es la fecha en la que se está registrando la devolución. */
      const vencFactura = venta?.vencimientoFactura ?? ''
      const dias = vencFactura ? diasCorridos(fechaDevolucion, vencFactura) : null
      const vigente = dias !== null && dias >= 0

      lineas.push({
        remitoId: l.remitoId,
        remitoNro: l.remitoNro,
        ventaId: venta?.ventaId,
        ventaNro: venta?.ventaNro,
        productoId: prod.productoId,
        codigo: prod.codigo,
        nombre: prod.nombre,
        um: prod.um,
        cantidad: l.imputada,
        precioUnitario,
        moneda: venta?.enDolares ? 'Dólares' : 'Pesos',
        tipoCambio: venta?.enDolares ? venta.tipoCambio : undefined,
        iva,
        subtotal,
        ivaImporte,
        total: round2(subtotal + ivaImporte),
        vencimiento: vigente ? vencFactura : fechaDevolucion,
        vencimientoDelDia: !vigente,
        sinPrecio: venta === undefined,
      })
    }
  }

  const suma = (moneda: 'Pesos' | 'Dólares') =>
    round2(lineas.filter((l) => l.moneda === moneda).reduce((acc, l) => acc + l.total, 0))

  return {
    lineas,
    totalPesos: suma('Pesos'),
    totalDolares: suma('Dólares'),
    incompleta: lineas.some((l) => l.sinPrecio),
  }
}

/**
 * La nota de crédito lista para escribirse en "Notas de Credito Pends de Emitir", que es un tablero
 * MONO-MONEDA: sus columnas son "$".
 *
 * Las líneas facturadas en dólares se convierten con el tipo de cambio de SU factura original —el
 * mismo que ya arrastra la línea—, no con el del día: lo que se acredita es lo que el cliente pagó,
 * y recotizarlo hoy le daría de más o de menos según cómo se movió el dólar. Sin tipo de cambio
 * conocido la línea viaja tal cual: es preferible un importe corto y visible a inventarle una tasa.
 */
export interface LineaNotaCreditoAEmitir {
  productoId?: string
  codigo: string
  nombre: string
  um: string
  cantidad: number
  /** Precio unitario en PESOS (ya convertido si la factura era en dólares). */
  precioUnitario: number
  /** IVA de la línea, en pesos. */
  iva: number
  /** cantidad × precio unitario, en pesos. SIN IVA: el impuesto va en su propia columna. */
  subtotal: number
}

export interface NotaCreditoAEmitir {
  /** Vencimiento del documento, en dd/MM/yyyy. */
  vencimiento: string
  /** Suma de los subtotales de las líneas, SIN IVA, en pesos. */
  subtotal: number
  /** IVA de toda la nota, en pesos: la suma del de cada línea. */
  iva: number
  /** Importe total a acreditar (subtotal + IVA), en pesos. */
  total: number
  lineas: LineaNotaCreditoAEmitir[]
}

/** Importe de una línea llevado a pesos con el tipo de cambio de su factura original. */
const aPesos = (l: LineaNotaCredito, valor: number): number =>
  round2(l.moneda === 'Dólares' && l.tipoCambio ? valor * l.tipoCambio : valor)

/**
 * Convierte la nota de crédito calculada en lo que se escribe en el tablero.
 *
 * El vencimiento del documento es el MÁS TEMPRANO de sus líneas: si una de las facturas que corrige
 * vence antes que las otras, la nota tiene que estar disponible para entonces.
 *
 * Las líneas sin precio conocido NO entran: acreditar cero es peor que no acreditar, porque deja el
 * documento emitido y sin nada que reclamar. La pantalla ya avisa que la NC está incompleta.
 */
export function notaCreditoAMonday(nc: NotaCreditoPendiente): NotaCreditoAEmitir {
  const lineas = nc.lineas
    .filter((l) => !l.sinPrecio && l.cantidad > 0)
    .map((l) => ({
      productoId: l.productoId,
      codigo: l.codigo,
      nombre: l.nombre,
      um: l.um,
      cantidad: l.cantidad,
      precioUnitario: aPesos(l, l.precioUnitario),
      iva: aPesos(l, l.ivaImporte),
      /* NETO, sin IVA: el subelemento tiene "Precio Unit $" y "Subtotal" al lado de la cantidad,
         así que el subtotal tiene que ser cantidad × precio o la fila se contradice sola. El
         tablero no tiene columna de IVA, de modo que la nota se escribe neta. */
      subtotal: aPesos(l, l.subtotal),
    }))

  const vencimientos = nc.lineas
    .map((l) => parseDate(l.vencimiento))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())

  const subtotal = round2(lineas.reduce((acc, l) => acc + l.subtotal, 0))
  // El IVA del documento es la suma del de sus líneas: se calcula una vez, en un solo lugar.
  const iva = round2(lineas.reduce((acc, l) => acc + l.iva, 0))

  return {
    vencimiento: vencimientos.length > 0 ? formatDate(vencimientos[0]) : '',
    subtotal,
    iva,
    /* Como en el resto de los documentos de la app (ver la venta), el TOTAL incluye el IVA y la
       columna de IVA detalla qué parte de ese total es impuesto. */
    total: round2(subtotal + iva),
    lineas,
  }
}
