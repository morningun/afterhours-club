/**
 * EMBERS multiplayer net — room:'camp', site assignment, presence sync.
 * Solo fallback + reconnect backoff mirrors the club client.
 */
import * as THREE from 'three';
import { makeAvatar, nameTag, restyleRig, peerColor } from '../core/avatar.js';
import { poseFromNet, netPoseFields } from '../core/pose.js';

const LOBBY_URL = (() => {
  const q = new URLSearchParams(location.search).get('lobby');
  if (q) return q;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://127.0.0.1:8080';
  return 'wss://afterhours-lobby.onrender.com';
})();

function loadBlocked() {
  try {
    const raw = localStorage.getItem('embers.blocked');
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (e) { return new Set(); }
}
function saveBlocked(set) {
  try { localStorage.setItem('embers.blocked', JSON.stringify([...set])); } catch (e) { /* */ }
}

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {() => ({x:number,z:number,yaw:number,pose:string,on:number})} opts.getState
 * @param {(name:string,color:number) => void} [opts.onYou]
 * @param {(info:{site:number,siteN:number,solo:boolean,online:boolean,full?:boolean,fireLevel?:number}) => void} [opts.onStatus]
 * @param {(msg:object) => void} [opts.onEvent]  chat/emote/wish/site/reason…
 */
const IS_MOBILE = (navigator.maxTouchPoints > 0) || matchMedia('(pointer:coarse)').matches;
const TAG_HIDE = 16;
const TAG_NEAR = 3.5;
const TAG_FAR = 12;
const _tagProj = new THREE.Vector3();
const _tagBuf = [];

export function createCampNet(opts) {
  const scene = opts.scene;
  const getState = opts.getState;
  const getCamera = opts.getCamera || (() => null);
  const getPlayer = opts.getPlayer || (() => ({ x: 0, z: 0 }));
  const onYou = opts.onYou || (() => {});
  const onStatus = opts.onStatus || (() => {});
  const onEvent = opts.onEvent || (() => {});
  const tagOpts = IS_MOBILE ? { compact: true } : undefined;

  const NET = {
    ws: null, id: null, name: '', color: 0, online: false,
    tries: 0, retryAt: 0, lastSent: 0, site: 1, siteN: 1, fireLevel: 0.55,
    full: false, solo: true
  };
  const peers = new Map();
  const blocked = loadBlocked();

  function emitStatus(extra) {
    onStatus({
      site: NET.site,
      siteN: NET.siteN,
      solo: !NET.online,
      online: NET.online,
      full: NET.full,
      fireLevel: NET.fireLevel,
      ...extra
    });
  }

  function clearPeers() {
    for (const id of [...peers.keys()]) removePeer(id);
  }

  function addPeer(s) {
    if (!s || peers.has(s.id) || s.id === NET.id) return;
    if (blocked.has(s.id)) {
      /* still track silently for unblock? skip avatar */
    }
    const trim = peerColor(s.color || 0);
    const body = new THREE.Color(trim).multiplyScalar(0.34);
    const rig = makeAvatar(body.getHex(), trim, false);
    const tag = nameTag(s.name || '캠퍼', trim, tagOpts);
    rig.group.add(tag);
    rig.group.position.set(s.x || 0, 0, s.z || 0);
    rig.group.rotation.y = s.yaw || 0;
    if (!blocked.has(s.id)) scene.add(rig.group);
    peers.set(s.id, {
      id: s.id,
      name: s.name || '캠퍼',
      color: s.color || 0,
      rig, tag,
      x: s.x || 0, z: s.z || 0, yaw: s.yaw || 0,
      tx: s.x || 0, tz: s.z || 0, tyaw: s.yaw || 0,
      on: s.on ? 1 : 0,
      pose: poseFromNet(s),
      reason: s.reason || '',
      reasonTag: null,
      bubble: null, bubbleUntil: 0,
      emote: null, emoteUntil: 0,
      bob: 0, sitMix: 0, hidden: blocked.has(s.id)
    });
    if (s.reason) setPeerReason(peers.get(s.id), s.reason);
  }

  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    scene.remove(p.rig.group);
    if (p.bubble && p.bubble.parent) p.bubble.parent.remove(p.bubble);
    if (p.reasonTag && p.reasonTag.parent) p.reasonTag.parent.remove(p.reasonTag);
    peers.delete(id);
  }

  function retagPeer(p, name, trim) {
    if (p.tag && p.tag.parent) p.tag.parent.remove(p.tag);
    p.tag = nameTag(name, trim, tagOpts);
    p.rig.group.add(p.tag);
    p.name = name;
  }

  function setPeerReason(p, reason) {
    p.reason = reason || '';
    if (p.reasonTag && p.reasonTag.parent) p.reasonTag.parent.remove(p.reasonTag);
    p.reasonTag = null;
    if (!reason || p.hidden) return;
    const sprite = nameTag(reason, 0xffc98a, tagOpts);
    sprite.position.y = 2.72;
    sprite.scale.multiplyScalar(0.72);
    p.rig.group.add(sprite);
    p.reasonTag = sprite;
  }

  function makeBubbleSprite(text) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const font = '500 28px "Helvetica Neue", Arial, "Apple SD Gothic Neo", sans-serif';
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    const wCss = Math.min(420, Math.ceil(measure.measureText(text).width) + 36);
    const hCss = 52;
    const c = document.createElement('canvas');
    c.width = Math.ceil(wCss * dpr); c.height = Math.ceil(hCss * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(r, 4);
    ctx.arcTo(wCss - 4, 4, wCss - 4, hCss - 4, r);
    ctx.arcTo(wCss - 4, hCss - 4, 4, hCss - 4, r);
    ctx.arcTo(4, hCss - 4, 4, 4, r);
    ctx.arcTo(4, 4, wCss - 4, 4, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20,14,10,0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,200,140,0.45)';
    ctx.stroke();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe8d0';
    ctx.fillText(text, wCss / 2, hCss / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false
    }));
    sprite.scale.set(0.28 * (wCss / hCss), 0.28, 1);
    sprite.position.set(0, 2.55, 0);
    sprite.renderOrder = 30;
    return sprite;
  }

  function showPeerBubble(p, text) {
    if (p.hidden) return;
    if (p.bubble && p.bubble.parent) p.bubble.parent.remove(p.bubble);
    p.bubble = makeBubbleSprite(text);
    p.rig.group.add(p.bubble);
    p.bubbleUntil = performance.now() + 5000;
  }

  function sendHi() {
    const ws = NET.ws;
    if (!ws || ws.readyState !== 1) return;
    const st = getState();
    try {
      const hi = {
        t: 'hi', room: 'camp',
        x: st.x, z: st.z, yaw: st.yaw, on: st.on ? 1 : 0,
        ...netPoseFields(st.pose)
      };
      if (NET.name) hi.name = NET.name;
      ws.send(JSON.stringify(hi));
    } catch (e) { /* */ }
  }

  function handleNet(m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'full') {
      NET.full = true;
      emitStatus({ full: true });
      onEvent({ t: 'full' });
      return;
    }
    if (m.t === 'welcome') {
      NET.id = m.id;
      NET.name = m.name;
      NET.color = m.color || 0;
      NET.online = true;
      NET.solo = false;
      NET.tries = 0;
      NET.full = false;
      if (m.site != null) NET.site = m.site;
      if (m.siteN != null) NET.siteN = m.siteN;
      if (m.fireLevel != null) NET.fireLevel = m.fireLevel;
      if (m.n != null) NET.siteN = m.n;
      clearPeers();
      (m.peers || []).forEach(addPeer);
      onYou(m.name, m.color || 0);
      emitStatus();
      onEvent({ t: 'welcome', fireLevel: NET.fireLevel, site: NET.site });
      return;
    }
    if (m.t === 'you') {
      NET.name = m.name;
      NET.color = m.color || 0;
      NET.online = true;
      onYou(m.name, m.color || 0);
      return;
    }
    if (m.t === 'join') { addPeer(m); if (NET.online) { NET.siteN = peers.size + 1; emitStatus(); } return; }
    if (m.t === 'm') {
      const p = peers.get(m.id);
      if (!p) { addPeer(m); return; }
      p.tx = m.x; p.tz = m.z; p.tyaw = m.yaw;
      p.on = m.on ? 1 : 0;
      p.pose = poseFromNet(m);
      return;
    }
    if (m.t === 'set') {
      const p = peers.get(m.id);
      if (!p) { addPeer(m); return; }
      const trim = peerColor(m.color || 0);
      if (m.name) retagPeer(p, m.name, trim);
      restyleRig(p.rig, trim);
      p.color = m.color || 0;
      return;
    }
    if (m.t === 'left') {
      removePeer(m.id);
      if (NET.online) { NET.siteN = peers.size + 1; emitStatus(); }
      return;
    }
    if (m.t === 'count') {
      NET.online = true;
      NET.siteN = m.n || 1;
      emitStatus();
      return;
    }
    if (m.t === 'site') {
      if (m.site != null) NET.site = m.site;
      if (m.siteN != null) NET.siteN = m.siteN;
      if (m.fireLevel != null) NET.fireLevel = m.fireLevel;
      emitStatus();
      onEvent({ t: 'site', site: NET.site, siteN: NET.siteN, fireLevel: NET.fireLevel });
      return;
    }
    if (m.t === 'chat') {
      const p = peers.get(m.id);
      if (p && !p.hidden) {
        showPeerBubble(p, String(m.text || '').slice(0, 60));
        onEvent({ t: 'chat', id: m.id, text: m.text, peer: p });
      } else if (m.id === NET.id) {
        onEvent({ t: 'chat', id: m.id, text: m.text, self: true });
      }
      return;
    }
    if (m.t === 'emote') {
      const p = peers.get(m.id);
      if (p && !p.hidden) {
        p.emote = m.emote;
        p.emoteUntil = performance.now() + 2200;
        onEvent({ t: 'emote', id: m.id, emote: m.emote, peer: p });
      } else if (m.id === NET.id) {
        onEvent({ t: 'emote', id: m.id, emote: m.emote, self: true });
      }
      return;
    }
    if (m.t === 'reason') {
      const p = peers.get(m.id);
      if (p) setPeerReason(p, m.reason);
      onEvent({ t: 'reason', id: m.id, reason: m.reason });
      return;
    }
    if (m.t === 'wish') {
      onEvent({ t: 'wish', text: String(m.text || '').slice(0, 40) });
      return;
    }
  }

  function connectNet() {
    if (NET.ws || NET.full) return;
    emitStatus({ solo: true, online: false });
    let ws;
    try { ws = new WebSocket(LOBBY_URL); }
    catch (e) { scheduleReconnect(); return; }
    NET.ws = ws;
    const openTimer = setTimeout(() => {
      if (ws.readyState === 0) { try { ws.close(); } catch (e) {} }
    }, 7000);
    ws.onopen = () => { clearTimeout(openTimer); sendHi(); };
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handleNet(m);
    };
    ws.onclose = (ev) => {
      clearTimeout(openTimer);
      if (NET.ws === ws) NET.ws = null;
      NET.online = false;
      NET.id = null;
      clearPeers();
      if (ev && ev.code === 1013) {
        NET.full = true;
        emitStatus({ full: true, solo: true });
        onEvent({ t: 'full' });
        return;
      }
      emitStatus({ solo: true });
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function scheduleReconnect() {
    if (NET.full) return;
    NET.tries = Math.min(NET.tries + 1, 6);
    const wait = Math.min(9000, 1200 * NET.tries);
    NET.retryAt = performance.now() + wait;
  }

  function pumpNet() {
    if (!NET.ws || NET.ws.readyState !== 1 || !NET.id) return;
    const now = performance.now();
    if (now - NET.lastSent < 80) return;
    NET.lastSent = now;
    const st = getState();
    try {
      NET.ws.send(JSON.stringify({
        t: 'm',
        x: +st.x.toFixed(2),
        z: +st.z.toFixed(2),
        yaw: +st.yaw.toFixed(2),
        on: st.on ? 1 : 0,
        ...netPoseFields(st.pose)
      }));
    } catch (e) { /* */ }
  }

  function updatePeers(dt) {
    const now = performance.now();
    for (const p of peers.values()) {
      if (p.hidden) continue;
      p.x = THREE.MathUtils.damp(p.x, p.tx, 10, dt);
      p.z = THREE.MathUtils.damp(p.z, p.tz, 10, dt);
      let dy = p.tyaw - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += dy * Math.min(1, dt * 10);
      p.sitMix = THREE.MathUtils.damp(p.sitMix, (p.pose === 'sit' || p.pose === 'roast') ? 1 : 0, 6, dt);
      const moving = p.on && p.sitMix < 0.5;
      p.bob += dt * (moving ? 8 : 0);
      const swing = Math.sin(p.bob) * (moving ? 0.55 : 0);
      let bodyY = moving ? Math.abs(Math.sin(p.bob)) * 0.05 : 0;
      let legLx = swing, legRx = -swing;
      let armLx = -swing * 0.7, armRx = swing * 0.7;
      let armLz = 0.12, armRz = -0.12;
      let headY = 1.92;
      if (p.sitMix > 0.01) {
        bodyY = THREE.MathUtils.lerp(bodyY, 0.42, p.sitMix);
        headY = THREE.MathUtils.lerp(headY, 1.78, p.sitMix);
        legLx = THREE.MathUtils.lerp(legLx, -1.4, p.sitMix);
        legRx = THREE.MathUtils.lerp(legRx, -1.4, p.sitMix);
        armLx = THREE.MathUtils.lerp(armLx, p.pose === 'roast' ? -0.2 : -0.9, p.sitMix);
        armRx = THREE.MathUtils.lerp(armRx, p.pose === 'roast' ? -1.55 : -0.9, p.sitMix);
        armLz = THREE.MathUtils.lerp(armLz, 0.4, p.sitMix);
        armRz = THREE.MathUtils.lerp(armRz, p.pose === 'roast' ? -0.15 : -0.4, p.sitMix);
      }
      /* emote overlays */
      if (p.emote && now < p.emoteUntil) {
        const t = (p.emoteUntil - now) / 2200;
        if (p.emote === 'wave') {
          armRx = -0.2 + Math.sin(now * 0.02) * 1.2;
          armRz = -0.6;
        } else if (p.emote === 'nod') {
          headY = 1.92 + Math.sin(now * 0.015) * 0.04;
          p.rig.head.rotation.x = Math.sin(now * 0.015) * 0.35;
        } else if (p.emote === 'cheers') {
          armLx = -2.2; armRx = -2.2;
          armLz = 0.5; armRz = -0.5;
        }
        if (t < 0.05) p.emote = null;
      } else {
        p.rig.head.rotation.x = 0;
      }
      p.rig.legL.rotation.x = legLx;
      p.rig.legR.rotation.x = legRx;
      p.rig.armL.rotation.x = armLx;
      p.rig.armR.rotation.x = armRx;
      p.rig.armL.rotation.z = armLz;
      p.rig.armR.rotation.z = armRz;
      p.rig.head.position.y = headY;
      p.rig.group.position.set(p.x, bodyY, p.z);
      p.rig.group.rotation.y = p.yaw;
      if (p.bubble && now > p.bubbleUntil) {
        if (p.bubble.parent) p.bubble.parent.remove(p.bubble);
        p.bubble = null;
      }
    }
  }

  function layoutNameTags() {
    const cam = getCamera();
    if (!cam) return;
    const me = getPlayer();
    _tagBuf.length = 0;
    for (const p of peers.values()) {
      if (p.hidden || !p.tag) continue;
      const dx = p.x - me.x, dz = p.z - me.z;
      const dist = Math.hypot(dx, dz);
      if (dist > TAG_HIDE) {
        p.tag.visible = false;
        if (p.reasonTag) p.reasonTag.visible = false;
        continue;
      }
      p.tag.visible = true;
      if (p.reasonTag) p.reasonTag.visible = dist < TAG_HIDE * 0.85;
      const t = Math.min(1, Math.max(0, (TAG_FAR - dist) / (TAG_FAR - TAG_NEAR)));
      const mul = 0.55 + 0.45 * t;
      const bx = p.tag.userData.baseScaleX || p.tag.scale.x;
      const by = p.tag.userData.baseScaleY || p.tag.scale.y;
      p.tag.userData.baseScaleX = bx;
      p.tag.userData.baseScaleY = by;
      p.tag.scale.set(bx * mul, by * mul, 1);
      const baseY = p.tag.userData.baseY || 2.42;
      _tagProj.set(p.x, (p.rig.group.position.y || 0) + baseY, p.z);
      _tagProj.project(cam);
      if (_tagProj.z > 1) { p.tag.visible = false; continue; }
      const sx = (_tagProj.x * 0.5 + 0.5) * innerWidth;
      const sy = (-_tagProj.y * 0.5 + 0.5) * innerHeight;
      _tagBuf.push({ p, sx, sy, baseY, oy: 0 });
    }
    _tagBuf.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
    const minDx = IS_MOBILE ? 72 : 96;
    const minDy = IS_MOBILE ? 22 : 28;
    for (let i = 0; i < _tagBuf.length; i++) {
      let oy = 0;
      for (let j = 0; j < i; j++) {
        const a = _tagBuf[i], b = _tagBuf[j];
        if (Math.abs(a.sx - b.sx) < minDx && Math.abs((a.sy - oy * 40) - (b.sy - b.oy * 40)) < minDy) {
          oy = Math.max(oy, b.oy + 0.22);
        }
      }
      _tagBuf[i].oy = oy;
      _tagBuf[i].p.tag.position.y = _tagBuf[i].baseY + oy;
      if (_tagBuf[i].p.reasonTag) {
        _tagBuf[i].p.reasonTag.position.y = 2.72 + oy;
      }
    }
  }

  function update(dt) {
    if (!NET.ws && !NET.full && performance.now() >= NET.retryAt) connectNet();
    pumpNet();
    updatePeers(dt);
    layoutNameTags();
  }

  function send(obj) {
    if (!NET.ws || NET.ws.readyState !== 1 || !NET.id) return false;
    try { NET.ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  function sendProfile(name, colorIdx) {
    return send({ t: 'set', name, color: colorIdx });
  }

  function resite() {
    return send({ t: 'resite' });
  }

  function sendChat(text) {
    return send({ t: 'chat', text: String(text || '').slice(0, 60) });
  }

  function sendEmote(emote) {
    return send({ t: 'emote', emote });
  }

  function sendReason(reason) {
    return send({ t: 'reason', reason });
  }

  function sendLog() {
    return send({ t: 'log' });
  }

  function sendWish(text) {
    return send({ t: 'wish', text: String(text || '').slice(0, 40) });
  }

  function report(id, name, reason) {
    return send({ t: 'report', id, name, reason: String(reason || '').slice(0, 80) });
  }

  function block(id) {
    blocked.add(String(id));
    saveBlocked(blocked);
    const p = peers.get(id);
    if (p) {
      p.hidden = true;
      scene.remove(p.rig.group);
    }
  }

  function isBlocked(id) { return blocked.has(String(id)); }

  function peersWithin(x, z, dist) {
    const out = [];
    const d2 = dist * dist;
    for (const p of peers.values()) {
      if (p.hidden) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz <= d2) out.push(p);
    }
    return out;
  }

  /** Hide bubbles/emotes beyond range (client-side filter). */
  function filterBubblesByRange(x, z, dist) {
    const d2 = dist * dist;
    for (const p of peers.values()) {
      if (!p.bubble) continue;
      const dx = p.x - x, dz = p.z - z;
      p.bubble.visible = (dx * dx + dz * dz) <= d2;
    }
  }

  addEventListener('online', () => { NET.tries = 0; NET.full = false; if (!NET.ws) connectNet(); });
  addEventListener('pagehide', () => {
    if (NET.ws && NET.ws.readyState === 1) {
      try { NET.ws.send(JSON.stringify({ t: 'bye' })); } catch (e) {}
    }
  });

  connectNet();
  emitStatus({ solo: true });

  return {
    NET, peers, update, sendProfile, resite, sendChat, sendEmote, sendReason,
    sendLog, sendWish, report, block, isBlocked, peersWithin, filterBubblesByRange,
    lobbyUrl: LOBBY_URL,
    setName(n) { NET.name = n; }
  };
}
