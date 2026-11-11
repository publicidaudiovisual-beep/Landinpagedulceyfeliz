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
