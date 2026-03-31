const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:12580';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const USERS = Number(process.env.USERS || 12);

function tokenFor(i) {
  const id = `u${i}`;
  const username = `user${i}`;
  return jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '1h' });
}

function connectClient(i) {
  const token = tokenFor(i);
  const socket = io(SERVER_URL, {
    auth: { token },
    reconnection: false,
    transports: ['websocket']
  });
  return socket;
}

async function waitFor(socket, event, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    }
    function cleanup() {
      clearTimeout(t);
      socket.off(event, handler);
    }
    socket.on(event, handler);
  });
}

async function main() {
  const sockets = [];

  const watcher = connectClient(0);
  sockets.push(watcher);
  await waitFor(watcher, 'connect', () => true, 5000);

  const friendIds = [];
  for (let i = 1; i < Math.min(USERS, 11); i += 1) friendIds.push(`u${i}`);
  watcher.emit('subscribe_friends_status', { friendIds });

  const results = [];
  for (let i = 1; i < friendIds.length + 1; i += 1) {
    const fid = `u${i}`;
    const start = Date.now();
    const s = connectClient(i);
    sockets.push(s);
    await waitFor(s, 'connect', () => true, 5000);
    await waitFor(
      watcher,
      'friend_status_update',
      (p) => String(p?.friendId) === fid && Boolean(p?.online) === true,
      5000
    );
    results.push({ fid, ms: Date.now() - start });
  }

  const max = results.reduce((a, b) => Math.max(a, b.ms), 0);
  const avg = results.reduce((a, b) => a + b.ms, 0) / Math.max(1, results.length);
  console.log(JSON.stringify({ users: friendIds.length + 1, maxMs: max, avgMs: Math.round(avg), results }, null, 2));

  for (const s of sockets) s.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
