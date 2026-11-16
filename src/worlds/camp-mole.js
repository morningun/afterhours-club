/**
 * EMBERS — 두더지 잡기 (local-only minigame; no network, no pose change).
 * Geometry / materials built once and reused; update() returns at once when off.
 * DOM (menu item #moleBtn, HUD #moleHud) lives in camp_head.html; text via textContent only.
 */
const MOLE_TIME = 30;              /* seconds per round */
const MOLE_INTERVAL_START = 1.0;   /* spawn interval at start (s) */
const MOLE_INTERVAL_END = 0.6;     /* spawn interval at the end (s) */
const MOLE_UP_RATIO = 0.85;        /* time up = interval * ratio (a bit shorter) */
const MOLE_BEST_KEY = 'embers-mole-best';
const CLICK_MAX_MOVE = 6;          /* px */
const CLICK_MAX_MS = 300;
const RETRY_SHOW_MS = 10000;

/* field: empty ground behind-left of the fire (chairs r≈3.35, tents ±8, lantern (2.8,-4.2), trees r≥8.5) */
const FIELD_X = -4.25;
const FIELD_Z = -4.25;
const HOLE_GAP = 1.4;

const HIDE_Y = -0.62;   /* pop offset when fully down (below ground) */
const RISE_S = 0.1;
const SQUASH_S = 0.16;
const PARTICLE_N = 14;
const PARTICLE_LIFE = 0.45;

function loadBest() {
  try { const v = parseInt(localStorage.getItem(MOLE_BEST_KEY) || '0', 10); return Number.isFinite(v) && v > 0 ? v : 0; }
  catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem(MOLE_BEST_KEY, String(v)); } catch (e) { /* private mode */ }
}

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {HTMLCanvasElement} o.canvas
 * @param {(msg:string)=>void} o.showToast
 * @param {()=>boolean} o.isBulmong
 * @param {()=>void} o.standUp          release sit / 불멍
 * @param {(x:number,z:number)=>void} o.faceToward
 * @param {()=>{x:number,z:number}} [o.getPlayer]
 * @param {()=>void} [o.playPop]
 */
