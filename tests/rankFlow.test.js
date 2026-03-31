const test = require('node:test');
const assert = require('node:assert/strict');

const { setRankServiceDeps, submitRank, getTopRanks } = require('../rank/service');
const { isSupportedGameMode, normalizeGame, normalizeMode, getRankConfig } = require('../rank/config');
const { getRedisClient, isRedisAvailable } = require('../rank/redis');

function createFakeRedis() {
  const zsets = new Map();
  const hashes = new Map();

  function getZ(key) {
    if (!zsets.has(key)) zsets.set(key, []);
    return zsets.get(key);
  }

  function getH(key) {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  }

  return {
    async connect() {},
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
      const out = list.slice(start, end + 1).map((x) => x.value);
      return out;
    }
  };
}

function createFakeRankModel() {
  let seq = 0;
  const store = [];

  function find(query) {
    const results = store.filter((d) => d.game === query.game && d.mode === query.mode);
    return {
      sort() {
        results.sort((a, b) => {
          if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
          const bt = new Date(b.timestamp).getTime();
          const at = new Date(a.timestamp).getTime();
          if (bt !== at) return bt - at;
          return String(b._id).localeCompare(String(a._id));
        });
        return this;
      },
      limit(n) {
        this._limit = n;
        return this;
      },
      async lean() {
        return results.slice(0, this._limit || results.length);
      }
    };
  }

  async function create(doc) {
    const d = { ...doc, _id: String(++seq) };
    store.push(d);
    return d;
  }

  return { create, find, _store: store };
}

test('rank config validates game/mode', () => {
  const cfg = getRankConfig();
  assert.ok(Array.isArray(cfg) && cfg.length >= 2);
  assert.equal(isSupportedGameMode('tetris', 'easy'), true);
  assert.equal(isSupportedGameMode('tetris', 'unknown'), false);
  assert.equal(normalizeGame('  TETRIS '), 'tetris');
  assert.equal(normalizeGame(null), '');
  assert.equal(normalizeMode('  Coop '), 'coop');
  assert.equal(normalizeMode(undefined), '');
});

test('rank service works with in-memory DB and redis cache', async () => {
  const fakeRedis = createFakeRedis();
  const fakeModel = createFakeRankModel();

  setRankServiceDeps({
    getRankModel: () => fakeModel,
    getRedisClient: async () => fakeRedis,
    isRedisAvailable: () => true,
    normalizeGame,
    normalizeMode
  });

  const a = await submitRank({ game: 'tetris', mode: 'easy', playerId: 'p1', score: 10, duration: 1 });
  const b = await submitRank({ game: 'tetris', mode: 'easy', playerId: 'p2', score: 20, duration: 1 });
  const c = await submitRank({ game: 'tetris', mode: 'easy', playerId: 'p3', score: 20, duration: 1, timestamp: Date.now() - 1000 });

  assert.ok(a.id && b.id && c.id);

  const top = await getTopRanks({ game: 'tetris', mode: 'easy', limit: 100 });
  assert.equal(top.length, 3);
  assert.equal(top[0].playerId, 'p2');
  assert.equal(top[1].playerId, 'p3');
  assert.equal(top[2].playerId, 'p1');
});

test('rank service falls back to DB when redis payload is incomplete', async () => {
  const fakeRedis = createFakeRedis();
  const fakeModel = createFakeRankModel();

  setRankServiceDeps({
    getRankModel: () => fakeModel,
    getRedisClient: async () => fakeRedis,
    isRedisAvailable: () => true,
    normalizeGame,
    normalizeMode
  });

  await submitRank({ game: 'aircraft', mode: 'easy', playerId: 'p1', score: 10, duration: 1 });
  await submitRank({ game: 'aircraft', mode: 'easy', playerId: 'p2', score: 9, duration: 1 });
  await submitRank({ game: 'aircraft', mode: 'easy', playerId: 'p3', score: 8, duration: 1 });
  await submitRank({ game: 'aircraft', mode: 'easy', playerId: 'p4', score: 7, duration: 1 });
  await submitRank({ game: 'aircraft', mode: 'easy', playerId: 'p5', score: 6, duration: 1 });

  await fakeRedis.hSet('rank:h:aircraft:easy', '3', '{bad-json');
  const top = await getTopRanks({ game: 'aircraft', mode: 'easy', limit: 5 });
  assert.equal(top.length, 5);
  assert.equal(top[0].playerId, 'p1');
});

