const test = require('node:test');
const assert = require('node:assert/strict');

const checkoutPath = require.resolve('../api/nave-checkout');
const variables = {
  NAVE_ENVIRONMENT: 'production',
  NAVE_CLIENT_ID: 'test-client',
  NAVE_CLIENT_SECRET: 'test-secret',
  NAVE_AUDIENCE: 'test-audience',
  NAVE_POS_ID: 'test-pos',
  ADMIN_PASSWORD: 'test-password-1234',
  UPSTASH_REDIS_REST_URL: 'https://example.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'test-token',
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPOSITORY: 'example/repo',
  GITHUB_BRANCH: 'main'
};

async function request(environment, method, body) {
  const saved = {};
  for (const name of Object.keys(variables)) {
    saved[name] = process.env[name];
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
  }
  delete require.cache[checkoutPath];
  try {
    const handler = require(checkoutPath);
    const response = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    await handler({ method, body }, response);
    return response;
  } finally {
    for (const name of Object.keys(variables)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    delete require.cache[checkoutPath];
  }
}

test('production checkout is available when required variables are configured', async () => {
  const response = await request(variables, 'GET');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { available: true, environment: 'production' });
});

test('production checkout is unavailable without required configuration', async () => {
  const response = await request({ ...variables, NAVE_POS_ID: undefined }, 'GET');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.available, false);
});

test('sandbox checkout remains disabled for both availability and payment creation', async () => {
  const environment = { ...variables, NAVE_ENVIRONMENT: 'sandbox' };
  const availability = await request(environment, 'GET');
  const payment = await request(environment, 'POST', {});
  assert.equal(availability.body.available, false);
  assert.equal(payment.statusCode, 503);
});

test('production payment creation reaches request validation', async () => {
  const response = await request(variables, 'POST', {});
  assert.equal(response.statusCode, 400);
});

test('new production payment requests include the public store return URL', async () => {
  const originalFetch = global.fetch;
  const orderId = '12345678-1234-1234-1234-123456789abc';
  const order = {
    id: orderId,
    paymentMethod: 'Sistema Nave de Galicia / MODO',
    items: [{ productId: 'cookie', quantity: 1 }],
    total: 6000
  };
  let paymentBody;
  global.fetch = async (url, options) => {
    const reply = result => ({ ok: true, json: async () => result });
    if (url === variables.UPSTASH_REDIS_REST_URL) {
      const command = JSON.parse(options.body);
      if (command[0] === 'SET') return reply({ result: 'OK' });
      if (command[0] === 'GET') return reply({ result: JSON.stringify([order]) });
      if (command[0] === 'EVAL' && command.length === 6) return reply({ result: command[5] });
      if (command[0] === 'EVAL') return reply({ result: 1 });
    }
    if (url.startsWith('https://api.github.com/')) {
      const catalog = { products: [{ id: 'cookie', name: 'Cookie', price: 6000, stockQuantity: 1 }] };
      return reply({ content: Buffer.from(JSON.stringify(catalog)).toString('base64') });
    }
    if (url.startsWith('https://services.apinaranja.com/')) {
      return reply({ access_token: 'test-access-token', expires_in: 3600 });
    }
    if (url === 'https://api.ranty.io/integrations/payment_requests/ecommerce') {
      paymentBody = JSON.parse(options.body);
      return reply({ id: 'test-request', checkout_url: 'https://checkout.ranty.io/test' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await request(variables, 'POST', { orderId });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.checkoutUrl, 'https://checkout.ranty.io/test');
    assert.deepEqual(paymentBody.additional_info, { callback_url: 'https://www.dulceyfeliz.online/' });
  } finally {
    global.fetch = originalFetch;
  }
});
