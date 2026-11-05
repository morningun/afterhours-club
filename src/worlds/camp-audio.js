/**
 * EMBERS procedural camp audio (Web Audio only — no files).
 * Nodes created once and reused. Crackles / bug chirps: short one-shot
 * BufferSource or Oscillator from shared buffers (ok); no per-frame alloc.
 */

const STORAGE_KEY = 'embers.audio';
const DEFAULTS = { fire: 0.5, bugs: 0.32, wind: 0.38, master: 0.6, muted: false };
const MOD_HZ = 15;
const MOD_MS = 1000 / MOD_HZ;
const FIRE_LEVEL_MS = 1000 / 15;

function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const o = JSON.parse(raw);
    return {
      fire: clamp01(o.fire ?? DEFAULTS.fire),
      bugs: clamp01(o.bugs ?? DEFAULTS.bugs),
      wind: clamp01(o.wind ?? DEFAULTS.wind),
      master: clamp01(o.master ?? DEFAULTS.master),
      muted: !!o.muted
    };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function savePrefs(p) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fire: p.fire, bugs: p.bugs, wind: p.wind, master: p.master, muted: p.muted
    }));
  } catch (e) { /* private mode / quota */ }
}

function makeNoiseBuffer(ctx, seconds, kind) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    /* blend the tail into the first fadeN samples; loop then ends at len - fadeN,
       so the wrap from sample len-fadeN-1 to 0 is continuous */
    const fadeN = Math.min(len >> 1, Math.floor(ctx.sampleRate * 0.1));
    for (let i = 0; i < fadeN; i++) {
      const t = i / fadeN;
      d[i] = d[i] * t + d[len - fadeN + i] * (1 - t);
    }
    buf._fadeN = fadeN;
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

/**
 * @param {{ onRunningChange?: (running:boolean)=>void }} [opts]
 */
