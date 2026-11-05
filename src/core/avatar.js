import * as THREE from 'three';

/** Outfit palette — length must match server COLORS. */
export const NET_COLORS = [
  0xff2e88, 0x00e5ff, 0x37ff8b, 0xffd166, 0x9b5cff,
  0xff6b35, 0x4dd2ff, 0xff5ec8, 0x8affc1, 0xffe066
];

export function neon(w, h, d, color, intensity = 2.2) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: intensity,
    roughness: 1, metalness: 0
  });
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}

export function shadowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

let _SHADOW_TEX = null;
export function getShadowTex() {
  if (!_SHADOW_TEX) _SHADOW_TEX = shadowTex();
  return _SHADOW_TEX;
}

export function makeAvatar(bodyColor, trimColor, withLight = true) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0.35 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a37c, roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 6, 16), bodyMat);
  torso.position.y = 1.32;
  group.add(torso);

  const chest = neon(0.34, 0.05, 0.02, trimColor, 2.6);
  chest.position.set(0, 1.42, 0.21);
  group.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), skinMat);
  head.position.y = 1.92;
  group.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.MeshStandardMaterial({ color: 0x08060c, roughness: 0.9 })
  );
  hair.position.y = 1.925;
  group.add(hair);

  const phones = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.028, 8, 22),
    new THREE.MeshStandardMaterial({
      color: 0x0a0a12, roughness: 0.4, metalness: 0.7,
      emissive: new THREE.Color(trimColor), emissiveIntensity: 1.4
    })
  );
  phones.position.y = 1.94;
  phones.rotation.y = Math.PI / 2;
  group.add(phones);

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.52, 4, 10), bodyMat);
  armL.position.set(-0.31, 1.36, 0);
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.31;
  group.add(armR);

  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.66, 4, 10), bodyMat);
  legL.position.set(-0.13, 0.42, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.13;
  group.add(legR);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({
      map: getShadowTex(), transparent: true, depthWrite: false, opacity: 0.9
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  let light = null;
  if (withLight) {
    light = new THREE.PointLight(trimColor, 6, 6, 2);
    light.position.set(0, 2.4, 0);
    group.add(light);
  }

  return {
    group, torso, chest, head, hair, phones, armL, armR, legL, legR, shadow, light,
    bodyMat, skinMat, headBaseY: 1.92, phase: Math.random() * 6.283
  };
}

export function bodyTint(trimHex) {
  return new THREE.Color(trimHex).multiplyScalar(0.34);
}

export function restyleRig(rig, trimHex) {
  rig.bodyMat.color.copy(bodyTint(trimHex));
  rig.chest.material.emissive.set(trimHex);
  rig.phones.material.emissive.set(trimHex);
  if (rig.light) rig.light.color.set(trimHex);
  rig.trim = trimHex;
}

export function peerColor(index) {
  return NET_COLORS[((index % NET_COLORS.length) + NET_COLORS.length) % NET_COLORS.length];
}

export function nameTag(text, hex) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const font = '600 34px "Helvetica Neue", Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const wCss = Math.ceil(measure.measureText(text).width) + 34;
  const hCss = 56;

  const c = document.createElement('canvas');
  c.width = Math.ceil(wCss * dpr);
  c.height = Math.ceil(hCss * dpr);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);

  const rgb = new THREE.Color(hex);
  const css = 'rgb(' + Math.round(rgb.r * 255) + ',' + Math.round(rgb.g * 255) + ',' + Math.round(rgb.b * 255) + ')';

  const r = 26;
  ctx.beginPath();
  ctx.moveTo(r, 4);
  ctx.arcTo(wCss - 4, 4, wCss - 4, hCss - 4, r);
  ctx.arcTo(wCss - 4, hCss - 4, 4, hCss - 4, r);
  ctx.arcTo(4, hCss - 4, 4, 4, r);
  ctx.arcTo(4, 4, wCss - 4, 4, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(6,4,12,0.74)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = css;
  ctx.stroke();

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = css;
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, wCss / 2, hCss / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false
  }));
  const hWorld = 0.30;
  sprite.scale.set(hWorld * (wCss / hCss), hWorld, 1);
  sprite.position.set(0, 2.42, 0);
  sprite.renderOrder = 20;
  return sprite;
}

export function cssOf(hex) {
  const c = new THREE.Color(hex);
  return 'rgb(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ')';
}
