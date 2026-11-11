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

El sitio guarda un pedido en Upstash antes de abrir WhatsApp. Esto registra que se inició el pedido, pero no confirma que el cliente haya enviado el mensaje. Se conservan como máximo 200 pedidos; el más antiguo se elimina al superar el límite. El panel los agrupa por día (hora de Argentina).

Cada pedido recibe un número correlativo `DF-000001`, compartido por los pedidos iniciados por WhatsApp y por Nave. Los pedidos anteriores reciben números estables automáticamente al consultar o registrar pedidos.

En **Pedidos generados**, selecciona y guarda el estado correspondiente: **Compra concretada**, **Compra con devolución**, **Compra no concluida** o **Compra rechazada**. Solo **Compra concretada** descuenta las cantidades del catálogo en GitHub; los demás estados no modifican el stock. El descuento es idempotente y no se repite al actualizar un pedido. Los pagos aprobados por Nave se registran automáticamente como compra concretada.

Esta función requiere `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY` y `GITHUB_BRANCH` en Vercel. El token de GitHub debe tener permiso **Contents: Read and write**. Si falta alguna configuración o GitHub no puede actualizar el catálogo, el pedido queda pendiente y el panel muestra el error para poder reintentar.

### Checkout Nave (sandbox)

El checkout está temporalmente deshabilitado en todos los entornos, tanto en la interfaz como en la API. No puede habilitarse con variables de Vercel; antes de reactivarlo hay que completar y validar las pruebas de Nave.

El checkout crea la intención desde el servidor y redirige al `checkout_url` de Nave. En desktop, el checkout ofrece QR; en móviles, MODO y billeteras compatibles. Las tarjetas deben estar vinculadas a esos medios. El ingreso manual de tarjeta no está habilitado por defecto en producción; Nave debe aprobarlo por separado.

Lo más seguro es probar primero en un despliegue **Preview**. En **Vercel → Project Settings → Environment Variables**, agrega las credenciales sandbox seleccionando solo el entorno **Preview**; no las agregues a Production. No las pongas en archivos del sitio ni las compartas por chat:

| Variable | Valor |
|---|---|
| `NAVE_ENVIRONMENT` | `sandbox` |
| `NAVE_CLIENT_ID` | `client_id` de las credenciales sandbox de Nave |
| `NAVE_CLIENT_SECRET` | `client_secret` de las credenciales sandbox de Nave |
| `NAVE_AUDIENCE` | `audience` de las credenciales sandbox de Nave |
| `NAVE_POS_ID` | ID del punto de venta online obtenido en Nave |

Configura en Nave la URL de notificaciones sandbox con la URL estable del despliegue Preview: `https://TU-URL-PREVIEW/api/nave-notifications`. El endpoint consulta el pago directamente a Nave antes de marcarlo como aprobado y descontar stock; no confía solamente en el contenido de la notificación. Para que las notificaciones lleguen, el sitio debe estar desplegado y accesible públicamente. La opción de pago de Nave queda desactivada automáticamente si falta alguna variable requerida.

El envío por Envia.com también permanece marcado como **Próximamente** y no se puede seleccionar hasta terminar su integración.

Vuelve a desplegar el Preview y realiza una compra de prueba. Verifica que el pedido aparezca en el panel y pase a **Compra concretada** después de aprobarse el pago. No habilites producción hasta confirmar con Nave las credenciales y el punto de venta productivo. Para la publicación productiva, configura las credenciales de producción solo en **Production**, cambia `NAVE_ENVIRONMENT` a `production` en ese entorno y registra en Nave la URL productiva de notificaciones. Nunca reutilices credenciales sandbox en producción.

En **Settings → Git**, confirma que la rama indicada en `GITHUB_BRANCH` sea la rama de producción. El panel requiere esa configuración para acceder; sin ella, no se puede validar el acceso ni guardar cambios.

## Uso

Ingresa la contraseña `ADMIN_PASSWORD` en el panel. Los botones de guardar y los controles de stock publican sus cambios en GitHub; Vercel construye y publica la nueva versión automáticamente. El botón **Publicar cambios** permite reintentar un guardado. **Descargar JSON** queda disponible como copia de respaldo.
