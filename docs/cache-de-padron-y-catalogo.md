# El caché de padrón y catálogo

Cómo y por qué la app dejó de preguntarle a Monday cada vez que alguien busca un cliente o un
producto.

Este documento explica **decisiones**, no código. Si venís a tocar algo de esto, leelo antes: casi
todo lo que parece una vuelta de más está resolviendo un problema concreto que ya se pagó.

---

## 1. El problema que se vino a resolver

La primera etapa de toda operación —presupuesto, venta, remito, actividad— es elegir el cliente. Y
la segunda, elegir productos. Las dos funcionaban igual:

> Escribo → aprieto **Buscar** → espero a que Monday pagine → me faltó una letra → vuelvo a empezar.

Cada intento era un viaje a la API. Equivocarse en una letra costaba otra vuelta completa. En la
etapa más tipeada de la app, eso se siente todo el día.

Además había un problema de fondo peor: **la búsqueda mentía**. Pedía una página de 50 resultados y
lo que no entraba simplemente no existía para la app, sin ningún aviso. Medido sobre el tablero
real, "MARIA" coincide con 135 clientes: se veían 50, y el vendedor concluía que su cliente no
estaba cargado.

---

## 2. La idea: traer una vez, buscar muchas

Los datos que se buscan —quiénes son los clientes, qué productos hay— **cambian poco y se consultan
muchísimo**. Un cliente nuevo se da de alta unas pocas veces por día; su nombre se tipea cientos de
veces.

Esa asimetría es la que habilita el caché: si una copia del padrón vive del lado del servidor y se
baja una sola vez por sesión, buscar deja de ser una consulta y pasa a ser un filtro en memoria.
Recorrer 2681 clientes cuesta **menos de un milisegundo**. A esa velocidad, la lista se puede
rearmar con cada tecla.

El cambio no es "más rápido". Es **otra cosa**: se pasa de "pedir y esperar" a "ver mientras
escribo".

---

## 3. Por qué un Cron Job, y no otra cosa

Había tres formas de mantener esa copia al día:

**Un webhook desde Monday.** Sería lo más fresco: Monday avisa cuando algo cambia. Se descartó
porque agrega una dependencia frágil —si el webhook falla o se desconfigura, el caché se queda
viejo y nadie se entera— y porque exige exponer otra ruta pública.

**Refrescar cuando alguien entra a la app.** Simple, pero el primero en entrar cada mañana paga la
espera completa, y con varios usuarios entrando a la vez se dispararían barridos simultáneos del
mismo tablero.

**Un Cron Job.** Corre solo, a intervalo fijo, sin que nadie lo dispare ni lo espere. El costo está
acotado y es predecible, y cuando falla falla en un lugar donde queda registrado, no en la cara del
usuario. Es lo que se eligió.

El frescor elegido es de **5 minutos**. Es el intervalo en el que un cliente recién dado de alta
aparece en el buscador — y para lo que no puede esperar esos 5 minutos existe el botón **Buscar**
(ver §7).

---

## 4. Dos modos de barrido, y por qué

El cron corre en dos modos distintos, y ésta es la decisión que más plata ahorra.

### El barrido COMPLETO

Recorre el tablero entero, guarda todo y —esto es lo importante— **reconcilia**: lo que estaba en el
caché y ya no aparece en el tablero se da de baja. Una persona eliminada, una que pasó a inactiva,
una que dejó de ser cliente: sin un barrido completo, esas siguen vivas en el caché para siempre, y
se las puede seguir eligiendo para vender.

Es la única corrida que puede darlas de baja, porque es la única que ve el padrón completo. Para las
otras, "no la vi" no significa nada.

Cuesta unos 68 segundos y 40 consultas. Corre **una vez por día**, de madrugada.

### El barrido INCREMENTAL

Le pide a Monday sólo lo modificado desde la corrida anterior, ordenado de más nuevo a más viejo, y
corta apenas llega a lo que ya procesó. Una consulta, unos 2 segundos.

Corre **cada 5 minutos**.

### Por qué no el completo cada 5 minutos

Porque sería tirar plata. Medido: 40 páginas, 68 segundos. Cada 5 minutos son **~5,4 horas por día
de tiempo de función** para descubrir, casi siempre, que no cambió nada — el padrón se toca un
puñado de veces por día. El incremental logra el mismo frescor por 2 segundos.

### La marca de agua

Para saber "desde dónde", cada caché guarda la fecha de modificación más nueva que ya procesó. La
corrida siguiente arranca de ahí.

Tres decisiones alrededor de esa marca:

