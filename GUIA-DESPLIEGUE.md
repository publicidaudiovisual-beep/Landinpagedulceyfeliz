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

No escribas estos secretos en el código ni los compartas por chat. Después de guardarlos, vuelve a desplegar el proyecto para que la función de Vercel los reciba.

En **Settings → Git**, confirma que la rama indicada en `GITHUB_BRANCH` sea la rama de producción. El panel requiere esa configuración para acceder; sin ella, no se puede validar el acceso ni guardar cambios.

## Uso

Ingresa la contraseña `ADMIN_PASSWORD` en el panel. Los botones de guardar y los controles de stock publican sus cambios en GitHub; Vercel construye y publica la nueva versión automáticamente. El botón **Publicar cambios** permite reintentar un guardado. **Descargar JSON** queda disponible como copia de respaldo.
