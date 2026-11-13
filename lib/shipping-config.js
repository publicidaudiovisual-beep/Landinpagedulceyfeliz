const { getRedisKey } = require('./redis-keys');

const SHIPPING_KEY = getRedisKey('dulce-feliz-shipping-config');
const DEFAULT_ZONES = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'CABA', localities: ['CABA'] },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Primer cordón', localities: ['Vicente López', 'San Isidro', 'San Martín', 'Tres de Febrero', 'Hurlingham', 'Ituzaingó', 'Morón', 'La Matanza Norte', 'Avellaneda', 'Lanús', 'Lomas de Zamora'] },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Segundo cordón', localities: ['Tigre', 'San Fernando', 'Malvinas Argentinas', 'José C. Paz', 'San Miguel', 'Moreno', 'Merlo', 'La Matanza Sur', 'Ezeiza', 'Esteban Echeverría', 'Almirante Brown', 'Quilmes', 'Berazategui', 'Florencio Varela'] },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Tercer cordón', localities: ['Zárate', 'Campana', 'Escobar', 'Pilar', 'General Rodríguez', 'Marcos Paz', 'Cañuelas', 'Presidente Perón', 'San Vicente', 'Ensenada', 'Berisso', 'La Plata'] }
];
const DEFAULT_CONFIG = {
  zones: DEFAULT_ZONES,
  companies: [{
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Vima',
    enabled: true,
    rates: [541475, 871200, 1222100, 1222100].map((priceCents, index) => ({
      zoneId: DEFAULT_ZONES[index].id, priceCents
    }))
  }]
};

function validateShippingConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || !Array.isArray(config.zones) || config.zones.length > 50
    || !Array.isArray(config.companies) || config.companies.length > 20) return false;
  const zoneIds = new Set();
  const localityNames = new Set();
  for (const zone of config.zones) {
    if (!zone || typeof zone !== 'object' || Array.isArray(zone)
      || typeof zone.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(zone.id) || zoneIds.has(zone.id)
      || typeof zone.name !== 'string' || !zone.name.trim() || zone.name.length > 80
      || !Array.isArray(zone.localities) || zone.localities.length < 1 || zone.localities.length > 100) return false;
    zoneIds.add(zone.id);
    for (const locality of zone.localities) {
      if (typeof locality !== 'string' || !locality.trim() || locality.length > 100) return false;
      const key = locality.trim().toLocaleLowerCase('es-AR');
      if (localityNames.has(key)) return false;
      localityNames.add(key);
    }
  }
  const companyIds = new Set();
  for (const company of config.companies) {
    if (!company || typeof company !== 'object' || Array.isArray(company)
      || typeof company.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(company.id)
      || companyIds.has(company.id)
      || typeof company.name !== 'string' || !company.name.trim() || company.name.length > 80
      || typeof company.enabled !== 'boolean'
      || !Array.isArray(company.rates) || company.rates.length > config.zones.length
      || (company.enabled && company.rates.length === 0)) return false;
    companyIds.add(company.id);
    const companyZones = new Set();
    for (const rate of company.rates) {
      if (!rate || typeof rate !== 'object' || Array.isArray(rate)
        || !zoneIds.has(rate.zoneId) || companyZones.has(rate.zoneId)
        || !Number.isSafeInteger(rate.priceCents) || rate.priceCents <= 0 || rate.priceCents > 1000000000) return false;
      companyZones.add(rate.zoneId);
    }
  }
  return true;
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('El almacenamiento de tarifas no está configurado.');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error('No se pudo acceder al almacenamiento de tarifas.');
  return result.result;
}

async function readShippingConfig() {
  const raw = await redisCommand(['GET', SHIPPING_KEY]);
  if (raw === null) return structuredClone(DEFAULT_CONFIG);
  const config = JSON.parse(raw);
  if (!validateShippingConfig(config)) throw new Error('La configuración de envíos guardada no es válida.');
  return config;
}

async function saveShippingConfig(config) {
  if (!validateShippingConfig(config)) throw new Error('La configuración de envíos no es válida.');
  const result = await redisCommand(['SET', SHIPPING_KEY, JSON.stringify(config)]);
  if (result !== 'OK') throw new Error('No se pudo guardar la configuración de envíos.');
}

module.exports = { readShippingConfig, saveShippingConfig, validateShippingConfig };
