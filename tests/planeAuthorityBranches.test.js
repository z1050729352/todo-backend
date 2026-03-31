const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPlaneRoomState,
  applyHostWorldPatch,
  applyPlaneDamage,
  applyPlayerSnapshot,
  shouldBroadcast,
  removeEnemy,
  buildBroadcastPayload
} = require('../planeAuthority');

test('applyHostWorldPatch rejects non-host and invalid patch', () => {
  const s = createPlaneRoomState({ roomId: 'rb1', roomSeed: 1, hostId: 'h', players: ['h', 'g'] });
  assert.equal(applyHostWorldPatch(s, 'g', null), false);
  assert.equal(applyHostWorldPatch(s, 'g', { tick: 1 }), false);
  assert.equal(applyHostWorldPatch(s, 'h', null), false);
});

test('applyHostWorldPatch applies removedEnemyIds and boss healthBars', () => {
  const s = createPlaneRoomState({ roomId: 'rb2', roomSeed: 1, hostId: 'h', players: ['h', 'g'] });
  applyHostWorldPatch(s, 'h', {
    tick: 1,
    enemies: [
      { id: 'e1', x: 0, y: 0, vx: 0, vy: 0, angle: 0, level: 1, type: 'normal', state: 'alive', maxHealth: 10, health: 10, color: '#fff' },
      { id: 'e2', x: 0, y: 0, vx: 0, vy: 0, angle: 0, level: 1, type: 'normal', state: 'alive', maxHealth: 10, health: 10, color: '#fff' }
    ],
    boss: { id: 'boss', x: 0, y: 0, vx: 0, vy: 0, angle: 0, phase: 1, state: 'alive', maxHealth: 100, health: 100, healthBars: [50, 50] }
  });

  applyHostWorldPatch(s, 'h', { removedEnemyIds: ['e2'] });
  const snap = buildBroadcastPayload(s).snapshot;
  assert.equal(snap.enemies.length, 1);
  assert.equal(snap.enemies[0].id, 'e1');
  assert.deepEqual(snap.boss.healthBars, [50, 50]);

  applyPlaneDamage(s, { targetType: 'boss', amount: 5, barIndex: 0 });
  const snap2 = buildBroadcastPayload(s).snapshot;
  assert.equal(snap2.boss.health, 95);
  assert.equal(snap2.boss.healthBars[0], 45);
});

test('buildBroadcastPayload reports changed only when snapshot changes', () => {
  const s = createPlaneRoomState({ roomId: 'rb7', roomSeed: 1, hostId: 'h', players: ['h'] });
  applyHostWorldPatch(s, 'h', {
    enemies: [{ id: 'e1', x: 1, y: 2, vx: 0, vy: 0, angle: 0, level: 1, type: 'normal', state: 'alive', maxHealth: 1, health: 1 }]
  });
  const a = buildBroadcastPayload(s);
  const b = buildBroadcastPayload(s);
  assert.equal(a.changed, true);
  assert.equal(b.changed, false);
});

test('applyPlaneDamage rejects invalid inputs and missing targets', () => {
  const s = createPlaneRoomState({ roomId: 'rb3', roomSeed: 1, hostId: 'h', players: ['h', 'g'] });
  assert.equal(applyPlaneDamage(s, null), false);
  assert.equal(applyPlaneDamage(s, { targetType: 'enemy', targetId: 'missing', amount: 0 }), false);
  assert.equal(applyPlaneDamage(s, { targetType: 'enemy', targetId: 'missing', amount: 1 }), false);
  assert.equal(applyPlaneDamage(s, { targetType: 'boss', amount: 1 }), false);
  assert.equal(applyPlaneDamage(s, { targetType: 'noop', amount: 1 }), false);
});

test('applyPlayerSnapshot clamps wallCount and ignores unknown player', () => {
  const s = createPlaneRoomState({ roomId: 'rb4', roomSeed: 1, hostId: 'h', players: ['h', 'g'] });
  assert.equal(applyPlayerSnapshot(s, 'missing', { wallCount: 4 }), false);
  assert.equal(applyPlayerSnapshot(s, 'h', { wallCount: 999 }), true);
  const snap = buildBroadcastPayload(s).snapshot;
  const me = snap.players.find((p) => p.playerId === 'h');
  assert.equal(me.wallCount, 4);
});

test('shouldBroadcast respects tickMs and lastBroadcastAt', () => {
  const s = createPlaneRoomState({ roomId: 'rb5', roomSeed: 1, hostId: 'h', players: ['h'], tickMs: 80 });
  assert.equal(shouldBroadcast(s, 1000), true);
  s.lastBroadcastAt = 1000;
  assert.equal(shouldBroadcast(s, 1070), false);
  assert.equal(shouldBroadcast(s, 1080), true);
});

test('removeEnemy returns false for invalid ids', () => {
  const s = createPlaneRoomState({ roomId: 'rb6', roomSeed: 1, hostId: 'h', players: ['h'] });
  assert.equal(removeEnemy(s, null), false);
  assert.equal(removeEnemy(s, ''), false);
});

test('applyHostWorldPatch increments tick when missing and skips invalid enemies', () => {
  const s = createPlaneRoomState({ roomId: 'rb8', roomSeed: 1, hostId: 'h', players: ['h'] });
  assert.equal(s.tick, 0);
  applyHostWorldPatch(s, 'h', { enemies: [{ x: 1 }, { id: 'e1', x: 1, y: 1, maxHealth: 10, health: 10 }] });
  assert.ok(s.tick >= 1);
  const snap = buildBroadcastPayload(s).snapshot;
  assert.equal(snap.enemies.length, 1);
  assert.equal(snap.enemies[0].id, 'e1');
});
