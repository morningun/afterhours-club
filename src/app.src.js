import { THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from './imports.js';
import {
  neon, getShadowTex, makeAvatar, restyleRig, peerColor, nameTag
} from './core/avatar.js';
import { createKeyState, createLookControls, createJoystick } from './core/input.js';
import { collide as collideWorld } from './core/player-movement.js';
import { setupNicknameUI } from './core/nickname-ui.js';
import { poseFromNet, netPoseFields, isPose } from './core/pose.js';

/* ---------------- renderer ---------------- */
const app = document.getElementById('app');
const isMobile = matchMedia('(pointer:coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.6 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04030a);
scene.fog = new THREE.FogExp2(0x04030a, 0.032);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 3.2, 9);

/* soft environment so metal surfaces catch some light */
(function makeEnv(){
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#1a0f2e'); g.addColorStop(0.55, '#07060c'); g.addColorStop(1, '#14061c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
})();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), isMobile ? 0.5 : 0.62, 0.72, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------------- room constants ---------------- */
const HALF_W = 18, HALF_D = 13, ROOM_H = 11;

/* ---------------- lights ---------------- */
scene.add(new THREE.AmbientLight(0x1a1530, 0.5));
scene.add(new THREE.HemisphereLight(0x2a2050, 0x040308, 0.28));

const movingLights = [
  { light: new THREE.PointLight(0xff2e88, 22, 22, 2), r: 6.5, a: 0, sp: 0.5, y: 4.2 },
  { light: new THREE.PointLight(0x00e5ff, 22, 22, 2), r: 6.5, a: Math.PI * 0.66, sp: 0.42, y: 4.6 },
  { light: new THREE.PointLight(0x9b5cff, 18, 22, 2), r: 8.5, a: Math.PI * 1.33, sp: 0.33, y: 5.0 }
];
movingLights.forEach((m, i) => {
  m.light.position.set(Math.cos(m.a) * m.r, m.y, -2 + Math.sin(m.a) * m.r);
  scene.add(m.light);
});

const djSpotA = new THREE.SpotLight(0xffffff, 40, 26, 0.42, 0.85, 1.6);
djSpotA.position.set(-5.5, 9.6, -10);
djSpotA.target.position.set(0, 0, -3);
scene.add(djSpotA, djSpotA.target);

const djSpotB = new THREE.SpotLight(0xff2e88, 32, 26, 0.4, 0.9, 1.6);
djSpotB.position.set(5.5, 9.6, -10);
djSpotB.target.position.set(0, 0, -2);
scene.add(djSpotB, djSpotB.target);

/* ---------------- helpers ---------------- */
function box(w, h, d, color, opts = {}){
  const m = new THREE.MeshStandardMaterial(Object.assign({
    color: new THREE.Color(color), roughness: 0.6, metalness: 0.3
  }, opts));
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}
/* ---------------- floor & walls ---------------- */
const floorMat = new THREE.MeshStandardMaterial({ color: 0x050409, roughness: 0.42, metalness: 0.6, envMapIntensity: 0.5 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 4, HALF_D * 2 + 4), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0812, roughness: 0.92, metalness: 0.15 });
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, ROOM_H), wallMat);
backWall.position.set(0, ROOM_H / 2, -HALF_D);
scene.add(backWall);

const frontWall = backWall.clone();
frontWall.position.set(0, ROOM_H / 2, HALF_D);
frontWall.rotation.y = Math.PI;
scene.add(frontWall);

[-1, 1].forEach(s => {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(HALF_D * 2, ROOM_H), wallMat);
  w.position.set(s * HALF_W, ROOM_H / 2, 0);
  w.rotation.y = -s * Math.PI / 2;
  scene.add(w);
});

const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
  new THREE.MeshStandardMaterial({ color: 0x05040a, roughness: 1, metalness: 0 }));
ceil.position.y = ROOM_H;
ceil.rotation.x = Math.PI / 2;
scene.add(ceil);

/* neon strips along the walls */
const neonStrips = [];
const stripSpecs = [
  { color: 0xff2e88, pos: [0, 1.15, -HALF_D + 0.06], size: [30, 0.09, 0.04] },
  { color: 0x00e5ff, pos: [0, 5.4, -HALF_D + 0.06], size: [34, 0.07, 0.04] },
  { color: 0x9b5cff, pos: [-HALF_W + 0.06, 1.15, 0], size: [0.04, 0.09, 24] },
  { color: 0x9b5cff, pos: [HALF_W - 0.06, 1.15, 0], size: [0.04, 0.09, 24] },
  { color: 0xffd166, pos: [-HALF_W + 0.06, 6.2, -4], size: [0.04, 0.06, 12] },
  { color: 0x37ff8b, pos: [HALF_W - 0.06, 6.2, 2], size: [0.04, 0.06, 12] }
];
stripSpecs.forEach(s => {
  const m = neon(s.size[0], s.size[1], s.size[2], s.color, 2.6);
  m.position.set(s.pos[0], s.pos[1], s.pos[2]);
  scene.add(m);
  neonStrips.push(m);
});

/* wall accent point lights */
[[-11, 3, -12.4, 0xff2e88], [11, 3, -12.4, 0x00e5ff], [-17.4, 3, 4, 0x9b5cff], [17.4, 3, -4, 0xffd166]]
  .forEach(([x, y, z, c]) => {
    const l = new THREE.PointLight(c, 12, 12, 2);
    l.position.set(x, y, z);
    scene.add(l);
  });

/* ---------------- dance floor tiles ---------------- */
const TILE = 1.6, TILE_X = 10, TILE_Z = 7;
const tileGeo = new THREE.BoxGeometry(TILE * 0.94, 0.08, TILE * 0.94);
const tileMat = () => new THREE.MeshStandardMaterial({
  color: 0x0b0916, roughness: 0.25, metalness: 0.6,
  emissive: new THREE.Color(0x0a0616), emissiveIntensity: 0.6
});
const tiles = [];
const tileGroup = new THREE.Group();
const originX = -((TILE_X - 1) * TILE) / 2;
const originZ = -((TILE_Z - 1) * TILE) / 2 + 0.6;
for (let i = 0; i < TILE_X; i++){
  for (let j = 0; j < TILE_Z; j++){
    const t = new THREE.Mesh(tileGeo, tileMat());
    t.position.set(originX + i * TILE, 0.04, originZ + j * TILE);
    t.userData = { i, j, phase: (i + j) * 0.42, hueBase: (i / TILE_X) * 0.35 + (j / TILE_Z) * 0.22 };
    tiles.push(t);
    tileGroup.add(t);
  }
}
scene.add(tileGroup);
/* floor frame around dance area */
const frameW = TILE_X * TILE + 0.6, frameD = TILE_Z * TILE + 0.6;
[-1, 1].forEach(s => {
  const a = neon(frameW, 0.05, 0.06, 0xff2e88, 2.4);
  a.position.set(0, 0.05, 0.6 + s * frameD / 2);
  scene.add(a);
  const b = neon(0.06, 0.05, frameD, 0xff2e88, 2.4);
  b.position.set(s * frameW / 2, 0.05, 0.6);
  scene.add(b);
});

