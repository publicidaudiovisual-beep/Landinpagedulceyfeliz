const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const orders = require('../api/orders');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const updateOptions = html.match(/    function updateCheckoutOptions\(event\) \{[\s\S]*?\n    \}/);
const takeawayRule = html.match(/    function requiresTakeawayForIndividualBoxes\(\) \{[\s\S]*?\n    \}/);
const updateBusinessHours = html.match(/    function updateBusinessHours\(\) \{[\s\S]*?\n    \}/);
assert.ok(updateOptions, 'No se encontró la función updateCheckoutOptions');
assert.ok(takeawayRule, 'No se encontró la regla de retiro');
assert.ok(updateBusinessHours, 'No se encontró la actualización de horarios');

test('el tipo de destino y los horarios se solicitan solo cuando corresponden', () => {
  const elements = {};
  function element(id) {
    if (!elements[id]) {
      elements[id] = {
        value: '', required: false, disabled: false, hidden: false,
        classList: { toggle(name, hidden) { elements[id].hidden = hidden; } }
      };
    }
    return elements[id];
  }
  const shipping = element('box-shipping-method');
  shipping.options = [
    { value: 'Envío por empresa privada', disabled: false },
    { value: 'Coordinar envío por WhatsApp', disabled: false }
  ];
  const payment = element('box-payment-method');
  payment.options = [];
  payment.selectedOptions = [{ dataset: {} }];
  const destination = element('box-destination-type');
  const hours = element('box-business-delivery-hours');
  const context = vm.createContext({
    document: { getElementById: element },
    shippingMethodSelect: shipping,
    paymentMethodSelect: payment,
    destinationTypeSelect: destination,
    businessDeliveryHours: hours,
    activeBoxes: [[1, 2, 3, 4]],
    boxSizes: [4],
    selectedDelivery: null,
    openOrderPreviewTotal() {}
  });
  vm.runInContext(takeawayRule[0], context);
  vm.runInContext(updateOptions[0], context);
  vm.runInContext(updateBusinessHours[0], context);

  shipping.value = 'Envío por empresa privada';
  context.updateCheckoutOptions();
  destination.value = 'empresa';
  context.updateBusinessHours();
  assert.equal(hours.required, true);
  assert.equal(hours.disabled, false);
  assert.equal(element('business-delivery-hours-details').hidden, false);
  destination.value = 'casa';
  context.updateBusinessHours();
  assert.equal(hours.required, false);
  assert.equal(hours.disabled, true);
  shipping.value = 'Retiro Take Away en Villa Dominico';
  context.updateCheckoutOptions();
  context.activeBoxes = [[1], [1], [1]];
  context.boxSizes = [1, 1, 1];
  shipping.value = 'Envío por empresa privada';
  context.updateCheckoutOptions();
  assert.equal(shipping.value, '');
  assert.equal(shipping.options[0].disabled, true);
  assert.equal(shipping.options[1].disabled, true);
  context.activeBoxes.push([1]);
  context.boxSizes.push(1);
  context.updateCheckoutOptions();
  assert.equal(shipping.options[0].disabled, false);
  assert.equal(shipping.options[1].disabled, false);
});

test('los pedidos guardan el destino y validan el horario de empresas', async t => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
  t.after(() => {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  });

  let saved;
  global.fetch = async (url, options) => {
    const command = JSON.parse(options.body);
    if (command.length > 6) {
      saved = JSON.parse(command[6]);
      saved.orderNumber = 1;
      return { ok: true, json: async () => ({ result: JSON.stringify(saved) }) };
    }
    return { ok: true, json: async () => ({ result: '[]' }) };
  };
  const base = {
    customerName: 'Cliente', shippingMethod: 'Envío por Vima',
    paymentMethod: 'Transferencia', address: 'Dirección', registered: false,
    boxes: [{ size: 4, items: [{ productId: 'p', name: 'Galleta', quantity: 1, unitPrice: 100 }] }]
  };
  async function submit(order) {
    const res = {
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await orders({
      method: 'POST', headers: {},
      body: { action: 'create', requestId: '00000000-0000-4000-8000-000000000001', order }
    }, res);
    return res;
  }
  let res = await submit({ ...base, destinationType: 'empresa', businessDeliveryHours: '  Lunes de 9 a 12  ' });
  assert.equal(res.statusCode, 201);
  assert.equal(saved.destinationType, 'empresa');
  assert.equal(saved.businessDeliveryHours, 'Lunes de 9 a 12');
  res = await submit({ ...base, destinationType: 'casa', businessDeliveryHours: '' });
  assert.equal(res.statusCode, 201);
  assert.equal(saved.destinationType, 'casa');
  res = await submit({ ...base, destinationType: 'empresa', businessDeliveryHours: '   ' });
  assert.equal(res.statusCode, 400);
  res = await submit({ ...base, destinationType: 'casa', businessDeliveryHours: '9 a 12' });
  assert.equal(res.statusCode, 400);
  res = await submit(base);
  assert.equal(res.statusCode, 201);
  const individual = { size: 1, items: [{ productId: 'p', name: 'Galleta', quantity: 1, unitPrice: 100 }] };
  for (const shippingMethod of ['Envío por empresa privada', 'Coordinar envío por WhatsApp']) {
    res = await submit({ ...base, shippingMethod, boxes: Array(3).fill(individual) });
    assert.equal(res.statusCode, 400);
    if (shippingMethod === 'Coordinar envío por WhatsApp') {
      res = await submit({ ...base, shippingMethod, boxes: Array(4).fill(individual) });
      assert.equal(res.statusCode, 201);
      res = await submit({ ...base, shippingMethod, boxes: [individual, ...base.boxes] });
      assert.equal(res.statusCode, 201);
    }
  }
  res = await submit({ ...base, shippingMethod: 'Retiro Take Away en Villa Dominico', boxes: [individual] });
  assert.equal(res.statusCode, 201);
});