export function createMoleGame(o) {
  const { THREE, scene, camera, canvas } = o;
  const showToast = o.showToast || (() => {});
  const isBulmong = o.isBulmong || (() => false);
  const standUp = o.standUp || (() => {});
  const faceToward = o.faceToward || (() => {});
  const getPlayer = o.getPlayer || null;
  const playPop = o.playPop || (() => {});

  /* ---------- scene (built once) ---------- */
  const root = new THREE.Group();
  root.name = 'moleField';
  root.position.set(FIELD_X, 0, FIELD_Z);
  /* front row faces the fire */
  root.rotation.y = Math.atan2(-FIELD_X, -FIELD_Z);
  scene.add(root);

  const holeGeo = new THREE.CircleGeometry(0.34, 20);
  const holeMat = new THREE.MeshStandardMaterial({
    color: 0x070504, roughness: 1, metalness: 0,
    emissive: new THREE.Color(0x1a0d05), emissiveIntensity: 0.25
  });
  const moundGeo = new THREE.TorusGeometry(0.4, 0.09, 6, 22);
  const moundMat = new THREE.MeshStandardMaterial({
    color: 0x2c2117, roughness: 1, metalness: 0, flatShading: true,
    emissive: new THREE.Color(0x3a1c0a), emissiveIntensity: 0.22
  });
  const bodyGeo = new THREE.SphereGeometry(0.24, 10, 8);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x6b4a2e, roughness: 0.9, metalness: 0, flatShading: true,
    emissive: new THREE.Color(0x2a160a), emissiveIntensity: 0.45
  });
  const noseGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xff8fa8, roughness: 0.6, metalness: 0,
    emissive: new THREE.Color(0x6a2232), emissiveIntensity: 0.7
  });
  const eyeGeo = new THREE.SphereGeometry(0.028, 6, 4);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const hitGeo = new THREE.SphereGeometry(0.42, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  const moles = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const lx = (c - 1) * HOLE_GAP, lz = (r - 1) * HOLE_GAP;
      const hole = new THREE.Group();
      hole.position.set(lx, 0, lz);
      const disc = new THREE.Mesh(holeGeo, holeMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.018;
      const mound = new THREE.Mesh(moundGeo, moundMat);
      mound.rotation.x = -Math.PI / 2;
      mound.scale.set(1, 1, 0.6);
      mound.position.y = 0.03;
      hole.add(disc, mound);

      const pop = new THREE.Group();   /* moves up/down */
      const face = new THREE.Group();  /* yaw toward player on spawn */
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.scale.set(1, 1.25, 1);
      body.position.y = 0.24;
      const nose = new THREE.Mesh(noseGeo, noseMat);
      nose.position.set(0, 0.34, 0.22);
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
      eyeL.position.set(-0.085, 0.43, 0.18);
      const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      eyeR.position.set(0.085, 0.43, 0.18);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.y = 0.28;
      face.add(body, nose, eyeL, eyeR, hit);
      pop.add(face);
      pop.position.y = HIDE_Y;
      pop.visible = false;
      hole.add(pop);
      root.add(hole);
      moles.push({ hole, pop, face, body, hit });
    }
  }
  root.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  root.getWorldPosition(center);

  /* hit particles: fixed pool */
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PARTICLE_N * 3);
  const pVel = new Float32Array(PARTICLE_N * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xffc98a, size: 0.08, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  particles.visible = false;
  scene.add(particles);
  let pAge = 0;

  /* ---------- DOM ---------- */
  const hudEl = document.getElementById('moleHud');
  const textEl = document.getElementById('moleText');
  const stopBtn = document.getElementById('moleStop');
  const retryBtn = document.getElementById('moleRetry');
  const menuBtn = document.getElementById('moleBtn');

  /* ---------- state ---------- */
  let active = false;
  let t = 0;
  let score = 0;
  let best = loadBest();
  let spawnIn = 0;
  let cur = -1;        /* index of the mole that is up */
  let curT = 0;
  let curUp = 0;       /* up duration for current mole */
  let curHit = false;
  let hitT = 0;
  let last = -1;
  let shownScore = -1, shownSec = -1;
  let hudBulmong = false;
  let retryTimer = 0;

  const tmpV = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const hits = [];

  function setHud(mode) { /* 'off' | 'play' | 'retry' */
    if (!hudEl) return;
    hudEl.classList.toggle('show', mode !== 'off');
    hudEl.classList.toggle('retry', mode === 'retry');
  }
  function paintHud() {
    const sec = Math.max(0, Math.ceil(MOLE_TIME - t));
    if (sec === shownSec && score === shownScore) return;
    shownSec = sec; shownScore = score;
    if (textEl) textEl.textContent = '🐹 ' + score + '점 · ' + sec + '초';
  }

  function hideMole(i) {
    if (i < 0) return;
    const m = moles[i];
    m.pop.visible = false;
    m.pop.position.y = HIDE_Y;
    m.body.scale.set(1, 1.25, 1);
  }
  function hideAll() {
    for (let i = 0; i < moles.length; i++) hideMole(i);
    cur = -1;
    particles.visible = false;
  }

  function intervalNow() {
    const k = Math.min(1, t / MOLE_TIME);
    return MOLE_INTERVAL_START + (MOLE_INTERVAL_END - MOLE_INTERVAL_START) * k;
  }

  function spawn() {
    if (cur >= 0) hideMole(cur);
    let i = Math.floor(Math.random() * moles.length);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (moles.length - 1))) % moles.length;
    last = i;
    cur = i; curT = 0; curHit = false; hitT = 0;
    const iv = intervalNow();
    curUp = iv * MOLE_UP_RATIO;
    spawnIn = iv;
    const m = moles[i];
    m.pop.visible = true;
    m.pop.position.y = HIDE_Y;
    m.body.scale.set(1, 1.25, 1);
    /* face the player (world yaw minus field yaw) */
    if (getPlayer) {
      const p = getPlayer();
      m.hole.getWorldPosition(tmpV);
      m.face.rotation.y = Math.atan2(p.x - tmpV.x, p.z - tmpV.z) - root.rotation.y;
    }
  }

  function start() {
    clearTimeout(retryTimer);
    standUp();
    faceToward(center.x, center.z);
    active = true;
    t = 0; score = 0; last = -1;
    spawnIn = 0.5; /* small lead-in */
    hideAll();
    shownScore = -1; shownSec = -1;
    hudBulmong = false;
    if (hudEl) hudEl.classList.remove('bm');
    paintHud();
    setHud('play');
  }

  function finish() {
    active = false;
    hideAll();
    if (score > best) { best = score; saveBest(best); }
    showToast(score + '점! (최고 ' + best + '점)');
    setHud('retry');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!active) setHud('off'); }, RETRY_SHOW_MS);
  }

  function cancel() {
    if (!active) { clearTimeout(retryTimer); setHud('off'); return; }
    active = false;
    hideAll();
    setHud('off');
  }

  function burst(i) {
    const m = moles[i];
    m.hole.getWorldPosition(tmpV);
    for (let k = 0; k < PARTICLE_N; k++) {
      const a = (k / PARTICLE_N) * Math.PI * 2 + Math.random() * 0.4;
      const s = 0.9 + Math.random() * 0.9;
      pPos[k * 3] = tmpV.x; pPos[k * 3 + 1] = 0.35; pPos[k * 3 + 2] = tmpV.z;
      pVel[k * 3] = Math.cos(a) * s; pVel[k * 3 + 1] = 1.4 + Math.random() * 1.4; pVel[k * 3 + 2] = Math.sin(a) * s;
    }
    pGeo.attributes.position.needsUpdate = true;
    pAge = 0;
    pMat.opacity = 1;
    particles.visible = true;
  }

  function whack() {
    if (cur < 0 || curHit) return;
    curHit = true; hitT = 0;
    score++;
    paintHud();
    burst(cur);
    playPop();
  }

  /* ---------- input: short click/tap only (drag stays look-rotate) ---------- */
  let downId = null, downX = 0, downY = 0, downT = 0, downMoved = false;
  const LIM2 = CLICK_MAX_MOVE * CLICK_MAX_MOVE;
  canvas.addEventListener('pointerdown', e => {
    if (!active) return;
    if (e.button != null && e.button !== 0) return;
    downId = e.pointerId; downX = e.clientX; downY = e.clientY; downT = e.timeStamp; downMoved = false;
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== downId || downMoved) return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (dx * dx + dy * dy > LIM2) downMoved = true;
  });
  const clearDown = e => { if (e.pointerId === downId) downId = null; };
  canvas.addEventListener('pointercancel', clearDown);
  canvas.addEventListener('pointerup', e => {
    if (e.pointerId !== downId) return;
    downId = null;
    if (!active || isBulmong()) return;
    if (downMoved || e.timeStamp - downT > CLICK_MAX_MS) return; /* event time, not handler time */
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (dx * dx + dy * dy > LIM2) return;
    /* only a release over the bare canvas (not chat / menus / HUD) */
    const top = document.elementFromPoint(e.clientX, e.clientY);
    if (top !== canvas) return;
    pick(e.clientX, e.clientY);
  });

  function pick(cx, cy) {
    if (cur < 0 || curHit) return;
    const m = moles[cur];
    if (!m.pop.visible || m.pop.position.y < HIDE_Y * 0.6) return;
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    hits.length = 0;
    m.hit.updateMatrixWorld(true);
    raycaster.intersectObject(m.hit, false, hits);
    if (hits.length) whack();
  }

  function overlayOpen() {
    return !!document.querySelector('#reasonPanel.open, #peerMenu.open, #siteMenu.open, #emoteWrap.open, #actionWrap.open, #chatBox.open, #wishBox.open, #panel.open');
  }

  /* capture phase: decide before camp.js closes menus on the same ESC */
  addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const ae = document.activeElement;
    const aeTag = ae && ae.tagName ? ae.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || aeTag === 'input' || aeTag === 'textarea') return;
    if (e.code === 'KeyM' && !e.repeat) {
      if (!active) start();
      return;
    }
    if (e.code === 'Escape') {
      if (overlayOpen() || isBulmong()) return;
      if (active || (hudEl && hudEl.classList.contains('retry'))) cancel();
    }
  }, true);

  if (menuBtn) menuBtn.addEventListener('click', e => { e.stopPropagation(); start(); });
  if (stopBtn) {
    stopBtn.addEventListener('click', e => { e.stopPropagation(); cancel(); });
    stopBtn.addEventListener('pointerdown', e => e.stopPropagation());
  }
  if (retryBtn) {
    retryBtn.addEventListener('click', e => { e.stopPropagation(); start(); });
    retryBtn.addEventListener('pointerdown', e => e.stopPropagation());
  }

  /* ---------- per frame ---------- */
  function update(dt) {
    if (!active) return;

    /* 불멍: HUD hidden (picking disabled in pointerup) */
    const bm = isBulmong();
    if (bm !== hudBulmong) {
      hudBulmong = bm;
      if (hudEl) hudEl.classList.toggle('bm', bm);
    }

    t += dt;
    if (t >= MOLE_TIME) { t = MOLE_TIME; paintHud(); finish(); return; }

    spawnIn -= dt;
    if (spawnIn <= 0) spawn();

    if (cur >= 0) {
      const m = moles[cur];
      curT += dt;
      if (curHit) {
        hitT += dt;
        if (hitT < SQUASH_S) {
          const k = hitT / SQUASH_S;
          m.body.scale.set(1 + 0.35 * k, 1.25 * (1 - 0.65 * k), 1 + 0.35 * k);
        } else {
          m.pop.position.y = Math.max(HIDE_Y, m.pop.position.y - dt * 6);
          if (m.pop.position.y <= HIDE_Y) { hideMole(cur); cur = -1; }
        }
      } else {
        let y;
        if (curT < RISE_S) y = HIDE_Y * (1 - curT / RISE_S);
        else if (curT < curUp - RISE_S) y = 0;
        else y = HIDE_Y * Math.min(1, (curT - (curUp - RISE_S)) / RISE_S);
        m.pop.position.y = y;
        if (curT >= curUp) { hideMole(cur); cur = -1; }
      }
    }

    if (particles.visible) {
      pAge += dt;
      if (pAge >= PARTICLE_LIFE) particles.visible = false;
      else {
        for (let k = 0; k < PARTICLE_N; k++) {
          pPos[k * 3] += pVel[k * 3] * dt;
          pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt;
          pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
          pVel[k * 3 + 1] -= 5 * dt;
        }
        pGeo.attributes.position.needsUpdate = true;
        pMat.opacity = 1 - pAge / PARTICLE_LIFE;
      }
    }

    paintHud();
  }

  return {
    start, cancel, update,
    isActive: () => active,
    center
  };
}
