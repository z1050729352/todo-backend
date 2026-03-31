const test = require('node:test');
const assert = require('node:assert/strict');
const { createInviteRegistry } = require('../realtime/inviteRegistry');

test('inviteRegistry dedupes pending invites within window', () => {
  const reg = createInviteRegistry({ dedupeWindowMs: 1000, ttlMs: 5000 });
  const a = reg.createInvite({ fromUserId: 'u1', toUserId: 'u2', gameType: 'plane-war', nowMs: 1000 });
  const b = reg.createInvite({ fromUserId: 'u1', toUserId: 'u2', gameType: 'plane-war', nowMs: 1500 });
  assert.equal(a.inviteId, b.inviteId);
  assert.equal(b.existing, true);
});

test('inviteRegistry allows new invite after window', () => {
  const reg = createInviteRegistry({ dedupeWindowMs: 1000, ttlMs: 5000 });
  const a = reg.createInvite({ fromUserId: 'u1', toUserId: 'u2', gameType: 'tetris', nowMs: 1000 });
  const b = reg.createInvite({ fromUserId: 'u1', toUserId: 'u2', gameType: 'tetris', nowMs: 2501 });
  assert.notEqual(a.inviteId, b.inviteId);
  assert.equal(b.existing, false);
});

test('inviteRegistry accept is idempotent and recipient-bound', () => {
  const reg = createInviteRegistry({ dedupeWindowMs: 1000, ttlMs: 5000 });
  const { inviteId } = reg.createInvite({ fromUserId: 'u1', toUserId: 'u2', gameType: 'plane-war', nowMs: 1000 });
  assert.equal(reg.acceptInvite({ inviteId, toUserId: 'u3', nowMs: 1100 }).ok, false);
  const r1 = reg.acceptInvite({ inviteId, toUserId: 'u2', nowMs: 1100 });
  assert.equal(r1.ok, true);
  assert.equal(r1.status, 'accepted');
  reg.setInviteRoom({ inviteId, roomId: 'room_1', nowMs: 1200 });
  const r2 = reg.acceptInvite({ inviteId, toUserId: 'u2', nowMs: 1300 });
  assert.equal(r2.ok, true);
  assert.equal(r2.roomId, 'room_1');
});
