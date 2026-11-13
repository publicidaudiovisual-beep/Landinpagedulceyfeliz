# Publicación automática del catálogo

El panel guarda los cambios de productos, stock, presentación, anuncios y galería en `catalog-data.json` mediante un commit a GitHub. Si el proyecto de Vercel está conectado a ese repositorio y rama de producción, cada guardado inicia un despliegue automático.

## Configuración en Vercel

En **Project Settings → Environment Variables**, agrega estas variables para **Production**:

| Variable | Valor |
|---|---|
| `ADMIN_PASSWORD` | Contraseña administrativa única de al menos 16 caracteres (recomendado: 32 caracteres aleatorios o más). |
| `GITHUB_TOKEN` | Token de acceso fino limitado a este repositorio, con permiso **Contents: Read and write**. |
| `GITHUB_REPOSITORY` | Repositorio conectado, con formato `propietario/nombre`. |
| `GITHUB_BRANCH` | Rama de producción conectada a Vercel (por ejemplo, `main`). |
| `UPSTASH_REDIS_REST_URL` | URL REST de una base Redis de Upstash. |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST de Upstash con permiso de lectura y escritura. |

No escribas estos secretos en el código ni los compartas por chat. Después de guardarlos, vuelve a desplegar el proyecto para que la función de Vercel los reciba.

### Configurar el contador de visitas

