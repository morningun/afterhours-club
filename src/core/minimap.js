/**
 * Top-left minimap (2D canvas). Shared by EMBERS (camp.html) and AFTERHOURS (index.html).
 * Local rendering only: reads existing player / peer objects, no server / protocol / pose changes.
 *
 *  - static layer (bounds, landmarks) drawn once per resize into an offscreen canvas
 *  - dynamic layer (peers as dots in their outfit colour, self as a heading arrow) redrawn at ~12 Hz
 *  - pointer-events:none so look-drag on the canvas underneath keeps working
 *  - labels are DOM spans filled via textContent
 *  - update() allocates nothing (Map.forEach with a pre-bound callback, cached CSS colour strings)
 *
 * Layout keeps the map outside the central 60% of the viewport, clear of the top-centre HUD
 * band (mole / portal HUD), and respects safe-area insets.
 */
const REDRAW_MS = 80;          /* ~12 Hz */
const MAX_DPR = 2;
const MIN_SIZE = 56;

let styleDone = false;
function ensureStyle() {
  if (styleDone) return;
  styleDone = true;
  const st = document.createElement('style');
  st.textContent =
    '.minimap{position:fixed;z-index:12;pointer-events:none;touch-action:none;user-select:none;' +
    'border-radius:12px;overflow:hidden;background:rgba(6,8,12,.55);border:1px solid rgba(255,255,255,.16);' +
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:opacity .35s ease}' +
    '.minimap.off{opacity:0;visibility:hidden}' +
    '.minimap canvas{display:block;width:100%;height:100%}' +
    '.minimap span{position:absolute;transform:translate(-50%,-50%);font:700 8px/1 system-ui,sans-serif;' +
    'letter-spacing:.08em;white-space:nowrap;color:rgba(255,255,255,.55);pointer-events:none}' +
    '.minimap.small span{display:none}';
  document.head.appendChild(st);
}

/**
 * @param {object} o
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} o.view  world rect shown (x → right, -z → up)
 * @param {Array<object>} [o.shapes]  static landmarks:
 *   {t:'rect',x,z,w,d,rot?,fill?,stroke?,lw?} | {t:'circle',x,z,r,fill?,stroke?,lw?} | {t:'line',x1,z1,x2,z2,stroke,lw?}
 * @param {Array<{x:number,z:number,text:string,color?:string}>} [o.labels]
 * @param {()=>{x:number,z:number}} o.getSelf
 * @param {()=>number} o.getSelfYaw          avatar yaw; forward = (sin yaw, cos yaw)
 * @param {()=>number} o.getSelfColor        hex
 * @param {()=>Map} o.getPeers               values: { rig:{group, chest}, hidden? }
 * @param {()=>boolean} [o.isHidden]         e.g. 불멍
 * @param {object} o.layout
 * @param {number} o.layout.left             px from left (plus safe-area)
 * @param {number} o.layout.top              px from top  (plus safe-area)
 * @param {number} [o.layout.size=160]       max width
 * @param {number} [o.layout.mobileSize=110] max width on touch (coarse pointer) devices
 * @param {number} [o.layout.hudHalf=90]     half width of the top-centre HUD to keep clear
 * @param {(w:number,h:number)=>number} [o.layout.top2]  optional per-viewport top override
 * @param {string} [o.bg]                    canvas background fill
 */
