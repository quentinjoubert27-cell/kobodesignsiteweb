// api/_ratelimit.js — helper rate limiting via Upstash Redis REST API
// Utilise fetch natif (Node 18+), aucune dépendance npm

async function rateLimit(ip, key, { max, windowSec }) {
  const url  = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { ok: true }; // pas de Redis configuré → on laisse passer

  const redisKey = `rl:${key}:${ip}`;

  // INCR + EXPIRE atomique via pipeline
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['EXPIRE', redisKey, windowSec],
    ]),
  });

  if (!r.ok) return { ok: true }; // en cas d'erreur Redis → on laisse passer plutôt que bloquer

  const [incrResult] = await r.json();
  const count = incrResult.result;

  return { ok: count <= max, count, max };
}

module.exports = { rateLimit };