- **Se solapa dos minutos hacia atrás.** Los relojes del servidor y de Monday no son el mismo, y un
  ítem modificado en el segundo exacto del corte se perdería para siempre. Repetir dos minutos no
  cuesta nada —guardar lo mismo dos veces no cambia nada— y cierra ese agujero.
- **Nunca retrocede.** El barrido completo mira sólo lo que entra al padrón; el incremental mira el
  tablero entero. La fecha más nueva que ve el primero puede ser anterior a la del segundo. Si la
  marca pudiera ir para atrás, cada barrido diario obligaría a recorrer días ya procesados.
- **No avanza si la corrida falló.** Así la siguiente reintenta el mismo tramo en vez de saltearlo.

### El filtro NO viaja en la consulta incremental

Esto parece un detalle y es de los más importantes del diseño.

La consulta incremental pide lo modificado **sin filtrar** por "es cliente o proveedor". Si el filtro
viajara en la consulta, la persona que pasa a inactiva —o que deja de ser cliente— simplemente
dejaría de aparecer en el resultado, y el caché no tendría forma de enterarse: se quedaría con ella
adentro, ofreciéndola para vender.

Sin filtro, llega igual, y el cron decide por ítem: si corresponde, se actualiza; si no, **se da de
baja**. La misma lógica vale para los productos.

---

## 5. Que una corrida no deje el caché a medias

Un caché a medias es **peor que no tener caché**: el buscador no encuentra cosas que existen, y nada
en pantalla dice por qué. Se ve idéntico a "eso no está cargado". Tres mecanismos lo evitan.

### Un lock entre corridas

Vercel avisa que puede disparar una invocación mientras la anterior sigue viva, y que ocasionalmente
repite una. Dos barridos completos simultáneos se pisan las marcas de "ya lo vi", y el barrido final
termina dando de baja filas que el otro todavía no alcanzó a tocar.

El lock vive en la base —no en memoria— porque en serverless cada instancia tiene su propia memoria
y un candado local no candaría nada. Y **vence solo**: una corrida que muere por timeout no puede
dejar el caché bloqueado para siempre.

### Todo es reconciliación, nunca incrementos

Correr el cron dos veces con los mismos datos tiene que dejar exactamente el mismo estado. Por eso
todo lo que hace es "dejá esta fila así", nunca "sumale uno a esto". Una corrida repetida es
inofensiva y una corrida perdida se recupera en la siguiente.

### Si una corrida falla, la siguiente barre entero

Ésta se agregó después de que un barrido muriera a mitad de camino. El caché quedó incompleto y las
corridas incrementales **no lo reparaban**: seguían desde la marca vieja y sólo traían lo que
cambiaba, así que las páginas que faltaban seguían faltando. El padrón quedó roto casi un día.

Ahora, un error registrado obliga a la corrida siguiente a barrer entero. El caché se repara solo en
la ventana siguiente en vez de esperar al barrido diario.

---

## 6. El cupo por campo de Monday

Aparte del límite general de la cuenta, Monday corta **por campo y por minuto**. El que se agota
primero es el que devuelve el valor calculado de una fórmula o una columna espejo.

No es un tecnicismo: cada persona del padrón trae su cuenta corriente con tres columnas espejo, así
que un barrido completo las pide casi 4000 veces. Mientras el padrón fue sólo de clientes eran 27
páginas y pasaba raspando; al sumar proveedores pasaron a ser 40 y el cupo se agotó a mitad del
barrido.

La lección fue que **un rechazo por cupo no es un error**: es el servidor diciendo "esperá unos
segundos". Los dos crones ahora esperan lo que el propio Monday indica y reintentan, en vez de morir
y dejar el caché a medias.

---

## 7. Qué se cachea y qué NO

Ésta es la decisión de la que depende que el caché sea seguro, y la regla es una sola:

> **Se cachea lo que sirve para ENCONTRAR. No se cachea lo que sirve para DECIDIR.**

El caché tiene hasta 5 minutos de antigüedad. Eso es perfectamente aceptable para saber que existe
un cliente llamado así; es inaceptable para decidir si se le puede vender.

### El crédito del cliente: se relee siempre

Al **elegir** un cliente, la app vuelve a leer ese cliente de Monday antes de cargarlo. De ese dato
salen el crédito disponible y la situación, y con eso se decide si una venta puede seguir. Cinco
minutos de antigüedad ahí significan dejar pasar una venta contra una línea de crédito que ya se
consumió.

