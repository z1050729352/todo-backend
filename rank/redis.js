const { createClient } = require('redis');

let client = null;
let connecting = null;
let available = false;

async function getRedisClient() {
  if (process.env.REDIS_DISABLED === '1') {
    available = false;
    return null;
  }
  if (process.env.REDIS_INMEMORY === '1') {
    if (!client) {
      const zsets = new Map();
      const hashes = new Map();
      const getZ = (k) => (zsets.get(k) || (zsets.set(k, []), zsets.get(k)));
      const getH = (k) => (hashes.get(k) || (hashes.set(k, new Map()), hashes.get(k)));
      client = {
        on() {},
        async connect() {
          available = true;
          return client;
        },
        async del(...keys) {
          for (const k of keys) {
            zsets.delete(k);
            hashes.delete(k);
          }
        },
        async expire() {},
        async hSet(key, fieldOrObj, value) {
          const h = getH(key);
          if (typeof fieldOrObj === 'object' && fieldOrObj) {
            for (const [k, v] of Object.entries(fieldOrObj)) h.set(k, v);
            return;
          }
          h.set(String(fieldOrObj), String(value));
        },
        async hmGet(key, fields) {
          const h = getH(key);
          return fields.map((f) => h.get(String(f)) || null);
        },
        async zAdd(key, entries) {
          const z = getZ(key);
          for (const e of entries) z.push({ score: e.score, value: e.value });
        },
        async zRemRangeByRank() {},
        async zRange(key, start, stop, opts) {
          const z = getZ(key).slice();
          z.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return String(b.value).localeCompare(String(a.value));
          });
          const list = opts?.REV ? z : z.reverse();
          const end = Math.min(list.length - 1, stop);
          return list.slice(start, end + 1).map((x) => x.value);
        }
      };
    }
    available = true;
    return client;
  }
  if (client) return client;
  if (connecting) return connecting;

  const url = process.env.REDIS_URL || process.env.REDIS_URI || 'redis://localhost:6379';
  client = createClient({ url });

  connecting = client
    .connect()
    .then(() => {
      available = true;
      client.on('error', () => {
        available = false;
      });
      return client;
    })
    .catch(() => {
      available = false;
      try {
        client = null;
      } catch {}
      return null;
    })
    .finally(() => {
      connecting = null;
    });

  return connecting;
}

function isRedisAvailable() {
  return available;
}

module.exports = {
  getRedisClient,
  isRedisAvailable
};
