/**
 * Keyboard, look-drag, and virtual joystick — shared by club and camp.
 */

export function createKeyState(opts = {}) {
  const keys = Object.create(null);
  const onRun = opts.onRun || (() => {});
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') onRun(1);
  });
  addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') onRun(0);
  });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  return keys;
}

export function createLookControls(canvas, opts = {}) {
  const look = {
    yaw: opts.yaw != null ? opts.yaw : 0,
    pitch: opts.pitch != null ? opts.pitch : -0.13,
    dragging: false,
    lastX: 0,
    lastY: 0,
    id: null
  };
  const yawScale = opts.yawScale != null ? opts.yawScale : 0.0042;
  const pitchScale = opts.pitchScale != null ? opts.pitchScale : 0.0032;
  const pitchMin = opts.pitchMin != null ? opts.pitchMin : -0.55;
  const pitchMax = opts.pitchMax != null ? opts.pitchMax : 0.42;
  const shouldIgnore = opts.shouldIgnore || (() => false);

  canvas.addEventListener('pointerdown', e => {
    if (shouldIgnore()) return;
    look.dragging = true; look.id = e.pointerId;
    look.lastX = e.clientX; look.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!look.dragging || e.pointerId !== look.id || shouldIgnore()) return;
    const dx = e.clientX - look.lastX, dy = e.clientY - look.lastY;
    look.lastX = e.clientX; look.lastY = e.clientY;
    look.yaw -= dx * yawScale;
    look.pitch = Math.max(pitchMin, Math.min(pitchMax, look.pitch - dy * pitchScale));
  });
  const endDrag = e => { if (e.pointerId === look.id) { look.dragging = false; look.id = null; } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  return look;
}

export function createJoystick(stick, knob) {
  const moveVec = { x: 0, y: 0 };
  let stickId = null;
  function stickMove(e) {
    const r = stick.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2);
    let y = e.clientY - (r.top + r.height / 2);
    const max = r.width * 0.36;
    const len = Math.hypot(x, y);
    if (len > max) { x = x / len * max; y = y / len * max; }
    knob.style.transform = `translate(${x}px, ${y}px)`;
    moveVec.x = x / max; moveVec.y = y / max;
  }
  stick.addEventListener('pointerdown', e => {
    stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e);
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = e => {
    if (e.pointerId !== stickId) return;
    stickId = null; moveVec.x = 0; moveVec.y = 0;
    knob.style.transform = 'translate(0px, 0px)';
  };
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  return moveVec;
}

/** Combine WASD/arrows + joystick into a unit-ish xz intent in camera space inputs. */
export function readMoveIntent(keys, moveVec) {
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  ix += moveVec.x; iz += moveVec.y;
  const mag = Math.min(1, Math.hypot(ix, iz));
  if (mag > 0.02) { ix /= Math.max(mag, 0.0001); iz /= Math.max(mag, 0.0001); }
  else { ix = 0; iz = 0; }
  return { ix, iz, mag, walking: mag > 0.05 };
}
