'use strict';
/**
 * AFTERHOURS 3D club — presence relay.
 * Keeps a single shared room: who is online, where they stand, whether they dance.
 * The client stays playable on its own; this server only shares presence.
 */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const COLORS = 10;            /* must match NET_COLORS length in the client */
const MAX_CLIENTS = 80;
const HI_TIMEOUT = 8000;

const ADJ = ['네온', '미드나잇', '시티', '딥', '펑크', '골드', '블루', '레드', '스모크',
  '빈티지', '일렉', '재즈', '루나', '바이닐', '디스코', '글로우', '스파클', '언더',
  '슬로우', '네이비', '긴 밤의', '새벽'];
const NOUN = ['고양이', '여우', '토끼', '판다', '늑대', '드리머', '나이트', '댄서',
  '펭귄', '박쥐', '올빼미', '해파리', '호랑이', '비버', '스타', '루퍼', '고래', '라쿤'];

const clients = new Map();      /* id -> client */
const usedNames = new Set();
let seq = 0;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeName() {
  for (let i = 0; i < 200; i++) {
    const base = pick(ADJ) + ' ' + pick(NOUN);
    if (!usedNames.has(base)) { usedNames.add(base); return base; }
    const alt = base + ' ' + (2 + Math.floor(Math.random() * 97));
    if (!usedNames.has(alt)) { usedNames.add(alt); return alt; }
  }
  const fallback = '게스트 ' + (++seq);
  usedNames.add(fallback);
  return fallback;
}

function freeColor() {
  const used = new Set([...clients.values()].map(c => c.color));
  for (let i = 0; i < COLORS; i++) if (!used.has(i)) return i;
  return clients.size % COLORS;
}

function stateOf(c) {
  return {
    id: c.id, name: c.name, color: c.color,
    x: c.x, z: c.z, yaw: c.yaw, on: c.on ? 1 : 0, dance: c.dance ? 1 : 0
  };
}

function roster() {
  return [...clients.values()].filter(c => c.joined).map(stateOf);
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

function broadcast(obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const c of clients.values()) {
    if (c.id === exceptId || !c.joined) continue;
    if (c.ws.readyState === 1) { try { c.ws.send(msg); } catch (e) { /* ignore */ } }
  }
}

function broadcastCount() {
  const n = roster().length;
  broadcast({ t: 'count', n });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  });
  res.end('afterhours-lobby ok · ' + roster().length + ' online');
});

const wss = new WebSocketServer({ server, maxPayload: 2048, path: '/' });

wss.on('connection', (ws, req) => {
  if (clients.size >= MAX_CLIENTS) { try { ws.close(1013, 'full'); } catch (e) {} return; }

  const id = Math.random().toString(36).slice(2, 10);
  const client = {
    id, ws,
    name: makeName(),
    color: freeColor(),
    x: 0, z: 5.2, yaw: Math.PI,
    on: 0, dance: 0,
    joined: false,
    alive: true,
    hiTimer: null,
    stamps: []
  };
  clients.set(id, client);

  client.hiTimer = setTimeout(() => {
    if (!client.joined) drop(client, 'no-hello');
  }, HI_TIMEOUT);
  client.hiTimer.unref && client.hiTimer.unref();

  send(ws, { t: 'welcome', id, name: client.name, color: client.color, peers: roster(), n: roster().length });

  ws.on('pong', () => { client.alive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    /* light rate limit: 60 messages per second per socket */
    const now = Date.now();
    client.stamps.push(now);
    while (client.stamps.length && now - client.stamps[0] > 1000) client.stamps.shift();
    if (client.stamps.length > 60) return;

    if (m.t === 'hi') {
      if (client.joined) return;
      if (typeof m.name === 'string' && m.name.trim()) {
        const want = m.name.trim().slice(0, 20);
        if (!usedNames.has(want) || want === client.name) {
          if (!usedNames.has(want)) { usedNames.add(want); }
          usedNames.delete(client.name);
          client.name = want;
        }
      }
      client.joined = true;
      clearTimeout(client.hiTimer);
      applyMove(client, m);
      broadcast({ t: 'join', ...stateOf(client) }, client.id);
      send(ws, { t: 'you', id: client.id, name: client.name, color: client.color });
      broadcastCount();
      return;
    }

    if (!client.joined) return;

    if (m.t === 'm') {
      applyMove(client, m);
      broadcast({ t: 'm', id: client.id, x: client.x, z: client.z, yaw: client.yaw, on: client.on, dance: client.dance }, client.id);
      return;
    }

    if (m.t === 'set') { applyProfile(client, m); return; }

    if (m.t === 'bye') { drop(client, 'bye'); }
  });

  ws.on('close', () => drop(client, 'close'));
  ws.on('error', () => drop(client, 'error'));
});

/* nickname / outfit change; broadcast so every screen updates at once */
function applyProfile(c, m) {
  let changed = false;

  if (typeof m.name === 'string') {
    const want = m.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
    if (want && want !== c.name && (!usedNames.has(want) || want === c.name)) {
      usedNames.delete(c.name);
      usedNames.add(want);
      c.name = want;
      changed = true;
    }
  }

  if (Number.isInteger(m.color) && m.color >= 0 && m.color < COLORS && m.color !== c.color) {
    c.color = m.color;
    changed = true;
  }

  if (!changed) { send(c.ws, { t: 'you', id: c.id, name: c.name, color: c.color }); return; }
  broadcast({ t: 'set', id: c.id, name: c.name, color: c.color }, c.id);
  send(c.ws, { t: 'you', id: c.id, name: c.name, color: c.color });
}

function applyMove(c, m) {
  const nx = Number(m.x), nz = Number(m.z), ny = Number(m.yaw);
  if (Number.isFinite(nx)) c.x = Math.max(-30, Math.min(30, nx));
  if (Number.isFinite(nz)) c.z = Math.max(-30, Math.min(30, nz));
  if (Number.isFinite(ny)) c.yaw = ny;
  c.on = m.on ? 1 : 0;
  c.dance = m.dance ? 1 : 0;
}

function drop(client, why) {
  if (!clients.has(client.id)) return;
  clients.delete(client.id);
  usedNames.delete(client.name);
  clearTimeout(client.hiTimer);
  try { client.ws.close(); } catch (e) {}
  if (client.joined) {
    broadcast({ t: 'left', id: client.id });
    broadcastCount();
  }
}

const heartbeat = setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { drop(c, 'dead'); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch (e) {}
  }
}, 25000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log('afterhours-lobby listening on ' + PORT);
});

process.on('uncaughtException', err => { console.error('uncaught', err); });
process.on('unhandledRejection', err => { console.error('unhandled', err); });
