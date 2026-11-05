'use strict';
/**
 * AFTERHOURS / EMBERS presence relay.
 * Backward compatible: clients that omit `room` (or send room:'club') join the
 * single 'club' room — same welcome/join/m/set/left/count shapes as before.
 * Camp clients send room:'camp' and are assigned to fire sites (max 8 each).
 */
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const COLORS = 10;
const MAX_CLIENTS = 80;
const SITE_CAP = 8;
const HI_TIMEOUT = 8000;
/* 60 msgs/sec keeps club's ~12.5 Hz `m` stream (80 ms) well under the ceiling */
const RATE_PER_SEC = 60;
const POS_LIM = 30;

const ADJ = ['네온', '미드나잇', '시티', '딥', '펑크', '골드', '블루', '레드', '스모크',
  '빈티지', '일렉', '재즈', '루나', '바이닐', '디스코', '글로우', '스파클', '언더',
  '슬로우', '네이비', '긴 밤의', '새벽'];
const NOUN = ['고양이', '여우', '토끼', '판다', '늑대', '드리머', '나이트', '댄서',
  '펭귄', '박쥐', '올빼미', '해파리', '호랑이', '비버', '스타', '루퍼', '고래', '라쿤'];

const POSES = new Set(['idle', 'dance', 'sit', 'roast']);
const EMOTES = new Set(['wave', 'nod', 'cheers']);

const BAD = [
  '시발', '씨발', '병신', '좆', '개새끼', '니미', '느금', 'ㅅㅂ', 'ㅂㅅ', 'fuck', 'shit',
  'bitch', 'asshole', 'cunt', 'nigger', 'faggot'
];

const clients = new Map(); /* id -> client */
const usedNames = new Set();
let seq = 0;
let nextSiteId = 1;

/** roomKey -> Room */
const rooms = new Map();

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

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
}

function normalizePose(m) {
  if (m && typeof m.pose === 'string' && POSES.has(m.pose)) return m.pose;
  if (m && m.dance) return 'dance';
  return 'idle';
}

function containsBad(text) {
  const lower = String(text).toLowerCase().replace(/\s+/g, '');
  for (const w of BAD) {
    if (lower.includes(w.toLowerCase().replace(/\s+/g, ''))) return true;
  }
  return false;
}

function stateOf(c) {
  const pose = c.pose || (c.dance ? 'dance' : 'idle');
  return {
    id: c.id, name: c.name, color: c.color,
    x: c.x, z: c.z, yaw: c.yaw, on: c.on ? 1 : 0,
    dance: pose === 'dance' ? 1 : 0,
    pose,
    reason: c.reason || ''
  };
}

function getRoom(key) {
  let r = rooms.get(key);
  if (!r) {
    r = {
      key,
      clients: new Map(), /* id -> client */
      sites: new Map(),   /* siteId -> Site (camp only) */
    };
    rooms.set(key, r);
  }
  return r;
}

function siteRoster(site) {
  return [...site.clients.values()].filter(c => c.joined).map(stateOf);
}

function clubRoster(room) {
  return [...room.clients.values()].filter(c => c.joined).map(stateOf);
}

function freeColorIn(groupMap) {
  const used = new Set([...groupMap.values()].map(c => c.color));
  for (let i = 0; i < COLORS; i++) if (!used.has(i)) return i;
  return groupMap.size % COLORS;
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

function broadcastGroup(groupMap, obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const c of groupMap.values()) {
    if (c.id === exceptId || !c.joined) continue;
    if (c.ws.readyState === 1) { try { c.ws.send(msg); } catch (e) { /* ignore */ } }
  }
}

function groupOf(c) {
  if (!c.roomKey) return null;
  const room = rooms.get(c.roomKey);
  if (!room) return null;
  if (c.roomKey === 'camp' && c.siteId != null) {
    return room.sites.get(c.siteId) ? room.sites.get(c.siteId).clients : null;
  }
  return room.clients;
}

function broadcastTo(c, obj, exceptSelf) {
  const g = groupOf(c);
  if (!g) return;
  broadcastGroup(g, obj, exceptSelf ? c.id : undefined);
}

function countOf(c) {
  const g = groupOf(c);
  if (!g) return 0;
  let n = 0;
  for (const x of g.values()) if (x.joined) n++;
  return n;
}

