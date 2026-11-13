const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/shipping-config');
const { validateShippingConfig, companyAvailability, collectionSchedule } = require('../lib/shipping-config');

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
  let migrated = false;
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'SET') { stored = command[2]; return { ok: true, json: async () => ({ result: 'OK' }) }; }
    if (command[0] === 'EVAL') {
      if (migrated || (stored || '') !== command[5]) return { ok: true, json: async () => ({ result: 0 }) };
      stored = command[6]; migrated = true;
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    return { ok: true, json: async () => ({ result: command[1].includes('cabify-solo-moto-v1') ? (migrated ? '1' : null) : stored }) };
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
  assert.equal(res.body.companies.length, 3);
  assert.equal(res.body.companies[0].name, 'Vima');
  assert.equal(res.body.companies[0].enabled, true);
  assert.deepEqual(res.body.companies[0].workDays, [1, 2, 3, 4, 5, 6]);
  res = response();
  await handler({ method: 'POST', headers: {}, body: { zones: [zone], companies: [company] } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(stored).companies.length, 3);
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
  assert.equal(res.body.companies[0].name, company.name);
  assert.deepEqual(res.body.companies[0].workDays, [1, 2, 3, 4, 5, 6]);
  assert.equal(res.body.companies[0].collectionDate, collectionSchedule(company).collectionDate);
  assert.deepEqual(res.body.zones, [zone]);
  assert.deepEqual(res.body.unavailable, [{ name: paused.name, reason: 'Empresa pausada' }]);
  res = response();
  await handler({ method: 'GET', headers }, res);
  assert.deepEqual(res.body.companies, [
    { ...company, workDays: [1, 2, 3, 4, 5, 6] },
    { ...paused, workDays: [1, 2, 3, 4, 5, 6] }
  ]);
  res = response();
  await handler({ method: 'POST', headers, body: { zones: [zone], companies: [{ ...company, workDays: [2, 4] }] } }, res);
  assert.equal(res.statusCode, 200);
  res = response();
  await handler({ method: 'GET', headers }, res);
  assert.deepEqual(res.body.companies[0].workDays, [2, 4]);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  company.closure = { reason: 'holiday', start: today, end: today };
  res = response();
  await handler({ method: 'POST', headers, body: { zones: [zone], companies: [company] } }, res);
  assert.equal(res.statusCode, 200);
  res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.body.companies.length, 1);
  assert.equal(res.body.companies[0].holidayReopeningDate, companyAvailability(company).holidayReopeningDate);
  assert.deepEqual(res.body.unavailable, []);
});

