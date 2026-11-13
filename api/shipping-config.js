const crypto = require('node:crypto');
const { readShippingConfig, saveShippingConfig, validateShippingConfig, companyUnavailableReason } = require('../lib/shipping-config');

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function isAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD || '';
  const authorization = req.headers?.authorization || '';
  if (expected.length < 16 || !authorization.startsWith('Bearer ')) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(authorization.slice(7));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const config = await readShippingConfig();
      const admin = isAdmin(req);
      const now = new Date();
      const availability = config.companies.map(company => ({ company, reason: companyUnavailableReason(company, now) }));
      return respond(res, 200, {
        zones: config.zones,
        companies: admin ? config.companies : availability.filter(item => !item.reason).map(item => item.company),
        unavailable: admin ? [] : availability.filter(item => item.reason)
          .map(item => ({ name: item.company.name, reason: item.reason }))
      });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return respond(res, 405, { error: 'Método no permitido.' });
    }
    if (!isAdmin(req)) return respond(res, 401, { error: 'No tienes autorización para modificar los envíos.' });
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return respond(res, 400, { error: 'La solicitud no tiene un formato válido.' });
    }
    if (!body || !validateShippingConfig(body)) {
      return respond(res, 400, { error: 'La configuración de empresas y tarifas no es válida.' });
    }
    await saveShippingConfig(body);
    return respond(res, 200, { saved: true });
  } catch (error) {
    console.error('Shipping configuration failed', error);
    return respond(res, 502, { error: 'No se pudo procesar la configuración de envíos.' });
  }
};