function broadcastCountFor(c) {
  broadcastTo(c, { t: 'count', n: countOf(c) }, false);
}

function createSite(room) {
  const id = nextSiteId++;
  const site = {
    id,
    clients: new Map(),
    fireLevel: 0.55,
    lastLogAt: Date.now(),
  };
  room.sites.set(id, site);
  return site;
}

function pickSite(room, excludeId) {
  let best = null;
  for (const s of room.sites.values()) {
    if (excludeId != null && s.id === excludeId) continue;
    if (s.clients.size >= SITE_CAP) continue;
    if (!best || s.clients.size > best.clients.size) best = s;
  }
  if (best) return best;
  return createSite(room);
}

function decayFire(site) {
  const now = Date.now();
  const dt = Math.max(0, (now - (site.lastTick || now)) / 1000);
  site.lastTick = now;
  /* ~3 minutes from full to ember if nobody feeds */
  site.fireLevel = Math.max(0.05, site.fireLevel - dt * (0.95 / 180));
}

function sitePayload(site) {
  decayFire(site);
  let n = 0;
  for (const c of site.clients.values()) if (c.joined) n++;
  return { t: 'site', site: site.id, siteN: n, fireLevel: +site.fireLevel.toFixed(3) };
}

function broadcastSite(site) {
  broadcastGroup(site.clients, sitePayload(site));
}

function removeFromSite(c) {
  if (c.roomKey !== 'camp' || c.siteId == null) return;
  const room = rooms.get('camp');
  if (!room) return;
  const site = room.sites.get(c.siteId);
  if (!site) { c.siteId = null; return; }
  site.clients.delete(c.id);
  room.clients.delete(c.id);
  const sid = c.siteId;
  c.siteId = null;
  if (site.clients.size === 0) {
    room.sites.delete(sid);
  } else {
    broadcastSite(site);
    broadcastGroup(site.clients, { t: 'count', n: site.clients.size });
  }
}

function assignCampSite(c, excludeSiteId) {
  const room = getRoom('camp');
  room.clients.set(c.id, c);
  const site = pickSite(room, excludeSiteId);
  c.siteId = site.id;
  c.color = freeColorIn(site.clients);
  site.clients.set(c.id, c);
  decayFire(site);
  return site;
}

const server = http.createServer((req, res) => {
  let clubN = 0, campN = 0;
  const club = rooms.get('club');
  if (club) for (const c of club.clients.values()) if (c.joined) clubN++;
  const camp = rooms.get('camp');
  if (camp) for (const c of camp.clients.values()) if (c.joined) campN++;
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  });
  res.end('afterhours-lobby ok · club ' + clubN + ' · camp ' + campN + ' · total ' + clients.size);
});

const wss = new WebSocketServer({ server, maxPayload: 4096, path: '/' });

