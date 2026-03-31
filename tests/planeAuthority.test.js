const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPlaneRoomState,
  ensurePlanePlayers,
  applyHostWorldPatch,
  applyPlaneDamage,
  applyPlayerSnapshot,
  handleEnemyKilled,
  removeEnemy,
  buildBroadcastPayload
} = require('../planeAuthority');

test('planeAuthority keeps enemy and boss hp consistent across broadcasts', () => {
  const room = createPlaneRoomState({
    roomId: 'r1',
    roomSeed: 123,
    hostId: 'u1',
    players: ['u1', 'u2']
  });

  ensurePlanePlayers(room, ['u1', 'u2']);

  applyHostWorldPatch(room, 'u1', {
    tick: 1,
    enemies: [
      { id: 'e1', x: 10, y: 10, vx: 0, vy: 1, angle: 0, level: 2, type: 'normal', state: 'alive', maxHealth: 50, health: 50, color: '#fff' }
    ],
    boss: { id: 'boss', x: 100, y: 80, vx: 0, vy: 0, angle: 0, phase: 3, attackType: 'rain', width: 80, height: 80, color: '#f00', state: 'alive', maxHealth: 500, health: 500 }
  });

  const before = buildBroadcastPayload(room).snapshot;
  assert.equal(before.enemies[0].health, 50);
  assert.equal(before.boss.health, 500);

  applyPlaneDamage(room, { targetType: 'enemy', targetId: 'e1', amount: 12 });
  applyPlaneDamage(room, { targetType: 'boss', amount: 40 });

  const after = buildBroadcastPayload(room).snapshot;
  assert.equal(after.enemies[0].health, 38);
  assert.equal(after.boss.health, 460);

  applyPlaneDamage(room, { targetType: 'enemy', targetId: 'e1', amount: 1000 });
  const dead = buildBroadcastPayload(room).snapshot;
  assert.equal(dead.enemies.length, 0);
});

test('planeAuthority stores per-player wallCount in snapshot', () => {
  const room = createPlaneRoomState({
    roomId: 'r2',
    roomSeed: 456,
    hostId: 'u1',
    players: ['u1', 'u2']
  });

  applyPlayerSnapshot(room, 'u1', { wallCount: 4 });
  applyPlayerSnapshot(room, 'u2', { wallCount: 1 });

  const snap = buildBroadcastPayload(room).snapshot;
  const p1 = snap.players.find((p) => p.playerId === 'u1');
  const p2 = snap.players.find((p) => p.playerId === 'u2');
  assert.equal(p1.wallCount, 4);
  assert.equal(p2.wallCount, 1);
});

test('planeAuthority generates independent and reproducible drops per player', () => {
  const roomA = createPlaneRoomState({
    roomId: 'r3',
    roomSeed: 999,
    hostId: 'u1',
    players: ['u1', 'u2']
  });

  const roomB = createPlaneRoomState({
    roomId: 'r3',
    roomSeed: 999,
    hostId: 'u1',
    players: ['u1', 'u2']
  });

  applyHostWorldPatch(roomA, 'u1', {
    tick: 1,
    enemies: [{ id: 'e9', x: 10, y: 10, vx: 0, vy: 1, angle: 0, level: 1, type: 'normal', state: 'alive', maxHealth: 10, health: 0, color: '#fff' }]
  });

  applyHostWorldPatch(roomB, 'u1', {
    tick: 1,
    enemies: [{ id: 'e9', x: 10, y: 10, vx: 0, vy: 1, angle: 0, level: 1, type: 'normal', state: 'alive', maxHealth: 10, health: 0, color: '#fff' }]
  });

  const a = handleEnemyKilled(roomA, { enemyId: 'e9', x: 10, y: 10 });
  const b = handleEnemyKilled(roomB, { enemyId: 'e9', x: 10, y: 10 });

  assert.deepEqual(a, b);
  assert.ok(a.every((d) => d.toUserId === 'u1' || d.toUserId === 'u2'));
});

test('planeAuthority supports enemy removal', () => {
  const room = createPlaneRoomState({
    roomId: 'r4',
    roomSeed: 1,
    hostId: 'u1',
    players: ['u1', 'u2']
  });

  applyHostWorldPatch(room, 'u1', {
    tick: 1,
    enemies: [{ id: 'e1', x: 10, y: 10, vx: 0, vy: 1, angle: 0, level: 1, type: 'normal', state: 'alive', maxHealth: 10, health: 10, color: '#fff' }]
  });

  assert.equal(buildBroadcastPayload(room).snapshot.enemies.length, 1);
  removeEnemy(room, 'e1');
  assert.equal(buildBroadcastPayload(room).snapshot.enemies.length, 0);
});
