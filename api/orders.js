const crypto = require('node:crypto');

const ORDERS_KEY = 'dulce-feliz-generated-orders';
const MAX_ORDERS = 200;
const GITHUB_API = 'https://api.github.com';

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function matchesPassword(provided, expected) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function hasAdminAccess(req) {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword || expectedPassword.length < 16) return false;
  const authorization = req.headers.authorization || '';
  const providedPassword = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  return matchesPassword(providedPassword, expectedPassword);
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('El almacenamiento de pedidos no está configurado en Vercel.');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error('No se pudo acceder al almacenamiento de pedidos.');
  }
  return result.result;
}

async function readOrders() {
  const result = await redisCommand(['GET', ORDERS_KEY]);
  if (result === null) return [];
  const orders = JSON.parse(result);
  if (!Array.isArray(orders)) throw new Error('El registro de pedidos tiene un formato inválido.');
  return orders;
}

function getOrderSubmission(body) {
  const order = body && body.order;
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
  if (typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)) return null;
  if (typeof order.customerName !== 'string' || !order.customerName.trim() || order.customerName.length > 120) return null;
  if (typeof order.shippingMethod !== 'string' || !order.shippingMethod.trim() || order.shippingMethod.length > 180) return null;
  if (typeof order.paymentMethod !== 'string' || !order.paymentMethod.trim() || order.paymentMethod.length > 200) return null;
  if (typeof order.address !== 'string' || order.address.length > 500) return null;
  if (typeof order.registered !== 'boolean') return null;
  if (!Array.isArray(order.boxes) || order.boxes.length < 1 || order.boxes.length > 100) return null;

  let total = 0;
  const boxes = [];
  const itemCounts = new Map();
  for (const box of order.boxes) {
    if (!box || ![1, 3].includes(box.size) || !Array.isArray(box.items) || box.items.length < 1) return null;
    let cookieCount = 0;
    const items = [];
    for (const item of box.items) {
      if (!item || typeof item.productId !== 'string' || !item.productId.trim() || item.productId.length > 120) return null;
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) return null;
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > box.size) return null;
      if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) return null;
      cookieCount += item.quantity;
      total += item.unitPrice * item.quantity;
      items.push({
        productId: item.productId.trim(),
        name: item.name.trim(),
        quantity: item.quantity,
        unitPrice: item.unitPrice
      });
      const current = itemCounts.get(item.productId.trim()) || { productId: item.productId.trim(), name: item.name.trim(), quantity: 0 };
      current.quantity += item.quantity;
      itemCounts.set(item.productId.trim(), current);
    }
    if (cookieCount > box.size) return null;
    const customName = box.size === 3 && typeof box.customName === 'string'
      ? box.customName.trim().slice(0, 40)
      : '';
    boxes.push({ size: box.size, customName, items });
  }

  if (!Number.isSafeInteger(Math.round(total)) || total > Number.MAX_SAFE_INTEGER) return null;
  return {
    id: body.requestId,
    createdAt: new Date().toISOString(),
    customerName: order.customerName.trim(),
    address: order.address.trim(),
    shippingMethod: order.shippingMethod.trim(),
    paymentMethod: order.paymentMethod.trim(),
    registered: order.registered,
    boxes,
    items: [...itemCounts.values()],
    total,
    status: 'generated'
  };
}

async function createOrder(req, res, body) {
  const order = getOrderSubmission(body);
  if (!order) return respond(res, 400, { error: 'El pedido enviado no tiene un formato válido.' });

  const script = `
    local raw = redis.call('GET', KEYS[1])
    local orders = raw and cjson.decode(raw) or {}
    for _, existing in ipairs(orders) do
      if existing.id == ARGV[1] then return cjson.encode(existing) end
    end
    table.insert(orders, 1, cjson.decode(ARGV[1]))
    while #orders > tonumber(ARGV[2]) do table.remove(orders) end
    redis.call('SET', KEYS[1], cjson.encode(orders))
    return cjson.encode(orders[1])
  `;
  const stored = await redisCommand(['EVAL', script, '1', ORDERS_KEY, JSON.stringify(order), String(MAX_ORDERS)]);
  const savedOrder = typeof stored === 'string' ? JSON.parse(stored) : stored;
  return respond(res, 201, { saved: true, orderId: savedOrder.id });
}