wss.on('connection', (ws) => {
  if (clients.size >= MAX_CLIENTS) {
    try {
      send(ws, { t: 'full', msg: '지금은 만석' });
      ws.close(1013, 'full');
    } catch (e) {}
    return;
  }

  const id = Math.random().toString(36).slice(2, 10);
  const client = {
    id, ws,
    name: makeName(),
    color: 0,
    x: 0, z: 5.2, yaw: Math.PI,
    on: 0, dance: 0, pose: 'idle',
    reason: '',
    joined: false,
    alive: true,
    hiTimer: null,
    stamps: [],
    roomKey: null,
    siteId: null,
    lastChatAt: 0,
    lastChatText: '',
    lastEmoteAt: 0,
    lastLogAt: 0,
    lastWishAt: 0,
    lastReportAt: 0
  };
  clients.set(id, client);

  client.hiTimer = setTimeout(() => {
    if (!client.joined) drop(client, 'no-hello');
  }, HI_TIMEOUT);
  client.hiTimer.unref && client.hiTimer.unref();

  /* welcome is sent after `hi` once the room is known (club clients send hi on open) */

  ws.on('pong', () => { client.alive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    const now = Date.now();
    client.stamps.push(now);
    while (client.stamps.length && now - client.stamps[0] > 1000) client.stamps.shift();
    if (client.stamps.length > RATE_PER_SEC) return;

    if (m.t === 'hi') {
      if (client.joined) return;
      const roomKey = (m.room === 'camp') ? 'camp' : 'club';
      client.roomKey = roomKey;

      const want = sanitizeName(m.name);
      if (want && (!usedNames.has(want) || want === client.name)) {
        if (!usedNames.has(want)) usedNames.add(want);
        usedNames.delete(client.name);
        client.name = want;
      }

      if (roomKey === 'camp') {
        const site = assignCampSite(client, null);
        applyMove(client, m);
        client.joined = true;
        clearTimeout(client.hiTimer);
        const peers = siteRoster(site).filter(p => p.id !== client.id);
        send(ws, {
          t: 'welcome', id: client.id, name: client.name, color: client.color,
          peers, n: peers.length + 1,
          room: 'camp', site: site.id, siteN: peers.length + 1,
          fireLevel: +site.fireLevel.toFixed(3)
        });
        broadcastGroup(site.clients, { t: 'join', ...stateOf(client) }, client.id);
        send(ws, { t: 'you', id: client.id, name: client.name, color: client.color });
        broadcastSite(site);
        broadcastGroup(site.clients, { t: 'count', n: peers.length + 1 });
      } else {
        const room = getRoom('club');
        client.color = freeColorIn(room.clients);
        room.clients.set(client.id, client);
        applyMove(client, m);
        client.joined = true;
        clearTimeout(client.hiTimer);
        const peers = clubRoster(room).filter(p => p.id !== client.id);
        send(ws, {
          t: 'welcome', id: client.id, name: client.name, color: client.color,
          peers, n: peers.length + 1
        });
        broadcastGroup(room.clients, { t: 'join', ...stateOf(client) }, client.id);
        send(ws, { t: 'you', id: client.id, name: client.name, color: client.color });
        broadcastGroup(room.clients, { t: 'count', n: peers.length + 1 });
      }
      return;
    }

    if (!client.joined) return;

    if (m.t === 'm') {
      applyMove(client, m);
      broadcastTo(client, {
        t: 'm', id: client.id, x: client.x, z: client.z, yaw: client.yaw, on: client.on,
        dance: client.dance, pose: client.pose || 'idle'
      }, true);
      return;
    }

    if (m.t === 'set') { applyProfile(client, m); return; }

    if (m.t === 'resite') {
      if (client.roomKey !== 'camp') return;
      const prev = client.siteId;
      /* leave old site visibly */
      broadcastTo(client, { t: 'left', id: client.id }, true);
      removeFromSite(client);
      client.roomKey = 'camp';
      const site = assignCampSite(client, prev);
      const peers = siteRoster(site).filter(p => p.id !== client.id);
      send(ws, {
        t: 'welcome', id: client.id, name: client.name, color: client.color,
        peers, n: peers.length + 1,
        room: 'camp', site: site.id, siteN: peers.length + 1,
        fireLevel: +site.fireLevel.toFixed(3)
      });
      broadcastGroup(site.clients, { t: 'join', ...stateOf(client) }, client.id);
      broadcastSite(site);
      broadcastGroup(site.clients, { t: 'count', n: peers.length + 1 });
      return;
    }

    if (m.t === 'chat') {
      handleChat(client, m);
      return;
    }
    if (m.t === 'emote') {
      handleEmote(client, m);
      return;
    }
    if (m.t === 'reason') {
      handleReason(client, m);
      return;
    }
    if (m.t === 'report') {
      handleReport(client, m);
      return;
    }
    if (m.t === 'log') {
      handleLog(client);
      return;
    }
    if (m.t === 'wish') {
      handleWish(client, m);
      return;
    }

    if (m.t === 'bye') { drop(client, 'bye'); }
  });

  ws.on('close', () => drop(client, 'close'));
  ws.on('error', () => drop(client, 'error'));
});

