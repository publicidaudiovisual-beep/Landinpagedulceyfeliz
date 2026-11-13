const crypto = require('node:crypto');
const { getRedisKey } = require('../lib/redis-keys');
const { createPaymentRequest, getNaveConfig } = require('../lib/nave');

const ORDERS_KEY = getRedisKey('dulce-feliz-generated-orders');
const GITHUB_API = 'https://api.github.com';
const NAVE_PAYMENT_METHOD = 'Sistema Nave de Galicia / MODO';
const NAVE_CHECKOUT_ENABLED = process.env.NAVE_ENVIRONMENT === 'production';

class CheckoutValidationError extends Error {}

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('El almacenamiento de pedidos no está configurado en Vercel.');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: ['Bearer', token].join(' '),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error('No se pudo acceder al almacenamiento de pedidos.');
  return result.result;
}

async function readCatalog() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY || '';
  const branch = process.env.GITHUB_BRANCH;
  const [owner, repo, ...extraParts] = repository.split('/');
  if (!token || !branch || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || extraParts.length) {
    throw new Error('Falta configurar GITHUB_TOKEN, GITHUB_REPOSITORY o GITHUB_BRANCH para verificar los precios.');
  }

  const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/catalog-data.json?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: ['Bearer', token].join(' '),
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Dulce-y-Feliz-nave-checkout'
    }
  });
  const result = await response.json();
  if (!response.ok || !result.content) {
    console.error('Could not read catalog before creating Nave payment intent', { status: response.status });
    throw new Error('No se pudo verificar el catálogo actual antes de cobrar.');
  }

  try {
    return JSON.parse(Buffer.from(result.content, 'base64').toString('utf8'));
  } catch (error) {
    console.error('Invalid catalog JSON before creating Nave payment intent', error);
    throw new Error('El catálogo actual no tiene un formato válido.');
  }
}

function getVerifiedProducts(order, catalog) {
  if (!Array.isArray(catalog.products) || !Array.isArray(order.items)) {
    throw new CheckoutValidationError('No se pudo validar el detalle del pedido.');
  }

  let totalCents = 0;
  const products = order.items.map(item => {
    const product = catalog.products.find(candidate => candidate.id === item.productId);
    if (!product || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new CheckoutValidationError('El catálogo cambió. Vuelve a armar el pedido para actualizar los precios.');
    }
    const unitPriceCents = Math.round(Number(product.price) * 100);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new CheckoutValidationError(`El precio de "${product.name}" no es válido en el catálogo.`);
    }
    const stock = product.stockQuantity ?? 10;
    if (!Number.isSafeInteger(stock) || stock < item.quantity) {
      throw new CheckoutValidationError(`No hay stock suficiente de "${product.name}" para crear el pago.`);
    }
    totalCents += unitPriceCents * item.quantity;
    return {
      name: String(product.name).slice(0, 120),
      quantity: item.quantity,
      unit_price: { currency: 'ARS', value: (unitPriceCents / 100).toFixed(2) }
    };
  });

  const productTotal = order.productTotal === undefined ? order.total : order.productTotal;
  if (totalCents !== Math.round(Number(productTotal) * 100)) {
    throw new CheckoutValidationError('El total del pedido cambió. Vuelve a armarlo antes de pagar.');
  }
  if (order.delivery?.shippingPayment === 'together') {
    const shippingCents = Math.round(Number(order.shippingCost) * 100);
    if (!Number.isSafeInteger(shippingCents) || shippingCents <= 0) {
      throw new CheckoutValidationError('El costo de envío guardado no es válido.');
    }
    totalCents += shippingCents;
    products.push({
      name: 'Envío',
      quantity: 1,
      unit_price: { currency: 'ARS', value: (shippingCents / 100).toFixed(2) }
    });
  }
  if (totalCents !== Math.round(Number(order.total) * 100)) {
    throw new CheckoutValidationError('El total del pedido no coincide con los productos y el envío.');
  }
  return {
    products,
    total: (totalCents / 100).toFixed(2)
  };
}

