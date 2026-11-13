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
  assert.deepEqual(res.body.companies[0].workDays, [1, 2, 3, 4, 5, 6]);
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