/* ---------------- DJ booth ---------------- */
const dj = new THREE.Group();
dj.position.set(0, 0, -11.2);
const boothBody = box(9, 1.15, 1.9, 0x0c0a14, { roughness: 0.5, metalness: 0.5 });
boothBody.position.y = 0.58;
dj.add(boothBody);
const boothTop = neon(9, 0.05, 1.95, 0xff2e88, 2.0);
boothTop.position.y = 1.17;
dj.add(boothTop);

/* turntables */
[-2.4, 2.4].forEach((x, idx) => {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 28),
    new THREE.MeshStandardMaterial({ color: 0x14121c, roughness: 0.35, metalness: 0.8 }));
  base.position.set(x, 1.24, 0);
  dj.add(base);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 32),
    new THREE.MeshStandardMaterial({ color: 0x08070d, roughness: 0.25, metalness: 0.9 }));
  disc.position.set(x, 1.31, 0);
  disc.userData.spin = idx === 0 ? 3.2 : -3.2;
  dj.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(idx ? 0x00e5ff : 0xff2e88), emissiveIntensity: 2.4 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 1.35, 0);
  dj.add(ring);
});
const mixer = box(1.5, 0.09, 0.85, 0x0e0c16, { roughness: 0.4, metalness: 0.7 });
mixer.position.set(0, 1.26, 0.1);
dj.add(mixer);

/* DJ character behind booth */
const djFigure = new THREE.Group();
const djBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 6, 14),
  new THREE.MeshStandardMaterial({ color: 0x0d0c14, roughness: 0.75, metalness: 0.1 }));
djBody.position.y = 1.5;
djFigure.add(djBody);
const djHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14),
  new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 0.6 }));
djHead.position.y = 2.08;
djFigure.add(djHead);
djFigure.position.set(0, 0, -12);
scene.add(djFigure);

/* ---------------- LED video wall ---------------- */
const wallCanvas = document.createElement('canvas');
wallCanvas.width = 512; wallCanvas.height = 256;
const wallCtx = wallCanvas.getContext('2d');
const wallTex = new THREE.CanvasTexture(wallCanvas);
wallTex.colorSpace = THREE.SRGBColorSpace;
const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(17, 8.5),
  new THREE.MeshBasicMaterial({ map: wallTex, opacity: 0.85, transparent: true }));
wallScreen.position.set(0, 6.1, -HALF_D + 0.12);
scene.add(wallScreen);

/* ---------------- bar ---------------- */
const bar = new THREE.Group();
bar.position.set(-15.2, 0, 4.5);
bar.rotation.y = Math.PI / 2;
const counter = box(7.4, 1.05, 1.05, 0x151020, { roughness: 0.35, metalness: 0.55 });
counter.position.y = 0.52;
bar.add(counter);
const barTop = box(7.6, 0.08, 1.15, 0x2a1f38, { roughness: 0.18, metalness: 0.9 });
barTop.position.y = 1.09;
bar.add(barTop);
const barEdge = neon(7.6, 0.03, 0.04, 0x00e5ff, 2.2);
barEdge.position.set(0, 0.72, 0.56);
bar.add(barEdge);
/* shelves and bottles */
[2.0, 3.1, 4.2].forEach((y, si) => {
  const shelf = box(7, 0.06, 0.4, 0x100d18, { roughness: 0.5, metalness: 0.4 });
  shelf.position.set(0, y, -0.62);
  bar.add(shelf);
  for (let i = 0; i < 16; i++){
    const h = 0.28 + Math.random() * 0.16;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, h, 8),
      new THREE.MeshStandardMaterial({
        color: [0x2ee6a8, 0xff2e88, 0x00e5ff, 0xffd166, 0xd9d2ff][i % 5],
        roughness: 0.15, metalness: 0.2,
        emissive: new THREE.Color([0x0a4a34, 0x4a0a26, 0x0a3a4a, 0x4a3a0a, 0x241e3a][i % 5]),
        emissiveIntensity: 1.4
      }));
    b.position.set(-3.1 + i * 0.41, y + h / 2 + 0.03, -0.62);
    bar.add(b);
  }
  if (si === 1) {
    const glow = new THREE.PointLight(0x00e5ff, 12, 7, 2);
    glow.position.set(0, y + 0.6, -0.2);
    bar.add(glow);
  }
});
scene.add(bar);

/* bar stools */
for (let i = 0; i < 5; i++){
  const s = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 18),
    new THREE.MeshStandardMaterial({ color: 0x1c0f1e, roughness: 0.5, metalness: 0.5 }));
  seat.position.y = 0.78;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.78, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a2a34, roughness: 0.3, metalness: 0.9 }));
  stem.position.y = 0.39;
  s.add(seat, stem);
  s.position.set(-12.4, 0, -1.8 + i * 1.7);
  scene.add(s);
}

/* ---------------- VJ / VIP lounge (right) ---------------- */
const lounge = new THREE.Group();
lounge.position.set(14.2, 0, 3.4);
const sofaMat = new THREE.MeshStandardMaterial({ color: 0x1a0f24, roughness: 0.85, metalness: 0.1 });
const sofa = box(4.6, 0.7, 1.7, 0x1a0f24, { roughness: 0.85 });
sofa.position.set(0, 0.35, 0);
lounge.add(sofa);
const sofaBack = box(4.6, 1.1, 0.4, 0x160c1e, { roughness: 0.85 });
sofaBack.position.set(0, 0.85, -0.65);
lounge.add(sofaBack);
const table = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 28),
  new THREE.MeshStandardMaterial({ color: 0x0e0c16, roughness: 0.2, metalness: 0.85 }));
table.position.set(0, 0.5, 1.9);
lounge.add(table);
const tableGlow = neon(0.02, 0.02, 0.02, 0x9b5cff, 3);
const ringLight = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.025, 8, 44),
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0x9b5cff), emissiveIntensity: 2.6 }));
ringLight.rotation.x = Math.PI / 2;
ringLight.position.set(0, 0.5, 1.9);
lounge.add(ringLight, tableGlow);
scene.add(lounge);

/* ---------------- hanging lamps ---------------- */
for (let i = 0; i < 7; i++){
  const x = -12 + i * 4;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x22202a, roughness: 0.8 }));
  cord.position.set(x, ROOM_H - 1.6, -6.2);
  scene.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.42, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x14111c, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }));
  shade.position.set(x, ROOM_H - 3.2, -6.2);
  scene.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd8a8 }));
  bulb.position.set(x, ROOM_H - 3.36, -6.2);
  scene.add(bulb);
  const pl = new THREE.PointLight(0xffb46b, 5, 7, 2);
  pl.position.copy(bulb.position);
  scene.add(pl);
}