Es una sola consulta, por un solo ítem, en el momento en que el usuario ya eligió. El caché sirvió
para llegar hasta ahí; el que decide plata es el dato fresco.

**Y si esa lectura falla, el cliente NO se carga.** Operar sobre un saldo que no se pudo confirmar es
exactamente lo que no se puede hacer.

### El stock del producto: se relee siempre

Mismo criterio. El caché guarda el maestro —precios, taxonomía, proveedor— pero **no las
cantidades**: se mueven con cada venta, y cachearlas sería mostrar un disponible que ya se vendió.
Al elegir un producto que vino del caché, se lee su stock contra Monday antes de entregarlo. Si esa
lectura falla, el producto no se carga: mostrarlo con el stock en cero sería peor que no mostrarlo.

### REGISTRAR ACTIVIDAD: no relee nada

La excepción que confirma la regla. Esa etapa no vende ni factura: la ficha muestra código, nombre,
dirección y estado, y los cuatro ya vienen en el caché. Ahí la relectura sólo agregaría media espera
y un modo de fallar —una actividad que no se puede cargar porque no se pudo leer un saldo que esa
pantalla ni muestra—. Así que no se hace.

### Los contactos: no se cachean

Se consultan a Monday cuando hacen falta. Se evaluó cachearlos y se descartó: son otro tablero,
con su propio ciclo, y sumaban un barrido más sin un beneficio claro.

### El botón Buscar: la salida de emergencia

El caché nunca es la única fuente. El botón **Buscar** sigue consultando Monday en vivo, y es la
salida para el cliente o el producto que se dio de alta hace dos minutos y que el cron todavía no
levantó. También es lo que mantiene la app usable si el caché no se pudo bajar: el live search no
funciona, pero la app queda como estaba antes de todo esto, no rota.

---

## 8. El live search: por qué el orden es el producto

Con el padrón en memoria, filtrar es trivial. Lo difícil es **ordenar**.

Lo que el usuario necesita no es "los que contienen lo que escribí" sino **"el que busco, primero"**.
Con la lista rearmándose en cada tecla, el que la encabeza es el que va a elegir sin leer el resto.

Por eso la coincidencia se puntúa **por capas**, de la más fuerte a la más débil: código exacto,
CUIT exacto, código que empieza así, nombre que empieza así, palabra del nombre que empieza así,
nombre que lo contiene, y último de todo, parecido difuso para el error de tipeo.

Las capas están separadas por huecos grandes a propósito: ninguna combinación de coincidencias
débiles puede treparse por encima de una coincidencia exacta de identificador.

Tres decisiones dentro de eso:

**Los identificadores se comparan EXACTOS.** Un código o un CUIT o es el que se buscó o no lo es.
Cuando la comparación era por subcadena, buscar el código "7001" también traía al cliente 2385,
cuyo CUIT termina en 7001. Ofrecer dos cuando se escribió uno solo es peor que no ofrecer ninguno:
invita a elegir al que no era, y de ahí sale una venta facturada a otro.

**El espacio no cuenta.** Nadie reproduce los espacios del nombre tal como quedó cargado: se tipea
"theautomationpartner" de un tirón. Las capas de nombre comparan contra una forma sin espacios ni
puntuación, en las dos puntas, así que escribirlo con o sin espacios es la misma búsqueda y da el
mismo orden.

