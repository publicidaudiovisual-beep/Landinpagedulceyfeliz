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

### Registro de pedidos y descuento de inventario

El sitio guarda un pedido en Upstash antes de abrir WhatsApp. Esto registra que se inició el pedido, pero no confirma que el cliente haya enviado el mensaje. Se conservan como máximo 200 pedidos; el más antiguo se elimina al superar el límite. El panel los agrupa por día (hora de Argentina).

En **Pedidos generados**, marca **Confirmar cierre y descontar stock** únicamente cuando la venta esté cerrada. Esa acción descuenta las cantidades del catálogo en GitHub y cambia el pedido a **Venta cerrada**. La operación es idempotente: reintentar el mismo cierre no vuelve a descontar el inventario.

Esta función requiere `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY` y `GITHUB_BRANCH` en Vercel. El token de GitHub debe tener permiso **Contents: Read and write**. Si falta alguna configuración o GitHub no puede actualizar el catálogo, el pedido queda pendiente y el panel muestra el error para poder reintentar.

### Checkout Nave (sandbox)

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

Vuelve a desplegar el Preview y realiza una compra de prueba. Verifica que el pedido aparezca en el panel y pase a **Venta cerrada** después de aprobarse el pago. No habilites producción hasta confirmar con Nave las credenciales y el punto de venta productivo. Para la publicación productiva, configura las credenciales de producción solo en **Production**, cambia `NAVE_ENVIRONMENT` a `production` en ese entorno y registra en Nave la URL productiva de notificaciones. Nunca reutilices credenciales sandbox en producción.

En **Settings → Git**, confirma que la rama indicada en `GITHUB_BRANCH` sea la rama de producción. El panel requiere esa configuración para acceder; sin ella, no se puede validar el acceso ni guardar cambios.

## Uso

Ingresa la contraseña `ADMIN_PASSWORD` en el panel. Los botones de guardar y los controles de stock publican sus cambios en GitHub; Vercel construye y publica la nueva versión automáticamente. El botón **Publicar cambios** permite reintentar un guardado. **Descargar JSON** queda disponible como copia de respaldo.