/* ---------------- mirror ball ---------------- */
const mirrorBall = new THREE.Mesh(new THREE.SphereGeometry(0.85, 26, 20),
  new THREE.MeshStandardMaterial({
    color: 0xb8bdd6, roughness: 0.06, metalness: 1, flatShading: true,
    envMapIntensity: 2.2
  }));
mirrorBall.position.set(0, ROOM_H - 1.7, 0.5);
scene.add(mirrorBall);
const ballRod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 6),
  new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.5, metalness: 0.8 }));
ballRod.position.set(0, ROOM_H - 0.85, 0.5);
scene.add(ballRod);
const ballLight = new THREE.PointLight(0xffe9ff, 26, 18, 2);
ballLight.position.copy(mirrorBall.position);
scene.add(ballLight);

/* ---------------- lasers / moving head beams ---------------- */
const beams = [];
for (let i = 0; i < 4; i++){
  const geo = new THREE.ConeGeometry(0.75, 15, 20, 1, true);
  geo.translate(0, -7.5, 0);
  const mat = new THREE.MeshBasicMaterial({
    color: [0xff2e88, 0x00e5ff, 0x9b5cff, 0x37ff8b][i],
    transparent: true, opacity: 0.075, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const beam = new THREE.Mesh(geo, mat);
  beam.position.set(-7.5 + i * 5, ROOM_H - 0.6, -8.5);
  scene.add(beam);
  beams.push({ mesh: beam, phase: i * 1.7, color: mat.color.clone() });
}

/* ---------------- crowd ---------------- */
const crowd = [];
const skinTones = [0xe8b48f, 0xc98f66, 0x8a5a3b, 0xf0c9a8, 0x6e4530];
const outfits = [0x1a1226, 0x241028, 0x101a24, 0x2a1420, 0x0f1622, 0x301a2a];

function makeDancer(scale = 1){
  const g = new THREE.Group();
  const outfit = outfits[Math.floor(Math.random() * outfits.length)];
  const skin = skinTones[Math.floor(Math.random() * skinTones.length)];
  const bodyMat = new THREE.MeshStandardMaterial({ color: outfit, roughness: 0.72, metalness: 0.15 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, metalness: 0.05 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 5, 12), bodyMat);
  torso.position.y = 1.28;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), skinMat);
  head.position.y = 1.79;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.163, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    new THREE.MeshStandardMaterial({ color: 0x0a0810, roughness: 0.85 }));
  hair.position.y = 1.80;
  g.add(hair);

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.46, 4, 8), skinMat);
  armL.position.set(-0.27, 1.34, 0);
  armL.rotation.z = 0.18;
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.27;
  armR.rotation.z = -0.18;
  g.add(armR);

  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.6, 4, 8), bodyMat);
  legL.position.set(-0.11, 0.42, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.11;
  g.add(legR);

  /* glow wristband */
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 14),
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color([0xff2e88, 0x00e5ff, 0x37ff8b, 0xffd166][Math.floor(Math.random() * 4)]),
      emissiveIntensity: 3
    }));
  band.rotation.x = Math.PI / 2;
  band.position.set(0.28, 1.66, 0);
  g.add(band);

  const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95),
    new THREE.MeshBasicMaterial({ map: getShadowTex(), transparent: true, depthWrite: false, opacity: 0.85 }));
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.015;
  g.add(sh);

  g.scale.setScalar(scale);
  g.userData = {
    armL, armR, legL, legR, head, torso,
    phase: Math.random() * Math.PI * 2,
    speed: 1.6 + Math.random() * 1.4,
    bounce: 0.9 + Math.random() * 0.9,
    sway: 0.12 + Math.random() * 0.18,
    energy: 0.6 + Math.random() * 0.6
  };
  return g;
}

/* dancers on the floor */
const dancerSpots = [];
for (let i = 0; i < 26; i++){
  const gx = (Math.random() - 0.5) * (TILE_X * TILE - 1.5);
  const gz = (Math.random() - 0.5) * (TILE_Z * TILE - 1.5) + 0.6;
  dancerSpots.push([gx, gz]);
}
dancerSpots.forEach(([x, z]) => {
  const d = makeDancer(0.95 + Math.random() * 0.15);
  d.position.set(x, 0, z);
  d.rotation.y = Math.random() * Math.PI * 2;
  scene.add(d);
  crowd.push({ obj: d, home: new THREE.Vector3(x, 0, z), radius: 0.35 + Math.random() * 0.4, sp: 0.15 + Math.random() * 0.3, a: Math.random() * 6.28 });
});

/* people at the bar */
for (let i = 0; i < 6; i++){
  const d = makeDancer(0.95 + Math.random() * 0.12);
  d.position.set(-13.1, 0, -1.6 + i * 1.55);
  d.rotation.y = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  scene.add(d);
  crowd.push({ obj: d, home: d.position.clone(), radius: 0.12, sp: 0.4, a: Math.random() * 6.28, static: true });
}

/* lounge guests */
for (let i = 0; i < 3; i++){
  const d = makeDancer(1.0);
  d.position.set(12.5 + i * 1.4, 0.72, 3.4 + (i % 2 ? 0.1 : -0.1));
  d.rotation.y = Math.PI + (Math.random() - 0.5) * 0.4;
  d.scale.setScalar(0.98);
  scene.add(d);
  crowd.push({ obj: d, home: d.position.clone(), radius: 0, sp: 0.5, a: Math.random() * 6.28, static: true, seated: true });
}

/* ---------------- avatars (from src/core/avatar.js) ---------------- */

/* the local player uses the same body as everyone else, just its own colours */
const playerRig = makeAvatar(0x150e22, 0xff2e88, true);
const player = playerRig.group;
const rimLight = playerRig.light;

let playerTag = null;

player.position.set(0, 0, 5.2);
scene.add(player);

/* aliases kept from the single-body build so the animation code below reads the same */
const pTorso = playerRig.torso;
const pHead = playerRig.head;
const pChest = playerRig.chest;
const pArmL = playerRig.armL;
const pArmR = playerRig.armR;
const pLegL = playerRig.legL;
const pLegR = playerRig.legR;

const playerState = {
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  speed: 0,
  run: 0,
  bob: 0,
  pose: 'idle',
  poseMix: 0,
  poseT: 0
};

/* ---------------- input ---------------- */
const keys = createKeyState({ onRun: v => { playerState.run = v; } });

/* pose toggle — club F = dance */
const danceBtn = document.getElementById('dance');
function setPose(pose){
  if (!isPose(pose)) pose = 'idle';
  playerState.pose = pose;
  if (pose === 'dance') playerState.poseT = 0;
  const on = pose === 'dance';
  danceBtn.classList.toggle('on', on);
  danceBtn.textContent = on ? 'DANCING' : 'DANCE';
}
danceBtn.addEventListener('click', () => setPose(playerState.pose === 'dance' ? 'idle' : 'dance'));
addEventListener('keydown', e => {
  if (e.code === 'KeyF' && !e.repeat) setPose(playerState.pose === 'dance' ? 'idle' : 'dance');
});

