const { getRedisKey } = require('../lib/redis-keys');

const VISIT_COUNTER_KEY = getRedisKey('dulce-feliz-page-visits');

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return respond(res, 405, { error: 'Método no permitido.' });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return respond(res, 503, { error: 'El contador de visitas no está configurado en Vercel.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    return respond(res, 503, { error: 'UPSTASH_REDIS_REST_URL no es una URL válida.' });
  }
  if (parsedUrl.protocol !== 'https:') {
    return respond(res, 503, { error: 'UPSTASH_REDIS_REST_URL debe usar HTTPS.' });
  }

  const command = req.method === 'POST' ? 'incr' : 'get';
  const endpoint = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, '')}/${command}/${VISIT_COUNTER_KEY}`;

  try {
    const response = await fetch(endpoint, {
      method: req.method,
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      console.error('Upstash visit counter request failed', { status: response.status });
      return respond(res, 502, { error: 'No se pudo consultar el contador de visitas.' });
    }

    const visits = result.result === null ? 0 : Number(result.result);
    if (!Number.isSafeInteger(visits) || visits < 0) {
      console.error('Upstash returned an invalid visit count');
      return respond(res, 502, { error: 'El contador de visitas devolvió un valor inválido.' });
    }

    return respond(res, 200, { visits });
  } catch (error) {
    console.error('Visit counter request failed', error);
    return respond(res, 502, { error: 'No se pudo conectar con el contador de visitas.' });
  }
};
