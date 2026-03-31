const crypto = require('crypto');

const DEFAULT_TICK_MS = 80;

function clampNumber(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function hashToUnitFloat(input) {
  const h = crypto.createHash('sha256').update(String(input)).digest();
  const x = h.readUInt32BE(0);
  return x / 0xffffffff;
}

function computePlayerDrop({ roomSeed, playerId, enemyId, dropIndex }) {
  const r = hashToUnitFloat(`${roomSeed}|${playerId}|${enemyId}|${dropIndex}`);
  return r;
}

function createPlaneRoomState({ roomId, roomSeed, hostId, players, tickMs = DEFAULT_TICK_MS }) {
  return {
    roomId,
    roomSeed,
    hostId,
    tickMs,
    tick: 0,
    lastBroadcastAt: 0,
    enemies: new Map(),
    boss: null,
    players: new Map(players.map((p) => [p, { wallCount: 0, dropIndex: 0 }])),
    revision: 0,
    lastBroadcastRevision: -1,
    lastSnapshot: null
  };
}

function ensurePlanePlayers(state, players) {
  const next = new Set(players);
  for (const p of next) {
    if (!state.players.has(p)) state.players.set(p, { wallCount: 0, dropIndex: 0 });
  }
  for (const p of Array.from(state.players.keys())) {
    if (!next.has(p)) state.players.delete(p);
  }
}

function applyHostWorldPatch(state, fromUserId, patch) {
  if (!patch || fromUserId !== state.hostId) return false;

  const enemies = Array.isArray(patch.enemies) ? patch.enemies : null;
  const removedEnemyIds = Array.isArray(patch.removedEnemyIds) ? patch.removedEnemyIds : null;
  const boss = patch.boss && typeof patch.boss === 'object' ? patch.boss : null;
  const tick = Number.isFinite(patch.tick) ? patch.tick : null;

  if (removedEnemyIds) {
    for (const id of removedEnemyIds) {
      state.enemies.delete(String(id));
    }
  }

  if (enemies) {
    for (const e of enemies) {
      if (!e || typeof e !== 'object') continue;
      const id = String(e.id ?? '');
      if (!id) continue;
      if (typeof e.state === 'string' && e.state === 'dead') {
        state.enemies.delete(id);
        continue;
      }
      const prev = state.enemies.get(id) || {};
      const next = {
        id,
        x: clampNumber(e.x, -2000, 2000),
        y: clampNumber(e.y, -2000, 4000),
        vx: clampNumber(e.vx, -100, 100),
        vy: clampNumber(e.vy, -100, 200),
        angle: clampNumber(e.angle, -Math.PI * 4, Math.PI * 4),
        level: clampNumber(e.level, 1, 99),
        type: typeof e.type === 'string' ? e.type : (prev.type || 'normal'),
        state: typeof e.state === 'string' ? e.state : (prev.state || 'alive'),
        maxHealth: clampNumber(e.maxHealth, 0, 1e9),
        health: clampNumber(e.health, 0, 1e9),
        color: typeof e.color === 'string' ? e.color : prev.color
      };
      if (next.state === 'dead' || next.health <= 0) {
        state.enemies.delete(id);
        continue;
      }
      state.enemies.set(id, next);
    }
  }

  if (boss) {
    state.boss = {
      id: String(boss.id || 'boss'),
      x: clampNumber(boss.x, -2000, 2000),
      y: clampNumber(boss.y, -2000, 4000),
      vx: clampNumber(boss.vx, -100, 100),
      vy: clampNumber(boss.vy, -100, 200),
      angle: clampNumber(boss.angle, -Math.PI * 4, Math.PI * 4),
      phase: clampNumber(boss.phase, 1, 99),
      attackType: typeof boss.attackType === 'string' ? boss.attackType : undefined,
      width: clampNumber(boss.width, 0, 2000),
      height: clampNumber(boss.height, 0, 2000),
      color: typeof boss.color === 'string' ? boss.color : undefined,
      state: typeof boss.state === 'string' ? boss.state : 'alive',
      maxHealth: clampNumber(boss.maxHealth, 0, 1e9),
      health: clampNumber(boss.health, 0, 1e9),
      healthBars: Array.isArray(boss.healthBars) ? boss.healthBars.map((n) => clampNumber(n, 0, 1e9)) : undefined
    };
  }

  if (Array.isArray(patch.bossBullets)) {
    state.bossBullets = patch.bossBullets;
  } else if (patch.bossBullets === null) {
    state.bossBullets = [];
  }

  if (tick !== null) state.tick = tick;
  else state.tick += 1;
  state.revision += 1;

  return true;
}

function applyPlaneDamage(state, damage) {
  if (!damage || typeof damage !== 'object') return false;
  const targetType = damage.targetType;
  const amount = clampNumber(damage.amount, 0, 1e6);
  if (!amount) return false;

  if (targetType === 'enemy') {
    const id = String(damage.targetId ?? '');
    if (!id) return false;
    const e = state.enemies.get(id);
    if (!e) return false;
    e.health = clampNumber(e.health - amount, 0, e.maxHealth || 1e9);
    if (e.health <= 0) {
      e.state = 'dead';
      state.enemies.delete(id);
    }
    state.tick += 1;
    state.revision += 1;
    return true;
  }

  if (targetType === 'boss') {
    if (!state.boss) return false;
    state.boss.health = clampNumber(state.boss.health - amount, 0, state.boss.maxHealth || 1e9);
    if (state.boss.health <= 0) state.boss.state = 'dead';
    if (Array.isArray(state.boss.healthBars) && Number.isInteger(damage.barIndex)) {
      const idx = clampNumber(damage.barIndex, 0, state.boss.healthBars.length - 1);
      state.boss.healthBars[idx] = clampNumber(state.boss.healthBars[idx] - amount, 0, 1e9);
    }
    state.tick += 1;
    state.revision += 1;
    return true;
  }

  return false;
}

function applyPlayerSnapshot(state, userId, snapshot) {
  if (!userId || !snapshot || typeof snapshot !== 'object') return false;
  const p = state.players.get(userId);
  if (!p) return false;
  let changed = false;
  if (snapshot.wallCount !== undefined) {
    const next = clampNumber(snapshot.wallCount, 0, 4);
    if (p.wallCount !== next) {
      p.wallCount = next;
      changed = true;
    }
  }
  if (!changed) return false;
  state.tick += 1;
  state.revision += 1;
  return true;
}

function handleEnemyKilled(state, { enemyId, x, y, difficulty = 'medium' }) {
  const id = String(enemyId ?? '');
  if (!id) return [];

  // 根据难度调整整体掉落概率，目前减半处理 (简单0.22, 中等0.17, 困难0.12)
  const dropChance = difficulty === 'easy' ? 0.22 : (difficulty === 'hard' ? 0.12 : 0.17);

  const drops = [];
  for (const [playerId, playerState] of state.players.entries()) {
    const r = computePlayerDrop({ roomSeed: state.roomSeed, playerId, enemyId: id, dropIndex: playerState.dropIndex });
    playerState.dropIndex += 1;
    
    // 如果 r 大于掉落概率，则不掉落
    if (r > dropChance) continue;
    
    // 将 0~dropChance 映射到 0~1 的权重区间
    const weightR = r / dropChance;
    
    let dropType = null;
    // 属性类 > 子弹类 > 特别道具
    // 属性类 (约 45%)
    if (weightR < 0.15) dropType = 'RAPID';
    else if (weightR < 0.30) dropType = 'SPREAD';
    else if (weightR < 0.45) dropType = 'PIERCE';
    // 子弹类/特别道具 (约 30%)
    else if (weightR < 0.55) dropType = 'EXPLOSIVE';
    else if (weightR < 0.65) dropType = 'LASER';
    else if (weightR < 0.75) dropType = 'BURST';
    // 强化/恢复/防守类 (约 25%)
    else if (weightR < 0.85) dropType = 'BOOST';
    else if (weightR < 0.92) dropType = 'HEALTH';
    else if (weightR < 0.97) dropType = 'SHIELD';
    else dropType = 'BARRIER';

    if (dropType) {
      drops.push({
        toUserId: playerId,
        drop: { type: dropType, x: clampNumber(x, -2000, 2000), y: clampNumber(y, -2000, 4000), enemyId: id }
      });
    }
  }
  return drops;
}

function removeEnemy(state, enemyId) {
  const id = String(enemyId ?? '');
  if (!id) return false;
  const removed = state.enemies.delete(id);
  if (removed) {
    state.tick += 1;
    state.revision += 1;
  }
  return removed;
}

function getPlaneSnapshot(state) {
  return {
    roomId: state.roomId,
    roomSeed: state.roomSeed,
    tick: state.tick,
    enemies: Array.from(state.enemies.values()),
    boss: state.boss,
    bossBullets: state.bossBullets || [],
    players: Array.from(state.players.entries()).map(([playerId, s]) => ({ playerId, wallCount: s.wallCount }))
  };
}

function shouldBroadcast(state, nowMs) {
  if (!state.lastBroadcastAt) return true;
  return nowMs - state.lastBroadcastAt >= state.tickMs;
}

function buildBroadcastPayload(state) {
  const snapshot = getPlaneSnapshot(state);
  const changed = state.revision !== state.lastBroadcastRevision;
  state.lastBroadcastRevision = state.revision;
  state.lastSnapshot = snapshot;
  return { changed, snapshot };
}

module.exports = {
  DEFAULT_TICK_MS,
  createPlaneRoomState,
  ensurePlanePlayers,
  applyHostWorldPatch,
  applyPlaneDamage,
  applyPlayerSnapshot,
  handleEnemyKilled,
  removeEnemy,
  shouldBroadcast,
  buildBroadcastPayload,
  getPlaneSnapshot
};