/* ---------------- presence: other people in the room ---------------- */
const LOBBY_URL = (() => {
  const q = new URLSearchParams(location.search).get('lobby');
  if (q) return q;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://127.0.0.1:8080';
  return 'wss://afterhours-lobby.onrender.com';
})();

const NET = {
  ws: null, id: null, name: '', online: false,
  tries: 0, retryAt: 0, lastSent: 0, manualClose: false
};
const peers = new Map();

const countText = document.getElementById('onlineText');
const onlineBox = document.getElementById('online');

function setNetState(state, n){
  const cls = state === 'online' ? '' : (state === 'connecting' ? 'warn' : 'off');
  onlineBox.className = cls;
  const people = Math.max(1, n || peers.size + 1);
  if (state === 'online') countText.textContent = '지금 ' + people + '명 함께 있어요';
  else if (state === 'connecting') countText.textContent = '연결 중… · 혼자 걷기는 그대로';
  else countText.textContent = '연결 끊김 · 다시 연결 중';
}
setNetState('connecting', 1);

function addPeer(s){
  if (!s || peers.has(s.id) || s.id === NET.id) return;
  const trim = peerColor(s.color || 0);
  const body = new THREE.Color(trim).multiplyScalar(0.34);
  const rig = makeAvatar(body.getHex(), trim, false);
  const tag = nameTag(s.name || '게스트', trim);
  rig.group.add(tag);
  rig.group.position.set(s.x || 0, 0, s.z || 0);
  rig.group.rotation.y = s.yaw || 0;
  scene.add(rig.group);

  peers.set(s.id, {
    id: s.id, name: s.name || '게스트', rig, tag,
    x: s.x || 0, z: s.z || 0, yaw: s.yaw || 0,
    tx: s.x || 0, tz: s.z || 0, tyaw: s.yaw || 0,
    on: s.on ? 1 : 0, pose: poseFromNet(s),
    speed: 0, bob: 0, poseMix: 0, poseT: Math.random() * 4.5
  });
  setNetState('online', peers.size + 1);
}

function retagPeer(p, name, colorHex){
  if (p.tag){
    p.rig.group.remove(p.tag);
    if (p.tag.material.map) p.tag.material.map.dispose();
    p.tag.material.dispose();
  }
  p.tag = nameTag(name, colorHex);
  p.rig.group.add(p.tag);
  p.name = name;
}

function removePeer(id){
  const p = peers.get(id);
  if (!p) return;
  scene.remove(p.rig.group);
  p.rig.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material){
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
  peers.delete(id);
  setNetState(NET.online ? 'online' : 'offline', peers.size + 1);
}

function clearPeers(){
  for (const id of [...peers.keys()]) removePeer(id);
}

function danceSeg(s, beat){
  const out = { legLx: 0, legRx: 0, armLx: 0, armRx: 0, armLz: 0, armRz: 0,
    torsoZ: 0, torsoY: 0, bodyY: 0, headY: 1.92, yaw: 0 };
  const seg = Math.floor(s / 4.5) % 3;
  if (seg === 0){
    const p = Math.sin(s * 5.4);
    out.armLx = -2.15 + p * 0.42;
    out.armRx = -2.15 - p * 0.42;
    out.armLz = 0.5 + beat * 0.4;
    out.armRz = -0.5 - beat * 0.4;
    out.bodyY = Math.abs(p) * 0.085 * (0.6 + beat * 0.6);
    out.torsoZ = Math.sin(s * 2.7) * 0.09;
    out.headY = 1.92 + p * 0.018;
  } else if (seg === 1){
    const p = Math.sin(s * 3.2);
    out.armLx = -0.55 + p * 0.45;
    out.armRx = -0.55 - p * 0.45;
    out.armLz = 1.2 + p * 0.22;
    out.armRz = -1.2 - p * 0.22;
    out.torsoZ = p * 0.2;
    out.torsoY = p * 0.16;
    out.yaw = p * 0.12;
    out.legLx = p * 0.16;
    out.legRx = -p * 0.16;
    out.bodyY = Math.abs(p) * 0.045;
  } else {
    const p = Math.sin(s * 6.2);
    out.armLx = -1.0 + p * 0.5;
    out.armRx = -1.0 - p * 0.5;
    out.armLz = 0.85;
    out.armRz = -0.85;
    out.legLx = p * 0.5;
    out.legRx = -p * 0.5;
    out.torsoY = p * 0.22;
    out.torsoZ = Math.sin(s * 3.1) * 0.1;
    out.yaw = Math.sin(s * 3.1) * 0.32;
    out.bodyY = Math.abs(p) * 0.065;
    out.headY = 1.92 + p * 0.022;
  }
  return out;
}

