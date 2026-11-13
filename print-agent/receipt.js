(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/qrcode'));
  } else {
    root.DulceReceipt = factory(root.qrcode);
  }
})(typeof globalThis === 'object' ? globalThis : this, function (qrcode) {
  function receiptBlocks(order) {
    const blocks = [];
    const clean = value => String(value).replace(/\s+/g, ' ').trim();
    const add = (type, text) => blocks.push({ type, text });
    const row = (label, value) => {
      if (value !== undefined && value !== null && value !== '') add('line', `${label}: ${clean(value)}`);
    };
    const money = value => `$${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const section = name => add('section', name);
    add('title', 'DULCE Y FELIZ');
    add('subtitle', 'CONSUMIDOR FINAL - NO FISCAL');
    add('number', `DF-${String(order.orderNumber).padStart(6, '0')}`);
    row('Fecha', order.createdAt);
    section('DATOS DEL PEDIDO');
    row('Cliente', order.customerName);
    row('Entrega', order.shippingMethod);
    row('Pago', order.paymentMethod);
    if (order.paymentStatus === 'APPROVED') row('Confirmación', 'Pago aprobado por Nave');
    if (order.address) row('Dirección', order.address);
    if (order.delivery) {
      const delivery = order.delivery;
      section('DATOS DE ENTREGA');
      for (const [label, value] of [
        ['Calle', delivery.street], ['Altura', delivery.number],
        ['Piso', delivery.floor], ['Departamento', delivery.apartment], ['Barrio', delivery.neighborhood],
        ['Localidad', delivery.locality], ['Provincia', delivery.province], ['Entre calles', delivery.crossStreets],
        ['Referencia', delivery.landmark], ['Teléfono', delivery.phone], ['Teléfono adicional', delivery.phoneAlt],
        ['Persona autorizada', delivery.authorized],
        ['Recolección prevista', delivery.collectionDate],
        ['Feriado: gestión desde', delivery.holidayReopeningDate],
        ['Pago de envío', delivery.shippingPayment === 'together' ? 'Incluido en la compra' : 'A pagar aparte por transferencia'],
        ['Costo de envío', money(order.shippingCost)]
      ]) row(label, value);
    }
    section('PRODUCTOS');
    for (const [index, box] of (order.boxes || []).entries()) {
      add('box', `Caja ${index + 1} · ${box.size === 1 ? 'Cajita individual' : `Caja de ${box.size}`}`);
      row('Personalizada para', box.customName);
      for (const item of box.items || []) row(item.name, `${item.quantity} x ${money(item.unitPrice)}`);
    }
    section('IMPORTE');
    if (order.productTotal !== undefined) row('Productos', money(order.productTotal));
    add('total', `Total de la compra: ${money(order.total)}`);
    return blocks;
  }

  function createReceipt(order) {
    const blocks = receiptBlocks(order);
    const payload = `COMPROBANTE NO FISCAL\nPedido: DF-${String(order.orderNumber).padStart(6, '0')}\nFecha: ${String(order.createdAt || '').slice(0, 10)}\nTotal: ${Number(order.total).toFixed(2)} ARS`;
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'M');
    qr.addData(payload, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    const code = {
      label: 'Datos del comprobante',
      payload,
      svg: qr.createSvgTag(4, 16),
      matrix: Array.from({ length: count }, (_, row) =>
        Array.from({ length: count }, (_, column) => qr.isDark(row, column)))
    };
    return { blocks, codes: [code] };
  }

  function flattenOrder(order) {
    const fields = {};
    function visit(value, name) {
      if (value === null || typeof value !== 'object') {
        fields[name] = value;
      } else {
        const keys = Object.keys(value);
        if (!keys.length) fields[name] = Array.isArray(value) ? '[]' : '{}';
        for (const key of keys) visit(value[key], name ? `${name}.${key}` : key);
      }
    }
    visit(order, '');
    return fields;
  }

  function archiveBlocks(order) {
    const labels = {
      id: 'Identificador', orderNumber: 'Número de pedido', createdAt: 'Fecha de creación',
      customerName: 'Cliente', address: 'Dirección', shippingMethod: 'Forma de entrega',
      destinationType: 'Tipo de destino', businessDeliveryHours: 'Horario de recepción',
      paymentMethod: 'Medio de pago', paymentStatus: 'Estado del pago', paymentId: 'ID del pago',
      registered: 'Registro VIP', shippingCost: 'Costo de envío', shippingProvider: 'Transportista',
      productTotal: 'Subtotal de productos', total: 'Total de la compra', status: 'Estado del pedido',
      statusUpdatedAt: 'Fecha de actualización', confirmedAt: 'Fecha de confirmación',
      companyName: 'Empresa', companyId: 'ID de empresa', zoneName: 'Zona', zoneId: 'ID de zona',
      recipient: 'Destinatario', buyerDocument: 'Documento del comprador', street: 'Calle',
      number: 'Altura', floor: 'Piso', apartment: 'Departamento', neighborhood: 'Barrio',
      locality: 'Localidad', province: 'Provincia', crossStreets: 'Entre calles', landmark: 'Referencia',
      phone: 'Teléfono', phoneAlt: 'Teléfono adicional', authorized: 'Persona autorizada',
      shippingPayment: 'Pago de envío', collectionDate: 'Recolección prevista', holidayReopeningDate: 'Feriado: gestión desde',
      holidayAcceptedAt: 'Fecha de aceptación del aviso', size: 'Tamaño', customName: 'Personalización',
      productId: 'ID de producto', name: 'Producto', quantity: 'Cantidad', unitPrice: 'Precio unitario'
    };
    const label = key => key.split('.').map(part => {
      if (/^\d+$/.test(part)) return String(Number(part) + 1);
      return labels[part] || ({ delivery: 'Entrega', boxes: 'Caja', items: 'Artículo', paymentRequest: 'Solicitud de pago' }[part]) || part;
    }).join(' / ');
    return [
      { type: 'title', text: 'DULCE Y FELIZ' },
      { type: 'subtitle', text: 'RESPALDO COMPLETO - NO FISCAL' },
      { type: 'number', text: `DF-${String(order.orderNumber).padStart(6, '0')}` },
      { type: 'section', text: 'DATOS REGISTRADOS DE LA COMPRA' },
      ...Object.entries(flattenOrder(order)).map(([key, value]) => ({
        type: 'line', text: `${label(key)}: ${value === null ? 'null' : String(value)}`
      }))
    ];
  }

  function billingData(job) {
    const order = job.order;
    const recordedAt = job.paymentRecordedAt || order.createdAt;
    const date = new Date(recordedAt);
    if (!recordedAt || Number.isNaN(date.getTime())) throw new Error('El pedido no tiene una fecha válida para organizar el PDF.');
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const part = name => parts.find(item => item.type === name).value;
    const month = `${part('year')}-${part('month')}`;
    const money = value => `$${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const blocks = [
      { type: 'title', text: 'DULCE Y FELIZ' },
      { type: 'subtitle', text: 'DATOS PARA FACTURAR - NO ES FACTURA' },
      { type: 'number', text: `Pedido DF-${String(order.orderNumber).padStart(6, '0')}` },
      { type: 'line', text: `${job.paymentRecordedAt ? 'Pago aprobado registrado' : 'Fecha del pedido (pago sin fecha registrada)'}: ${part('day')}/${part('month')}/${part('year')}` },
      { type: 'line', text: `Cliente: ${order.customerName}` },
      { type: 'line', text: `Documento del comprador: ${order.delivery?.buyerDocument || 'No registrado; verificar si corresponde'}` },
      { type: 'line', text: 'Condición: consumidor final (verificar antes de facturar)' },
      { type: 'line', text: 'Medio de pago: Nave' },
      { type: 'line', text: `ID de pago: ${job.paymentId}` },
      { type: 'section', text: 'PRODUCTOS' }
    ];
    for (const box of order.boxes || []) {
      for (const item of box.items || []) {
        blocks.push({ type: 'line', text: `${item.name}: ${item.quantity} x ${money(item.unitPrice)}` });
      }
    }
    if (order.delivery?.shippingPayment === 'together') {
      blocks.push({ type: 'line', text: `Envío incluido: ${money(order.shippingCost)}` });
    } else if (order.delivery?.shippingPayment === 'separate') {
      blocks.push({ type: 'line', text: 'Envío a pagar por separado: no incluido en el importe de Nave' });
    }
    blocks.push({ type: 'total', text: `Total pagado por Nave: ${money(order.total)}` });
    blocks.push({ type: 'line', text: 'Verificar los datos y que la venta no haya sido facturada antes de emitir.' });
    return { month, blocks };
  }

  return { receiptLines: order => receiptBlocks(order).map(block => block.text), createReceipt, flattenOrder, archiveBlocks, billingData };
});
