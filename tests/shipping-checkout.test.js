const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const orders = require('../api/orders');

function response() {
  return {
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('el servidor calcula el envío por zona y rechaza tarifas desactualizadas', async t => {
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
  const zone = { id: '00000000-0000-4000-8000-000000000001', name: 'Zona 1', localities: ['Avellaneda'] };
  const company = {
    id: '00000000-0000-4000-8000-000000000002', name: 'Vima', enabled: true,
    rates: [{ zoneId: zone.id, priceCents: 871200 }]
  };
  let saved;
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    if (command[0] === 'GET') return { ok: true, json: async () => ({ result: JSON.stringify({ zones: [zone], companies: [company] }) }) };
    if (command.length > 6) {
      saved = JSON.parse(command[6]);
      saved.orderNumber = 1;
      return { ok: true, json: async () => ({ result: JSON.stringify(saved) }) };
    }
    return { ok: true, json: async () => ({ result: '[]' }) };
  };
  const delivery = {
    companyId: company.id, zoneId: zone.id, locality: 'Avellaneda',
    quotedCents: 932184, shippingPayment: 'together',
    recipient: 'Cliente', buyerDocument: '12345678', street: 'Calle', number: '123',
    province: 'Buenos Aires', phone: '1100000000'
  };
  const order = {
    customerName: 'Cliente', shippingMethod: 'Envío por empresa privada',
    paymentMethod: 'Transferencia', address: 'Calle 123', registered: false,
    destinationType: 'casa', businessDeliveryHours: '',
    boxes: [{ size: 4, items: [{ productId: 'p', name: 'Galleta', quantity: 1, unitPrice: 100 }] }],
    delivery
  };
  async function submit(candidate) {
    const res = response();
    await orders({ method: 'POST', headers: {}, body: {
      action: 'create', requestId: '00000000-0000-4000-8000-000000000003', order: candidate
    } }, res);
    return res;
  }
  let res = await submit(order);
  assert.equal(res.statusCode, 201);
  assert.equal(saved.shippingCost, 9321.84);
  assert.equal(saved.productTotal, 100);
  assert.equal(saved.total, 9421.84);
  res = await submit({ ...order, delivery: { ...delivery, shippingPayment: 'separate' } });
  assert.equal(res.statusCode, 201);
  assert.equal(saved.total, 100);
  assert.equal(saved.shippingCost, 9321.84);
  res = await submit({ ...order, delivery: { ...delivery, quotedCents: 1 } });
  assert.equal(res.statusCode, 409);
  res = await submit({ ...order, delivery: { ...delivery, locality: 'Otra' } });
  assert.equal(res.statusCode, 409);
  res = await submit({ ...order, delivery: { ...delivery, phone: '' } });
  assert.equal(res.statusCode, 400);
});

test('Nave incluye el envío solo cuando se eligió pagarlo con la compra', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'nave-checkout.js'), 'utf8');
  const match = source.match(/function getVerifiedProducts\(order, catalog\) \{[\s\S]*?\n\}/);
  assert.ok(match);
  const context = vm.createContext({ CheckoutValidationError: class extends Error {} });
  vm.runInContext(match[0], context);
  const catalog = { products: [{ id: 'p', name: 'Galleta', price: 100, stockQuantity: 2 }] };
  const order = {
    items: [{ productId: 'p', quantity: 1 }], productTotal: 100,
    shippingCost: 9321.84, total: 9421.84, delivery: { shippingPayment: 'together' }
  };
  const included = context.getVerifiedProducts(order, catalog);
  assert.equal(included.total, '9421.84');
  assert.equal(included.products.length, 2);
  const separate = context.getVerifiedProducts({ ...order, total: 100, delivery: { shippingPayment: 'separate' } }, catalog);
  assert.equal(separate.total, '100.00');
  assert.equal(separate.products.length, 1);
  assert.throws(() => context.getVerifiedProducts({ ...order, total: 100 }, catalog));
});

test('el comprobante manual incluye datos de entrega y escapa texto del cliente', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const match = source.match(/    async function printOrderReceipt\(orderId\) \{[\s\S]*?\n    \}/);
  assert.ok(match);
  let html = '';
  let printed = false;
  const context = vm.createContext({
    generatedOrders: [{
      id: 'pedido', status: 'completed', orderNumber: 1, total: 200, productTotal: 100,
      shippingCost: 100, destinationType: 'empresa', businessDeliveryHours: '9 a 12',
      delivery: { companyName: 'Vima', recipient: 'Ana', street: '<Calle>', phone: '1100000000', shippingPayment: 'together' },
      boxes: [{ size: 4, items: [{ name: 'Galleta', quantity: 1, unitPrice: 100 }] }]
    }],
    formatOrderNumber: number => `DF-${number}`,
    DulceReceipt: require('../print-agent/receipt'),
    location: { href: 'https://example.test/admin.html' },
    URL,
    escapeOrderHTML: value => String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]),
    window: { open: () => ({ document: {
      write: value => { html = value; }, close() {}, querySelector: () => ({ decode: async () => {} })
    }, focus() {}, print() { printed = true; }, close() {} }) },
    alert: message => { throw new Error(message); }
  });
  vm.runInContext(match[0], context);
  await context.printOrderReceipt('pedido');
  assert.equal(printed, true);
  assert.match(html, /&lt;Calle&gt;/);
  assert.doesNotMatch(html, /<Calle>/);
  assert.doesNotMatch(html, /9 a 12/);
  assert.match(html, /Teléfono/);
  assert.match(html, /Galleta/);
  context.generatedOrders[0].status = 'generated';
  await assert.rejects(context.printOrderReceipt('pedido'), /pedidos concretados/);
});

test('la exportación de compras incluye campos anidados y neutraliza fórmulas', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const match = source.match(/    async function exportOrdersCSV\(\) \{[\s\S]*?\n    \}/);
  assert.ok(match);
  let exported;
  const context = vm.createContext({
    generatedOrdersAvailable: true,
    generatedOrders: [{ customerName: '=PRUEBA', delivery: { recipient: 'Ana' }, boxes: [{ size: 4 }] }],
    loadGeneratedOrders: async () => {},
    DulceReceipt: require('../print-agent/receipt'),
    Blob,
    URL: { createObjectURL: blob => { exported = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    alert: message => { throw new Error(message); }
  });
  vm.runInContext(match[0], context);
  await context.exportOrdersCSV();
  const csv = await exported.text();
  assert.match(csv, /"delivery\.recipient"/);
  assert.match(csv, /"boxes\.0\.size"/);
  assert.match(csv, /"'=PRUEBA"/);
});