function updatePeer(p, dt, el, beat){
  const k = 1 - Math.pow(0.002, dt);
  const ox = p.x, oz = p.z;
  p.x += (p.tx - p.x) * k;
  p.z += (p.tz - p.z) * k;
  const moved = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 0.0001);
  p.speed = THREE.MathUtils.damp(p.speed, Math.min(moved, 6), 9, dt);

  let diff = ((p.tyaw - p.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
  p.yaw += diff * Math.min(1, dt * 10);

  const moving = p.on || p.speed > 0.2;
  p.bob += dt * (moving ? Math.max(p.speed, 1.4) * 3.4 : 0);
  const swing = Math.sin(p.bob) * Math.min(1, Math.max(p.speed, 1) / 3);

  p.poseMix = THREE.MathUtils.damp(p.poseMix, (p.pose === 'dance' && !moving) ? 1 : 0, 7, dt);

  const idle = Math.abs(Math.sin(el + p.rig.phase)) * (0.02 + beat * 0.025);
  let legLx = swing * 0.85, legRx = -swing * 0.85;
  let armLx = -swing * 0.7, armRx = swing * 0.7;
  let armLz = 0.12, armRz = -0.12;
  let torsoZ = 0, torsoY = 0;
  let bodyY = moving ? Math.abs(Math.sin(p.bob)) * 0.055 : idle;
  let headY = 1.92, yawExtra = 0;

  if (p.poseMix > 0.002){
    p.poseT += dt;
    const d = danceSeg(p.poseT, beat);
    const m = p.poseMix;
    legLx = THREE.MathUtils.lerp(legLx, d.legLx, m);
    legRx = THREE.MathUtils.lerp(legRx, d.legRx, m);
    armLx = THREE.MathUtils.lerp(armLx, d.armLx, m);
    armRx = THREE.MathUtils.lerp(armRx, d.armRx, m);
    armLz = THREE.MathUtils.lerp(armLz, d.armLz, m);
    armRz = THREE.MathUtils.lerp(armRz, d.armRz, m);
    torsoZ = THREE.MathUtils.lerp(torsoZ, d.torsoZ, m);
    torsoY = THREE.MathUtils.lerp(torsoY, d.torsoY, m);
    bodyY = THREE.MathUtils.lerp(bodyY, d.bodyY, m);
    headY = THREE.MathUtils.lerp(headY, d.headY, m);
    yawExtra = d.yaw * m;
  }

  const rig = p.rig;
  rig.legL.rotation.x = legLx;
  rig.legR.rotation.x = legRx;
  rig.armL.rotation.x = armLx;
  rig.armR.rotation.x = armRx;
  rig.armL.rotation.z = armLz;
  rig.armR.rotation.z = armRz;
  rig.torso.rotation.z = torsoZ;
  rig.torso.rotation.y = torsoY;
  rig.head.position.y = headY;
  rig.group.position.set(p.x, bodyY, p.z);
  rig.group.rotation.y = p.yaw + yawExtra;
  rig.chest.material.emissiveIntensity = 1.6 + beat * 2.4 + p.poseMix * 1.6;
  if (rig.light) rig.light.intensity = 3.4 + beat * 4.5;
}

/* --- socket plumbing --- */
function sendHi(){
  const ws = NET.ws;
  if (!ws || ws.readyState !== 1) return;
  try {
    const hi = { t: 'hi', x: player.position.x, z: player.position.z, yaw: playerState.yaw };
    if (NET.name) hi.name = NET.name;
    ws.send(JSON.stringify(hi));
  } catch (e) { /* ignore */ }
}

function handleNet(m){
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'welcome'){
    NET.id = m.id;
    NET.name = m.name;
    NET.online = true;
    NET.tries = 0;
    clearPeers();
    (m.peers || []).forEach(addPeer);
    setNetState('online', peers.size + 1);
    if (ME.name && (ME.name !== m.name || ME.color !== m.color)){
      sendProfile(ME.name, ME.color);
    } else {
      applyMe(m.name, m.color, false);
    }
  } else if (m.t === 'you'){
    NET.name = m.name;
    NET.online = true;
    if (NET.id) applyMe(m.name, m.color, true);
  } else if (m.t === 'join'){
    addPeer(m);
  } else if (m.t === 'm'){
    const p = peers.get(m.id);
    if (!p){ addPeer(m); return; }
    p.tx = m.x; p.tz = m.z; p.tyaw = m.yaw;
    p.on = m.on ? 1 : 0;
    p.pose = poseFromNet(m);
  } else if (m.t === 'set'){
    const p = peers.get(m.id);
    if (!p){ addPeer(m); return; }
    const trim = peerColor(m.color || 0);
    if (m.name) retagPeer(p, m.name, trim);
    restyleRig(p.rig, trim);
  } else if (m.t === 'left'){
    removePeer(m.id);
  } else if (m.t === 'count'){
    NET.online = true;
    setNetState('online', m.n);
  }
}

function connectNet(){
  if (NET.ws) return;
  setNetState(NET.tries ? 'offline' : 'connecting', peers.size + 1);
  let ws;
  try { ws = new WebSocket(LOBBY_URL); }
  catch (e){ scheduleReconnect(); return; }
  NET.ws = ws;

  const openTimer = setTimeout(() => {
    if (ws.readyState === 0){ try { ws.close(); } catch (e) {} }
  }, 7000);

  ws.onopen = () => {
    clearTimeout(openTimer);
    sendHi();
  };
  ws.onmessage = ev => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    handleNet(m);
  };
  ws.onclose = () => {
    clearTimeout(openTimer);
    if (NET.ws === ws) NET.ws = null;
    NET.online = false;
    NET.id = null;
    clearPeers();
    setNetState('offline', 1);
    scheduleReconnect();
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function scheduleReconnect(){
  NET.tries = Math.min(NET.tries + 1, 6);
  const wait = Math.min(9000, 1200 * NET.tries);
  NET.retryAt = performance.now() + wait;
}

function pumpNet(){
  if (!NET.ws || NET.ws.readyState !== 1 || !NET.id) return;
  const now = performance.now();
  if (now - NET.lastSent < 80) return;
  NET.lastSent = now;
  try {
    NET.ws.send(JSON.stringify({
      t: 'm',
      x: +player.position.x.toFixed(2),
      z: +player.position.z.toFixed(2),
      yaw: +playerState.yaw.toFixed(2),
      on: playerState.speed > 0.15 ? 1 : 0,
      ...netPoseFields(playerState.pose)
    }));
  } catch (e) { /* ignore */ }
}

function updateNet(dt, el, beat){
  if (!NET.ws && performance.now() >= NET.retryAt) connectNet();
  pumpNet();
  for (const p of peers.values()) updatePeer(p, dt, el, beat);
}

addEventListener('online', () => { NET.tries = 0; if (!NET.ws) connectNet(); });
addEventListener('pagehide', () => {
  if (NET.ws && NET.ws.readyState === 1){
    try { NET.ws.send(JSON.stringify({ t: 'bye' })); } catch (e) {}
  }
});
connectNet();

/* ---------------- my nickname + outfit ---------------- */
function sendProfile(name, colorIdx){
  const ws = NET.ws;
  if (!ws || ws.readyState !== 1 || !NET.id) return false;
  try {
    ws.send(JSON.stringify({ t: 'set', name, color: colorIdx }));
    return true;
  } catch (e) { return false; }
}

const nick = setupNicknameUI({
  storageKeyPrefix: 'afterhours',
  playerRig,
  player,
  getPlayerTag: () => playerTag,
  setPlayerTag: (t) => { playerTag = t; },
  sendProfile,
  onApplied: (me) => { if (me.name) NET.name = me.name; }
});
const ME = nick.ME;
const applyMe = nick.applyMe;
const retagPlayer = nick.retagPlayer;
/* sync NET.name if restore found a saved nickname */
if (ME.name) NET.name = ME.name;

/* mouse / touch look + virtual joystick */
const canvasEl = renderer.domElement;
const look = createLookControls(canvasEl);
const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
const moveVec = createJoystick(stick, knob);

/* ---------------- procedural audio ---------------- */
const audio = { ctx: null, master: null, on: false, next: 0, step: 0, bpm: 124, timer: null };
const soundBtn = document.getElementById('sound');

function initAudio(){
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  const ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = 0.0;
  master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 6;
  comp.connect(master);
  audio.ctx = ctx; audio.master = master; audio.bus = comp;
  audio.next = ctx.currentTime + 0.12;
  audio.on = true;
  master.gain.linearRampToValueAtTime(0.72, ctx.currentTime + 1.6);
  audio.timer = setInterval(schedule, 40);
  schedule();
  return true;
}
function env(g, t, a, d, peak){
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function kick(t){
  const ctx = audio.ctx;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
  env(g, t, 0.004, 0.30, 0.9);
  o.connect(g); g.connect(audio.bus);
  o.start(t); o.stop(t + 0.36);
}
function hat(t, open){
  const ctx = audio.ctx;
  const len = open ? 0.16 : 0.045;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7800;
  const g = ctx.createGain(); env(g, t, 0.002, len, open ? 0.22 : 0.13);
  src.connect(hp); hp.connect(g); g.connect(audio.bus);
  src.start(t);
}
function clap(t){
  const ctx = audio.ctx;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.16), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.1;
  const g = ctx.createGain(); env(g, t, 0.003, 0.14, 0.34);
  src.connect(bp); bp.connect(g); g.connect(audio.bus);
  src.start(t);
}
const bassNotes = [45, 45, 48, 43];
function bass(t, midi){
  const ctx = audio.ctx;
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o2.type = 'sine';
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  o.frequency.value = f; o2.frequency.value = f / 2;
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(420, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.22);
  lp.Q.value = 7;
  env(g, t, 0.01, 0.26, 0.22);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(audio.bus);
  o.start(t); o2.start(t); o.stop(t + 0.3); o2.stop(t + 0.3);
}
function stab(t, chord){
  const ctx = audio.ctx;
  chord.forEach(m => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    env(g, t, 0.012, 0.5, 0.055);
    o.connect(g); g.connect(audio.bus);
    o.start(t); o.stop(t + 0.56);
  });
}
const chords = [[69, 72, 76, 79], [67, 71, 74, 78], [65, 69, 72, 76], [64, 67, 71, 74]];
function schedule(){
  const ctx = audio.ctx;
  if (!ctx) return;
  const spb = 60 / audio.bpm / 4; /* 16th */
  while (audio.next < ctx.currentTime + 0.2){
    const t = audio.next;
    const s = audio.step % 16;
    const bar = Math.floor(audio.step / 16) % 4;
    if (s % 4 === 0) kick(t);
    if (s === 4 || s === 12) clap(t);
    if (s % 2 === 0) hat(t, s % 8 === 6);
    else if (Math.random() < 0.3) hat(t, false);
    if (s === 3 || s === 7 || s === 11 || s === 14) bass(t, bassNotes[bar]);
    if (s === 0) stab(t, chords[bar]);
    audio.step++;
    audio.next += spb;
  }
}
soundBtn.addEventListener('click', async () => {
  if (!audio.ctx){
    if (!initAudio()) return;
    soundBtn.textContent = 'SOUND ON';
    soundBtn.style.borderColor = 'rgba(255,46,136,.7)';
    soundBtn.style.background = 'rgba(255,46,136,.2)';
    document.getElementById('hint').classList.remove('hide');
    return;
  }
  if (audio.on){
    audio.on = false;
    audio.master.gain.cancelScheduledValues(audio.ctx.currentTime);
    audio.master.gain.linearRampToValueAtTime(0.0001, audio.ctx.currentTime + 0.4);
    clearInterval(audio.timer);
    soundBtn.textContent = 'SOUND OFF';
    soundBtn.style.borderColor = 'rgba(255,255,255,.18)';
    soundBtn.style.background = 'rgba(255,255,255,.05)';
  } else {
    await audio.ctx.resume();
    audio.on = true;
    audio.next = audio.ctx.currentTime + 0.08;
    audio.master.gain.cancelScheduledValues(audio.ctx.currentTime);
    audio.master.gain.linearRampToValueAtTime(0.72, audio.ctx.currentTime + 0.5);
    audio.timer = setInterval(schedule, 40);
    schedule();
    soundBtn.textContent = 'SOUND ON';
    soundBtn.style.borderColor = 'rgba(255,46,136,.7)';
    soundBtn.style.background = 'rgba(255,46,136,.2)';
  }
});

