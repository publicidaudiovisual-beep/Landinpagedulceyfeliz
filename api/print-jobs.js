const crypto = require('node:crypto');
const jobs = require('../lib/print-jobs');

function authorized(req, secret, minimumLength) {
  if (!secret || secret.length < minimumLength) return false;
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!authorized(req, process.env.ADMIN_PASSWORD, 16)) return respond(res, 401, { error: 'Sin autorización.' });
      return respond(res, 200, { jobs: await jobs.listJobs() });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return respond(res, 405, { error: 'Método no permitido.' });
    }
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return respond(res, 400, { error: 'Solicitud inválida.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res, 400, { error: 'Solicitud inválida.' });
    const isAdminAction = body.action === 'retry' || body.action === 'resolve';
    const secret = isAdminAction ? process.env.ADMIN_PASSWORD : process.env.PRINT_AGENT_TOKEN;
    if (!authorized(req, secret, isAdminAction ? 16 : 32)) return respond(res, 401, { error: 'Sin autorización.' });
    if (body.action === 'claim') {
      return respond(res, 200, { job: await jobs.claimJob(crypto.randomUUID()) });
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return respond(res, 400, { error: 'Identificador de impresión inválido.' });
    }
    if (body.action === 'finish') {
      if (typeof body.claimId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.claimId)) {
        return respond(res, 400, { error: 'Identificador de reserva inválido.' });
      }
      const completed = await jobs.finishJob(body.id, body.claimId);
      return completed ? respond(res, 200, { sent: true })
        : respond(res, 409, { error: 'La reserva ya no está activa.' });
    }
    if (body.action === 'retry') {
      const retried = await jobs.retryJob(body.id);
      return retried ? respond(res, 200, { retried: true })
        : respond(res, 409, { error: 'El trabajo no está en revisión.' });
    }
    if (body.action === 'resolve') {
      const resolved = await jobs.resolveJob(body.id);
      return resolved ? respond(res, 200, { resolved: true })
        : respond(res, 409, { error: 'El trabajo no está en revisión.' });
    }
    return respond(res, 400, { error: 'Acción inválida.' });
  } catch (error) {
    console.error('Print queue request failed', error);
    return respond(res, 502, { error: 'No se pudo procesar la cola de impresión.' });
  }
};