test('la migración conserva Vima, incorpora tarifas y cobertura por empresa solo una vez', async t => {
  const savedFetch = global.fetch;
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
  t.after(() => {
    global.fetch = savedFetch;
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  });
  const zones = ['CABA', 'Primer cordón', 'Segundo cordón', 'Tercer cordón'].map((name, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`, name, localities: [name]
  }));
  const vimaOriginal = { id: '00000000-0000-4000-8000-000000000005', name: 'Vima', enabled: false,
    workDays: [1, 3], rates: [{ zoneId: zones[0].id, priceCents: 12345 }] };
  let raw = JSON.stringify({ zones, companies: [vimaOriginal] });
  let marker = null;
  let concurrentChange = true;
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'GET') return { ok: true, json: async () => ({ result: command[1].includes('cabify-solo-moto-v1') ? marker : raw }) };
    assert.equal(command[0], 'EVAL');
    assert.equal(command[5], raw || '');
    if (concurrentChange) {
      concurrentChange = false;
      const current = JSON.parse(raw);
      current.companies[0].rates[0].priceCents = 54321;
      raw = JSON.stringify(current);
      return { ok: true, json: async () => ({ result: 0 }) };
    }
    raw = command[6]; marker = '1';
    return { ok: true, json: async () => ({ result: 1 }) };
  };
  const { readShippingConfig } = require('../lib/shipping-config');
  const config = await readShippingConfig();
  const [vima, cabify, moto] = config.companies;
  assert.equal(vima.name, 'Vima');
  assert.equal(vima.enabled, false);
  assert.equal(vima.rates[0].priceCents, 54321);
  assert.deepEqual(cabify.workDays, [1, 3]);
  assert.deepEqual(moto.workDays, [1, 3]);
  assert.deepEqual(cabify.rates.map(rate => Math.round(rate.priceCents * 107 / 100)), [437479, 583262, 804009, 1082369]);
  assert.deepEqual(moto.rates.map(rate => Math.round(rate.priceCents * 107 / 100)), [460100, 695500, 802500, 1016500]);
  assert.ok(cabify.rates[1].localities.includes('San Fernando'));
  assert.ok(!cabify.rates[2].localities.includes('San Fernando'));
  assert.ok(cabify.rates[3].localities.includes('Luján'));
  assert.ok(!cabify.rates.flatMap(rate => rate.localities).includes('Marcos Paz'));
  assert.equal(moto.rates[1].localities, undefined);
  config.companies.splice(1, 1);
  raw = JSON.stringify(config);
  assert.equal((await readShippingConfig()).companies.length, 2);
  assert.equal(validateShippingConfig({ ...config, companies: [{ ...moto, rates: [
    { ...moto.rates[0], localities: ['CABA'] }, { ...moto.rates[1], localities: ['caba'] }
  ] }] }), false);
});

test('la disponibilidad respeta días y cierres inclusivos en hora argentina', () => {
  const company = { enabled: true, workDays: [1, 2, 3, 4, 5], closure: {
    reason: 'vacation', start: '2026-11-09', end: '2026-11-10'
  } };
  assert.equal(companyAvailability(company, new Date('2026-11-09T02:00:00Z')).reason, 'Día no laborable');
  assert.equal(companyAvailability(company, new Date('2026-11-09T03:00:00Z')).reason, 'Vacaciones');
  assert.equal(companyAvailability(company, new Date('2026-11-11T02:59:59Z')).reason, 'Vacaciones');
  assert.equal(companyAvailability(company, new Date('2026-11-11T03:00:00Z')).reason, '');
  assert.equal(companyAvailability({ enabled: true }, new Date('2026-11-08T15:00:00Z')).reason, 'Día no laborable');
  assert.equal(companyAvailability({ enabled: false }, new Date('2026-11-09T15:00:00Z')).reason, 'Empresa pausada');
  const holiday = { ...company, closure: { reason: 'holiday', start: '2026-11-13', end: '2026-11-13' } };
  assert.deepEqual(companyAvailability(holiday, new Date('2026-11-13T15:00:00Z')),
    { reason: '', holidayReopeningDate: '2026-11-16' });
  assert.match(companyAvailability({ ...holiday, workDays: [] }, new Date('2026-11-13T15:00:00Z')).reason, /no hay próximo/);
  assert.equal(companyAvailability({ ...holiday, enabled: false }, new Date('2026-11-13T15:00:00Z')).reason, 'Empresa pausada');
  assert.equal(companyAvailability({ ...holiday, closure: { ...holiday.closure, end: '2026-11-16' } },
    new Date('2026-11-13T15:00:00Z')).holidayReopeningDate, '2026-11-17');
});

test('el contador cambia a las 12 en Argentina y salta cierres y días no laborables', () => {
  const company = { enabled: true, workDays: [1, 2, 3, 4, 5] };
  assert.deepEqual(collectionSchedule(company, new Date('2026-11-13T14:59:59Z')), {
    collectionDate: '2026-11-13', collectionCutoff: '2026-11-13T15:00:00.000Z', holiday: false
  });
  assert.deepEqual(collectionSchedule(company, new Date('2026-11-13T15:00:00Z')), {
    collectionDate: '2026-11-16', collectionCutoff: '2026-11-16T15:00:00.000Z', holiday: false
  });
  const holiday = { ...company, closure: { reason: 'holiday', start: '2026-11-16', end: '2026-11-17' } };
  assert.deepEqual(collectionSchedule(holiday, new Date('2026-11-13T15:00:00Z')), {
    collectionDate: '2026-11-18', collectionCutoff: '2026-11-18T15:00:00.000Z', holiday: true
  });
  assert.equal(collectionSchedule({ ...company, workDays: [] }, new Date('2026-11-13T15:00:00Z')), null);
});

test('sin días guardados trabaja de lunes a sábado y después del sábado pasa al lunes', () => {
  const company = { enabled: true };
  assert.equal(companyAvailability(company, new Date('2026-11-14T14:00:00Z')).reason, '');
  assert.equal(companyAvailability(company, new Date('2026-11-15T14:00:00Z')).reason, 'Día no laborable');
  assert.equal(collectionSchedule(company, new Date('2026-11-14T15:00:00Z')).collectionDate, '2026-11-16');
  assert.equal(companyAvailability({ ...company, workDays: [0] }, new Date('2026-11-15T14:00:00Z')).reason, '');
});

test('se rechazan días y cierres inválidos sin romper configuraciones anteriores', () => {
  const zone = { id: '00000000-0000-4000-8000-000000000001', name: 'Zona', localities: ['CABA'] };
  const company = { id: '00000000-0000-4000-8000-000000000002', name: 'Vima', enabled: true,
    rates: [{ zoneId: zone.id, priceCents: 100 }] };
  const valid = candidate => validateShippingConfig({ zones: [zone], companies: [candidate] });
  assert.equal(valid(company), true);
  assert.equal(valid({ ...company, workDays: [1, 1] }), false);
  assert.equal(valid({ ...company, closure: { reason: 'holiday', start: '2026-02-30', end: '2026-03-01' } }), false);
  assert.equal(valid({ ...company, closure: { reason: 'holiday', start: '2026-11-10', end: '2026-11-09' } }), false);
  assert.equal(valid({ ...company, closure: { reason: 'unexpected', start: '2026-11-09', end: '2026-11-10' } }), true);
});