/* ---------------- collision ---------------- */
const obstacles = [
  { x: 0, z: -11.2, w: 4.7, d: 1.2 },      /* DJ booth */
  { x: -15.2, z: 4.5, w: 0.85, d: 3.9 },   /* bar counter */
  { x: 14.2, z: 3.0, w: 2.5, d: 1.1 },     /* lounge sofa */
  { x: 14.2, z: 6.9, w: 0.85, d: 0.85 }    /* lounge table */
];
function collide(p, r){
  collideWorld(p, r, { halfW: HALF_W, halfD: HALF_D }, obstacles);
}

/* ---------------- LED wall drawing ---------------- */
let wallTime = 0;
function drawWall(t){
  const w = wallCanvas.width, h = wallCanvas.height;
  const ctx = wallCtx;
  ctx.fillStyle = '#05030b';
  ctx.fillRect(0, 0, w, h);

  const hue = (t * 22) % 360;
  const g = ctx.createLinearGradient(0, h, w, 0);
  g.addColorStop(0, `hsla(${hue}, 95%, 55%, 0.85)`);
  g.addColorStop(0.5, `hsla(${(hue + 90) % 360}, 95%, 58%, 0.45)`);
  g.addColorStop(1, `hsla(${(hue + 200) % 360}, 95%, 60%, 0.8)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* concentric pulsing rings */
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++){
    const r = ((t * 90 + i * 62) % 340);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${(hue + i * 55) % 360}, 100%, 65%, ${Math.max(0, 1 - r / 340) * 0.55})`;
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  /* horizontal scan bars */
  for (let y = 0; y < h; y += 8){
    const a = 0.06 + 0.06 * Math.sin(y * 0.09 + t * 3.2);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(0, y, w, 4);
  }
  /* equalizer */
  const bars = 26;
  const bw = w / bars;
  for (let i = 0; i < bars; i++){
    const amp = (Math.sin(t * 3.1 + i * 0.7) * 0.5 + 0.5) * (Math.sin(t * 1.3 + i) * 0.35 + 0.65);
    const bh = 10 + amp * h * 0.42;
    ctx.fillStyle = `hsla(${(hue + i * 9) % 360}, 100%, 66%, 0.85)`;
    ctx.fillRect(i * bw + 3, h - bh, bw - 6, bh);
  }
  ctx.globalCompositeOperation = 'source-over';

  /* big type */
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 74px Helvetica, Arial, sans-serif';
  ctx.letterSpacing = '14px';
  ctx.textAlign = 'center';
  ctx.fillText('AFTERHOURS', w / 2, h * 0.46 + Math.sin(t * 1.4) * 6);
  ctx.font = '400 22px Helvetica, Arial, sans-serif';
  ctx.globalAlpha = 0.55;
  ctx.fillText('SEOUL  ·  UNDERGROUND  ·  VOL. 07', w / 2, h * 0.46 + 44);
  ctx.restore();

  wallTex.needsUpdate = true;
}

/* ---------------- dance animation ---------------- */
function animateDancer(d, t, beat){
  const u = d.userData;
  const ph = u.phase;
  const bounce = Math.abs(Math.sin(t * u.speed + ph));
  const amp = u.bounce * u.energy * (0.45 + beat * 0.55);

  d.position.y = u.baseY + bounce * 0.055 * amp;
  d.rotation.z = Math.sin(t * u.speed * 0.5 + ph) * u.sway * 0.5;
  d.rotation.y = u.baseRotY + Math.sin(t * u.speed * 0.34 + ph * 1.3) * 0.34;

  u.armL.rotation.z = 0.2 + Math.sin(t * u.speed + ph) * (0.5 + beat * 0.9) * u.energy;
  u.armR.rotation.z = -0.2 - Math.sin(t * u.speed + ph + 0.8) * (0.5 + beat * 0.9) * u.energy;
  u.armL.rotation.x = Math.cos(t * u.speed * 0.8 + ph) * 0.35;
  u.armR.rotation.x = Math.cos(t * u.speed * 0.8 + ph + 1.1) * 0.35;

  u.legL.rotation.z = Math.sin(t * u.speed * 0.7 + ph) * 0.09;
  u.legR.rotation.z = -Math.sin(t * u.speed * 0.7 + ph) * 0.09;
  u.head.rotation.z = Math.sin(t * u.speed * 0.6 + ph) * 0.14;
}
crowd.forEach(c => { c.obj.userData.baseY = c.obj.position.y; c.obj.userData.baseRotY = c.obj.rotation.y; });

/* ---------------- camera ---------------- */
const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const camPos = new THREE.Vector3(player.position.x, 3.4, player.position.z + 6.5);
camera.position.copy(camPos);
const smoothTarget = new THREE.Vector3(0, 1.6, 0);

/* ---------------- resize ---------------- */
function onResize(){
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
}
addEventListener('resize', onResize);

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();
let elapsed = 0;
const tmpDir = new THREE.Vector3();
const tileColors = tiles.map((t, i) => new THREE.Color().setHSL((0.85 + (i % 7) * 0.09) % 1, 0.9, 0.55));

function tick(){
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  const beat = (Math.sin(elapsed * Math.PI * 2 * (audio.bpm / 60)) * 0.5 + 0.5);

  /* --- movement input --- */
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  ix += moveVec.x; iz += moveVec.y;
  const mag = Math.min(1, Math.hypot(ix, iz));
  if (mag > 0.02){ ix /= Math.max(mag, 0.0001); iz /= Math.max(mag, 0.0001); }
  else { ix = 0; iz = 0; }
  const walking = mag > 0.05;
  if (walking && playerState.pose === 'dance') setPose('idle');
  const targetSpeed = walking ? (playerState.run ? 5.4 : 2.7) * Math.min(1, mag * 1.4) : 0;
  playerState.speed = THREE.MathUtils.damp(playerState.speed, targetSpeed, 9, dt);

  /* move relative to camera yaw */
  const yaw = look.yaw;
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  tmpDir.set(fwdX * (-iz) + rightX * ix, 0, fwdZ * (-iz) + rightZ * ix);
  if (tmpDir.lengthSq() > 0){
    tmpDir.normalize();
    player.position.x += tmpDir.x * playerState.speed * dt;
    player.position.z += tmpDir.z * playerState.speed * dt;
    collide(player.position, 0.42);
    const wantYaw = Math.atan2(tmpDir.x, tmpDir.z);
    let diff = ((wantYaw - playerState.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    playerState.yaw += diff * Math.min(1, dt * 12);
  }

  /* walk cycle + idle groove, blended with the dance routine */
  const moving = playerState.speed > 0.15;
  playerState.bob += dt * (moving ? playerState.speed * 3.4 : 0);
  const swing = Math.sin(playerState.bob) * Math.min(1, playerState.speed / 3);

  playerState.poseMix = THREE.MathUtils.damp(
    playerState.poseMix, (playerState.pose === 'dance' && !moving) ? 1 : 0, 7, dt);

  const idle = Math.abs(Math.sin(elapsed * 2.6)) * (0.02 + beat * 0.025);

  let legLx = swing * 0.85, legRx = -swing * 0.85;
  let armLx = -swing * 0.7, armRx = swing * 0.7;
  let armLz = 0.12 + (moving ? 0 : Math.sin(elapsed * 2.6) * 0.16 * beat);
  let armRz = -0.12 - (moving ? 0 : Math.sin(elapsed * 2.6 + 1) * 0.16 * beat);
  let torsoZ = moving ? 0 : Math.sin(elapsed * 1.9) * 0.035;
  let torsoY = moving ? 0 : Math.sin(elapsed * 1.4) * 0.05;
  let bodyY = moving ? Math.abs(Math.sin(playerState.bob)) * 0.055 : idle;
  let headY = 1.92 + (moving ? 0 : Math.sin(elapsed * 2.6) * 0.015);
  let yawExtra = 0;

  const mix = playerState.poseMix;
  if (mix > 0.002){
    playerState.poseT += dt;
    const s = playerState.poseT;
    const seg = Math.floor(s / 4.5) % 3;
    let dLegLx = 0, dLegRx = 0, dArmLx = 0, dArmRx = 0;
    let dArmLz = 0, dArmRz = 0, dTorsoZ = 0, dTorsoY = 0, dBodyY = 0, dHeadY = 1.92, dYaw = 0;

    if (seg === 0){
      /* arms up, pumping to the kick */
      const p = Math.sin(s * 5.4);
      dArmLx = -2.15 + p * 0.42;
      dArmRx = -2.15 - p * 0.42;
      dArmLz = 0.5 + beat * 0.4;
      dArmRz = -0.5 - beat * 0.4;
      dBodyY = Math.abs(Math.sin(s * 5.4)) * 0.085 * (0.6 + beat * 0.6);
      dTorsoZ = Math.sin(s * 2.7) * 0.09;
      dHeadY = 1.92 + Math.sin(s * 5.4) * 0.018;
    } else if (seg === 1){
      /* side sway, arms swinging wide */
      const p = Math.sin(s * 3.2);
      dArmLx = -0.55 + p * 0.45;
      dArmRx = -0.55 - p * 0.45;
      dArmLz = 1.2 + p * 0.22;
      dArmRz = -1.2 - p * 0.22;
      dTorsoZ = p * 0.2;
      dTorsoY = p * 0.16;
      dYaw = p * 0.12;
      dLegLx = p * 0.16;
      dLegRx = -p * 0.16;
      dBodyY = Math.abs(p) * 0.045;
    } else {
      /* footwork twist with low arm swing */
      const p = Math.sin(s * 6.2);
      dArmLx = -1.0 + p * 0.5;
      dArmRx = -1.0 - p * 0.5;
      dArmLz = 0.85;
      dArmRz = -0.85;
      dLegLx = p * 0.5;
      dLegRx = -p * 0.5;
      dTorsoY = p * 0.22;
      dTorsoZ = Math.sin(s * 3.1) * 0.1;
      dYaw = Math.sin(s * 3.1) * 0.32;
      dBodyY = Math.abs(Math.sin(s * 6.2)) * 0.065;
      dHeadY = 1.92 + Math.sin(s * 6.2) * 0.022;
    }

    legLx = THREE.MathUtils.lerp(legLx, dLegLx, mix);
    legRx = THREE.MathUtils.lerp(legRx, dLegRx, mix);
    armLx = THREE.MathUtils.lerp(armLx, dArmLx, mix);
    armRx = THREE.MathUtils.lerp(armRx, dArmRx, mix);
    armLz = THREE.MathUtils.lerp(armLz, dArmLz, mix);
    armRz = THREE.MathUtils.lerp(armRz, dArmRz, mix);
    torsoZ = THREE.MathUtils.lerp(torsoZ, dTorsoZ, mix);
    torsoY = THREE.MathUtils.lerp(torsoY, dTorsoY, mix);
    bodyY = THREE.MathUtils.lerp(bodyY, dBodyY, mix);
    headY = THREE.MathUtils.lerp(headY, dHeadY, mix);
    yawExtra = dYaw * mix;
  }

  pLegL.rotation.x = legLx;
  pLegR.rotation.x = legRx;
  pArmL.rotation.x = armLx;
  pArmR.rotation.x = armRx;
  pArmL.rotation.z = armLz;
  pArmR.rotation.z = armRz;
  pTorso.rotation.z = torsoZ;
  pTorso.rotation.y = torsoY;
  player.position.y = bodyY;
  pHead.position.y = headY;
  player.rotation.y = playerState.yaw + yawExtra;
  pChest.material.emissiveIntensity = 1.6 + beat * 2.4 + mix * 1.6;

  /* --- camera follow --- */
  const dist = isMobile ? 6.2 : 5.6;
  const height = 2.55 + look.pitch * 3.2;
  camDesired.set(
    player.position.x + Math.sin(yaw) * dist,
    player.position.y + height,
    player.position.z + Math.cos(yaw) * dist
  );
  camDesired.x = THREE.MathUtils.clamp(camDesired.x, -HALF_W + 1.2, HALF_W - 1.2);
  camDesired.z = THREE.MathUtils.clamp(camDesired.z, -HALF_D + 1.2, HALF_D - 1.2);
  camDesired.y = THREE.MathUtils.clamp(camDesired.y, 1.2, ROOM_H - 1.4);

  camera.position.lerp(camDesired, 1 - Math.pow(0.0022, dt));
  camTarget.set(player.position.x, player.position.y + 1.75, player.position.z);
  smoothTarget.lerp(camTarget, 1 - Math.pow(0.0009, dt));
  camera.lookAt(smoothTarget);

  /* --- moving lights --- */
  movingLights.forEach((m, i) => {
    m.a += dt * m.sp * 0.55;
    const wob = Math.sin(elapsed * m.sp + i) * 1.6;
    m.light.position.set(
      Math.cos(m.a) * (m.r + wob),
      m.y + Math.sin(elapsed * 0.9 + i) * 0.7,
      -2 + Math.sin(m.a) * (m.r + wob)
    );
    m.light.intensity = 16 + beat * 16;
  });

  /* --- beams --- */
  beams.forEach((b, i) => {
    b.mesh.rotation.z = Math.sin(elapsed * 0.9 + b.phase) * 0.55;
    b.mesh.rotation.x = Math.cos(elapsed * 0.7 + b.phase) * 0.42;
    b.mesh.rotation.y = Math.sin(elapsed * 0.4 + b.phase * 2) * 1.4;
    b.mesh.material.opacity = 0.045 + beat * 0.075;
  });

  /* --- laser sweep from mirror ball --- */
  mirrorBall.rotation.y += dt * 0.55;
  mirrorBall.rotation.x = Math.sin(elapsed * 0.4) * 0.18;
  ballLight.intensity = 8 + beat * 14;

  /* --- dance floor --- */
  for (let k = 0; k < tiles.length; k++){
    const t = tiles[k], u = t.userData;
    const wave = Math.sin(elapsed * 2.4 - (u.i + u.j) * 0.55);
    const pulse = Math.max(0, wave) ** 3;
    const hue = 0.52 + ((elapsed * 0.03 + u.hueBase * 1.6) % 0.42);
    tileColors[k].setHSL(hue, 0.9, 0.06 + pulse * 0.17);
    t.material.emissive.copy(tileColors[k]);
    t.material.emissiveIntensity = 0.18 + pulse * 0.62 + beat * 0.16;
    t.position.y = 0.04 + pulse * 0.022;
  }

  /* --- crowd --- */
  crowd.forEach((c, i) => {
    if (!c.static){
      c.a += dt * c.sp;
      const px = c.home.x + Math.cos(c.a) * c.radius;
      const pz = c.home.z + Math.sin(c.a * 0.9) * c.radius;
      c.obj.position.x += (px - c.obj.position.x) * Math.min(1, dt * 1.6);
      c.obj.position.z += (pz - c.obj.position.z) * Math.min(1, dt * 1.6);
    }
    animateDancer(c.obj, elapsed, beat);
  });

  /* --- other people in the room --- */
  updateNet(dt, elapsed, beat);

  /* --- DJ --- */
  djFigure.rotation.y = Math.sin(elapsed * 0.7) * 0.22;
  djFigure.position.y = Math.abs(Math.sin(elapsed * 2.4)) * 0.03;
  dj.traverse(o => { if (o.userData && o.userData.spin) o.rotation.y += dt * o.userData.spin; });

  /* spot sway */
  djSpotA.target.position.x = Math.sin(elapsed * 0.6) * 6;
  djSpotA.target.position.z = -3 + Math.cos(elapsed * 0.45) * 4;
  djSpotB.target.position.x = Math.sin(elapsed * 0.6 + Math.PI) * 6;
  djSpotB.target.position.z = -2 + Math.cos(elapsed * 0.45 + 1) * 4;
  djSpotA.intensity = 26 + beat * 24;
  djSpotB.intensity = 18 + (1 - beat) * 20;

  /* neon pulse */
  neonStrips.forEach((s, i) => {
    s.material.emissiveIntensity = 1.8 + Math.sin(elapsed * 2 + i) * 0.5 + beat * 0.7;
  });

  /* LED wall */
  wallTime += dt;
  if (wallTime > 0.05){ wallTime = 0; drawWall(elapsed); }

  /* player rim light */
  rimLight.intensity = 4 + beat * 5;

  /* audio-visual: exposure breathes with beat */
  renderer.toneMappingExposure = 0.9 + beat * 0.05;
  camera.fov = 58 + (playerState.speed > 4 ? 3 : 0);
  camera.updateProjectionMatrix();

  composer.render();

  if (!appReady){ appReady = true; app.classList.add('ready'); }
  if (!hintHidden && elapsed > 9){
    document.getElementById('hint').classList.add('hide');
    hintHidden = true;
  }
}

/* ---------------- boot ---------------- */
drawWall(0);
let appReady = false, hintHidden = false;
tick();
