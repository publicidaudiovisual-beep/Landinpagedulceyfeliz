function getRedisKey(key) {
  if (process.env.VERCEL_ENV === 'production') return key;
  return `${key}:sandbox`;
}

module.exports = { getRedisKey };
