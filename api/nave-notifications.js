const { getPayment } = require('../lib/nave');
const ordersApi = require('./orders');
const { enqueuePaidOrder } = require('../lib/print-jobs');

function respond(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function getApprovedAmountCents(payment) {
  const purchases = Array.isArray(payment.transactions)
    ? payment.transactions.filter(transaction => transaction.transaction_type === 'PURCHASE')
    : [];
  const amounts = purchases.length
    ? purchases.map(transaction => transaction.amount)
    : [payment.amount || payment.total_amount || payment.available_balance?.total_amount];

  if (!amounts.length || amounts.some(amount => !amount || amount.currency !== 'ARS')) return null;
  const values = amounts.map(amount => Number(amount.value));
  if (values.some(value => !Number.isFinite(value) || value < 0)) return null;
  return values.reduce((total, value) => total + Math.round(value * 100), 0);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Método no permitido.' });
  }

  let notification;
  try {
    notification = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return respond(res, 400, { error: 'La notificación recibida no tiene un formato válido.' });
  }
  if (!notification || typeof notification !== 'object'
    || typeof notification.payment_id !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(notification.payment_id)
    || typeof notification.external_payment_id !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(notification.external_payment_id)) {
    return respond(res, 400, { error: 'La notificación no contiene identificadores de pago válidos.' });
  }

  try {
    const orders = await ordersApi.readOrders();
    const order = orders.find(item => item.id === notification.external_payment_id);
    if (!order) return respond(res, 404, { error: 'No se encontró el pedido asociado a la notificación.' });
    if (order.paymentMethod !== 'Sistema Nave de Galicia / MODO' || !order.paymentRequest?.id) {
      return respond(res, 409, { error: 'El pedido no tiene una intención de pago de Nave registrada.' });
    }

    const payment = await getPayment(notification.payment_id);
    if (payment.id !== notification.payment_id
      || payment.external_payment_id !== order.id) {
      console.error('Nave payment notification did not match the stored order', {
        paymentId: notification.payment_id,
        orderId: order.id
      });
      return respond(res, 409, { error: 'La información consultada a Nave no coincide con el pedido.' });
    }

    if (payment.status?.name !== 'APPROVED') {
      return respond(res, 200, { received: true, paymentStatus: payment.status?.name || 'UNKNOWN' });
    }

    const amountCents = getApprovedAmountCents(payment);
    if (amountCents === null || amountCents !== Math.round(Number(order.total) * 100)) {
      console.error('Approved Nave payment amount did not match the stored order', { orderId: order.id });
      return respond(res, 409, { error: 'El monto aprobado por Nave no coincide con el pedido.' });
    }

    if (order.delivery?.shippingPayment === 'together') {
      await ordersApi.markNaveShippingPaid(order.id, notification.payment_id);
    }
    await enqueuePaidOrder(order, notification.payment_id);
    const confirmation = await ordersApi.confirmOrderForNave(order.id, notification.payment_id);
    if (confirmation.status < 200 || confirmation.status >= 300) {
      console.error('Could not confirm inventory after approved Nave payment', {
        orderId: order.id,
        status: confirmation.status
      });
      return respond(res, confirmation.status, {
        error: confirmation.body?.error || 'No se pudo confirmar el pedido y descontar el inventario.'
      });
    }
    return respond(res, 200, { received: true, confirmed: true });
  } catch (error) {
    console.error('Nave payment notification failed', error);
    return respond(res, 502, { error: error.message || 'No se pudo procesar la notificación de Nave.' });
  }
};
