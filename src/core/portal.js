/**
 * Portal door between worlds (EMBERS camp.html <-> AFTERHOURS index.html).
 * Shared by both worlds. Local only: no server / protocol / pose changes.
 *
 *  - walk into the door: 1.2 s progress, cancelled when you step out
 *  - then 0.4 s black fade -> onBeforeLeave() -> location.href = target (+ ?lobby= kept)
 *  - arrival (?from=<arriveFrom>): spawn spot in front of the door, 3 s ignore, fade-in
 *  - bfcache back (pageshow persisted): overlay + progress reset, re-arm only after stepping out
 *
 * Geometry / materials are built once; update() allocates nothing.
 * All DOM text via textContent.
 */
const HOLD_S = 1.2;        /* progress fill time */
const FADE_MS = 400;       /* fade-out before navigating */
const IGNORE_S = 3;        /* after arrival: door ignored */
const BEHIND_DEPTH = 2.0;  /* trigger also covers the passage just behind the membrane */
const HALF_W = 1.2;        /* post centre offset from door centre */
const POST = 0.32;         /* post footprint (collision box) */
const HEIGHT = 2.7;

let styleDone = false;
function ensureStyle() {
  if (styleDone) return;
  styleDone = true;
  const st = document.createElement('style');
  st.textContent =
    '#portalHud{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);' +
    'z-index:60;display:none;flex-direction:column;align-items:center;gap:6px;pointer-events:none;' +
    'padding:8px 14px 9px;border-radius:14px;background:rgba(8,8,12,.82);border:1px solid rgba(255,255,255,.18);' +
    'color:#fff;font:700 13px/1.2 system-ui,sans-serif;white-space:nowrap}' +
    '#portalHud.show{display:flex}' +
    '#portalBar{width:150px;height:4px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden}' +
    '#portalFill{width:100%;height:100%;transform-origin:0 50%;transform:scaleX(0)}' +
    '@media (max-width:699px){#portalHud{top:calc(clamp(82px, 20vh - 46px, 122px) + env(safe-area-inset-top,0px));' +
    'font-size:12px;padding:6px 10px 7px}#portalBar{width:120px}}' +
    '@media (orientation:landscape) and (max-height:480px){#portalHud{top:calc(10px + env(safe-area-inset-top,0px))}}' +
    '#portalFade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9999;' +
    'transition:opacity .4s ease}';
  document.head.appendChild(st);
}

function css(hex) { return '#' + hex.toString(16).padStart(6, '0'); }

function makeSignTex(THREE, text, fg, bg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 112;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 112);
  ctx.strokeStyle = fg;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 500, 100);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg;
  ctx.font = '700 54px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Read and validate ?from=. Returns true only when it equals `expected`. */
export function arrivedFrom(expected) {
  try { return new URLSearchParams(location.search).get('from') === expected; }
  catch (e) { return false; }
}

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {THREE.Scene} o.scene
 * @param {{x:number,z:number}} o.position   door centre on the ground
 * @param {number} o.rotationY               door faces local +z (= the world inside)
 * @param {string} o.label                   e.g. 'AFTERHOURS'
 * @param {number[]} o.color                 two membrane colours
 * @param {'log'|'glow'} [o.frame]           log frame (camp) or glowing frame (club)
 * @param {number} [o.frameColor]
 * @param {string} o.targetUrl               relative URL incl. ?from=
 * @param {()=>{x:number,z:number}} o.getPlayerPos
 * @param {number} [o.radius=1.2]
 * @param {()=>boolean} [o.canEnter]         false while sitting / 불멍 / dancing
 * @param {()=>void} [o.onBeforeLeave]       ws close, audio stop…
 * @param {()=>void} [o.onReturn]            bfcache restore
 * @param {Array} [o.obstacles]              world obstacle list; door posts are pushed in
 * @param {string} [o.arriveFrom]            ?from= value that means "came through this door"
 * @param {number} [o.arriveDist=2.6]
 * @param {number} [o.arriveLookOffset=1.1]  camera swing (rad) off the door axis on arrival
 * @param {{prefixFrom:string, prefixTo:string, get:()=>{name:string,color:number}}} [o.carry]
 */