async function handler(req, res) {
  if (req.method === 'GET') {
    if (!NAVE_CHECKOUT_ENABLED) {
      return respond(res, 200, {
        available: false,
        environment: process.env.NAVE_ENVIRONMENT || 'sandbox',
        message: 'El pago online con Nave no está disponible por el momento.'
      });
    }

    try {
      getNaveConfig();
      const requiredEnvironment = [
        'ADMIN_PASSWORD',
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
        'GITHUB_TOKEN',
        'GITHUB_REPOSITORY',
        'GITHUB_BRANCH'
      ];
      const missing = requiredEnvironment.some(name => !process.env[name])
        || process.env.ADMIN_PASSWORD.length < 16;
      return respond(res, 200, {
        available: !missing,
        environment: process.env.NAVE_ENVIRONMENT || 'sandbox'
      });
    } catch (error) {
      return respond(res, 200, {
        available: false,
        environment: process.env.NAVE_ENVIRONMENT || 'sandbox',
        message: error.message
      });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Método no permitido.' });
  }
  if (!NAVE_CHECKOUT_ENABLED) {
    return respond(res, 503, { error: 'El pago online con Nave no está disponible por el momento.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return respond(res, 400, { error: 'La solicitud no tiene un formato válido.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.orderId)) {
    return respond(res, 400, { error: 'El identificador del pedido no es válido.' });
  }

  const lockKey = `${ORDERS_KEY}:nave:${body.orderId}`;
  const lockToken = crypto.randomUUID();
  try {
    const lockResult = await redisCommand(['SET', lockKey, lockToken, 'NX', 'EX', '120']);
    if (lockResult !== 'OK') {
      return respond(res, 409, { error: 'El pago ya se está preparando. Espera un momento y vuelve a intentarlo.' });
    }

    const rawOrders = await redisCommand(['GET', ORDERS_KEY]);
    const orders = rawOrders === null ? [] : JSON.parse(rawOrders);
    if (!Array.isArray(orders)) throw new Error('El registro de pedidos tiene un formato inválido.');
    const order = orders.find(item => item.id === body.orderId);
    if (!order) return respond(res, 404, { error: 'No se encontró el pedido. Vuelve a iniciarlo desde la tienda.' });
    if (order.paymentMethod !== NAVE_PAYMENT_METHOD) {
      return respond(res, 409, { error: 'Este pedido no fue creado con Nave como medio de pago.' });
    }
    if (order.status === 'confirmed' || order.status === 'completed' || order.paymentStatus === 'APPROVED') {
      return respond(res, 409, { error: 'Este pedido ya figura como pagado.' });
    }
    if (order.paymentRequest?.checkoutUrl) {
      return respond(res, 200, {
        checkoutUrl: order.paymentRequest.checkoutUrl,
        reused: true
      });
    }

    const catalog = await readCatalog();
    const verified = getVerifiedProducts(order, catalog);
    const config = getNaveConfig();
    const paymentRequest = await createPaymentRequest({
      external_payment_id: order.id,
      seller: { pos_id: config.posId },
      transactions: [{
        amount: { currency: 'ARS', value: verified.total },
        products: verified.products
      }],
      additional_info: { callback_url: 'https://www.dulceyfeliz.online/' },
      duration_time: 86400
    });

    if (typeof paymentRequest.id !== 'string' || typeof paymentRequest.checkout_url !== 'string') {
      console.error('Nave returned an invalid payment intent response');
      return respond(res, 502, { error: 'Nave devolvió una intención de pago incompleta.' });
    }
    const checkoutUrl = new URL(paymentRequest.checkout_url);
    if (checkoutUrl.protocol !== 'https:' || !checkoutUrl.hostname.endsWith('.ranty.io')) {
      console.error('Nave returned an unexpected checkout URL host', { hostname: checkoutUrl.hostname });
      return respond(res, 502, { error: 'Nave devolvió una dirección de checkout no válida.' });
    }

    const savedPaymentRequest = {
      id: paymentRequest.id,
      checkoutUrl: checkoutUrl.toString(),
      createdAt: new Date().toISOString()
    };
    const saveScript = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local orders = cjson.decode(raw)
      for index, order in ipairs(orders) do
        if order.id == ARGV[1] then
          if order.paymentRequest then return cjson.encode(order.paymentRequest) end
          order.paymentRequest = cjson.decode(ARGV[2])
          orders[index] = order
          redis.call('SET', KEYS[1], cjson.encode(orders))
          return cjson.encode(order.paymentRequest)
        end
      end
      return nil
    `;
    const saved = await redisCommand([
      'EVAL', saveScript, '1', ORDERS_KEY, order.id, JSON.stringify(savedPaymentRequest)
    ]);
    if (!saved) throw new Error('No se pudo guardar la referencia de pago del pedido.');
    const result = typeof saved === 'string' ? JSON.parse(saved) : saved;
    return respond(res, 200, { checkoutUrl: result.checkoutUrl, reused: result.id !== paymentRequest.id });
  } catch (error) {
    console.error('Nave checkout request failed', error);
    const status = error instanceof CheckoutValidationError ? 409 : 502;
    return respond(res, status, { error: error.message || 'No se pudo preparar el pago con Nave.' });
  } finally {
    try {
      const releaseScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `;
      await redisCommand(['EVAL', releaseScript, '1', lockKey, lockToken]);
    } catch (error) {
      console.error('Could not release Nave checkout lock', error);
    }
  }
}

module.exports = handler;
