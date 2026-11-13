const test = require('node:test');
const assert = require('node:assert/strict');
const jobs = require('../lib/print-jobs');
const handler = require('../api/print-jobs');
const { receiptLines, createReceipt, archiveBlocks, flattenOrder, billingData } = require('../print-agent/receipt');
const nave = require('../lib/nave');
const orders = require('../api/orders');

function response() {
  return {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('solo el servicio puede reservar trabajos y solo el administrador puede reintentarlos', async t => {
  const previous = { ...jobs };
  const oldToken = process.env.PRINT_AGENT_TOKEN;
  const oldPassword = process.env.ADMIN_PASSWORD;
  process.env.PRINT_AGENT_TOKEN = 'a'.repeat(32);
  process.env.ADMIN_PASSWORD = 'admin-password-de-prueba';
  t.after(() => {
    Object.assign(jobs, previous);
    if (oldToken === undefined) delete process.env.PRINT_AGENT_TOKEN;
    else process.env.PRINT_AGENT_TOKEN = oldToken;
    if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = oldPassword;
  });
  const id = '00000000-0000-4000-8000-000000000001';
  let claims = 0;
  let retried = 0;
  jobs.claimJob = async () => { claims++; return null; };
  jobs.retryJob = async () => { retried++; return true; };
  let res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'claim' } }, res);
  assert.equal(res.statusCode, 401);
  res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${process.env.ADMIN_PASSWORD}` }, body: { action: 'claim' } }, res);
  assert.equal(res.statusCode, 401);
  res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${process.env.PRINT_AGENT_TOKEN}` }, body: { action: 'claim' } }, res);
  assert.equal(res.body.job, null);
  assert.equal(claims, 1);
  res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${process.env.PRINT_AGENT_TOKEN}` }, body: { action: 'retry', id } }, res);
  assert.equal(res.statusCode, 401);
  res = response();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${process.env.ADMIN_PASSWORD}` }, body: { action: 'retry', id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(retried, 1);
});

test('el ticket simplificado omite los campos elegidos y el respaldo los conserva', () => {
  const order = {
    orderNumber: 1, total: 100, productTotal: 100, shippingCost: 200,
    destinationType: 'empresa', businessDeliveryHours: '9 a 12', registered: true,
    delivery: { companyName: 'Vima', zoneName: 'Zona', recipient: 'Ana', buyerDocument: '12345678',
      street: 'Calle de prueba', phone: '1100000000', shippingPayment: 'separate' },
    boxes: [{ size: 4, items: [{ name: 'Galleta', quantity: 1, unitPrice: 100 }] }]
  };
  const lines = receiptLines(order).join('\n');
  assert.doesNotMatch(lines, /Destino:|Horario de recepción|Destinatario:|Documento del comprador|Registro VIP|Empresa:|Zona:/);
  assert.match(lines, /Calle de prueba/);
  assert.match(lines, /Teléfono: 1100000000/);
  assert.match(lines, /A pagar aparte por transferencia/);
  assert.match(lines, /Galleta: 1 x/);
  const archive = archiveBlocks(order).map(block => block.text).join('\n');
  assert.match(archive, /Entrega \/ Destinatario: Ana/);
  assert.match(archive, /Horario de recepción: 9 a 12/);
  assert.equal(flattenOrder(order)['boxes.0.items.0.name'], 'Galleta');
});

test('el ticket tiene un solo QR pequeño con los datos básicos sin datos de entrega', () => {
  const receipt = createReceipt({
    orderNumber: 23, createdAt: '2026-11-12T12:00:00Z', customerName: 'Cliente de prueba', shippingMethod: 'Envío privado',
    paymentMethod: 'Nave', total: 100, shippingCost: 20,
    delivery: { companyName: 'Vima', recipient: 'Ana Ñúñez', phone: '1100000000',
      landmark: 'Referencia extensa '.repeat(60), shippingPayment: 'together' },
    boxes: [{ size: 4, items: [{ name: 'Galleta', quantity: 1, unitPrice: 100 }] }]
  });
  assert.equal(receipt.codes.length, 1);
  assert.ok(receipt.codes[0].matrix.length <= 41);
  assert.match(receipt.codes[0].payload, /DF-000023/);
  assert.match(receipt.codes[0].payload, /100\.00 ARS/);
  assert.doesNotMatch(receipt.codes[0].payload, /Ana Ñúñez/);
});

test('los datos para facturar usan el mes del pago en Argentina y distinguen el envío', () => {
  const job = {
    paymentId: 'pago-123', paymentRecordedAt: '2026-03-01T01:00:00Z',
    order: { orderNumber: 23, createdAt: '2026-02-28T20:00:00Z', customerName: 'Cliente',
      total: 120, shippingCost: 20,
      delivery: { buyerDocument: '12345678', shippingPayment: 'together' },
      boxes: [{ items: [{ name: 'Galleta', quantity: 1, unitPrice: 100 }] }] }
  };
  const data = billingData(job);
  const text = data.blocks.map(block => block.text).join('\n');
  assert.equal(data.month, '2026-02');
  assert.match(text, /NO ES FACTURA/);
  assert.match(text, /Pago aprobado registrado: 28\/02\/2026/);
  assert.match(text, /Documento del comprador: 12345678/);
  assert.match(text, /Envío incluido:/);
  assert.match(text, /Total pagado por Nave: \$120,00/);
  job.order.delivery = { shippingPayment: 'separate' };
  delete job.paymentRecordedAt;
  const oldText = billingData(job).blocks.map(block => block.text).join('\n');
  assert.match(oldText, /Fecha del pedido \(pago sin fecha registrada\)/);
  assert.match(oldText, /Documento del comprador: No registrado/);
  assert.match(oldText, /Envío a pagar por separado/);
  assert.doesNotMatch(oldText, /Envío incluido:/);
  assert.throws(() => billingData({ order: {} }), /fecha válida/);
});

