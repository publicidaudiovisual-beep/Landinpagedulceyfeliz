const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const context = vm.createContext({});
for (const name of ['getOrderDateKey', 'formatOrderNumber', 'buildSalesHistory', 'orderMatchesSearch']) {
  const match = source.match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n    \\}`));
  assert.ok(match, `No se encontró ${name}`);
  vm.runInContext(match[0], context);
}

test('el gráfico cuenta compras concretadas dentro del período en hora argentina', () => {
  const orders = [
    { status: 'completed', statusUpdatedAt: '2026-11-06T03:00:00Z', total: 100 },
    { status: 'confirmed', createdAt: '2026-11-12T15:00:00Z', total: 200 },
    { status: 'completed', createdAt: '2026-11-06T02:59:59Z', total: 300 },
    { status: 'refunded', createdAt: '2026-11-12T15:00:00Z', total: 400 },
    { status: 'generated', createdAt: '2026-11-12T15:00:00Z', total: 500 },
    { status: 'completed', createdAt: '2026-11-12T23:00:00Z', total: 600 },
    { status: 'completed', createdAt: 'fecha inválida', total: 700 }
  ];
  const result = context.buildSalesHistory(orders, 'week', new Date('2026-11-12T20:00:00Z'));
  assert.equal(result.start, '2026-11-06');
  assert.equal(result.end, '2026-11-12');
  assert.equal(result.buckets.length, 7);
  assert.equal(result.buckets.reduce((sum, item) => sum + item.count, 0), 2);
  assert.equal(result.buckets.reduce((sum, item) => sum + item.total, 0), 300);
  assert.equal(result.excluded, 1);
});

test('los períodos largos respetan meses calendario y sus extremos', () => {
  const now = new Date('2026-11-30T20:00:00Z');
  const orders = [
    { status: 'completed', createdAt: '2026-05-30T15:00:00Z', total: 10 },
    { status: 'completed', createdAt: '2026-05-29T15:00:00Z', total: 20 },
    { status: 'completed', createdAt: '2025-11-30T15:00:00Z', total: 30 }
  ];
  const halfYear = context.buildSalesHistory(orders, 'six-months', now);
  assert.equal(halfYear.start, '2026-05-30');
  assert.equal(halfYear.buckets.reduce((sum, item) => sum + item.total, 0), 10);
  const year = context.buildSalesHistory(orders, 'year', now);
  assert.equal(year.start, '2025-11-30');
  assert.equal(year.buckets.reduce((sum, item) => sum + item.total, 0), 60);
  assert.equal(context.buildSalesHistory([], 'month', now).buckets.length, 30);
});

test('el buscador encuentra números, nombres, teléfonos y estados sin depender de acentos', () => {
  const order = { orderNumber: 23, customerName: 'María Pérez', status: 'completed',
    delivery: { phone: '1112345678', locality: 'Avellaneda' }, items: [{ name: 'Limón' }] };
  for (const query of ['DF-000023', 'maria perez', '1112345678', 'limon', 'concretada', 'avellaneda']) {
    assert.equal(context.orderMatchesSearch(order, query), true, query);
  }
  assert.equal(context.orderMatchesSearch(order, 'inexistente'), false);
});

test('al editar la condición se preservan el identificador y la descripción completa', async () => {
  const save = source.match(/    async function saveProduct\(e\) \{[\s\S]*?\n    \}/);
  assert.ok(save);
  assert.match(source, /<option value="proximamente">Próximamente<\/option>/);
  assert.match(source, /<option value="fijo">Sabor Fijo<\/option>/);
  const values = {
    'edit-product-id': '0', 'prod-name': 'Galleta', 'prod-line': 'vip',
    'prod-condition': 'proximamente', 'prod-price': '6000', 'prod-stock': '4',
    'prod-ingredients': 'Ingredientes', 'prod-img': 'foto.jpg', 'prod-img-cenital': 'cenital.png'
  };
  const original = { id: 'id-existente', size: 'Tamaño', taste: 'Sabor', texture: 'Textura',
    ideal: 'Ideal', presentation: 'Caja' };
  const ctx = vm.createContext({
    adminData: { products: [original] },
    document: { getElementById(id) { return id === 'product-modal'
      ? { close() {}, showModal() {} } : { value: values[id] }; } },
    renderAdminDashboard() {}, async persistAdminData() { return true; }
  });
  vm.runInContext(save[0], ctx);
  await ctx.saveProduct({ preventDefault() {} });
  const product = ctx.adminData.products[0];
  for (const [field, value] of Object.entries(original)) assert.equal(product[field], value);
  assert.equal(product.condition, 'proximamente');
});