test('rank service warms redis from DB when zset is empty', async () => {
  const fakeModel = createFakeRankModel();
  const fakeRedis = {
    async del() {},
    async expire() {},
    async hSet() {},
    async zAdd() {},
    async zRemRangeByRank() {},
    async zRange() {
      return [];
    },
    async hmGet() {
      return [];
    }
  };

  setRankServiceDeps({
    getRankModel: () => fakeModel,
    getRedisClient: async () => fakeRedis,
    isRedisAvailable: () => true,
    normalizeGame,
    normalizeMode
  });

  await submitRank({ game: 'tetris', mode: 'coop', playerId: 'p1', partnerId: 'p2', score: 10, partnerScore: 2, duration: 1 });
  const top = await getTopRanks({ game: 'tetris', mode: 'coop', limit: 3 });
  assert.equal(top.length, 1);
  assert.equal(top[0].rankScore, 12);
});

test('rank service returns empty list when no records', async () => {
  const fakeModel = createFakeRankModel();
  const fakeRedis = {
    async del() {},
    async expire() {},
    async hSet() {},
    async zAdd() {},
    async zRemRangeByRank() {},
    async zRange() {
      return [];
    },
    async hmGet() {
      return [];
    }
  };

  setRankServiceDeps({
    getRankModel: () => fakeModel,
    getRedisClient: async () => fakeRedis,
    isRedisAvailable: () => true,
    normalizeGame,
    normalizeMode
  });

  const top = await getTopRanks({ game: 'tetris', mode: 'hard', limit: 100 });
  assert.deepEqual(top, []);
});

test('rank redis module returns null when disabled', async () => {
  const prev = process.env.REDIS_DISABLED;
  process.env.REDIS_DISABLED = '1';
  const c = await getRedisClient();
  assert.equal(c, null);
  assert.equal(isRedisAvailable(), false);
  process.env.REDIS_DISABLED = prev;
});

test('rank redis module supports in-memory mode', async () => {
  const prev = process.env.REDIS_INMEMORY;
  process.env.REDIS_INMEMORY = '1';
  const c = await getRedisClient();
  assert.ok(c);
  const c2 = await getRedisClient();
  assert.equal(c, c2);
  await c.hSet('h', 'k', 'v');
  await c.hSet('h2', { a: '1', b: '2' });
  const out = await c.hmGet('h', ['k', 'missing']);
  assert.deepEqual(out, ['v', null]);
  await c.zAdd('z', [{ score: 2, value: '2|b' }, { score: 1, value: '1|a' }]);
  const zr = await c.zRange('z', 0, 9, { REV: true });
  assert.deepEqual(zr, ['2|b', '1|a']);
  process.env.REDIS_INMEMORY = prev;
});

test('rank redis module handles connection failure', async () => {
  const prevUrl = process.env.REDIS_URL;
  const prevDisabled = process.env.REDIS_DISABLED;
  const prevInMemory = process.env.REDIS_INMEMORY;
  process.env.REDIS_DISABLED = '';
  process.env.REDIS_INMEMORY = '';
  process.env.REDIS_URL = 'redis://127.0.0.1:0';
  delete require.cache[require.resolve('../rank/redis')];
  const fresh = require('../rank/redis');
  const c = await fresh.getRedisClient();
  assert.equal(c, null);
  assert.equal(fresh.isRedisAvailable(), false);
  process.env.REDIS_URL = prevUrl;
  process.env.REDIS_DISABLED = prevDisabled;
  process.env.REDIS_INMEMORY = prevInMemory;
});