export function createMinimap(o) {
  ensureStyle();
  const view = o.view;
  const vw = view.maxX - view.minX, vd = view.maxZ - view.minZ;
  const aspect = vd / vw;
  const L = o.layout;
  const isHidden = o.isHidden || (() => false);

  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.setAttribute('aria-hidden', 'true');
  const cv = document.createElement('canvas');
  wrap.appendChild(cv);
  const ctx = cv.getContext('2d');
  const stat = document.createElement('canvas');
  const sctx = stat.getContext('2d');
  const labelEls = (o.labels || []).map(l => {
    const s = document.createElement('span');
    s.textContent = l.text;                 /* textContent only */
    if (l.color) s.style.color = l.color;
    wrap.appendChild(s);
    return s;
  });
  document.body.appendChild(wrap);

  /* safe-area probe (env() is only readable through layout) */
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);

  let W = 0, H = 0, S = 1, dpr = 1, wPx = 0, hPx = 0;
  const colorCache = new Map();
  function css(hex) {
    let s = colorCache.get(hex);
    if (!s) { s = '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6); colorCache.set(hex, s); }
    return s;
  }
  const mx = x => (x - view.minX) * S;
  const my = z => (z - view.minZ) * S;

  function layout() {
    const vwPx = innerWidth, vhPx = innerHeight;
    const cs = getComputedStyle(probe);
    const sT = parseFloat(cs.paddingTop) || 0, sL = parseFloat(cs.paddingLeft) || 0;
    const left = L.left + sL;
    const top = (L.top2 ? L.top2(vwPx, vhPx) : L.top) + sT;
    const coarse = matchMedia('(pointer:coarse)').matches;
    const max = coarse ? Math.min(L.size || 160, L.mobileSize || 110) : (L.size || 160);
    /* outside the central 60%: fit the left 20% strip, or the top 20% strip, whichever is larger */
    const fitLeft = vwPx * 0.2 - left - 2;
    const fitTop = (vhPx * 0.2 - top - 2) / aspect;
    let w = Math.min(max, Math.max(fitLeft, fitTop));
    /* top-centre HUD band (same formulas as the mole / portal HUD css) */
    const narrow = vwPx < 700, shortLand = vhPx <= 480 && vwPx > vhPx;
    const hudTop = (shortLand ? 10 : narrow ? Math.min(122, Math.max(82, vhPx * 0.2 - 46)) : 12) + sT;
    const hudBot = hudTop + 50;
    if (top < hudBot && top + w * aspect > hudTop) {
      w = Math.min(w, vwPx / 2 - (L.hudHalf || 90) - 6 - left);
    }
    w = Math.max(MIN_SIZE, Math.floor(w));
    const h = Math.round(w * aspect);
    wPx = w; hPx = h;
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    wrap.classList.toggle('small', w < 100);
    dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
    W = Math.round(w * dpr); H = Math.round(h * dpr);
    cv.width = W; cv.height = H; stat.width = W; stat.height = H;
    S = W / vw;
    drawStatic();
    (o.labels || []).forEach((l, i) => {
      labelEls[i].style.left = (mx(l.x) / dpr) + 'px';
      labelEls[i].style.top = (my(l.z) / dpr) + 'px';
    });
    last = 0;
  }

  function drawStatic() {
    const c = sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, W, H); }
    for (const sh of (o.shapes || [])) {
      c.save();
      c.lineWidth = (sh.lw || 1) * dpr;
      if (sh.t === 'line') {
        c.strokeStyle = sh.stroke;
        c.lineCap = 'round';
        c.beginPath(); c.moveTo(mx(sh.x1), my(sh.z1)); c.lineTo(mx(sh.x2), my(sh.z2)); c.stroke();
      } else if (sh.t === 'circle') {
        c.beginPath(); c.arc(mx(sh.x), my(sh.z), Math.max(sh.r * S, dpr), 0, Math.PI * 2);
        if (sh.fill) { c.fillStyle = sh.fill; c.fill(); }
        if (sh.stroke) { c.strokeStyle = sh.stroke; c.stroke(); }
      } else if (sh.t === 'rect') {
        c.translate(mx(sh.x), my(sh.z));
        c.rotate(-(sh.rot || 0));          /* three.js rotation.y → canvas (z down) */
        const w = sh.w * S, d = sh.d * S;
        if (sh.fill) { c.fillStyle = sh.fill; c.fillRect(-w / 2, -d / 2, w, d); }
        if (sh.stroke) { c.strokeStyle = sh.stroke; c.strokeRect(-w / 2, -d / 2, w, d); }
      }
      c.restore();
    }
  }

  /* ---------- dynamic layer ---------- */
  let last = 0, shown = true;
  const dotR = () => Math.max(2.2, wPx / 46) * dpr;
  let rDot = 3;
  function drawPeer(p) {
    if (!p || p.hidden || !p.rig) return;
    const pos = p.rig.group.position;
    let x = mx(pos.x), y = my(pos.z);
    const out = x < 0 || x > W || y < 0 || y > H;
    if (out) { x = Math.min(W - rDot, Math.max(rDot, x)); y = Math.min(H - rDot, Math.max(rDot, y)); }
    const col = css(p.rig.chest.material.emissive.getHex());
    ctx.beginPath();
    ctx.arc(x, y, rDot, 0, Math.PI * 2);
    if (out) { ctx.strokeStyle = col; ctx.lineWidth = 1.2 * dpr; ctx.stroke(); }
    else {
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 0.8 * dpr; ctx.stroke();
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(stat, 0, 0);
    rDot = dotR();
    const peers = o.getPeers();
    if (peers) peers.forEach(drawPeer);
    /* self arrow */
    const sp = o.getSelf();
    const yaw = o.getSelfYaw();
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const len = rDot * 2.3, wid = rDot * 1.35;
    let x = mx(sp.x), y = my(sp.z);
    x = Math.min(W - len, Math.max(len, x)); y = Math.min(H - len, Math.max(len, y));
    ctx.beginPath();
    ctx.moveTo(x + fx * len, y + fz * len);
    ctx.lineTo(x - fx * len * 0.65 + fz * wid, y - fz * len * 0.65 - fx * wid);
    ctx.lineTo(x - fx * len * 0.3, y - fz * len * 0.3);
    ctx.lineTo(x - fx * len * 0.65 - fz * wid, y - fz * len * 0.65 + fx * wid);
    ctx.closePath();
    ctx.fillStyle = css(o.getSelfColor());
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.1 * dpr;
    ctx.stroke();
  }

  function update() {
    const hide = isHidden();
    if (hide === shown) { shown = !hide; wrap.classList.toggle('off', hide); }
    if (hide) return;
    const now = performance.now();
    if (now - last < REDRAW_MS) return;
    last = now;
    draw();
  }

  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(layout, 60); };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);
  layout();

  function dispose() {
    removeEventListener('resize', onResize);
    removeEventListener('orientationchange', onResize);
    wrap.remove(); probe.remove();
  }
  return { update, dispose, el: wrap };
}
