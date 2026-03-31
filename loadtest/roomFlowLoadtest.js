const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:12580';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const LOOPS = Number(process.env.LOOPS || 10);

function tokenFor(id, username) {
  return jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '1h' });
}

function connectClient(token) {
  return io(SERVER_URL, {
    auth: { token },
    reconnection: false,
    transports: ['websocket']
  });
}

async function waitFor(socket, event, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (predicate && !predicate(payload)) return;
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

async function apiPost(path, token, body) {
  const res = await fetch(`${SERVER_URL}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body || {})
  });
  const txt = await res.text();
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
  return data;
}

async function runOnce(i) {
  const hostId = `h${i}`;
  const guestId = `g${i}`;
  const hostToken = tokenFor(hostId, `host${i}`);
  const guestToken = tokenFor(guestId, `guest${i}`);

  const host = connectClient(hostToken);
  const guest = connectClient(guestToken);

  await waitFor(host, 'connect', () => true);
  await waitFor(guest, 'connect', () => true);

  host.emit('invite_friend', { friendId: guestId, gameType: 'plane-war' });

  const invite = await waitFor(guest, 'game_invite', (p) => String(p?.fromUserId) === hostId);
  const waitHostJoined = waitFor(host, 'room_joined', () => true);
  const waitGuestJoined = waitFor(guest, 'room_joined', () => true);
  guest.emit('accept_invite', { inviteId: invite.inviteId, fromUserId: hostId, gameType: 'plane-war' });

  const hostJoined = await waitHostJoined;
  const guestJoined = await waitGuestJoined;
  const roomId = hostJoined.roomId || guestJoined.roomId;

  const t0 = Date.now();
  const waitGameChanged = waitFor(guest, 'room_game_changed', (p) => String(p?.roomId) === String(roomId));
  await apiPost('/room/setGame', hostToken, { roomId, gameType: 'plane-war', settings: { gameType: 'plane-war', difficulty: 'medium' } });
  await waitGameChanged;

  const waitReady = waitFor(host, 'room_player_ready', (p) => String(p?.roomId) === String(roomId) && String(p?.userId) === guestId && p?.ready === true);
  await apiPost('/room/ready', guestToken, { roomId, ready: true });
  await waitReady;

  const waitStartHost = waitFor(host, 'room_game_start', (p) => String(p?.roomId) === String(roomId));
  const waitStartGuest = waitFor(guest, 'room_game_start', (p) => String(p?.roomId) === String(roomId));
  await apiPost('/room/start', hostToken, { roomId });
  await waitStartHost;
  await waitStartGuest;

  const latencyMs = Date.now() - t0;
  host.disconnect();
  guest.disconnect();
  return latencyMs;
}

async function main() {
  const latencies = [];
  for (let i = 1; i <= LOOPS; i += 1) {
    const ms = await runOnce(i);
    latencies.push(ms);
  }
  const max = latencies.reduce((a, b) => Math.max(a, b), 0);
  const avg = latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length);
  console.log(JSON.stringify({ loops: LOOPS, maxMs: max, avgMs: Math.round(avg), latencies }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
