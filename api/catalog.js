const crypto = require('node:crypto');

const GITHUB_API = 'https://api.github.com';
const MAX_CATALOG_BYTES = 1024 * 1024;

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function matchesPassword(provided, expected) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Método no permitido.' });
  }

  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword) {
    return respond(res, 503, { error: 'El acceso administrativo no está configurado en Vercel.' });
  }
  if (expectedPassword.length < 16) {
    return respond(res, 503, { error: 'ADMIN_PASSWORD debe tener al menos 16 caracteres.' });
  }

  const authorization = req.headers.authorization || '';
  const providedPassword = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!matchesPassword(providedPassword, expectedPassword)) {
    return respond(res, 401, { error: 'Código incorrecto. Inténtalo de nuevo.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return respond(res, 400, { error: 'La solicitud no tiene un formato válido.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return respond(res, 400, { error: 'La solicitud no tiene un formato válido.' });
  }

  if (body.action === 'authenticate') {
    return respond(res, 200, { authenticated: true });
  }

  if (body.action !== 'save' || !body.data || !Array.isArray(body.data.products)) {
    return respond(res, 400, { error: 'El catálogo enviado no tiene un formato válido.' });
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH;
  const [owner, repo, ...extraParts] = (repository || '').split('/');
  const validRepository = /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repo);
  if (!token || !branch || !validRepository || extraParts.length > 0) {
    return respond(res, 503, { error: 'Falta configurar GITHUB_TOKEN, GITHUB_REPOSITORY o GITHUB_BRANCH en Vercel.' });
  }

  const serializedCatalog = JSON.stringify(body.data, null, 2);
  if (Buffer.byteLength(serializedCatalog, 'utf8') > MAX_CATALOG_BYTES) {
    return respond(res, 413, { error: 'El catálogo supera el tamaño máximo permitido.' });
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Dulce-y-Feliz-admin'
  };
  const contentsUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/catalog-data.json`;

  try {
    const currentResponse = await fetch(`${contentsUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    const currentFile = await readJson(currentResponse);
    if (!currentResponse.ok || !currentFile.sha) {
      console.error('Could not read catalog-data.json from GitHub', { status: currentResponse.status });
      return respond(res, currentResponse.status === 404 ? 404 : 502, {
        error: currentResponse.status === 404
          ? 'No se encontró catalog-data.json en la rama configurada de GitHub.'
          : 'GitHub no pudo leer el catálogo. Verifica los permisos del token y la rama.'
      });
    }

    const updateResponse = await fetch(contentsUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Actualizar catálogo desde el panel de administración',
        content: Buffer.from(serializedCatalog, 'utf8').toString('base64'),
        sha: currentFile.sha,
        branch
      })
    });
    const updateResult = await readJson(updateResponse);
    if (!updateResponse.ok) {
      console.error('Could not update catalog-data.json on GitHub', { status: updateResponse.status });
      return respond(res, updateResponse.status === 409 || updateResponse.status === 422 ? 409 : 502, {
        error: updateResponse.status === 409 || updateResponse.status === 422
          ? 'El catálogo cambió en GitHub mientras se guardaba. Recarga el panel e inténtalo otra vez.'
          : 'GitHub rechazó el guardado. Verifica que el token tenga permiso de escritura en el repositorio.'
      });
    }

    return respond(res, 200, { saved: true, commit: updateResult.commit && updateResult.commit.sha });
  } catch (error) {
    console.error('Catalog update request failed', error);
    return respond(res, 502, { error: 'No se pudo completar el guardado en GitHub. Inténtalo otra vez.' });
  }
};
