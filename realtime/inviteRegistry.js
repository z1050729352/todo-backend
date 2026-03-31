function createInviteRegistry({ dedupeWindowMs = 15000, ttlMs = 10 * 60 * 1000 } = {}) {
  const invites = new Map();
  const pairIndex = new Map();

  function makePairKey({ fromUserId, toUserId, gameType }) {
    return `${fromUserId}|${toUserId}|${gameType}`;
  }

  function createInvite({ fromUserId, toUserId, gameType, nowMs = Date.now() }) {
    const pairKey = makePairKey({ fromUserId, toUserId, gameType });
    const existingId = pairIndex.get(pairKey);
    if (existingId) {
      const existing = invites.get(existingId);
      if (existing && existing.status === 'pending' && nowMs - existing.createdAt < dedupeWindowMs) {
        return { inviteId: existingId, existing: true };
      }
    }

    const inviteId = `inv_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
    invites.set(inviteId, {
      inviteId,
      fromUserId,
      toUserId,
      gameType,
      createdAt: nowMs,
      updatedAt: nowMs,
      status: 'pending',
      roomId: null
    });
    pairIndex.set(pairKey, inviteId);
    return { inviteId, existing: false };
  }

  function getInvite(inviteId) {
    return invites.get(inviteId) || null;
  }

  function acceptInvite({ inviteId, toUserId, nowMs = Date.now() }) {
    const inv = invites.get(inviteId);
    if (!inv) return { ok: false, reason: 'not_found' };
    if (String(inv.toUserId) !== String(toUserId)) return { ok: false, reason: 'not_recipient' };
    inv.updatedAt = nowMs;
    if (inv.status === 'accepted') return { ok: true, status: 'accepted', roomId: inv.roomId };
    if (inv.status === 'rejected') return { ok: false, reason: 'rejected' };
    inv.status = 'accepted';
    return { ok: true, status: 'accepted', roomId: inv.roomId };
  }

  function setInviteRoom({ inviteId, roomId, nowMs = Date.now() }) {
    const inv = invites.get(inviteId);
    if (!inv) return false;
    inv.roomId = roomId;
    inv.updatedAt = nowMs;
    return true;
  }

  function rejectInvite({ inviteId, toUserId, nowMs = Date.now() }) {
    const inv = invites.get(inviteId);
    if (!inv) return { ok: false, reason: 'not_found' };
    if (String(inv.toUserId) !== String(toUserId)) return { ok: false, reason: 'not_recipient' };
    inv.updatedAt = nowMs;
    if (inv.status === 'accepted') return { ok: false, reason: 'already_accepted' };
    inv.status = 'rejected';
    return { ok: true, status: 'rejected' };
  }

  function cleanup({ nowMs = Date.now() } = {}) {
    for (const [id, inv] of invites.entries()) {
      if (nowMs - inv.updatedAt >= ttlMs) invites.delete(id);
    }
    for (const [pairKey, id] of pairIndex.entries()) {
      if (!invites.has(id)) pairIndex.delete(pairKey);
    }
  }

  return {
    createInvite,
    getInvite,
    acceptInvite,
    setInviteRoom,
    rejectInvite,
    cleanup
  };
}

module.exports = { createInviteRegistry };
