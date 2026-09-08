import { useEffect, useRef, useState } from 'react'
import {
  ACEPTA_ARCHIVO,
  archivoNoSoportado,
  ErrorFatalMake,
  procesarComprobante,
  type ClienteLectura,
  type DatosComprobante,
} from '@/services/make'
import type { FormaPago } from '@/types'

/**
 * En qué anda la lectura del documento. Es lo único que decide qué muestra el recuadro: la consigna
 * de arrastre, la animación de la espera o el resultado, siempre en el MISMO lugar —el recuadro
 * tiene medidas fijas, así que ningún cambio de estado mueve los campos que están abajo—.
 *
 * `advertencia` es el estado de TODO lo que salió mal por el ARCHIVO: no se pudo leer nada de él, no
 * es el comprobante del medio elegido, o no lo emitió el cliente de la operación. Ninguno es una
 * falla —el circuito anduvo de punta a punta— y ninguno se arregla reintentando: se arregla
 * subiendo otro documento. Por eso van en ámbar y no en rojo.
 *
 * `error` queda para UNA sola cosa: que el escenario de Make no conteste. Ahí sí hay algo roto que
 * el usuario no puede arreglar, y el rojo lo dice.
 */
type Estado = 'vacio' | 'procesando' | 'listo' | 'advertencia' | 'error'

/**
 * Cómo se llama el papel de cada medio de cobro. Se usa para nombrar lo que se esperaba cuando lo
 * que se subió es otra cosa: "no es un Cheque" dice bastante más que "no es válido".
 *
 * Lleva el artículo adentro porque no es el mismo para todos, y "NO es un Transferencia" se lee
 * como un texto armado por una máquina.
 */
const rotuloComprobante = (formaPago: FormaPago): string => {
  if (formaPago === 'Cheque') return 'un Cheque o eCheq'
  if (formaPago === 'Transferencia') return 'un Comprobante de Transferencia'
  if (formaPago.startsWith('Tarjeta')) return `un Cupón de ${formaPago}`
  if (formaPago.startsWith('Retencion')) return `un Certificado de ${formaPago}`
  return `un comprobante de ${formaPago}`
}

interface LectorComprobanteProps {
  /** id del `input[type=file]` oculto, para enganchar el `<label htmlFor>` del campo. */
  id: string
  /** Medio que se está cargando. Viaja al escenario: es el contexto con el que lee el documento. */
  formaPago: FormaPago
  /**
   * Cliente de la operación. Viaja al escenario junto con el documento: es lo único con lo que Make
   * puede contestar si el comprobante fue emitido por él. Sin esto esa validación no existe.
   */
  cliente?: ClienteLectura | null
  /** Documento cargado, que vive en el borrador del movimiento. `null` = todavía no hay nada. */
  archivo: File | null
  /** Entrega el documento para que quede en el borrador. */
  onArchivo: (archivo: File) => void
  /**
   * Saca el comprobante Y vacía los campos que ese documento había completado. Es una sola acción
   * porque son una sola cosa: dejar los datos de un comprobante que ya no está es peor que no
   * tenerlos —se registran igual, y nadie los va a mirar de nuevo—.
   */
  onQuitar: () => void
  /**
   * Vuelca sobre el formulario los datos que devolvió el escenario, ya normalizados, y responde
   * CUÁNTOS entraron. El número lo pone quien los recibe y no quien los lee, porque cuáles
   * corresponden depende del medio de cobro: un dato que este medio no muestra no se cargó en
   * ningún lado, y contarlo sería anunciar un campo completo que el usuario no va a encontrar.
   */
  onDatos: (datos: DatosComprobante) => number
  /**
   * Campos obligatorios del medio que la lectura NO pudo completar, por su nombre visible. Vacío
   * mientras no haya corrido una lectura, o cuando el documento los trajo a todos.
   *
   * Los calcula el formulario, que es el único que sabe qué pide cada medio y qué quedó cargado.
   * Acá sirven para decir QUÉ falta: "procesado correctamente" con dos campos en rojo más abajo
   * manda a buscar el problema en vez de nombrarlo.
   */
  faltantes?: readonly string[]
  /**
   * Reclamo del formulario cuando el comprobante es OBLIGATORIO y todavía no se cargó ninguno.
   *
   * Se muestra adentro del recuadro y no debajo: el recuadro tiene alto fijo, así que el mensaje
   * aparece y desaparece sin mover ni un pixel de lo que hay alrededor. Afuera, cada vez que se
   * intentaba agregar el movimiento, el bloque entero cambiaba de alto.
   */
  error?: string
  /** El formulario está cerrado: no se carga ni se procesa nada. */
  deshabilitado?: boolean
}