export function createCampAudio(opts = {}) {
  const prefs = loadPrefs();
  const onRunningChange = typeof opts.onRunningChange === 'function' ? opts.onRunningChange : () => {};

  let ctx = null;
  let running = false;
  let disposed = false;
  let fireLevel = 0.8;
  let crackleTimer = 0;
  let bugTimer = 0;
  let windLfoPhase = 0;
  let raf = 0;
  let unlockedOnce = false;
  let unlockBtnEl = null;
  let mixerEl = null;
  let gestureBound = false;
  let lastFireLevelApply = 0;
  let lastModApply = 0;

  let masterGain = null;
  let fireGain = null;
  let fireLevelGain = null;
  let bugsGain = null;
  let windGain = null;
  let fireSrc = null;
  let fireWhite = null;
  let fireBP = null;
  let fireLP = null;
  let windSrc = null;
  let windLP = null;
  let windDynGain = null;
  let crackleBuf = null;
  let brownNoise = null;
  let whiteNoise = null;
  let windNoise = null;

  function emitRunning() {
    if (unlockBtnEl) {
      unlockBtnEl.hidden = running;
      unlockBtnEl.setAttribute('aria-hidden', running ? 'true' : 'false');
    }
    onRunningChange(running);
  }

  function buildGraph() {
    if (!ctx || masterGain) return;

    masterGain = ctx.createGain();
    masterGain.gain.value = prefs.muted ? 0 : prefs.master;
    masterGain.connect(ctx.destination);

    fireGain = ctx.createGain();
    fireGain.gain.value = prefs.fire;
    fireLevelGain = ctx.createGain();
    fireLevelGain.gain.value = fireLevel;
    fireGain.connect(fireLevelGain);
    fireLevelGain.connect(masterGain);

    /* louder so chirps are audible at default slider (~0.32) */
    bugsGain = ctx.createGain();
    bugsGain.gain.value = prefs.bugs * 0.7;
    bugsGain.connect(masterGain);

    windGain = ctx.createGain();
    windGain.gain.value = prefs.wind;
    windDynGain = ctx.createGain();
    windDynGain.gain.value = 0.55;
    windGain.connect(windDynGain);
    windDynGain.connect(masterGain);

    /* distinct loop lengths 4–7 s */
    brownNoise = makeNoiseBuffer(ctx, 4.3, 'brown');
    whiteNoise = makeNoiseBuffer(ctx, 5.7, 'white');
    windNoise = makeNoiseBuffer(ctx, 6.6, 'white');
    crackleBuf = makeNoiseBuffer(ctx, 0.12, 'white');

    fireBP = ctx.createBiquadFilter();
    fireBP.type = 'bandpass';
    fireBP.frequency.value = 450;
    fireBP.Q.value = 0.6;
    const fireHP = ctx.createBiquadFilter();
    fireHP.type = 'highpass';
    fireHP.frequency.value = 150;
    fireLP = ctx.createBiquadFilter();
    fireLP.type = 'lowpass';
    fireLP.frequency.value = 900;
    fireLP.Q.value = 0.5;
    const bedTrim = ctx.createGain();
    bedTrim.gain.value = 0.45;

    fireSrc = ctx.createBufferSource();
    fireSrc.buffer = brownNoise;
    fireSrc.loop = true;
    fireSrc.loopStart = 0;
    fireSrc.loopEnd = (brownNoise.length - (brownNoise._fadeN || 0)) / ctx.sampleRate;
    fireWhite = ctx.createBufferSource();
    fireWhite.buffer = whiteNoise;
    fireWhite.loop = true;
    const fireWhiteGain = ctx.createGain();
    fireWhiteGain.gain.value = 0.10;
    fireSrc.connect(fireBP);
    fireWhite.connect(fireWhiteGain);
    fireWhiteGain.connect(fireBP);
    fireBP.connect(fireHP);
    fireHP.connect(fireLP);
    fireLP.connect(bedTrim);
    bedTrim.connect(fireGain);
    fireSrc.start();
    fireWhite.start();

    windSrc = ctx.createBufferSource();
    windSrc.buffer = windNoise;
    windSrc.loop = true;
    windLP = ctx.createBiquadFilter();
    windLP.type = 'lowpass';
    windLP.frequency.value = 420;
    windLP.Q.value = 0.4;
    windSrc.connect(windLP);
    windLP.connect(windGain);
    windSrc.start();

    scheduleCrackle();
    scheduleBugs();
    startModLoop();
  }

  function playCrack(when, peak) {
    const src = ctx.createBufferSource();
    src.buffer = crackleBuf;
    const g = ctx.createGain();
    const decay = 0.015 + Math.random() * 0.035; /* 0.015–0.05 s */
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 3000; /* 1500–4500 Hz */
    bp.Q.value = 1.0;
    src.connect(bp);
    bp.connect(g);
    /* crackles skip bedTrim and go straight to the fire slider gain */
    g.connect(fireGain || masterGain);
    src.start(when);
    src.stop(when + decay + 0.02);
  }

  function scheduleCrackle() {
    if (disposed || !ctx || !crackleBuf) return;
    if (ctx.state !== 'running') return;
    const wait = 0.25 + Math.random() * 1.55; /* 0.25–1.8 s */
    crackleTimer = setTimeout(() => {
      crackleTimer = 0;
      if (disposed || !ctx || ctx.state === 'closed') return;
      if (ctx.state !== 'running') return;
      try {
        const t0 = ctx.currentTime;
        let peak = 0.15 + Math.random() * 0.30; /* 0.15–0.45 */
        if (Math.random() < 0.10) {
          playCrack(t0, peak * 1.6); /* occasional loud, crisp snap */
        } else if (Math.random() < 0.30) {
          const n = 2 + Math.floor(Math.random() * 3); /* 2–4 hits */
          let t = t0;
          for (let i = 0; i < n; i++) {
            playCrack(t, peak);
            t += 0.02 + Math.random() * 0.06; /* 20–80 ms apart */
            peak *= 0.75 + Math.random() * 0.15; /* each a bit softer */
          }
        } else {
          playCrack(t0, peak);
        }
      } catch (e) { /* ignore */ }
      scheduleCrackle();
    }, wait * 1000);
  }

  function scheduleBugs() {
    if (disposed || !ctx || !bugsGain) return;
    if (ctx.state !== 'running') return;
    const wait = 0.8 + Math.random() * 2.2; /* 0.8–3 s */
    bugTimer = setTimeout(() => {
      bugTimer = 0;
      if (disposed || !ctx || ctx.state === 'closed') return;
      if (ctx.state !== 'running') return;
      try {
        const pulses = 3 + (Math.random() < 0.5 ? 0 : 1); /* 3–4 */
        const t0 = ctx.currentTime;
        for (let i = 0; i < pulses; i++) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 4000 + Math.random() * 1000; /* 4–5 kHz */
          const g = ctx.createGain();
          const start = t0 + i * (0.04 + Math.random() * 0.035);
          const dur = 0.016 + Math.random() * 0.022;
          const peak = 0.45 + Math.random() * 0.35;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(peak, start + 0.002);
          g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          osc.connect(g);
          g.connect(bugsGain);
          osc.start(start);
          osc.stop(start + dur + 0.01);
        }
      } catch (e) { /* ignore */ }
      scheduleBugs();
    }, wait * 1000);
  }

  function ensureSchedulers() {
    if (!ctx || ctx.state !== 'running' || disposed) return;
    if (!crackleTimer) scheduleCrackle();
    if (!bugTimer) scheduleBugs();
  }

  function startModLoop() {
    if (raf) return;
    const step = (now) => {
      raf = requestAnimationFrame(step);
      if (!ctx || ctx.state !== 'running') return;
      if (now - lastModApply < MOD_MS) return;
      lastModApply = now;
      const dt = MOD_MS / 1000;
      windLfoPhase += dt * 0.07;
      try {
        if (windLP && windDynGain) {
          const w = 0.5 + 0.5 * Math.sin(windLfoPhase);
          windLP.frequency.setTargetAtTime(280 + w * 420, ctx.currentTime, 0.2);
          windDynGain.gain.setTargetAtTime(0.35 + w * 0.45, ctx.currentTime, 0.25);
        }
      } catch (e) { /* ignore */ }
    };
    raf = requestAnimationFrame(step);
  }

  function applyGains() {
    if (!masterGain || !ctx) return;
    const t = ctx.currentTime;
    masterGain.gain.setTargetAtTime(prefs.muted ? 0 : prefs.master, t, 0.05);
    if (fireGain) fireGain.gain.setTargetAtTime(prefs.fire, t, 0.05);
    if (bugsGain) bugsGain.gain.setTargetAtTime(prefs.bugs * 0.7, t, 0.05);
    if (windGain) windGain.gain.setTargetAtTime(prefs.wind, t, 0.05);
    if (fireLevelGain) fireLevelGain.gain.setTargetAtTime(clamp01(fireLevel), t, 0.08);
  }

  async function unlock() {
    if (disposed) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!ctx) ctx = new AC();
      buildGraph();
      if (ctx.state === 'suspended') await ctx.resume();
      unlockedOnce = true;
      running = ctx.state === 'running';
      applyGains();
      ensureSchedulers();
      emitRunning();
      return running;
    } catch (e) {
      running = false;
      emitRunning();
      return false;
    }
  }

  function setFireLevel(v) {
    fireLevel = clamp01(v);
    const now = performance.now();
    if (now - lastFireLevelApply < FIRE_LEVEL_MS) return;
    lastFireLevelApply = now;
    if (fireLevelGain && ctx && ctx.state !== 'closed') {
      try {
        fireLevelGain.gain.setTargetAtTime(fireLevel, ctx.currentTime, 0.08);
      } catch (e) { /* ignore */ }
    }
  }

  function setChannel(name, value) {
    if (name !== 'fire' && name !== 'bugs' && name !== 'wind' && name !== 'master') return;
    prefs[name] = clamp01(value);
    applyGains();
    savePrefs(prefs);
  }

  function setMuted(m) {
    prefs.muted = !!m;
    applyGains();
    savePrefs(prefs);
  }

  function getPrefs() {
    return { fire: prefs.fire, bugs: prefs.bugs, wind: prefs.wind, master: prefs.master, muted: prefs.muted };
  }

  async function onVisibility() {
    if (!ctx || disposed || !unlockedOnce) return;
    try {
      if (document.hidden) {
        if (ctx.state === 'running') await ctx.suspend();
        running = false;
        emitRunning();
      } else {
        await ctx.resume();
        running = ctx.state === 'running';
        ensureSchedulers();
        emitRunning();
      }
    } catch (e) { /* ignore */ }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = 0; }
    if (bugTimer) { clearTimeout(bugTimer); bugTimer = 0; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try {
      if (fireSrc) fireSrc.stop();
      if (fireWhite) fireWhite.stop();
      if (windSrc) windSrc.stop();
    } catch (e) { /* ignore */ }
    try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (e) { /* ignore */ }
    ctx = null;
    masterGain = fireGain = fireLevelGain = bugsGain = windGain = null;
    fireSrc = fireWhite = fireBP = fireLP = windSrc = windLP = windDynGain = null;
    running = false;
    emitRunning();
  }

  document.addEventListener('visibilitychange', onVisibility);
  /* do not dispose on pagehide (bfcache); only beforeunload */
  addEventListener('beforeunload', dispose);

  function attachUI({ unlockBtn, mixer, chip, sliders, muteBtn }) {
    unlockBtnEl = unlockBtn || null;
    mixerEl = mixer || null;
    emitRunning();

    const tryUnlock = () => { unlock(); };
    if (unlockBtnEl) {
      unlockBtnEl.addEventListener('click', e => { e.stopPropagation(); tryUnlock(); });
    }
    if (!gestureBound) {
      gestureBound = true;
      const gesture = () => { if (!running && !disposed) tryUnlock(); };
      addEventListener('keydown', gesture, { passive: true });
      addEventListener('pointerdown', gesture, { passive: true });
      addEventListener('pointerup', gesture, { passive: true });
      addEventListener('touchend', gesture, { passive: true });
    }

    const p = getPrefs();
    if (sliders) {
      for (const key of ['fire', 'bugs', 'wind']) {
        const el = sliders[key];
        if (!el) continue;
        el.value = String(Math.round((p[key] ?? 0) * 100));
        el.addEventListener('input', () => setChannel(key, Number(el.value) / 100));
      }
    }
    if (muteBtn) {
      const paintMute = () => {
        muteBtn.classList.toggle('on', prefs.muted);
        muteBtn.textContent = prefs.muted ? '음소거 해제' : '음소거';
      };
      paintMute();
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        setMuted(!prefs.muted);
        paintMute();
      });
    }
    if (chip && mixerEl) {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        mixerEl.classList.toggle('open');
      });
    }

    return {
      setBulmongMode(on) {
        if (!mixerEl) return;
        mixerEl.classList.toggle('bulmong', !!on);
        if (on) mixerEl.classList.remove('open');
      }
    };
  }

  return {
    unlock,
    isRunning: () => running,
    setFireLevel,
    setChannel,
    setMuted,
    getPrefs,
    dispose,
    attachUI
  };
}