1. Crea una base Redis en [Upstash](https://console.upstash.com/) y copia la **REST URL** y el **REST TOKEN** desde los detalles de la base.
2. En Vercel, abre **Project Settings → Environment Variables** y agrega `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` para **Production**.
3. Vuelve a desplegar el proyecto. Cada carga de la página principal incrementa un contador persistente; el panel de administración lo consulta para el KPI de visitas.

### Acceso directo instalable y código QR

La tienda puede agregarse a la pantalla de inicio como una aplicación web (PWA), sin pasar por App Store o Play Store. El manifiesto, los íconos y el service worker se publican junto al sitio; el service worker solo conserva esos recursos de instalación y no almacena pedidos ni datos de clientes. El nuevo isotipo se utiliza para el icono del acceso directo. Al abrir el sitio aparece un aviso flotante para instalar o agregar el acceso, con el logo sobre fondo oscuro. Si el cliente lo descarta, se oculta durante 30 días en ese dispositivo. Al abrir la app instalada, se reproduce un video de bienvenida sin sonido mientras carga la tienda; se interrumpe al terminar la carga. Si no puede reproducirse o el usuario prefiere reducir el movimiento, se muestra solo el fondo oscuro hasta que termina la carga. El video no forma parte de la caché del service worker. En una visita normal desde el navegador no aparece. La pantalla nativa que muestra el dispositivo antes de cargar la página no puede mostrar este video.

El archivo `QR-Tienda-Dulce-y-Feliz.png` contiene únicamente el código QR de la marca y dirige a `https://www.dulceyfeliz.online/`. Para compartir un enlace que vuelva a mostrar el aviso de instalación aunque se haya cerrado antes, se puede enviar `https://www.dulceyfeliz.online/?instalar=1`. El navegador no permite lanzar la instalación sin una acción del cliente: debe tocar **Agregar al inicio** y confirmar. En iPhone, se indican los pasos de Safari → **Compartir** → **Agregar a pantalla de inicio**; en Android compatible, se abre el aviso nativo de instalación.

Los iconos nuevos usan rutas versionadas para ayudar a actualizar los accesos existentes. Si un dispositivo conserva el icono anterior después de actualizarse, hay que quitar el acceso directo antiguo y agregarlo nuevamente desde la página.

En el pie de página, los celulares muestran el logo optimizado para móvil; en pantallas grandes se reproduce en silencio el video comprimido en bucle. Si el dispositivo tiene activada la preferencia de movimiento reducido, se muestra la imagen estática.

### Registro de pedidos y descuento de inventario

El sitio guarda un pedido en Upstash antes de abrir WhatsApp. Esto registra que se inició el pedido, pero no confirma que el cliente haya enviado el mensaje. Se conservan como máximo 2.000 pedidos; el más antiguo se elimina al superar el límite. El panel los agrupa por día (hora de Argentina). Los pedidos eliminados antes de aumentar el límite no se recuperan.

Cada pedido recibe un número correlativo `DF-000001`, compartido por los pedidos iniciados por WhatsApp y por Nave. Los pedidos anteriores reciben números estables automáticamente al consultar o registrar pedidos.

Para envíos, el formulario solicita si el destino es una casa o una empresa. Si es una empresa, también solicita el horario de recepción; estos datos aparecen en el pedido del panel y en el mensaje de WhatsApp. El horario se coordina con el conductor y no garantiza disponibilidad.

Los pedidos compuestos únicamente por hasta tres cajitas individuales son solo para retiro en Villa Dominico. A partir de cuatro cajitas individuales se permite seleccionar envío; la restricción no se aplica si el pedido incluye una caja grande.

En **Pedidos generados**, selecciona y guarda el estado correspondiente: **Compra concretada**, **Compra con devolución**, **Compra no concluida** o **Compra rechazada**. Solo **Compra concretada** descuenta las cantidades del catálogo en GitHub; los demás estados no modifican el stock. El descuento es idempotente y no se repite al actualizar un pedido. Los pagos aprobados por Nave se registran automáticamente como compra concretada.

Para pedidos coordinados por WhatsApp, elegí el **medio de pago acordado** antes de concretar la compra: efectivo, transferencia bancaria, Postnet (QR, débito o crédito) u otro con descripción. Podés guardarlo o corregirlo desde **Pedidos generados** o **Envíos**. Se conserva por separado el medio elegido inicialmente por el cliente, y el ticket del cliente usa el medio acordado. La selección no modifica los pagos verificados por Nave ni el estado de pago del envío.

Si corregís el medio, también se actualiza el trabajo de impresión pendiente. Si está imprimiéndose o en revisión, resolvé la cola antes de cambiarlo. Una vez impreso, podés corregir el pedido y volver a imprimir el ticket manualmente; los PDF ya guardados no se modifican. Para pedidos antiguos sin medio acordado, el ticket sigue mostrando el medio elegido inicialmente hasta que lo cargues.

Los pedidos se consultan en su propia pestaña, con buscador y páginas de hasta 20 resultados. La pestaña de envíos también ofrece buscador y páginas de hasta 20 pedidos. El buscador acepta número de pedido, cliente, teléfono, producto, estado y datos de entrega; la descarga CSV sigue incluyendo todos los pedidos conservados. En la página principal, el gráfico resume las compras concretadas por fecha de confirmación, únicamente entre los últimos 2.000 pedidos. Ofrece 7 días, 30 días, 6 meses calendario o 1 año calendario hasta hoy, en hora argentina; las barras muestran cantidades y sus detalles incluyen importes. Las compras devueltas o no concretadas no se cuentan. El historial puede estar incompleto para períodos largos porque el registro elimina los pedidos más antiguos al superar 2.000.

El panel recibe los pedidos en respuestas limitadas por tamaño para evitar superar el límite de respuesta de Vercel. Redis conserva el registro completo y también guarda otros datos de la tienda; el tamaño real, la transferencia y los comandos dependen del uso. Revisá periódicamente el consumo y los límites en la consola de Upstash y, si hace falta, contratá un plan pago antes de alcanzarlos.

Esta función requiere `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY` y `GITHUB_BRANCH` en Vercel. El token de GitHub debe tener permiso **Contents: Read and write**. Si falta alguna configuración o GitHub no puede actualizar el catálogo, el pedido queda pendiente y el panel muestra el error para poder reintentar.

En los despliegues que no sean de Producción, el sistema agrega el sufijo `:sandbox` a las claves de pedidos, secuencia y visitas en Redis. Así se puede reutilizar la misma base de Upstash sin mezclar esos datos con los de Producción. Configura las credenciales de esa base también para **Preview**; no copies sus valores en el código ni los compartas.

### Envíos por empresas privadas

El cliente puede elegir retiro, envío por una empresa privada o coordinación por WhatsApp. Para una empresa privada se recopilan los datos de entrega, la localidad y el tipo de destino; para empresas destinatarias se solicita además el horario de recepción. El cliente puede sumar el envío al pago de la compra o pagarlo aparte por transferencia. El pedido debe cargarse y gestionarse en el panel de la empresa logística; la tienda no crea envíos ni obtiene seguimiento automáticamente.

En la pestaña **Envíos** del panel se consultan los pedidos con envío y se administran zonas compartidas y tarifas por empresa con IVA incluido. El panel calcula el precio orientativo con el 7 % adicional. La configuración se guarda en Upstash con las mismas credenciales del registro de pedidos; los datos de pruebas y producción están separados. Si no existe configuración guardada, Vima inicia activa con los importes de la vista previa; la configuración ya guardada conserva su estado. Revisa tarifas, localidades y el eventual recargo por recolección.

Por empresa se pueden marcar días laborables, registrar un horario informativo y cargar manualmente un cierre excepcional por vacaciones, feriado o causas mayores, con fechas de inicio y fin inclusive. Para un cierre temporal hay que dejar la empresa habilitada y seleccionar el motivo y las fechas; la pausa manual deshabilita la empresa hasta reactivarla. Por vacaciones, causas mayores o en días no laborables sin feriado, el cliente ve la causa y no puede seleccionar la empresa. Durante un feriado cargado manualmente, puede seleccionarla y continuar únicamente si acepta que el pedido se gestione a partir del primer día laborable posterior al cierre; la fecha y la aceptación quedan registradas en el pedido. El servidor comprueba la disponibilidad y la aceptación al registrar el pedido. Si no hay días laborables configurados, la empresa no se ofrece durante el feriado.

Las fechas se evalúan en hora de Buenos Aires. Al terminar el cierre vuelve a regir la configuración habitual. Las empresas sin días configurados y las nuevas usan de lunes a sábado; los días ya guardados se conservan y pueden modificarse en el panel. No se consultan feriados automáticamente. El horario escrito es informativo y no bloquea por hora; la fecha de gestión no garantiza la entrega ese mismo día.

El formulario de empresa privada muestra una barra y un contador hasta las 12:00 de Buenos Aires para la fecha de recolección prevista. Desde las 12:00 se calcula el próximo día laborable, omitiendo los cierres configurados. El servidor comprueba la fecha al registrar el pedido; si cambió mientras el cliente completaba el formulario, debe actualizar la página y volver a revisar el envío. La recolección y la entrega están sujetas a coordinación.

El estado del pago del envío es independiente del estado de la compra. Si Nave confirma el importe completo de una compra que incluye el envío, este se marca pagado automáticamente, incluso si falla el descuento del inventario. Si el envío se paga aparte, debe confirmarse manualmente. El administrador puede registrar otros estados; una notificación repetida no sobrescribe una clasificación manual distinta de pendiente. La devolución de una compra no modifica automáticamente este estado: revísalo por separado. La pantalla también permite acceder a los comprobantes, la exportación y la cola; no crea etiquetas ni pedidos en la empresa transportista.

Las empresas activas y sus tarifas aparecen en el formulario. El servidor comprueba la zona y el precio antes de guardar el pedido, y Nave incluye el envío únicamente si se eligió pagarlo junto con la compra. Si cambia la tarifa, el cliente debe volver a abrir los detalles para actualizarla.

Para pedidos marcados como **Compra concretada**, el panel ofrece **Imprimir comprobante del cliente**, con un formato para papel de 58 mm; se debe seleccionar la impresora en el diálogo del navegador. El botón **Descargar compras (CSV)** exporta todos los campos de los pedidos actualmente almacenados, incluidos los datos de entrega y de las cajas, para abrirlos en una planilla editable. El registro conserva hasta 2.000 pedidos; el CSV no recupera pedidos antiguos ya eliminados. La ventana de retiro muestra la dirección confirmada, un mapa de Google y el horario de lunes a viernes de 9:00 a 18:00.

El comprobante del cliente usa el isotipo de la tienda e incluye número, fecha, cliente, productos, cantidades, importe, forma de pago y un único QR con número, fecha e importe. No muestra la forma de entrega ni los datos del domicilio; si el envío se pagó junto con la compra, muestra su importe incluido. Es un **comprobante no fiscal**: no es factura autorizada por ARCA ni una etiqueta del transportista. Las facturas fiscales deben emitirse por separado. El PDF completo de respaldo contiene datos personales y debe mantenerse bajo resguardo.

### Impresión y respaldo automático de compras

El código incluye una cola persistente y un servicio local Windows, pero aún debe desplegarse, configurarse y probarse en sandbox. La notificación de Nave solo encola el comprobante después de consultar y verificar el pago y su importe. La impresión se encola aunque el descuento de inventario falle, ya que el pago ya fue aprobado; revisa el estado del pedido si esto ocurre. Los pedidos de otros medios se encolan cuando se guarda el estado **Compra concretada**, no al iniciar la coordinación por WhatsApp.

1. Configura en Vercel una variable `PRINT_AGENT_TOKEN` exclusiva para el servicio, de al menos 32 caracteres aleatorios. Usa credenciales diferentes en Preview y Production; no la compartas por chat ni la guardes en el repositorio. Genera, por ejemplo, 32 bytes aleatorios con Node.js mediante `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Despliega primero el entorno de pruebas con sus variables de Upstash y Nave. La cola de Preview está separada de producción. No habilites producción antes de verificar el flujo de punta a punta.
3. En la computadora Windows conectada a la impresora, instala Node.js 18 o posterior si falta y habilita **Microsoft Print to PDF**. Desde PowerShell ejecuta `.\print-agent\setup.ps1`, indica la URL HTTPS completa del Preview terminada en `/api/print-jobs`, el nombre exacto de la cola de impresión, la carpeta de respaldo y el mismo token. Por defecto la carpeta está en Documentos, `Dulce y Feliz\Comprobantes`. El instalador comprueba las impresoras, protege el token con DPAPI para el usuario actual y crea una tarea programada que se inicia al iniciar sesión. No ejecutes el instalador en más de un equipo sin un procedimiento de operación coordinado.
4. Comprueba en el Programador de tareas que **Dulce y Feliz - Impresion Nave** esté ejecutándose y revisa `%LOCALAPPDATA%\DulceYFeliz\print-agent.log`. Con compras simuladas, confirma que el comprobante del cliente sale para cada medio y que el comprobante interno sale únicamente para pagos Nave aprobados. El servicio puede funcionar con el panel cerrado, pero la computadora y la sesión de Windows deben estar encendidas.

La cola conserva los trabajos pendientes mientras la computadora está apagada. Si el servicio se interrumpe después de reservar un trabajo, queda **en revisión** y no se reimprime solo: en el panel, detén primero la tarea programada y comprueba el papel; luego elige **Ya está impreso** o **Reintentar**. En Nave se envían dos tickets separados y la interrupción podría ocurrir entre ambos; **Reintentar** vuelve a enviar los dos, por lo que puede duplicar uno. Un envío aceptado por la cola de Windows no garantiza que haya salido papel. El panel muestra hasta 100 trabajos pendientes y 100 en revisión. Tras marcarse como enviado, se eliminan los datos personales del trabajo y se conserva un identificador para evitar duplicados de notificaciones. El registro de pedidos mantiene su propia política de conservación.

El servicio crea primero un PDF A4 con todos los campos registrados, y después imprime el comprobante del cliente para todos los pedidos encolados. Solo para pagos Nave aprobados imprime además el comprobante de control interno. Los pedidos por otros medios se encolan al marcarse como concretados. Si la impresora térmica no está disponible, el servicio conserva el trabajo y espera; si el servicio se interrumpe, revisa el trabajo en el panel. El respaldo es local: organiza copias de seguridad de esa carpeta. Solo se generan automáticamente PDF para los trabajos existentes en la cola y los que se incorporen después; los trabajos ya eliminados no se recuperan automáticamente.

Para cada pago aprobado de Nave, el servicio también guarda un PDF separado en `Datos para facturar - no fiscal\AAAA-MM` dentro de la carpeta de respaldo. El mes corresponde a la fecha en que el sistema registró el pago aprobado, en hora argentina; si un trabajo anterior no tiene esa fecha, se usa y se indica la fecha del pedido. El PDF reúne los datos disponibles para revisar al facturar, pero **no es una factura**, no tiene CAE y no se envía automáticamente a Facturitas ni a ARCA. El DNI solo aparece si se recopiló en los datos de entrega; si falta, verifica si corresponde incorporarlo antes de emitir. El importe es el pago de Nave y no incluye un envío acordado para pago separado. Revisa las ventas ya facturadas para evitar duplicados y consulta con tu contador el tratamiento del envío y de las fechas.

Facturitas documenta la carga de [imágenes de comprobantes](https://help.facturitas.app/es/articles/15879029-como-creo-una-factura-mandando-una-imagen-por-whatsapp) y de [Excel con su modelo](https://help.facturitas.app/es/articles/11439169-como-puedo-facturar-de-forma-masiva); no se ha verificado que acepte PDF como entrada. El PDF puede servir para consultar sus datos o sacar una captura legible. No se genera un archivo de importación masiva hasta conocer y verificar el modelo requerido.

### Checkout Nave

En esta rama el checkout está habilitado únicamente cuando `NAVE_ENVIRONMENT` es `production` y se cumplen las verificaciones de configuración. Está deshabilitado en los demás entornos, tanto en la interfaz como en la API. Una prueba en producción genera un cobro real.

El checkout crea la intención desde el servidor y redirige al `checkout_url` de Nave. En desktop, el checkout ofrece QR; en móviles, MODO y billeteras compatibles. Las tarjetas deben estar vinculadas a esos medios. El ingreso manual de tarjeta no está habilitado por defecto en producción; Nave debe aprobarlo por separado.

Las nuevas intenciones de producción incluyen la URL de regreso `https://www.dulceyfeliz.online/`. Esta URL solo sirve para volver a la tienda: la confirmación del pago y el descuento de stock dependen de la notificación de Nave.

Lo más seguro es probar primero en un despliegue **Preview**. En **Vercel → Project Settings → Environment Variables**, agrega las credenciales sandbox seleccionando solo el entorno **Preview**; no las agregues a Production. No las pongas en archivos del sitio ni las compartas por chat:

| Variable | Valor |
|---|---|
| `NAVE_ENVIRONMENT` | `sandbox` |
| `NAVE_CLIENT_ID` | `client_id` de las credenciales sandbox de Nave |
| `NAVE_CLIENT_SECRET` | `client_secret` de las credenciales sandbox de Nave |
| `NAVE_AUDIENCE` | `audience` de las credenciales sandbox de Nave |
| `NAVE_POS_ID` | ID del punto de venta online obtenido en Nave |

Configura `GITHUB_REPOSITORY` con el repositorio y `GITHUB_BRANCH` con `sandbox-nave` en Preview. El token `GITHUB_TOKEN` debe tener permiso **Contents: Read and write**, porque un pago sandbox aprobado actualiza el stock de esa rama. No uses `main` para las pruebas. Configura en Nave la URL de notificaciones sandbox con la URL estable del despliegue Preview: `https://TU-URL-PREVIEW/api/nave-notifications`. El endpoint consulta el pago directamente a Nave antes de marcarlo como aprobado y descontar stock; no confía solamente en el contenido de la notificación. Para que las notificaciones lleguen, el sitio debe estar desplegado y accesible públicamente. La opción de pago de Nave queda desactivada automáticamente si falta alguna variable requerida.

Para probar en sandbox usa una rama de pruebas que habilite expresamente el checkout en ese entorno. En producción, configura las credenciales productivas solo en **Production**, establece `NAVE_ENVIRONMENT` en `production` y registra en Nave la URL productiva de notificaciones. Nunca reutilices credenciales sandbox en producción. Realiza una compra controlada y verifica que el pedido aparezca en el panel y pase a **Compra concretada** después de aprobarse el pago, y que se descuente el stock. Si el pago se aprueba pero el pedido no se actualiza, conserva el comprobante y revisa la notificación antes de volver a pagar.

En **Settings → Git**, confirma que la rama indicada en `GITHUB_BRANCH` sea la rama de producción. El panel requiere esa configuración para acceder; sin ella, no se puede validar el acceso ni guardar cambios.

## Uso

Ingresa la contraseña `ADMIN_PASSWORD` en el panel. Los botones de guardar y los controles de stock publican sus cambios en GitHub; Vercel construye y publica la nueva versión automáticamente. El botón **Publicar cambios** permite reintentar un guardado. **Descargar JSON** queda disponible como copia de respaldo.