export function createPortal(o) {
  const { THREE, scene } = o;
  const radius = o.radius || 1.2;
  const canEnter = o.canEnter || (() => true);
  const onBeforeLeave = o.onBeforeLeave || (() => {});
  const onReturn = o.onReturn || (() => {});
  const getPlayerPos = o.getPlayerPos;
  const cx = o.position.x, cz = o.position.z;
  const rot = o.rotationY || 0;
  const sinR = Math.sin(rot), cosR = Math.cos(rot);
  const colA = o.color[0], colB = o.color[1] != null ? o.color[1] : o.color[0];

  /* ---------- scene (built once) ---------- */
  const root = new THREE.Group();
  root.name = 'portal';
  root.position.set(cx, 0, cz);
  root.rotation.y = rot;
  const geos = [], mats = [], texs = [];
  const G = g => (geos.push(g), g);
  const M = m => (mats.push(m), m);

  if (o.frame === 'glow') {
    const fc = o.frameColor != null ? o.frameColor : 0xff7a28;
    const postGeo = G(new THREE.BoxGeometry(0.22, HEIGHT, 0.22));
    const barGeo = G(new THREE.BoxGeometry(HALF_W * 2 + 0.22, 0.22, 0.22));
    const frameMat = M(new THREE.MeshStandardMaterial({
      color: 0x1a0c06, roughness: 0.5, metalness: 0.3,
      emissive: new THREE.Color(fc), emissiveIntensity: 1.25
    }));
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, frameMat);
      p.position.set(s * HALF_W, HEIGHT / 2, 0);
      root.add(p);
    }
    const bar = new THREE.Mesh(barGeo, frameMat);
    bar.position.set(0, HEIGHT, 0);
    root.add(bar);
  } else {
    const wood = M(new THREE.MeshStandardMaterial({ color: o.frameColor != null ? o.frameColor : 0x3a2616, roughness: 0.92, metalness: 0.03, flatShading: true }));
    const postGeo = G(new THREE.CylinderGeometry(0.13, 0.16, HEIGHT + 0.1, 8));
    const barGeo = G(new THREE.CylinderGeometry(0.12, 0.12, HALF_W * 2 + 0.6, 8));
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, wood);
      p.position.set(s * HALF_W, (HEIGHT + 0.1) / 2, 0);
      p.rotation.y = s * 0.7;
      root.add(p);
    }
    const bar = new THREE.Mesh(barGeo, wood);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, HEIGHT - 0.05, 0);
    root.add(bar);
  }

  /* shimmering membrane: two additive MeshBasicMaterial layers */
  const memW = HALF_W * 2 - 0.26, memH = HEIGHT - 0.14;
  const memGeo = G(new THREE.PlaneGeometry(memW, memH));
  const memMatA = M(new THREE.MeshBasicMaterial({
    color: colA, transparent: true, opacity: 0.15, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  const memMatB = M(new THREE.MeshBasicMaterial({
    color: colB, transparent: true, opacity: 0.11, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  const memA = new THREE.Mesh(memGeo, memMatA);
  memA.position.set(0, memH / 2 + 0.02, 0.02);
  const memB = new THREE.Mesh(memGeo, memMatB);
  memB.position.set(0, memH / 2 + 0.02, -0.03);
  root.add(memA, memB);

  /* soft floor glow (no extra light: keeps mobile shaders cheap) */
  const glowC = document.createElement('canvas');
  glowC.width = glowC.height = 64;
  {
    const g2 = glowC.getContext('2d');
    const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  }
  const glowTex = new THREE.CanvasTexture(glowC);
  texs.push(glowTex);
  const glowMat = M(new THREE.MeshBasicMaterial({
    map: glowTex, color: colA, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  const glow = new THREE.Mesh(G(new THREE.PlaneGeometry(3.2, 2.2)), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.025, 0.2);
  root.add(glow);

  /* sign "→ LABEL" */
  const signTex = makeSignTex(THREE, '\u2192 ' + o.label, css(colA), 'rgba(8,6,12,0.92)');
  texs.push(signTex);
  const signMat = M(new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide }));
  const sign = new THREE.Mesh(G(new THREE.PlaneGeometry(1.9, 0.42)), signMat);
  sign.position.set(0, HEIGHT + 0.4, 0.04);
  root.add(sign);
  scene.add(root);

  /* posts -> world obstacles (axis-aligned footprint after rotation) */
  const added = [];
  if (Array.isArray(o.obstacles)) {
    const ex = Math.abs(cosR) * POST + Math.abs(sinR) * POST;
    for (const s of [-1, 1]) {
      const ob = { x: cx + cosR * s * HALF_W, z: cz - sinR * s * HALF_W, w: ex, d: ex };
      o.obstacles.push(ob);
      added.push(ob);
    }
  }

  /* ---------- DOM ---------- */
  ensureStyle();
  const hud = document.createElement('div');
  hud.id = 'portalHud';
  const hudText = document.createElement('span');
  hudText.textContent = '\u2192 ' + o.label + '\uB85C \uC774\uB3D9 \uC911\u2026'; /* "→ LABEL로 이동 중…" */
  const bar = document.createElement('div');
  bar.id = 'portalBar';
  const fill = document.createElement('div');
  fill.id = 'portalFill';
  fill.style.background = css(colA);
  bar.appendChild(fill);
  hud.append(hudText, bar);
  const fade = document.createElement('div');
  fade.id = 'portalFade';
  document.body.append(hud, fade);

  /* ---------- state ---------- */
  const arrived = !!(o.arriveFrom && arrivedFrom(o.arriveFrom));
  let ignoreT = arrived ? IGNORE_S : 0;
  let armed = false;         /* true once the player has been outside the trigger (and ignore elapsed) */
  let progress = 0;
  let shown = false;
  let lastPct = -1;
  let leaving = false;
  let leaveTimer = 0;

  let arrival = null;
  if (arrived) {
    const d = o.arriveDist || 2.6;
    arrival = {
      x: cx + sinR * d,
      z: cz + cosR * d,
      yaw: rot,                 /* face local +z: into the world */
      /* camera behind the player but swung ~63° off-axis, so the first view is not through the membrane */
      lookYaw: rot + Math.PI - (o.arriveLookOffset != null ? o.arriveLookOffset : 1.1)
    };
    /* start black, fade in on the first frames */
    fade.style.transition = 'none';
    fade.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fade.style.transition = '';
      fade.style.opacity = '0';
    }));
    /* drop ?from= so a reload starts at the default spot (other params, e.g. ?lobby=, kept) */
    try {
      const u = new URL(location.href);
      u.searchParams.delete('from');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* ignore */ }
  }

  function setHud(on) {
    if (on === shown) return;
    shown = on;
    hud.classList.toggle('show', on);
    if (!on) { lastPct = -1; fill.style.transform = 'scaleX(0)'; }
  }

  function targetHref() {
    const u = new URL(o.targetUrl, location.href);
    try {
      const lobby = new URLSearchParams(location.search).get('lobby');
      if (lobby) u.searchParams.set('lobby', lobby);
    } catch (e) { /* ignore */ }
    return u.href;
  }

  function carryProfile() {
    const c = o.carry;
    if (!c || !c.get) return;
    try {
      const me = c.get() || {};
      if (me.name) localStorage.setItem(c.prefixTo + '.name', String(me.name).slice(0, 20));
      if (Number.isInteger(me.color) && me.color >= 0) localStorage.setItem(c.prefixTo + '.color', String(me.color));
    } catch (e) { /* private mode: nickname falls back to server default */ }
  }

  function go() {
    leaveTimer = 0;
    carryProfile();
    try { onBeforeLeave(); } catch (e) { /* never block navigation */ }
    location.href = targetHref();
  }

  function startLeave() {
    leaving = true;
    fade.style.transition = '';
    fade.style.opacity = '1';
    leaveTimer = setTimeout(go, FADE_MS);
  }

  function reset() {
    if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }
    leaving = false;
    progress = 0;
    armed = false;           /* restored standing in the door: must step out first */
    setHud(false);
    fade.style.transition = 'none';
    fade.style.opacity = '0';
    requestAnimationFrame(() => { fade.style.transition = ''; });
  }

  function onPageShow(e) {
    if (!e.persisted) return;
    reset();
    try { onReturn(); } catch (err) { /* ignore */ }
  }
  addEventListener('pageshow', onPageShow);

  /* inside test in door-local space: circle r around the centre + the passage just behind it */
  function inside() {
    const p = getPlayerPos();
    const dx = p.x - cx, dz = p.z - cz;
    const lx = dx * cosR - dz * sinR;   /* along the door */
    const lz = dx * sinR + dz * cosR;   /* + = world inside, - = behind the membrane */
    if (lx * lx + lz * lz < radius * radius) return true;
    return lz < 0 && lz > -BEHIND_DEPTH && Math.abs(lx) < HALF_W - POST / 2;
  }

  function update(dt, elapsed) {
    /* shimmer (opacity + slight scale; no allocations) */
    const t = elapsed || 0;
    const boost = progress / HOLD_S;
    memMatA.opacity = 0.13 + 0.05 * Math.sin(t * 2.3) + boost * 0.18;
    memMatB.opacity = 0.09 + 0.04 * Math.sin(t * 3.1 + 1.7) + boost * 0.14;
    memA.scale.set(1 + 0.012 * Math.sin(t * 1.7), 1 + 0.018 * Math.sin(t * 2.1 + 0.6), 1);
    memB.scale.set(1 + 0.016 * Math.sin(t * 2.6 + 2.0), 1 + 0.012 * Math.sin(t * 1.4), 1);
    memB.position.x = Math.sin(t * 0.9) * 0.03;
    glowMat.opacity = 0.22 + 0.05 * Math.sin(t * 2.3) + boost * 0.22;

    if (leaving) return;
    if (ignoreT > 0) ignoreT = Math.max(0, ignoreT - dt);
    const inn = inside();
    if (!armed) {
      if (ignoreT <= 0 && !inn) armed = true;
      return;
    }
    if (inn && canEnter()) {
      progress += dt;
      setHud(true);
      const pct = Math.min(100, Math.round(progress / HOLD_S * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        fill.style.transform = 'scaleX(' + (pct / 100) + ')';
      }
      if (progress >= HOLD_S) startLeave();
    } else if (progress > 0 || shown) {
      progress = 0;
      setHud(false);
    }
  }

  function dispose() {
    removeEventListener('pageshow', onPageShow);
    if (leaveTimer) clearTimeout(leaveTimer);
    scene.remove(root);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const x of texs) x.dispose();
    if (Array.isArray(o.obstacles)) {
      for (const ob of added) { const i = o.obstacles.indexOf(ob); if (i >= 0) o.obstacles.splice(i, 1); }
    }
    hud.remove();
    fade.remove();
  }

  return {
    update, dispose,
    arrival,                       /* {x,z,yaw,lookYaw} when ?from= matched, else null */
    get progress() { return progress; },
    get leaving() { return leaving; },
    root
  };
}