test('la cola guarda la fecha en que registró el pago aprobado', async t => {
  const previous = { fetch: global.fetch, url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
  let command;
  global.fetch = async (url, options) => {
    command = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: 1 }) };
  };
  t.after(() => {
    global.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  });
  await jobs.enqueuePaidOrder({ id: 'pedido' }, 'pago');
  const job = JSON.parse(command[5]);
  assert.equal(job.paymentId, 'pago');
  assert.equal(job.order.paymentStatus, 'APPROVED');
  assert.ok(Number.isFinite(Date.parse(job.paymentRecordedAt)));
});

test('solo un pago aprobado y verificado de Nave genera un trabajo', async t => {
  const saved = { getPayment: nave.getPayment, readOrders: orders.readOrders,
    confirm: orders.confirmOrderForNave, markShipping: orders.markNaveShippingPaid, enqueue: jobs.enqueuePaidOrder };
  t.after(() => {
    nave.getPayment = saved.getPayment;
    orders.readOrders = saved.readOrders;
    orders.confirmOrderForNave = saved.confirm;
    orders.markNaveShippingPaid = saved.markShipping;
    jobs.enqueuePaidOrder = saved.enqueue;
    delete require.cache[require.resolve('../api/nave-notifications')];
  });
  const id = '00000000-0000-4000-8000-000000000001';
  const paymentId = '00000000-0000-4000-8000-000000000002';
  const order = { id, total: 100, paymentMethod: 'Sistema Nave de Galicia / MODO', paymentRequest: { id: 'request' } };
  orders.readOrders = async () => [order];
  orders.confirmOrderForNave = async () => ({ status: 200, body: {} });
  let marked = 0;
  orders.markNaveShippingPaid = async () => { marked++; };
  let enqueued = 0;
  jobs.enqueuePaidOrder = async () => { enqueued++; };
  let payment = { id: paymentId, external_payment_id: id, status: { name: 'PENDING' }, amount: { currency: 'ARS', value: '100.00' } };
  nave.getPayment = async () => payment;
  delete require.cache[require.resolve('../api/nave-notifications')];
  const freshHandler = require('../api/nave-notifications');
  const req = { method: 'POST', body: { payment_id: paymentId, external_payment_id: id } };
  let res = response();
  await freshHandler(req, res);
  assert.equal(enqueued, 0);
  payment = { ...payment, status: { name: 'APPROVED' }, amount: { currency: 'ARS', value: '99.00' } };
  res = response();
  await freshHandler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(enqueued, 0);
  payment = { ...payment, amount: { currency: 'ARS', value: '100.00' } };
  res = response();
  await freshHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(enqueued, 1);
  assert.equal(marked, 0);
  order.delivery = { shippingPayment: 'together' };
  payment = { ...payment, amount: { currency: 'ARS', value: '99.00' } };
  res = response();
  await freshHandler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(marked, 0);
  payment = { ...payment, amount: { currency: 'ARS', value: '100.00' } };
  res = response();
  await freshHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(marked, 1);
  order.delivery.shippingPayment = 'separate';
  res = response();
  await freshHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(marked, 1);
});

test('la confirmación manual guarda el pedido y prepara la cola en la misma operación', async t => {
  const previous = {
    fetch: global.fetch,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_BRANCH: process.env.GITHUB_BRANCH
  };
  Object.assign(process.env, {
    ADMIN_PASSWORD: 'admin-password-de-prueba',
    UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'test',
    GITHUB_TOKEN: 'test',
    GITHUB_REPOSITORY: 'test/repo',
    GITHUB_BRANCH: 'test'
  });
  t.after(() => {
    global.fetch = previous.fetch;
    for (const [key, value] of Object.entries(previous)) {
      if (key === 'fetch') continue;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const id = '00000000-0000-4000-8000-000000000001';
  const order = { id, status: 'generated', paymentMethod: 'Transferencia',
    items: [{ productId: 'p', name: 'Galleta', quantity: 1 }] };
  const catalog = { products: [{ id: 'p', name: 'Galleta', stockQuantity: 3 }] };
  let mark;
  global.fetch = async (url, options = {}) => {
    if (url.startsWith('https://api.github.com/')) {
      if (options.method === 'PUT') return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({ sha: 'sha', content: Buffer.from(JSON.stringify(catalog)).toString('base64') }) };
    }
    const command = JSON.parse(options.body);
    if (command[0] === 'SET') return { ok: true, json: async () => ({ result: 'OK' }) };
    if (command[1].includes("order.status = 'completed'")) {
      mark = command;
      return { ok: true, json: async () => ({ result: JSON.stringify({ ...order, status: 'completed' }) }) };
    }
    if (command[1].includes("redis.call('DEL'")) return { ok: true, json: async () => ({ result: 1 }) };
    return { ok: true, json: async () => ({ result: JSON.stringify([order]) }) };
  };
  const res = response();
  await orders({ method: 'POST', headers: { authorization: `Bearer ${process.env.ADMIN_PASSWORD}` },
    body: { action: 'update-status', status: 'completed', orderId: id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(mark[2], '3');
  assert.match(mark[1], /order\.paymentMethod ~= 'Sistema Nave de Galicia \/ MODO'/);
  assert.match(mark[1], /redis\.call\('ZADD', KEYS\[3\]/);
  assert.match(mark[4], /dulce-feliz-print-job/);
  assert.match(mark[5], /dulce-feliz-print-pending/);
});
