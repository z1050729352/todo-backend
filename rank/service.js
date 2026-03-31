const { getRankModel } = require('./model');
const { getRedisClient, isRedisAvailable } = require('./redis');
const { normalizeGame, normalizeMode } = require('./config');

const TTL_SECONDS = 300;

let deps = { getRankModel, getRedisClient, isRedisAvailable, normalizeGame, normalizeMode };

function setRankServiceDeps(next) {
  deps = { ...deps, ...(next || {}) };
}

function zsetKey(game, mode) {
  return `rank:z:${game}:${mode}`;
}

function hashKey(game, mode) {
  return `rank:h:${game}:${mode}`;
}

function encodeMember(tsMs, id) {
  const ts = String(Math.max(0, Number(tsMs) || 0)).padStart(13, '0');
  return `${ts}|${id}`;
}

function decodeMember(member) {
  const s = String(member || '');
  const idx = s.indexOf('|');
  if (idx < 0) return { id: s, ts: 0 };
  const ts = Number(s.slice(0, idx));
  const id = s.slice(idx + 1);
  return { id, ts: Number.isFinite(ts) ? ts : 0 };
}

function sortEntries(entries) {
  entries.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    const bt = new Date(b.timestamp).getTime();
    const at = new Date(a.timestamp).getTime();
    if (bt !== at) return bt - at;
    return String(b.id).localeCompare(String(a.id));
  });
  return entries;
}

function toLeanEntry(doc) {
  return {
    id: String(doc._id),
    game: doc.game,
    mode: doc.mode,
    playerId: doc.playerId,
    partnerId: doc.partnerId || null,
    score: doc.score,
    partnerScore: doc.partnerScore ?? null,
    rankScore: doc.rankScore,
    duration: doc.duration || 0,
    timestamp: doc.timestamp,
    roomId: doc.roomId || null
  };
}

function computeRankScore(mode, score, partnerScore) {
  if (mode === 'coop') return Number(score) + (Number.isFinite(Number(partnerScore)) ? Number(partnerScore) : 0);
  if (mode === 'pvp') return Math.max(Number(score), Number.isFinite(Number(partnerScore)) ? Number(partnerScore) : 0);
  return Number(score);
}

async function submitRank({ game, mode, playerId, partnerId, score, partnerScore, duration, roomId, timestamp }) {
  const g = deps.normalizeGame(game);
  const m = deps.normalizeMode(mode);
  const Rank = deps.getRankModel(g);
  const rs = computeRankScore(m, score, partnerScore);

  const doc = await Rank.create({
    game: g,
    mode: m,
    playerId: String(playerId),
    partnerId: partnerId ? String(partnerId) : undefined,
    score: Number(score),
    partnerScore: Number.isFinite(Number(partnerScore)) ? Number(partnerScore) : undefined,
    rankScore: rs,
    duration: Number.isFinite(duration) ? Number(duration) : 0,
    roomId: roomId ? String(roomId) : undefined,
    timestamp: timestamp ? new Date(timestamp) : new Date()
  });

  const entry = toLeanEntry(doc);

  const r = await deps.getRedisClient();
  if (r && deps.isRedisAvailable()) {
    const zk = zsetKey(g, m);
    const hk = hashKey(g, m);
    const tsMs = new Date(entry.timestamp).getTime();
    const member = encodeMember(tsMs, entry.id);
    await r.hSet(hk, entry.id, JSON.stringify(entry));
    await r.zAdd(zk, [{ score: entry.rankScore, value: member }]);
    await r.expire(zk, TTL_SECONDS);
    await r.expire(hk, TTL_SECONDS);
    await r.zRemRangeByRank(zk, 0, -201);
  }

  return entry;
}

async function getTopRanks({ game, mode, limit = 100 }) {
  const g = deps.normalizeGame(game);
  const m = deps.normalizeMode(mode);
  const lim = Math.max(1, Math.min(100, Number(limit) || 100));

  const r = await deps.getRedisClient();
  if (r && deps.isRedisAvailable()) {
    const zk = zsetKey(g, m);
    const hk = hashKey(g, m);
    const members = await r.zRange(zk, 0, lim - 1, { REV: true });
    if (members && members.length > 0) {
      const ids = members.map((x) => decodeMember(x).id);
      const raw = await r.hmGet(hk, ids);
      const parsed = raw
        .map((v) => {
          if (!v) return null;
          try {
            return JSON.parse(v);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (parsed.length >= Math.min(5, lim)) {
        sortEntries(parsed);
        return parsed.slice(0, lim);
      }
    }
  }

  const Rank = deps.getRankModel(g);
  const docs = await Rank.find({ game: g, mode: m })
    .sort({ rankScore: -1, timestamp: -1, _id: -1 })
    .limit(lim)
    .lean();
  const entries = docs.map((d) => ({
    id: String(d._id),
    game: d.game,
    mode: d.mode,
    playerId: d.playerId,
    partnerId: d.partnerId || null,
    score: d.score,
    partnerScore: d.partnerScore ?? null,
    rankScore: d.rankScore,
    duration: d.duration || 0,
    timestamp: d.timestamp,
    roomId: d.roomId || null
  }));

  if (r && deps.isRedisAvailable()) {
    const zk = zsetKey(g, m);
    const hk = hashKey(g, m);
    await r.del(zk);
    await r.del(hk);
    if (entries.length > 0) {
      await r.hSet(hk, Object.fromEntries(entries.map((e) => [e.id, JSON.stringify(e)])));
      await r.zAdd(
        zk,
        entries.map((e) => ({
          score: e.rankScore,
          value: encodeMember(new Date(e.timestamp).getTime(), e.id)
        }))
      );
    }
    await r.expire(zk, TTL_SECONDS);
    await r.expire(hk, TTL_SECONDS);
  }

  return entries;
}

module.exports = {
  submitRank,
  getTopRanks,
  computeRankScore,
  encodeMember,
  decodeMember,
  sortEntries,
  setRankServiceDeps
};
