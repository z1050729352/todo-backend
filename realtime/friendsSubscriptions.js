function createFriendsSubscriptions() {
  const watchIndex = new Map();
  const socketIndex = new Map();

  function normalizeIds(ids) {
    if (!Array.isArray(ids)) return [];
    const out = [];
    for (const id of ids) {
      const s = String(id || '');
      if (s) out.push(s);
    }
    return Array.from(new Set(out));
  }

  function unsubscribeSocket(socketId) {
    const prev = socketIndex.get(socketId);
    if (!prev) return;
    for (const friendId of prev) {
      const watchers = watchIndex.get(friendId);
      if (!watchers) continue;
      watchers.delete(socketId);
      if (watchers.size === 0) watchIndex.delete(friendId);
    }
    socketIndex.delete(socketId);
  }

  function replaceSubscription(socketId, friendIds) {
    unsubscribeSocket(socketId);
    const next = new Set(normalizeIds(friendIds));
    if (next.size === 0) return;
    socketIndex.set(socketId, next);
    for (const friendId of next) {
      const watchers = watchIndex.get(friendId) || new Set();
      watchers.add(socketId);
      watchIndex.set(friendId, watchers);
    }
  }

  function getWatchers(friendId) {
    const id = String(friendId || '');
    return watchIndex.get(id) || new Set();
  }

  function getSocketSubscriptions(socketId) {
    return socketIndex.get(socketId) || new Set();
  }

  return {
    replaceSubscription,
    unsubscribeSocket,
    getWatchers,
    getSocketSubscriptions
  };
}

module.exports = { createFriendsSubscriptions };