/**
 * CARGA AUTOMÁTICA del comprobante: el usuario suelta el documento (PDF o imagen) y los campos del
 * medio de cobro se completan solos con lo que lee un escenario de Make.com.
 *
 * Son dos piezas, una al lado de la otra:
 *
 *   · el RECUADRO donde se suelta el archivo, con la consigna adentro; cargado, muestra el ícono
 *     del formato y confirma que el documento entró, y clickearlo lo reemplaza;
 *   · la ZONA DE ESTADO a su derecha, con el lugar YA reservado para el spinner del procesamiento y
 *     el resultado: el visto verde de "Procesado correctamente" o la advertencia de que la lectura
 *     no trajo ningún dato.
 *
 * Los campos del medio de cobro quedan DEBAJO: lo que llega de Make se vuelca ahí, a la vista y
 * editable. Nada se registra en Monday sin pasar por esos campos, así que un OCR que se equivoca se
 * corrige antes de agregar el movimiento.
 */
export function LectorComprobante({
  id,
  formaPago,
  cliente,
  archivo,
  faltantes = [],
  error,
  onArchivo,
  onQuitar,
  onDatos,
  deshabilitado = false,
}: LectorComprobanteProps) {
  const [estado, setEstado] = useState<Estado>('vacio')
  /**
   * Qué decir del estado actual: el encabezado y, debajo, qué hacer al respecto. Van juntos porque
   * un aviso sin salida es la mitad del mensaje: el que ve "no es un cheque" ya sabe que algo pasó,
   * lo que necesita es que le digan qué subir.
   */
  const [aviso, setAviso] = useState({ titulo: '', detalle: '' })
  const [campos, setCampos] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  /** Reintentar sirve para la llamada que falló, no para el documento equivocado: volver a leer el
      mismo archivo va a dar el mismo rechazo. */
  const [reintentable, setReintentable] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  /* Llamada en curso. Se aborta al cargar otro documento: la respuesta de un archivo que ya no está
     no puede volcarse sobre los campos del que lo reemplazó. */
  const enVuelo = useRef<AbortController | null>(null)
  /** Último documento que se mandó a leer. Es lo que evita procesar dos veces el mismo archivo. */
  const procesado = useRef<File | null>(null)

  /**
   * El disparador de TODO el circuito: apenas hay un documento nuevo en el borrador, se manda a
   * leer. Cuelga del archivo y no del click para cubrir las dos puertas de entrada por igual —el
   * recuadro de acá arriba y el "Comprobante" de más abajo, que es el mismo campo del borrador—:
   * suba por donde suba, el documento se procesa una sola vez.
   *
   * Sin archivo el lector vuelve a cero: el estado es DEL DOCUMENTO, así que cuando el borrador se
   * limpia —movimiento agregado, cambio de medio, adjunto quitado— no queda un "procesado
   * correctamente" hablando de un archivo que ya no está.
   */
  useEffect(() => {
    if (!archivo) {
      enVuelo.current?.abort()
      procesado.current = null
      setEstado('vacio')
      setAviso({ titulo: '', detalle: '' })
      setCampos(0)
      setReintentable(false)
      return
    }
    if (procesado.current === archivo) return
    procesado.current = archivo

    /* El archivo puede haber entrado por el adjunto de abajo, que no filtra formatos: lo que no se
       puede leer se dice acá, sin gastar la llamada al escenario. */
    const problema = archivoNoSoportado(archivo)
    if (problema) {
      // Es el archivo, no el sistema: mismo criterio que los rechazos del escenario.
      setEstado('advertencia')
      setAviso({ titulo: 'El archivo no se puede leer', detalle: problema })
      setReintentable(false)
      return
    }
    void leer(archivo)
    /* Depende del ARCHIVO y de nada más: `leer` se recrea en cada render y meterlo acá volvería a
       procesar el mismo documento con cada tecla que se toque en el formulario. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivo])

  // Al desmontar (cambio de paso, cierre del formulario) no queda ninguna llamada colgada.
  useEffect(() => () => enVuelo.current?.abort(), [])

  /**
   * Manda el documento al escenario y vuelca lo que devuelva. La declaración va DESPUÉS del efecto
   * que la dispara —el efecto corre recién después del render, así que ya existe—, para que los
   * efectos queden juntos arriba y el circuito se lea de una.
   */
  const leer = async (f: File) => {
    enVuelo.current?.abort()
    const ctrl = new AbortController()
    enVuelo.current = ctrl

    setEstado('procesando')
    setAviso({ titulo: '', detalle: '' })
    setCampos(0)
    setReintentable(false)
    try {
      /* Se espera al escenario ENTERO: la promesa recién se resuelve cuando Make devuelve lo que
         leyó la IA, no cuando acusa recibo del archivo. Si el escenario todavía no está en
         condiciones de atender, el servicio insiste solo y avisa por `onReintento`: la espera se
         cuenta en pantalla en lugar de fallar al primer intento. */
      const lectura = await procesarComprobante(f, formaPago, {
        cliente,
        signal: ctrl.signal,
        onReintento: (intento, total, esperaMs) => {
          if (ctrl.signal.aborted) return
          setAviso({
            titulo: '',
            detalle: `El servidor no está respondiendo. Reintentamos en ${Math.round(esperaMs / 1000)} segundos (intento ${intento} de ${total - 1}).`,
          })
        },
      })
      // Abortada: llegó tarde y el formulario ya es de otro documento.
      if (ctrl.signal.aborted) return

      /* El escenario miró el documento y lo rechazó. No hay nada que volcar ni que reintentar: lo
         que corresponde es cambiar el archivo, y eso es lo que dice el aviso. */
      if (lectura.rechazo) {
        setEstado('advertencia')
        setAviso(
          lectura.rechazo.motivo === 'cliente'
            ? {
                titulo:
                  'Error: El comprobante asignado NO fue emitido por el cliente seleccionado en la operación',
                detalle: 'Cargá el comprobante emitido que corresponde al cliente seleccionado.',
              }
            : {
                titulo: `Error: El documento ingresado NO es ${rotuloComprobante(formaPago)}`,
                detalle: lectura.rechazo.tipoDetectado
                  ? `Se reconoció "${lectura.rechazo.tipoDetectado}". Cargá el comprobante que corresponde al medio de cobro elegido.`
                  : 'Cargá el comprobante que corresponde al medio de cobro elegido.',
              },
        )
        return
      }

      // Terminó la lectura: los datos se cargan en los campos del medio y se cuenta qué entró.
      const cargados = onDatos(lectura.datos)
      setCampos(cargados)

      /* Sin un solo campo cargado NO se canta victoria: se advierte, y se dice QUÉ mirar según
         dónde se cortó la cadena —el escenario que no responde, el que responde sin datos, o el
         que devolvió datos de otro medio de cobro—. */
      if (cargados === 0) {
        setEstado('advertencia')
        setReintentable(true)
        setAviso({
          titulo: 'No se obtuvieron los datos',
          detalle: !lectura.respondioJson
            ? 'El servidor recibió el documento pero no devolvió ningún dato. Cargá los campos a mano o volvé a intentar.'
            : lectura.campos === 0
              ? 'El documento se leyó, pero no se reconoció ningún dato. Cargá los campos a mano o volvé a intentar.'
              : `Los datos leídos no corresponden a ${formaPago}. Revisá que el documento sea el del medio de cobro elegido.`,
        })
        return
      }
      setEstado('listo')
    } catch (e) {
      if (ctrl.signal.aborted) return
      /* Lo ÚNICO que queda en rojo: el escenario no contestó. No es el archivo —ese caso ya salió
         por arriba, en ámbar— sino la plataforma, y no hay documento que lo arregle. */
      setEstado('error')
      setReintentable(!(e instanceof ErrorFatalMake))
      setAviso({
        titulo: 'No se pudo procesar el documento',
        detalle: e instanceof Error ? e.message : 'No se pudo procesar el documento.',
      })
    } finally {
      if (enVuelo.current === ctrl) enVuelo.current = null
    }
  }

  /**
   * Toma el archivo elegido o soltado y lo deja en el borrador; procesarlo es cosa del efecto de
   * arriba. Lo que no se puede leer se rechaza ACÁ y NO se carga: un .zip que igual quedara
   * adjunto daría por cumplido el comprobante obligatorio del movimiento.
   */
  const tomar = (f: File | null | undefined) => {
    if (cerrado || !f) return
    const problema = archivoNoSoportado(f)
    if (problema) {
      setEstado('advertencia')
      setAviso({ titulo: 'El archivo no se puede leer', detalle: problema })
      setReintentable(false)
      return
    }
    onArchivo(f)
  }

  /* El recuadro hace SIEMPRE lo mismo, con o sin documento cargado: abrir el buscador de archivos.
     Cargado, eso es reemplazarlo, que es la única acción sobre un comprobante ya subido. */
  const abrirBuscador = () => inputRef.current?.click()

  /* Lectura a medias: el documento se procesó —eso es un éxito y así se muestra—, pero quedaron
     campos obligatorios que no salieron de él y hay que cargar a mano. Se reclama al pie, sin
     tocar el resultado de la lectura. */
  const incompleto = estado === 'listo' && faltantes.length > 0

  /**
   * El trabajo del recuadro está TERMINADO: el documento se procesó y de él salieron todos los
   * datos que este medio necesita. A partir de ahí la zona se cierra —no acepta clicks ni archivos
   * arrastrados—, porque cualquier documento nuevo borraría los campos ya completos para volver a
   * leerlos, y no hay nada que ganar volviendo a leer lo que ya está bien.
   *
   * Se reabre sola si alguno de esos campos queda vacío: ahí sí un comprobante nuevo tiene algo que
   * aportar.
   */
  /* El comprobante obligatorio se reclama sólo con el recuadro VACÍO: si hubo un problema con el
     archivo, el mensaje del error dice algo más útil que "cargá el comprobante". */
  const reclamo = estado === 'vacio' ? error : undefined
  const listoYCompleto = estado === 'listo' && faltantes.length === 0
  /**
   * El recuadro NO acepta nada. Son tres motivos distintos con el mismo efecto:
   *
   *   · el formulario está cerrado —el cobro ya se registró—;
   *   · hay una lectura EN CURSO: hasta que termine no entra otro documento. Aceptarlo abortaría la
   *     llamada a mitad de camino y dispararía una segunda, con el escenario procesando dos veces
   *     el mismo cobro y los campos completándose con lo que devuelva la que conteste última;
   *   · ya se procesó uno y de él salieron todos los datos que este medio necesita, así que un
   *     documento nuevo sólo borraría campos que están bien para volver a leerlos.
   *
   * Lo del medio se reabre solo al terminar la lectura; lo último, si alguno de esos campos queda
   * vacío: ahí sí un comprobante nuevo tiene algo que aportar.
   */
  const cerrado = deshabilitado || estado === 'procesando' || listoYCompleto

  return (
    /* El recuadro ENTERO es la zona de soltado, y adentro pasa todo: la consigna, el estado de la
       lectura y el documento cargado con sus acciones. */
    <div
      /* El realce del arrastre se apaga con la zona cerrada: si el último dato entra JUSTO mientras
         se arrastra un archivo encima, el `dragleave` ya no llega y el resalte quedaría prendido. */
      className={`cobro-lector cobro-lector--${estado} ${dragOver && !cerrado ? 'is-over' : ''} ${
        reclamo ? 'is-falta' : ''
      }`}
      onDragOver={(e) => {
        // Sin `preventDefault` el navegador no deja soltar acá: cerrado, se lo deja rechazar solo.
        if (cerrado) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (cerrado) return
        e.preventDefault()
        setDragOver(false)
        tomar(e.dataTransfer.files?.[0])
      }}
    >
      {/* Botón transparente que cubre el recuadro entero: es el que abre el buscador y el que
          recibe el foco del teclado. Va como HERMANO del contenido y no envolviéndolo, porque un
          botón no puede anidar los botones del documento cargado —"Reemplazar", "Quitar"—, que
          quedan por encima con su propio z-index. */}
      <button
        type="button"
        className="cobro-lector-hit"
        /* Cerrado, el botón se apaga de verdad: no se clickea, no recibe el foco del tabulador y
           no muestra el cursor de mano. La zona deja de ser un control. */
        disabled={cerrado}
        title={
          estado === 'procesando'
            ? 'Esperá a que termine de procesarse el documento'
            : listoYCompleto
              ? 'El comprobante ya se procesó y completó todos los datos'
              : archivo
                ? 'Reemplazar el comprobante cargado'
                : 'Arrastrá para subir · PDF o imagen, hasta 4 MB'
        }
        aria-label={
          estado === 'procesando'
            ? 'Procesando el documento: esperá a que termine para cargar otro'
            : listoYCompleto
              ? `Comprobante procesado: ${archivo?.name ?? ''}. Ya completó todos los datos`
              : archivo
                ? `Comprobante cargado: ${archivo.name}. Hacé click para reemplazarlo`
                : 'Subir el comprobante: arrastrá el archivo o hacé click para elegirlo'
        }
        onClick={abrirBuscador}
      />

      <input
        ref={inputRef}
        id={id}
        type="file"
        hidden
        accept={ACEPTA_ARCHIVO}
        onChange={(e) => {
          tomar(e.target.files?.[0])
          // Se limpia el valor para que volver a elegir EL MISMO archivo dispare el `change`.
          e.target.value = ''
        }}
      />

      {/* TODO el feedback pasa por acá adentro, en el mismo lugar donde se soltó el archivo: la
          animación de la espera y su resultado no obligan a buscarlos en otra parte de la
          pantalla. `aria-live` hace que se lea solo al cambiar, sin mover el foco. */}
      <span className={`cobro-lector-cara cobro-lector-cara--${estado}`} aria-live="polite">
        {estado === 'procesando' && (
          <>
            <span className="cobro-lector-spin" aria-hidden="true" />
            <span className="cobro-lector-titulo">Procesando el documento…</span>
            {/* Mientras se reintenta, el detalle cuenta lo que está pasando: la espera larga se
                entiende, una pantalla quieta sin explicación parece colgada. */}
            <span className="cobro-lector-consigna">
              {aviso.detalle || 'Estamos leyendo el comprobante para completar los campos'}
            </span>
          </>
        )}

        {/* El documento SE PROCESÓ: eso es lo que informa el visto verde, y vale igual aunque de
            adentro no haya salido todo. Lo que falte se reclama abajo, junto al archivo. */}
        {estado === 'listo' && (
          <>
            <i className="fas fa-circle-check" aria-hidden="true" />
            <span className="cobro-lector-titulo">Procesado correctamente</span>
            <span className="cobro-lector-consigna">
              Se {campos === 1 ? 'completó' : 'completaron'} {campos}{' '}
              {campos === 1 ? 'campo' : 'campos'}: revisalos antes de agregar el movimiento
            </span>
          </>
        )}

        {/* Advertencia: el documento viajó y volvió, pero no trajo nada. Ni verde ni rojo —el
            procesamiento no se completó, y tampoco hubo un error de comunicación—. */}
        {/* ADVERTENCIA: el circuito anduvo y el problema es el archivo —no trajo datos, no es el
            comprobante del medio elegido, o no lo emitió el cliente—. Ámbar y no rojo: nada está
            roto, y lo que hay que hacer es subir otro documento. */}
        {estado === 'advertencia' && (
          <>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />
            <span className="cobro-lector-titulo">{aviso.titulo}</span>
            <span className="cobro-lector-consigna">{aviso.detalle}</span>
          </>
        )}

        {estado === 'error' && (
          <>
            {/* El error fatal se ve distinto desde el ícono: no es "falló, probá de nuevo" sino
                "con este archivo no se puede". */}
            <i className="fas fa-circle-exclamation" aria-hidden="true" />
            <span className="cobro-lector-titulo">{aviso.titulo}</span>
            <span className="cobro-lector-consigna">{aviso.detalle}</span>
          </>
        )}

        {/* La consigna vive DENTRO del recuadro: es la instrucción de esta zona, y leerla afuera
            obligaría a atar con la vista un texto suelto al lugar donde hay que soltar el
            archivo. El ícono va al pie, después del texto que lo explica. */}
        {estado === 'vacio' && (
          <>
            <span className="cobro-lector-titulo">Arrastrá para subir</span>
            <span className="cobro-lector-consigna">
              Soltá en este área tu comprobante —PDF o imagen— y completamos los campos
              automáticamente
            </span>
            <i className="fas fa-cloud-arrow-up" />
            {/* La ranura del reclamo se monta SIEMPRE, con o sin mensaje: tiene su alto reservado,
                así que aparecer o desaparecer no mueve ni el título ni el ícono de arriba. Montarla
                sólo cuando hay algo que decir sumaba un cuarto hijo a una cara centrada, y todo lo
                anterior se corría unos pixeles para arriba. */}
            <span className="cobro-lector-reclamo" role="alert">
              {reclamo}
            </span>
          </>
        )}
      </span>

      {/* El documento cargado y sus acciones, DEBAJO del mensaje de estado y centrado con él: son
          del archivo que se está mirando, así que se leen a continuación de lo que pasó con él. */}
      {archivo && (
        <span className="cobro-lector-archivo">
          <i className="fas fa-paperclip" aria-hidden="true" />
          <span className="cobro-lector-nombre" title={archivo.name}>
            {archivo.name}
          </span>
          {/* Reintentar sirve para las DOS formas de quedarse sin datos: la llamada que falló y la
              que volvió vacía. En las dos el documento sigue cargado y el siguiente intento puede
              salir bien —un escenario recién activado, una IA que esta vez sí leyó—. */}
          {reintentable && !deshabilitado && (
            <button
              type="button"
              className="cobro-lector-accion"
              onClick={() => void leer(archivo)}
            >
              Reintentar
            </button>
          )}
          {/* "Eliminar" está SIEMPRE, haya salido bien o mal: el que se equivocó de archivo tiene que
              poder sacarlo, y con él los campos que ese documento completó. "Reemplazar" seguía
              existiendo —el recuadro abre el buscador— pero como botón no aportaba: subir otro
              encima ya hacía eso, y lo que faltaba era la vuelta atrás. */}
          {!deshabilitado && (
            <button
              type="button"
              className="cobro-lector-accion cobro-lector-accion--quitar"
              onClick={onQuitar}
              title="Quitar el comprobante y vaciar los campos que completó"
            >
              Eliminar
            </button>
          )}
        </span>
      )}

      {/* Lo que la lectura NO trajo, en rojo y al pie: la lectura salió bien —arriba lo dice el
          visto verde—, pero el movimiento no se puede agregar hasta que alguien complete esto. Se
          NOMBRA cada campo, porque un "faltan datos" a secas manda a recorrer el formulario. */}
      {incompleto && (
        <span className="cobro-lector-falta" role="alert">
          <i className="fas fa-circle-exclamation" aria-hidden="true" />{' '}
          {faltantes.length === 1 ? 'No se pudo leer' : 'No se pudieron leer'}{' '}
          <strong>{faltantes.join(', ')}</strong>: completá{faltantes.length > 1 ? 'los' : 'lo'} a
          mano para poder agregar el movimiento
        </span>
      )}
    </div>
  )
}
