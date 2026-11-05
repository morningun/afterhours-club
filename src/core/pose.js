/** Shared pose vocabulary for club + camp (+ future). */
export const POSES = ['idle', 'dance', 'sit', 'roast'];

export function isPose(v) {
  return typeof v === 'string' && POSES.includes(v);
}

/** Accept either modern `pose` or legacy `dance` boolean/0|1 from the wire. */
export function poseFromNet(msg) {
  if (msg && isPose(msg.pose)) return msg.pose;
  if (msg && msg.dance) return 'dance';
  return 'idle';
}

/** Fields to put on outbound `m` / roster — always include both for old clients. */
export function netPoseFields(pose) {
  const p = isPose(pose) ? pose : 'idle';
  return { pose: p, dance: p === 'dance' ? 1 : 0 };
}

export function createPlayerState(extra = {}) {
  return Object.assign({
    vel: null, /* filled by caller with THREE.Vector3 if needed */
    yaw: Math.PI,
    speed: 0,
    run: 0,
    bob: 0,
    pose: 'idle',
    poseMix: 0,
    poseT: 0
  }, extra);
}