async function confirmOrder(req, res, body) {
  if (!hasAdminAccess(req)) return respond(res, 401, { error: 'No tienes autorización para cerrar pedidos.' });
  if (typeof body.orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.orderId)) {
    return respond(res, 400, { error: 'El identificador del pedido no es válido.' });
  }

  const lockKey = `${ORDERS_KEY}:confirm:${body.orderId}`;
  const lockToken = crypto.randomUUID();
  const lockResult = await redisCommand(['SET', lockKey, lockToken, 'NX', 'EX', '60']);
  if (lockResult !== 'OK') return respond(res, 409, { error: 'Este pedido ya se está procesando. Actualiza la lista e inténtalo de nuevo.' });

  try {
    const orders = await readOrders();
    const order = orders.find(item => item.id === body.orderId);
    if (!order) return respond(res, 404, { error: 'El pedido no está en el registro de los últimos 200 pedidos.' });
    if (order.status === 'confirmed') {
      if (body.paymentStatus === 'APPROVED' && order.paymentStatus !== 'APPROVED') {
        const paymentScript = `
          local raw = redis.call('GET', KEYS[1])
          if not raw then return nil end
          local orders = cjson.decode(raw)
          for index, existing in ipairs(orders) do
            if existing.id == ARGV[1] then
              existing.paymentStatus = 'APPROVED'
              existing.paymentId = ARGV[2]
              orders[index] = existing
              redis.call('SET', KEYS[1], cjson.encode(orders))
              return cjson.encode(existing)
            end
          end
          return nil
        `;
        const updated = await redisCommand(['EVAL', paymentScript, '1', ORDERS_KEY, order.id, body.paymentId || '']);
        const updatedOrder = typeof updated === 'string' ? JSON.parse(updated) : updated;
        return respond(res, 200, { confirmed: true, order: updatedOrder || order });
      }
      return respond(res, 200, { confirmed: true, order });
    }

    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY || '';
    const branch = process.env.GITHUB_BRANCH;
    const [owner, repo, ...extraParts] = repository.split('/');
    if (!token || !branch || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || extraParts.length) {
      return respond(res, 503, { error: 'Falta configurar GITHUB_TOKEN, GITHUB_REPOSITORY o GITHUB_BRANCH para descontar el inventario.' });
    }

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Dulce-y-Feliz-orders'
    };
    const fileUrl = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/catalog-data.json`;
    const catalogResponse = await fetch(`${fileUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    const catalogFile = await catalogResponse.json();
    if (!catalogResponse.ok || !catalogFile.sha || !catalogFile.content) {
      console.error('Could not read catalog before confirming order', { status: catalogResponse.status });
      return respond(res, 502, { error: 'No se pudo leer el inventario actual desde GitHub.' });
    }

    let catalog;
    try {
      catalog = JSON.parse(Buffer.from(catalogFile.content, 'base64').toString('utf8'));
    } catch (error) {
      console.error('Invalid catalog JSON while confirming order', error);
      return respond(res, 502, { error: 'El catálogo de inventario no tiene un formato válido.' });
    }
    if (!Array.isArray(catalog.products)) {
      return respond(res, 502, { error: 'El catálogo no contiene una lista de productos válida.' });
    }

    const processedSaleIds = Array.isArray(catalog.processedSaleIds)
      ? catalog.processedSaleIds.filter(id => typeof id === 'string')
      : [];
    const processedSales = catalog.processedSales && typeof catalog.processedSales === 'object'
      && !Array.isArray(catalog.processedSales)
      ? catalog.processedSales
      : {};
    let catalogChanged = false;
    if (!processedSaleIds.includes(order.id)) {
      for (const item of order.items) {
        const product = catalog.products.find(candidate => candidate.id === item.productId);
        if (!product) {
          return respond(res, 409, { error: `No se encontró "${item.name}" en el catálogo actual. El pedido sigue pendiente.` });
        }
        const stock = product.stockQuantity ?? 10;
        if (!Number.isSafeInteger(stock) || stock < item.quantity) {
          return respond(res, 409, { error: `Stock insuficiente para "${product.name}". El pedido sigue pendiente y no se descontó inventario.` });
        }
        product.stockQuantity = stock - item.quantity;
      }
      catalogChanged = true;
    }

    const retainedSaleIds = [...processedSaleIds.filter(id => id !== order.id), order.id].slice(-MAX_ORDERS);
    if (!processedSales[order.id]) {
      processedSales[order.id] = order.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity
      }));
      catalogChanged = true;
    }
    if (JSON.stringify(retainedSaleIds) !== JSON.stringify(processedSaleIds)) catalogChanged = true;
    catalog.processedSaleIds = retainedSaleIds;
    catalog.processedSales = Object.fromEntries(
      retainedSaleIds.filter(id => processedSales[id]).map(id => [id, processedSales[id]])
    );

    if (catalogChanged) {
      const updateResponse = await fetch(fileUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Descontar inventario por pedido ${order.id}`,
          content: Buffer.from(JSON.stringify(catalog, null, 2), 'utf8').toString('base64'),
          sha: catalogFile.sha,
          branch
        })
      });
      if (!updateResponse.ok) {
        console.error('Could not update catalog stock for confirmed order', { status: updateResponse.status });
        return respond(res, updateResponse.status === 409 || updateResponse.status === 422 ? 409 : 502, {
          error: updateResponse.status === 409 || updateResponse.status === 422
            ? 'El inventario cambió mientras se procesaba el pedido. Actualiza el panel e inténtalo nuevamente.'
            : 'GitHub rechazó la actualización del inventario.'
        });
      }
    }

    const paymentStatus = body.paymentStatus === 'APPROVED' ? 'APPROVED' : '';
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
    const markScript = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local orders = cjson.decode(raw)
      for index, order in ipairs(orders) do
        if order.id == ARGV[1] then
          order.status = 'confirmed'
          order.confirmedAt = ARGV[2]
          if ARGV[3] == 'APPROVED' then
            order.paymentStatus = ARGV[3]
            order.paymentId = ARGV[4]
          end
          orders[index] = order
          redis.call('SET', KEYS[1], cjson.encode(orders))
          return cjson.encode(order)
        end
      end
      return nil
    `;
    const result = await redisCommand([
      'EVAL', markScript, '1', ORDERS_KEY, order.id,
      new Date().toISOString(), paymentStatus, paymentId
    ]);
    if (!result) {
      console.error('Inventory was updated, but the order status could not be saved in Redis', { orderId: order.id });
      return respond(res, 502, { error: 'Se descontó el inventario, pero no se pudo actualizar el estado del pedido. Reintenta el check para sincronizarlo.' });
    }
    const confirmedOrder = typeof result === 'string' ? JSON.parse(result) : result;
    const stockByProductId = Object.fromEntries(order.items.flatMap(item => {
      const product = catalog.products.find(candidate => candidate.id === item.productId);
      return product ? [[item.productId, product.stockQuantity ?? 10]] : [];
    }));
    return respond(res, 200, {
      confirmed: true,
      order: confirmedOrder,
      stockByProductId,
      processedSaleIds: catalog.processedSaleIds,
      processedSales: catalog.processedSales
    });
  } finally {
    const releaseScript = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    try {
      await redisCommand(['EVAL', releaseScript, '1', lockKey, lockToken]);
    } catch (error) {
      console.error('Could not release order confirmation lock', error);
    }
  }
}

async function confirmOrderForNave(orderId, paymentId) {
  const res = {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  await confirmOrder({
    headers: { authorization: `Bearer ${process.env.ADMIN_PASSWORD || ''}` }
  }, res, {
    orderId,
    paymentStatus: 'APPROVED',
    paymentId
  });
  return { status: res.statusCode, body: res.body };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!hasAdminAccess(req)) return respond(res, 401, { error: 'No tienes autorización para consultar los pedidos.' });
      const orders = await readOrders();
      return respond(res, 200, { orders, limit: MAX_ORDERS });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return respond(res, 405, { error: 'Método no permitido.' });
    }

    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return respond(res, 400, { error: 'La solicitud no tiene un formato válido.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respond(res, 400, { error: 'La solicitud no tiene un formato válido.' });
    }
    if (body.action === 'create') return await createOrder(req, res, body);
    if (body.action === 'confirm') return await confirmOrder(req, res, body);
    return respond(res, 400, { error: 'La acción solicitada no es válida.' });
  } catch (error) {
    console.error('Order request failed', error);
    return respond(res, 502, { error: error.message || 'No se pudo procesar el pedido.' });
  }
};

module.exports.readOrders = readOrders;
module.exports.confirmOrderForNave = confirmOrderForNave;