**Las palabras sueltas también.** En productos, los nombres son largos y descriptivos ("ACAROX ULTRA
500 ML") y la gente escribe los pedazos que recuerda, en el orden que se le ocurren: "acarox 500".
Hay una capa dedicada a eso — cada palabra escrita tiene que arrancar alguna palabra del nombre, en
cualquier orden.

**Y cuando la lista se corta, se avisa.** Es la lección del bug original: el problema nunca fue el
tope, fue que el tope era **mudo**.

---

## 9. El cerrojo del buscador de clientes

El padrón guarda **clientes y proveedores** en la misma tabla: la app de ventas consume los primeros
y otra app consume los segundos. Eso trae un riesgo nuevo que antes no existía.

Ofrecer un proveedor como cliente de una venta es **facturarle a quien nos vende**. Es un error que
no se arregla después: queda un comprobante emitido a la persona equivocada.

Por eso hay **dos cerrojos**, y es deliberado:

1. **El servidor entrega sólo clientes.** La app pide explícitamente esa categoría y los proveedores
   ni siquiera llegan al navegador.
2. **El buscador vuelve a filtrar.** Aunque algo llegara de más, no se puede ofrecer.

Un cerrojo de más cuesta una comparación por tecla. El error que evita cuesta mucho más.

Hay una sutileza que el diseño tuvo que contemplar: una persona puede ser **cliente Y proveedor a la
vez**. Por eso cada registro guarda **todas** sus categorías, no una: quedarse con la primera dejaría
a esa persona afuera de una de las dos listas, y nadie se enteraría hasta no encontrarla.

---

## 10. Por qué se guarda el padrón en el navegador

La app vive en un iframe de monday.com y se recarga seguido. Sin guardar nada, cada recarga se baja
el padrón entero.

Guardarlo en el navegador hace que una recarga restaure la lista al instante y sólo pregunte *"¿qué
cambió desde la versión que tengo?"* — que en régimen es nada.

Se usa almacenamiento **de sesión** y no permanente a propósito: es la cartera de clientes con sus
límites y saldos, y no tiene por qué quedar escrita en el disco de la máquina más allá de la sesión.

**Y hay que decir el costo**, porque no es gratis: es la pieza más delicada de todo esto. Guardar la
lista junto con su versión es lo que convierte un problema pasajero del servidor en uno permanente
—si lo guardado queda vacío pero con una versión, el pedido siguiente es un delta, el servidor
contesta con razón que no cambió nada, y el padrón se queda vacío hasta que alguien borre el
almacenamiento a mano—. Ese caso ya está contemplado, pero el mecanismo merece respeto.

---

## 11. El delta y la versión

Cada caché tiene una **versión**: la fecha de modificación más nueva que hay adentro. El navegador la
guarda y la manda de vuelta; el servidor le contesta sólo con lo que cambió desde entonces.

Dos cosas que parecen detalles de implementación y son decisiones:

**La fecha de una fila sólo se mueve si sus datos cambiaron de verdad.** Si se pisara en cada
corrida, el barrido diario marcaría las 3906 personas como nuevas y todos los navegadores se
volverían a bajar el padrón entero cada noche — justo lo que este caché viene a evitar.

**La versión se lee ANTES que las filas, y las filas se acotan a ella.** Leída después, una escritura
del cron colada entre las dos consultas quedaría fuera del delta pero dentro de la versión, y el
navegador no volvería a pedir esa fila **nunca**: como su fecha no se mueve si los datos no cambian,
ninguna corrida posterior la rescata.

---

## 12. Trampas que ya se pagaron

Las que costaron tiempo, para que no se vuelvan a pagar.

**Un campo que no existe en la versión de API fijada.** Monday no ignora un campo desconocido:
rechaza la consulta **entera**. Una consulta de usuarios pedía un campo inexistente y lo que fallaba
no era ese dato sino la lectura de equipos completa — con lo cual todos, administradores incluidos,
quedaban con el rol más restrictivo. Se veía como "de golpe no puedo pisar un precio".

**El cupo por campo.** Ver §6.

**Precisión de fechas.** La base guarda microsegundos; las fechas de JavaScript llegan al
milisegundo. Al usar la versión para acotar, la fila que produjo el máximo quedaba afuera **de su
propia versión** por unas millonésimas — y esa fila es, por definición, la última modificada: justo
el cliente que alguien acaba de tocar y sale a buscar. No se recuperaba solo, porque la fecha no se
mueve si los datos no cambian.

**Un caché a medias es peor que ninguno.** Repetido acá porque es la lección que atraviesa todo el
diseño: los tres mecanismos de §5 existen por esto.

**Los fallos mudos son el enemigo.** Todos estos problemas se veían igual en pantalla: un buscador
que no encuentra nada. Por eso el servidor guarda el motivo del último fallo, la app lo dice por
consola, y existe un modo de diagnóstico.

---

## 13. Cuando algo no aparece en el buscador

En orden, de lo más barato a lo más caro:

1. **¿Está el caché sano?** El cron tiene un modo de sólo lectura que informa cuántas filas hay,
   cuántas entrega por categoría, si alguna quedó sin clasificar y cómo terminó la última corrida.
   Se consulta con el secreto del cron, sin abrir la base.
2. **¿Falló la última corrida?** El motivo queda guardado. Si hay error, la corrida siguiente va a
   barrer entero sola; se puede forzar antes.
3. **¿El navegador tiene un caché viejo?** Borrar el almacenamiento de sesión y recargar.
4. **¿El dato está bien en Monday?** Que la persona esté activa y tenga la categoría que
   corresponde. Un buscador que no la encuentra puede tener razón.

---

## En una línea

Se cachea lo que sirve para **encontrar**, nunca lo que sirve para **decidir**; el caché se mantiene
solo y se repara solo; y cuando algo falla, lo dice.
