const { getRedisKey } = require('./redis-keys');

const pendingKey = getRedisKey('dulce-feliz-print-pending');
const claimedKey = getRedisKey('dulce-feliz-print-claimed');
const jobPrefix = `${getRedisKey('dulce-feliz-print-job')}:`;

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('El almacenamiento de impresión no está configurado.');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error('No se pudo acceder a la cola de impresión.');
  return result.result;
}

async function enqueuePaidOrder(order, paymentId) {
  const script = `
    if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
    redis.call('SET', KEYS[1], ARGV[1])
    redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
    return 1
  `;
  const job = { id: order.id, paymentId, state: 'pending', paymentRecordedAt: new Date().toISOString(),
    order: { ...order, paymentStatus: 'APPROVED', paymentId } };
  const result = await redisCommand(['EVAL', script, '2', jobPrefix + order.id, pendingKey,
    JSON.stringify(job), String(Date.now()), order.id]);
  if (result !== 0 && result !== 1) throw new Error('No se pudo confirmar la creación del trabajo de impresión.');
}

async function claimJob(claimId) {
  const script = `
    local ids = redis.call('ZRANGE', KEYS[1], 0, 0)
    if #ids == 0 then return nil end
    local id = ids[1]
    local key = ARGV[1] .. id
    local raw = redis.call('GET', key)
    if not raw then return redis.error_reply('Missing print job') end
    local job = cjson.decode(raw)
    if job.state ~= 'pending' then return redis.error_reply('Invalid print job state') end
    job.state = 'claimed'
    job.claimId = ARGV[2]
    job.claimedAt = ARGV[3]
    redis.call('SET', key, cjson.encode(job))
    redis.call('ZREM', KEYS[1], id)
    redis.call('ZADD', KEYS[2], ARGV[4], id)
    return cjson.encode(job)
  `;
  const result = await redisCommand(['EVAL', script, '2', pendingKey, claimedKey,
    jobPrefix, claimId, new Date().toISOString(), String(Date.now())]);
  return result ? JSON.parse(result) : null;
}

async function finishJob(id, claimId) {
  const script = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return 0 end
    local job = cjson.decode(raw)
    if job.state == 'sent' and job.claimId == ARGV[1] then return 1 end
    if job.state ~= 'claimed' or job.claimId ~= ARGV[1] then return 0 end
    redis.call('SET', KEYS[1], cjson.encode({id = job.id, state = 'sent', claimId = job.claimId, sentAt = ARGV[2]}))
    redis.call('ZREM', KEYS[2], job.id)
    return 1
  `;
  return (await redisCommand(['EVAL', script, '2', jobPrefix + id, claimedKey,
    claimId, new Date().toISOString()])) === 1;
}

async function listJobs() {
  const script = `
    local result = {}
    for _, key in ipairs(KEYS) do
      local ids = redis.call('ZRANGE', key, 0, 99)
      for _, id in ipairs(ids) do
        local raw = redis.call('GET', ARGV[1] .. id)
        if not raw then return redis.error_reply('Missing print job') end
        local job = cjson.decode(raw)
        table.insert(result, {id = job.id, state = job.state, claimedAt = job.claimedAt,
          orderNumber = job.order.orderNumber})
      end
    end
    return cjson.encode(result)
  `;
  const result = JSON.parse(await redisCommand(['EVAL', script, '2', pendingKey, claimedKey, jobPrefix]));
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && Object.keys(result).length === 0) return [];
  throw new Error('La cola de impresión tiene un formato inválido.');
}

async function retryJob(id) {
  const script = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return 0 end
    local job = cjson.decode(raw)
    if job.state ~= 'claimed' then return 0 end
    job.state = 'pending'
    job.claimId = nil
    job.claimedAt = nil
    redis.call('SET', KEYS[1], cjson.encode(job))
    redis.call('ZREM', KEYS[2], job.id)
    redis.call('ZADD', KEYS[3], ARGV[1], job.id)
    return 1
  `;
  return (await redisCommand(['EVAL', script, '3', jobPrefix + id, claimedKey, pendingKey,
    String(Date.now())])) === 1;
}

async function resolveJob(id) {
  const script = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return 0 end
    local job = cjson.decode(raw)
    if job.state ~= 'claimed' then return 0 end
    redis.call('SET', KEYS[1], cjson.encode({id = job.id, state = 'sent',
      claimId = job.claimId, sentAt = ARGV[1]}))
    redis.call('ZREM', KEYS[2], job.id)
    return 1
  `;
  return (await redisCommand(['EVAL', script, '2', jobPrefix + id, claimedKey,
    new Date().toISOString()])) === 1;
}

function getPrintJobKeys(orderId) {
  return [jobPrefix + orderId, pendingKey];
}

module.exports = { enqueuePaidOrder, claimJob, finishJob, listJobs, retryJob, resolveJob, getPrintJobKeys };
