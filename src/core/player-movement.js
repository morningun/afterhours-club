import * as THREE from 'three';

/**
 * Axis-aligned obstacle collision + world clamp.
 * bounds: { halfW, halfD } or { half }
 * obstacles: [{ x, z, w, d }, ...]
 */
export function collide(p, r, bounds, obstacles = []) {
  const halfW = bounds.halfW != null ? bounds.halfW : bounds.half;
  const halfD = bounds.halfD != null ? bounds.halfD : bounds.half;
  const pad = 0.4;
  p.x = THREE.MathUtils.clamp(p.x, -halfW + r + pad, halfW - r - pad);
  p.z = THREE.MathUtils.clamp(p.z, -halfD + r + pad, halfD - r - pad);
  for (const o of obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const hx = o.w / 2 + r, hz = o.d / 2 + r;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
      if (ox < oz) p.x = o.x + Math.sign(dx || 1) * hx;
      else p.z = o.z + Math.sign(dz || 1) * hz;
    }
  }
}

/**
 * Apply camera-relative walk. Mutates player.position and playerState.yaw/speed.
 * tmpDir is a reusable THREE.Vector3.
 */
export function applyWalk({
  player, playerState, lookYaw, ix, iz, dt, tmpDir,
  walkSpeed = 2.7, runSpeed = 5.4, radius = 0.42,
  bounds, obstacles, enabled = true
}) {
  const walking = Math.hypot(ix, iz) > 0.05;
  const targetSpeed = (enabled && walking)
    ? (playerState.run ? runSpeed : walkSpeed) * Math.min(1, Math.hypot(ix, iz) * 1.4)
    : 0;
  playerState.speed = THREE.MathUtils.damp(playerState.speed, targetSpeed, 9, dt);

  if (!enabled) return { walking: false, moving: playerState.speed > 0.15 };

  const fwdX = -Math.sin(lookYaw), fwdZ = -Math.cos(lookYaw);
  const rightX = Math.cos(lookYaw), rightZ = -Math.sin(lookYaw);
  tmpDir.set(fwdX * (-iz) + rightX * ix, 0, fwdZ * (-iz) + rightZ * ix);
  if (tmpDir.lengthSq() > 0) {
    tmpDir.normalize();
    player.position.x += tmpDir.x * playerState.speed * dt;
    player.position.z += tmpDir.z * playerState.speed * dt;
    if (bounds) collide(player.position, radius, bounds, obstacles || []);
    const wantYaw = Math.atan2(tmpDir.x, tmpDir.z);
    let diff = ((wantYaw - playerState.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    playerState.yaw += diff * Math.min(1, dt * 12);
  }
  return { walking, moving: playerState.speed > 0.15 };
}

/** Base walk / idle limb targets (before pose blend). */
export function walkCyclePose(playerState, elapsed, opts = {}) {
  const beat = opts.beat != null ? opts.beat : 0;
  const moving = playerState.speed > 0.15;
  playerState.bob += opts.dt != null
    ? (opts.dt * (moving ? playerState.speed * 3.4 : 0))
    : 0;
  /* if dt not passed, assume bob already advanced by caller */
  const swing = Math.sin(playerState.bob) * Math.min(1, playerState.speed / 3);
  const idle = Math.abs(Math.sin(elapsed * 2.6)) * (0.02 + beat * 0.025);
  return {
    moving,
    legLx: swing * 0.85,
    legRx: -swing * 0.85,
    armLx: -swing * 0.7,
    armRx: swing * 0.7,
    armLz: 0.12 + (moving ? 0 : Math.sin(elapsed * 2.6) * 0.16 * beat),
    armRz: -0.12 - (moving ? 0 : Math.sin(elapsed * 2.6 + 1) * 0.16 * beat),
    torsoZ: moving ? 0 : Math.sin(elapsed * 1.9) * 0.035,
    torsoY: moving ? 0 : Math.sin(elapsed * 1.4) * 0.05,
    bodyY: moving ? Math.abs(Math.sin(playerState.bob)) * 0.055 : idle,
    headY: 1.92 + (moving ? 0 : Math.sin(elapsed * 2.6) * 0.015),
    yawExtra: 0
  };
}

export function applyLimbPose(rig, pose, groupYaw) {
  rig.legL.rotation.x = pose.legLx;
  rig.legR.rotation.x = pose.legRx;
  rig.armL.rotation.x = pose.armLx;
  rig.armR.rotation.x = pose.armRx;
  rig.armL.rotation.z = pose.armLz;
  rig.armR.rotation.z = pose.armRz;
  rig.torso.rotation.z = pose.torsoZ;
  rig.torso.rotation.y = pose.torsoY;
  if (pose.torsoX != null) rig.torso.rotation.x = pose.torsoX;
  rig.head.position.y = pose.headY;
  if (pose.bodyY != null) rig.group.position.y = pose.bodyY;
  if (groupYaw != null) rig.group.rotation.y = groupYaw;
}
