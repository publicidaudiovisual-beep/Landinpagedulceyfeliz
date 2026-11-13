const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/shipping-config');

function response() {
  return {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('las tarifas se guardan solo desde el panel y las empresas pausadas no son públicas', async t => {
  const previous = {
    fetch: global.fetch,
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    password: process.env.ADMIN_PASSWORD
  };
  Object.assign(process.env, {
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'test',
    ADMIN_PASSWORD: 'clave-de-prueba-larga'
  });
  t.after(() => {
    global.fetch = previous.fetch;
    for (const [name, value] of Object.entries({
      UPSTASH_REDIS_REST_URL: previous.url,
      UPSTASH_REDIS_REST_TOKEN: previous.token,
      ADMIN_PASSWORD: previous.password
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  let stored = null;
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'SET') { stored = command[2]; return { ok: true, json: async () => ({ result: 'OK' }) }; }
    return { ok: true, json: async () => ({ result: stored }) };
  };
  const zone = { id: '00000000-0000-4000-8000-000000000002', name: 'Zona 1', localities: ['Avellaneda'] };
  const company = {
    id: '00000000-0000-4000-8000-000000000001', name: 'Vima', enabled: true,
    rates: [{ zoneId: zone.id, priceCents: 871200 }]
  };
  const paused = { ...company, id: '00000000-0000-4000-8000-000000000003', enabled: false };
  let res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.body.zones.length, 4);
  assert.equal(res.body.companies.length, 1);
  assert.equal(res.body.companies[0].name, 'Vima');
  assert.equal(res.body.companies[0].enabled, true);
  res = response();
  await handler({ method: 'POST', headers: {}, body: { zones: [zone], companies: [company] } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(stored, null);
  const headers = { authorization: 'Bearer clave-de-prueba-larga' };
  res = response();
  await handler({ method: 'POST', headers, body: { zones: [zone], companies: [{ ...company, rates: [{ zoneId: zone.id, priceCents: -1 }] }] } }, res);
  assert.equal(res.statusCode, 400);
  res = response();
  await handler({ method: 'POST', headers, body: {
    zones: [zone, { ...zone, id: '00000000-0000-4000-8000-000000000004', localities: ['avellaneda'] }],
    companies: [company]
  } }, res);
  assert.equal(res.statusCode, 400);
  res = response();
  await handler({ method: 'POST', headers, body: { zones: [zone], companies: [company, paused] } }, res);
  assert.equal(res.statusCode, 200);
  res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.deepEqual(res.body.companies, [company]);
  assert.deepEqual(res.body.zones, [zone]);
  res = response();
  await handler({ method: 'GET', headers }, res);
  assert.deepEqual(res.body.companies, [company, paused]);
});
