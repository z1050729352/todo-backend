const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function waitForHealth(baseUrl, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 800);
      const res = await fetch(`${baseUrl}/health`, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('server health check timeout');
}

function startServer({ port }) {
  const cwd = path.join(__dirname, '..');
  const child = spawn(process.execPath, ['index.js'], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return child;
}

test('friend request triggers realtime notification to recipient', async (t) => {
  const port = 18000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer({ port });

  t.after(() => {
    try {
      server.kill('SIGTERM');
    } catch {}
  });

  await waitForHealth(baseUrl);

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userA = `a_${stamp}`;
  const userB = `b_${stamp}`;
  const password = 'PasswordA1';

  await fetchJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userA, password })
  });
  await fetchJson(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userB, password })
  });

  const loginA = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userA, password })
  });
  const loginB = await fetchJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: userB, password })
  });

  const socketB = io(baseUrl, {
    transports: ['websocket'],
    auth: { token: loginB.token }
  });

  t.after(() => {
    try {
      socketB.disconnect();
    } catch {}
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 4000);
    socketB.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socketB.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const got = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did not receive friend_request_created')), 4000);
    socketB.once('friend_request_created', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  await fetchJson(`${baseUrl}/api/friends/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${loginA.token}`
    },
    body: JSON.stringify({ targetUserId: loginB.user.id })
  });

  const payload = await got;
  assert.equal(String(payload?.request?.requester?.username), userA);
  assert.equal(String(payload?.request?.status), 'pending');
});