function applyProfile(c, m) {
  let changed = false;
  if (typeof m.name === 'string') {
    const want = sanitizeName(m.name);
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
  broadcastTo(c, { t: 'set', id: c.id, name: c.name, color: c.color }, true);
  send(c.ws, { t: 'you', id: c.id, name: c.name, color: c.color });
}

function applyMove(c, m) {
  const nx = Number(m.x), nz = Number(m.z), ny = Number(m.yaw);
  if (Number.isFinite(nx)) c.x = Math.max(-POS_LIM, Math.min(POS_LIM, nx));
  if (Number.isFinite(nz)) c.z = Math.max(-POS_LIM, Math.min(POS_LIM, nz));
  if (Number.isFinite(ny)) c.yaw = ny;
  c.on = m.on ? 1 : 0;
  c.pose = normalizePose(m);
  c.dance = c.pose === 'dance' ? 1 : 0;
}

function handleChat(c, m) {
  if (typeof m.text !== 'string') return;
  const text = m.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  if (!text) return;
  const now = Date.now();
  if (now - c.lastChatAt < 1500) return;
  if (text === c.lastChatText && now - c.lastChatAt < 8000) return;
  if (containsBad(text)) return;
  c.lastChatAt = now;
  c.lastChatText = text;
  broadcastTo(c, { t: 'chat', id: c.id, text }, false);
}

function handleEmote(c, m) {
  if (typeof m.emote !== 'string' || !EMOTES.has(m.emote)) return;
  const now = Date.now();
  if (now - c.lastEmoteAt < 800) return;
  c.lastEmoteAt = now;
  broadcastTo(c, { t: 'emote', id: c.id, emote: m.emote }, false);
}

const REASONS = new Set(['퇴근하고 멍때리러', '잠이 안 와서', '그냥 구경', '+1']);
function handleReason(c, m) {
  if (typeof m.reason !== 'string') return;
  const r = m.reason.trim().slice(0, 24);
  if (!REASONS.has(r)) return;
  c.reason = r;
  broadcastTo(c, { t: 'reason', id: c.id, reason: r }, false);
}

function handleReport(c, m) {
  const now = Date.now();
  if (now - c.lastReportAt < 5000) return;
  c.lastReportAt = now;
  const targetId = typeof m.id === 'string' ? m.id.slice(0, 16) : '';
  const targetName = typeof m.name === 'string' ? m.name.slice(0, 20) : '';
  const reason = typeof m.reason === 'string' ? m.reason.slice(0, 80) : '';
  console.log('[report]', JSON.stringify({
    from: c.id, fromName: c.name, targetId, targetName, reason, at: now
  }));
}

function handleLog(c) {
  if (c.roomKey !== 'camp' || c.siteId == null) return;
  const now = Date.now();
  if (now - c.lastLogAt < 4000) return;
  c.lastLogAt = now;
  const room = rooms.get('camp');
  const site = room && room.sites.get(c.siteId);
  if (!site) return;
  decayFire(site);
  site.fireLevel = Math.min(1, site.fireLevel + 0.22);
  site.lastLogAt = now;
  broadcastSite(site);
}

function handleWish(c, m) {
  if (c.roomKey !== 'camp' || c.siteId == null) return;
  if (typeof m.text !== 'string') return;
  const text = m.text.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (!text) return;
  const now = Date.now();
  if (now - c.lastWishAt < 8000) return;
  if (containsBad(text)) return;
  c.lastWishAt = now;
  broadcastTo(c, { t: 'wish', text }, false);
}

function drop(client, why) {
  if (!clients.has(client.id)) return;
  clients.delete(client.id);
  usedNames.delete(client.name);
  clearTimeout(client.hiTimer);
  if (client.joined) {
    if (client.roomKey === 'camp') {
      const g = groupOf(client);
      if (g) {
        broadcastGroup(g, { t: 'left', id: client.id }, client.id);
      }
      removeFromSite(client);
    } else if (client.roomKey === 'club') {
      const room = rooms.get('club');
      if (room) {
        broadcastGroup(room.clients, { t: 'left', id: client.id }, client.id);
        room.clients.delete(client.id);
        let n = 0;
        for (const x of room.clients.values()) if (x.joined) n++;
        broadcastGroup(room.clients, { t: 'count', n });
        if (room.clients.size === 0) rooms.delete('club');
      }
    }
  }
  try { client.ws.close(); } catch (e) {}
}

/* slow fire decay tick for occupied camp sites */
setInterval(() => {
  const camp = rooms.get('camp');
  if (!camp) return;
  for (const site of camp.sites.values()) {
    const before = site.fireLevel;
    decayFire(site);
    if (Math.abs(site.fireLevel - before) > 0.01) broadcastSite(site);
  }
}, 5000);

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
