/**
 * Padrón de cheques ya recibidos ("🧾Cheques/eCheq en Cartera", board 18425237398).
 *
 * Sólo se LEE. Existe para una cosa: que un mismo cheque no entre dos veces. El control local
 * —contra los movimientos que están en pantalla— no alcanza, porque el duplicado típico no es
 * cargar dos veces en la misma pantalla sino volver a presentar mañana un cheque que ya se recibió
 * en otra operación, y de eso en el navegador no hay rastro.
 *
 * La identidad de un cheque son DOS datos juntos: el CUIT de quien lo libró y su número. El número
 * solo no alcanza —cada banco numera su chequera por su cuenta, y dos emisores distintos repiten
 * números todo el tiempo—, y el CUIT solo tampoco: un cliente entrega muchos cheques del mismo
 * emisor. Y todo eso acotado AL CLIENTE, porque el mismo cheque de un tercero puede haber sido
 * entregado legítimamente por otro cliente.
 */
import { COL, BOARDS } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/** Un cheque del padrón, con lo único que hace falta para compararlo. */
interface ChequeEnCartera {
  id: string
  nombre: string
  cuitEmisor: string
  numero: string
}

interface Respuesta {
  boards: { items_page: { items: ItemCrudo[] } }[]
}
interface ItemCrudo {
  id: string
  name: string
  column_values: { id: string; text: string | null }[]
}

/** Sólo los dígitos: es lo que hace comparables "30-71803864-9" y "30718038649". */
const digitos = (v: string | undefined): string => (v ?? '').replace(/\D/g, '')

/**
 * El número de cheque se compara SIN espacios y sin ceros a la izquierda: "00123456" y "123456" son
 * el mismo cheque escrito por dos personas distintas, y tratarlos como distintos dejaría pasar
 * justo el duplicado que se está buscando. Vacío queda vacío —no se convierte en "0"—.
 */
const nroComparable = (v: string | undefined): string => {
  const d = digitos(v)
  return d ? d.replace(/^0+/, '') || '0' : ''
}

/**
 * Las formas en que ese mismo número puede estar cargado en el tablero. Hace falta porque el
 * filtro del servidor es EXACTO: buscando "015935562" no encuentra al "15935562" que sí está, y el
 * control contestaría "libre" sobre un cheque duplicado. Comparar bien después no sirve de nada si
 * el ítem nunca vuelve en la consulta.
 */
const variantesNro = (nro: string): string[] => [
  ...new Set([nro, digitos(nro), nroComparable(nro)].filter(Boolean)),
]

/**
 * Cheques del padrón de ESE cliente cuyo número coincide con el buscado.
 *
 * El filtro por cliente va por el ID del ítem linkeado y el id viaja como NÚMERO, no como string:
 * con comillas la regla no matchea nada y la consulta devuelve vacío —o sea, "no hay duplicado"
 * para todos los casos, que es la forma más silenciosa posible de romper este control—.
 *
 * El número se filtra en el servidor —en todas sus formas, ver `variantesNro`— y el CUIT se compara
 * acá: en el tablero está cargado con guiones y en el formulario también, pero basta un ítem
 * cargado a mano sin ellos para que una comparación exacta del lado del servidor dijera "no hay
 * duplicado" sobre un cheque que sí está.
 */
async function buscarEnCartera(
  clienteId: string,
  numeroCheque: string,
): Promise<ChequeEnCartera[]> {
  const query = `query {
    boards(ids: [${BOARDS.chequesCartera}]) {
      items_page(limit: 100, query_params: {rules: [
        {column_id: "${COL.chequeCartera.cliente}", compare_value: [${Number(clienteId)}], operator: any_of},
        {column_id: "${COL.chequeCartera.numero}", compare_value: [${variantesNro(numeroCheque)
          .map((v) => `"${v.replace(/"/g, '\\"')}"`)
          .join(', ')}], operator: any_of}
      ]}) {
        items {
          id name
          column_values(ids: ["${COL.chequeCartera.cuitEmisor}", "${COL.chequeCartera.numero}"]) { id text }
        }
      }
    }
  }`
  const data = await mondayApi<Respuesta>(query)
  return (data.boards?.[0]?.items_page.items ?? []).map((it) => {
    const col = (id: string) => it.column_values.find((c) => c.id === id)?.text ?? ''
    return {
      id: it.id,
      nombre: it.name,
      cuitEmisor: col(COL.chequeCartera.cuitEmisor),
      numero: col(COL.chequeCartera.numero),
    }
  })
}

/**
 * ¿Este cliente ya entregó ESTE cheque? Devuelve el ítem del padrón que lo prueba, o `null`.
 *
 * Sin los tres datos NO se consulta y se responde `null`: es la respuesta honesta —no se comprobó
 * nada—, y el alta la frenan igual las validaciones del formulario, que exigen el número y el CUIT
 * completos antes de llegar hasta acá.
 */
export async function chequeDuplicado(
  clienteId: string | undefined,
  cuitEmisor: string | undefined,
  numeroCheque: string | undefined,
): Promise<ChequeEnCartera | null> {
  const nro = (numeroCheque ?? '').trim()
  const cuit = digitos(cuitEmisor)
  if (!clienteId || !cuit || !nro || !mondayHabilitado()) return null

  const candidatos = await buscarEnCartera(clienteId, nro)
  return (
    candidatos.find(
      (c) => digitos(c.cuitEmisor) === cuit && nroComparable(c.numero) === nroComparable(nro),
    ) ?? null
  )
}
