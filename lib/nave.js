const AUTH_ENDPOINTS = {
  sandbox: 'https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate',
  production: 'https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate'
};

const PAYMENT_ENDPOINTS = {
  sandbox: 'https://api-sandbox.ranty.io/integrations',
  production: 'https://api.ranty.io/integrations'
};

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getNaveConfig() {
  const environment = process.env.NAVE_ENVIRONMENT || 'sandbox';
  if (!Object.prototype.hasOwnProperty.call(AUTH_ENDPOINTS, environment)) {
    throw new Error('NAVE_ENVIRONMENT debe ser sandbox o production.');
  }

  const clientId = process.env.NAVE_CLIENT_ID;
  const clientSecret = process.env.NAVE_CLIENT_SECRET;
  const audience = process.env.NAVE_AUDIENCE;
  const posId = process.env.NAVE_POS_ID;
  if (!clientId || !clientSecret || !audience || !posId) {
    throw new Error('Falta configurar NAVE_CLIENT_ID, NAVE_CLIENT_SECRET, NAVE_AUDIENCE o NAVE_POS_ID en Vercel.');
  }

  return {
    environment,
    clientId,
    clientSecret,
    audience,
    posId,
    authUrl: AUTH_ENDPOINTS[environment],
    apiUrl: PAYMENT_ENDPOINTS[environment]
  };
}

async function readJsonResponse(response, errorMessage) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(errorMessage);
  }
  if (!response.ok) throw new Error(errorMessage);
  return result;
}

async function getAccessToken(config) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const response = await fetch(config.authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      audience: config.audience
    })
  });
  const result = await readJsonResponse(response, 'Nave no pudo autenticar la solicitud. Revisa las credenciales del entorno configurado.');
  if (typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(Number(result.expires_in))) {
    throw new Error('Nave devolvió una respuesta de autenticación inválida.');
  }

  cachedToken = result.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(0, Number(result.expires_in) - 60) * 1000;
  return cachedToken;
}

async function naveRequest(path, options = {}) {
  const config = getNaveConfig();
  const token = await getAccessToken(config);
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return { config, response };
}

async function createPaymentRequest(body) {
  const { config, response } = await naveRequest('/payment_requests/ecommerce', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return readJsonResponse(response, 'Nave no pudo crear la intención de pago. Verifica el punto de venta y la configuración del entorno.');
}

async function getPayment(paymentId) {
  const { response } = await naveRequest(`/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET'
  });
  return readJsonResponse(response, 'No se pudo verificar el pago directamente con Nave.');
}

module.exports = {
  createPaymentRequest,
  getNaveConfig,
  getPayment
};
