/* ========================================================================
 * EMBERS — camping world (NPC + time + timer)
 * Uses shared modules from src/core/* (avatar, input, movement, nickname, pose).
 * ======================================================================== */
import { THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from '../imports.js';
import { neon, makeAvatar, nameTag, peerColor } from '../core/avatar.js';
import { createKeyState, createLookControls, createJoystick } from '../core/input.js';
import { collide as collideWorld } from '../core/player-movement.js';
import { setupNicknameUI } from '../core/nickname-ui.js';
import { createCampAudio } from './camp-audio.js';
import { createCampNet } from './camp-net.js';

/* ---------------- renderer ---------------- */
const app = document.getElementById('app');
const isMobile = matchMedia('(pointer:coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.4 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !isMobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
scene.fog = new THREE.FogExp2(0x0d1322, 0.011);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 280);
camera.position.set(0, 3.4, 10);

/* soft pre-dawn env */
(function makeEnv(){
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#0a1220'); g.addColorStop(0.45, '#070a12'); g.addColorStop(1, '#120a08');
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
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  isMobile ? 0.42 : 0.58, 0.65, 0.78
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------------- world bounds ---------------- */
const HALF = 28;

/* ---------------- lights ---------------- */
const ambLight = new THREE.AmbientLight(0x2a3655, 0.55);
scene.add(ambLight);
const hemiLight = new THREE.HemisphereLight(0x4a5f8a, 0x1a140e, 0.75);
scene.add(hemiLight);
const moon = new THREE.DirectionalLight(0x9fb2d8, 0.55);
moon.position.set(-12, 22, -8);
scene.add(moon);
const entryTime = performance.now();
const TOD_CYCLE = 60 * 12; /* 12 min full dusk→night→dawn */
const skyDay = { bg: new THREE.Color(0x05070c), fog: new THREE.Color(0x0d1322) };


/* ---------------- helpers ---------------- */
function makeRadialTex(stops, size = 64){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* flame / ember / smoke particle textures — code-generated, no files */
const FLAME_TEX = makeRadialTex([
  [0, 'rgba(255,255,230,1)'],
  [0.18, 'rgba(255,210,80,0.95)'],
  [0.42, 'rgba(255,110,20,0.7)'],
  [0.72, 'rgba(180,30,0,0.25)'],
  [1, 'rgba(0,0,0,0)']
], 64);
const EMBER_TEX = makeRadialTex([
  [0, 'rgba(255,240,180,1)'],
  [0.25, 'rgba(255,160,40,0.95)'],
  [0.55, 'rgba(255,60,0,0.45)'],
  [1, 'rgba(0,0,0,0)']
], 32);
const SMOKE_TEX = makeRadialTex([
  [0, 'rgba(90,90,95,0.45)'],
  [0.4, 'rgba(60,60,65,0.22)'],
  [1, 'rgba(0,0,0,0)']
], 64);

/* ---------------- ground ---------------- */
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x1a1812, roughness: 0.95, metalness: 0.05
});
const ground = new THREE.Mesh(new THREE.CircleGeometry(HALF + 4, 64), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = !isMobile;
scene.add(ground);

/* subtle dirt patch under fire circle */
const dirt = new THREE.Mesh(
  new THREE.CircleGeometry(4.2, 40),
  new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 1, metalness: 0 })
);
dirt.rotation.x = -Math.PI / 2;
dirt.position.y = 0.01;
scene.add(dirt);

/* ---------------- stars ---------------- */
const STAR_COUNT = isMobile ? 500 : 1100;
(function makeStars(){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(STAR_COUNT * 3);
  const col = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++){
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 0.72 + 0.05); /* upper hemisphere */
    const r = 90 + Math.random() * 60;
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    pos[i * 3 + 1] = Math.cos(ph) * r + 8;
    pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
    const warm = Math.random();
    col[i * 3] = 0.85 + warm * 0.15;
    col[i * 3 + 1] = 0.88 + warm * 0.1;
    col[i * 3 + 2] = 0.95;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: isMobile ? 0.35 : 0.48, vertexColors: true, transparent: true,
    opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(stars);
})();

/* ---------------- distant lake + forest silhouette ---------------- */
(function makeHorizon(){
  /* lake strip */
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 28),
    new THREE.MeshStandardMaterial({
      color: 0x0a1420, roughness: 0.15, metalness: 0.7,
      emissive: new THREE.Color(0x061018), emissiveIntensity: 0.35
    })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(0, -0.02, -48);
  scene.add(lake);

  /* far forest silhouette — dark cones along the ridge */
  const silGeo = new THREE.ConeGeometry(1, 1, 5);
  const silMat = new THREE.MeshBasicMaterial({ color: 0x04060a });
  const sil = new THREE.InstancedMesh(silGeo, silMat, 90);
  const m = new THREE.Matrix4(), s = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  for (let i = 0; i < 90; i++){
    const x = -48 + (i / 89) * 96 + (Math.random() - 0.5) * 1.4;
    const z = -58 - Math.random() * 10;
    const h = 4 + Math.random() * 7;
    p.set(x, h * 0.45, z);
    s.set(1.6 + Math.random() * 1.4, h, 1.6 + Math.random() * 1.4);
    q.identity();
    m.compose(p, q, s);
    sil.setMatrixAt(i, m);
  }
  sil.instanceMatrix.needsUpdate = true;
  scene.add(sil);

  /* soft dawn glow band on horizon */
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 10),
    new THREE.MeshBasicMaterial({
      color: 0x1a2840, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    })
  );
  band.position.set(0, 3.5, -70);
  scene.add(band);
})();

/* ---------------- procedural trees (instanced) ---------------- */
const TREE_COUNT = isMobile ? 70 : 140;
(function makeTrees(){
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
  const foliageGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.95 });
  const folMat = new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
  const folA = new THREE.InstancedMesh(foliageGeo, folMat, TREE_COUNT);
  const folB = new THREE.InstancedMesh(foliageGeo, folMat, TREE_COUNT);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
  let placed = 0, guard = 0;
  while (placed < TREE_COUNT && guard++ < 4000){
    const ang = Math.random() * Math.PI * 2;
    const rad = 9 + Math.random() * (HALF - 8);
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    /* keep camp circle and lake approach clear */
    if (Math.hypot(x, z) < 8.5) continue;
    if (z < -22 && Math.abs(x) < 18) continue;
    const th = 2.4 + Math.random() * 3.2;
    const tw = 0.7 + Math.random() * 0.55;
    p.set(x, th * 0.5, z); s.set(tw, th, tw); q.identity();
    m.compose(p, q, s); trunks.setMatrixAt(placed, m);
    const fh = 2.8 + Math.random() * 2.4;
    const fw = 1.4 + Math.random() * 1.1;
    p.set(x, th * 0.55 + fh * 0.35, z); s.set(fw, fh, fw);
    m.compose(p, q, s); folA.setMatrixAt(placed, m);
    p.set(x, th * 0.55 + fh * 0.7, z); s.set(fw * 0.72, fh * 0.7, fw * 0.72);
    m.compose(p, q, s); folB.setMatrixAt(placed, m);
    placed++;
  }
  trunks.instanceMatrix.needsUpdate = true;
  folA.instanceMatrix.needsUpdate = true;
  folB.instanceMatrix.needsUpdate = true;
  scene.add(trunks, folA, folB);
})();

/* ---------------- campfire ---------------- */
const fireRoot = new THREE.Group();
scene.add(fireRoot);

/* stone ring */
(function makeStoneRing(){
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3834, roughness: 0.92, metalness: 0.05 });
  for (let i = 0; i < 14; i++){
    const a = (i / 14) * Math.PI * 2;
    const r = 0.85 + (Math.random() - 0.5) * 0.08;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.08, 0),
      stoneMat
    );
    stone.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.castShadow = !isMobile;
    fireRoot.add(stone);
  }
})();

/* logs under fire */
(function makeFirewood(){
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9 });
  for (let i = 0; i < 4; i++){
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 7), wood);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 4) * Math.PI;
    log.position.set(0, 0.08, 0);
    fireRoot.add(log);
  }
})();

/* glowing ember bed */
const emberBed = new THREE.Mesh(
  new THREE.CircleGeometry(0.55, 24),
  new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(0xff5510), emissiveIntensity: 2.4,
    roughness: 1, metalness: 0, transparent: true, opacity: 0.95
  })
);
emberBed.rotation.x = -Math.PI / 2;
emberBed.position.y = 0.05;
fireRoot.add(emberBed);

const emberGlow = new THREE.Mesh(
  new THREE.CircleGeometry(1.1, 28),
  new THREE.MeshBasicMaterial({
    map: makeRadialTex([
      [0, 'rgba(255,90,20,0.55)'],
      [0.45, 'rgba(255,50,0,0.18)'],
      [1, 'rgba(0,0,0,0)']
    ], 64),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  })
);
emberGlow.rotation.x = -Math.PI / 2;
emberGlow.position.y = 0.04;
fireRoot.add(emberGlow);

/* flickering point lights */
const fireLight = new THREE.PointLight(0xff7a28, 40, 28, 1.4);
fireLight.position.set(0, 1.15, 0);
fireLight.castShadow = !isMobile;
if (!isMobile){
  fireLight.shadow.mapSize.set(1024, 1024);
  fireLight.shadow.camera.near = 0.2;
  fireLight.shadow.camera.far = 22;
  fireLight.shadow.bias = -0.002;
}
fireRoot.add(fireLight);

const fireLightB = new THREE.PointLight(0xff4400, 10, 10, 2);
fireLightB.position.set(0.15, 0.55, -0.1);
fireRoot.add(fireLightB);

/* particle systems */
function createParticleSystem(tex, count, opts){
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const lifetimes = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++){
    ages[i] = Math.random();
    lifetimes[i] = opts.lifeMin + Math.random() * (opts.lifeMax - opts.lifeMin);
    speeds[i] = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
    sizes[i] = opts.sizeMin + Math.random() * (opts.sizeMax - opts.sizeMin);
    seeds[i] = Math.random() * 100;
    positions[i * 3] = 0; positions[i * 3 + 1] = 0; positions[i * 3 + 2] = 0;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    size: opts.baseSize, color: opts.color || 0xffffff,
    opacity: opts.opacity || 1, sizeAttenuation: true, fog: false
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, positions, ages, lifetimes, speeds, sizes, seeds, count, opts, mat };
}

const FLAME_N = isMobile ? 48 : 110;
const EMBER_N = isMobile ? 36 : 90;
const SMOKE_N = isMobile ? 28 : 60;

const flames = createParticleSystem(FLAME_TEX, FLAME_N, {
  lifeMin: 0.35, lifeMax: 0.85, speedMin: 1.4, speedMax: 2.8,
  sizeMin: 0.35, sizeMax: 0.85, baseSize: 0.55, additive: true,
  color: 0xffcc66, opacity: 0.95, radius: 0.28, rise: 1
});
const embers = createParticleSystem(EMBER_TEX, EMBER_N, {
  lifeMin: 1.2, lifeMax: 2.8, speedMin: 0.9, speedMax: 2.2,
  sizeMin: 0.06, sizeMax: 0.16, baseSize: 0.12, additive: true,
  color: 0xffaa44, opacity: 1, radius: 0.35, rise: 1
});
const smokes = createParticleSystem(SMOKE_TEX, SMOKE_N, {
  lifeMin: 2.2, lifeMax: 4.5, speedMin: 0.35, speedMax: 0.75,
  sizeMin: 0.5, sizeMax: 1.4, baseSize: 1.1, additive: false,
  color: 0x888890, opacity: 0.35, radius: 0.22, rise: 1
});
fireRoot.add(flames.pts, embers.pts, smokes.pts);

function resetParticle(sys, i, yBias){
  const r = sys.opts.radius * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  sys.positions[i * 3] = Math.cos(a) * r;
  sys.positions[i * 3 + 1] = yBias + Math.random() * 0.15;
  sys.positions[i * 3 + 2] = Math.sin(a) * r;
  sys.ages[i] = 0;
  sys.lifetimes[i] = sys.opts.lifeMin + Math.random() * (sys.opts.lifeMax - sys.opts.lifeMin);
  sys.speeds[i] = sys.opts.speedMin + Math.random() * (sys.opts.speedMax - sys.opts.speedMin);
  sys.seeds[i] = Math.random() * 100;
}

function updateParticles(sys, dt, windX, windZ, y0, sizeScale){
  const pos = sys.positions;
  for (let i = 0; i < sys.count; i++){
    sys.ages[i] += dt;
    if (sys.ages[i] >= sys.lifetimes[i]){
      resetParticle(sys, i, y0);
      continue;
    }
    const t = sys.ages[i] / sys.lifetimes[i];
    const seed = sys.seeds[i];
    const wob = Math.sin(sys.ages[i] * 6 + seed) * 0.15;
    pos[i * 3] += (windX + wob + Math.sin(seed + sys.ages[i] * 2.1) * 0.08) * dt;
    pos[i * 3 + 1] += sys.speeds[i] * dt * (1.05 - t * 0.35);
    pos[i * 3 + 2] += (windZ + Math.cos(seed + sys.ages[i] * 1.7) * 0.08) * dt;
  }
  sys.pts.geometry.attributes.position.needsUpdate = true;
  /* average size / opacity pulse */
  sys.mat.size = sys.opts.baseSize * sizeScale;
  sys.mat.opacity = sys.opts.opacity * (0.85 + 0.15 * Math.sin(performance.now() * 0.008));
}

/* noise-ish flicker helper */
function n1(t, s){ return Math.sin(t * s) * 0.5 + Math.sin(t * s * 1.7 + 1.3) * 0.3 + Math.sin(t * s * 0.4 + 2.1) * 0.2; }

/* ---------------- log chairs (6 in circle) ---------------- */
const chairs = [];
function makeLogChair(){
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.88, metalness: 0.05 });
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.05, 10), wood);
  seat.rotation.z = Math.PI / 2;
  seat.position.y = 0.28;
  seat.castShadow = !isMobile;
  g.add(seat);
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.32, 6), wood);
  legL.position.set(-0.32, 0.14, 0.12);
  const legR = legL.clone(); legR.position.x = 0.32;
  const legL2 = legL.clone(); legL2.position.z = -0.12;
  const legR2 = legR.clone(); legR2.position.z = -0.12;
  g.add(legL, legR, legL2, legR2);
  return g;
}
const CHAIR_R = 3.35;
for (let i = 0; i < 6; i++){
  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
  const chair = makeLogChair();
  chair.position.set(Math.cos(a) * CHAIR_R, 0, Math.sin(a) * CHAIR_R);
  chair.lookAt(0, 0, 0);
  chair.rotation.y += Math.PI; /* face the fire */
  scene.add(chair);
  chairs.push({
    mesh: chair,
    angle: a,
    seatPos: new THREE.Vector3(Math.cos(a) * (CHAIR_R - 0.15), 0, Math.sin(a) * (CHAIR_R - 0.15)),
    faceYaw: Math.atan2(-Math.cos(a), -Math.sin(a)),
    reserved: false
  });
}

/* ---------------- NPC campers (yield chairs; not in room count) ---------------- */
const npcs = [];
{
  const specs = [
    { chair: 1, name: '기타 캠퍼', color: 0x8affc1, kind: 'guitar' },
    { chair: 4, name: '책 읽는 캠퍼', color: 0x4dd2ff, kind: 'reader' }
  ];
  for (const sp of specs){
    const ch = chairs[sp.chair];
    if (!ch) continue;
    const body = new THREE.Color(sp.color).multiplyScalar(0.34);
    const rig = makeAvatar(body.getHex(), sp.color, false);
    const tag = nameTag(sp.name, sp.color);
    rig.group.add(tag);
    rig.group.position.copy(ch.seatPos);
    rig.group.rotation.y = ch.faceYaw;
    /* sit pose */
    rig.legL.rotation.x = -1.4; rig.legR.rotation.x = -1.4;
    rig.armL.rotation.x = -0.9; rig.armR.rotation.x = -0.9;
    rig.armL.rotation.z = 0.4; rig.armR.rotation.z = -0.4;
    rig.group.position.y = 0.42;
    if (sp.kind === 'guitar'){
      const g = new THREE.Group();
      const bodyG = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.08, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 })
      );
      const neck = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x3a2810, roughness: 0.8 })
      );
      neck.position.z = -0.35;
      g.add(bodyG, neck);
      g.position.set(0.25, 1.15, 0.2);
      g.rotation.x = 0.5; g.rotation.y = -0.4;
      rig.group.add(g);
      rig.armR.rotation.x = -1.1; rig.armL.rotation.x = -0.6;
    } else {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.03, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.85 })
      );
      book.position.set(0.15, 1.2, 0.28);
      book.rotation.x = 0.6;
      rig.group.add(book);
      rig.armL.rotation.x = -1.2; rig.armR.rotation.x = -1.0;
      rig.head.rotation.x = -0.25;
    }
    scene.add(rig.group);
    ch.reserved = true;
    npcs.push({ rig, chairIdx: sp.chair, kind: sp.kind, home: true, yieldT: 0 });
  }
}


/* ---------------- tents (1–2) ---------------- */
function makeTent(color){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.05,
    side: THREE.DoubleSide, flatShading: true
  });
  /* A-frame tent from two planes + floor flap */
  const sideGeo = new THREE.PlaneGeometry(2.4, 1.7);
  const left = new THREE.Mesh(sideGeo, mat);
  left.position.set(-0.55, 0.85, 0);
  left.rotation.z = 0.55;
  left.rotation.y = Math.PI / 2;
  const right = new THREE.Mesh(sideGeo, mat.clone());
  right.position.set(0.55, 0.85, 0);
  right.rotation.z = -0.55;
  right.rotation.y = Math.PI / 2;
  g.add(left, right);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.7, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.9 })
  );
  pole.position.y = 0.85;
  g.add(pole);
  return g;
}
const tentA = makeTent(0x3a4a3a);
tentA.position.set(-7.5, 0, 4.5);
tentA.rotation.y = 0.6;
scene.add(tentA);
const tentB = makeTent(0x4a3a2a);
tentB.position.set(8.2, 0, 3.2);
tentB.rotation.y = -0.9;
scene.add(tentB);

/* ---------------- lantern ---------------- */
const lantern = new THREE.Group();
(function makeLantern(){
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.32, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.5, metalness: 0.6 })
  );
  frame.position.y = 1.15;
  lantern.add(frame);
  const glass = neon(0.16, 0.22, 0.16, 0xffaa55, 1.8);
  glass.position.y = 1.15;
  lantern.add(glass);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 1.0, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.85 })
  );
  post.position.y = 0.5;
  lantern.add(post);
  const lampLight = new THREE.PointLight(0xffb060, 7, 10, 2);
  lampLight.position.set(0, 1.2, 0);
  lantern.add(lampLight);
  lantern.userData.light = lampLight;
  lantern.userData.glass = glass;
})();
lantern.position.set(2.8, 0, -4.2);
scene.add(lantern);

/* ---------------- avatars (src/core/avatar.js) ---------------- */
const playerRig = makeAvatar(0x150e22, 0xff9a4a, true);
const player = playerRig.group;
const rimLight = playerRig.light;
let playerTag = null;
player.position.set(0, 0, 6.2);
scene.add(player);

const pTorso = playerRig.torso;
const pHead = playerRig.head;
const pChest = playerRig.chest;
const pArmL = playerRig.armL;
const pArmR = playerRig.armR;
const pLegL = playerRig.legL;
const pLegR = playerRig.legR;

/* pose: idle | sit (club uses dance; shared vocabulary via src/core/pose.js) */
const playerState = {
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  speed: 0,
  run: 0,
  bob: 0,
  pose: 'idle',
  sitMix: 0,
  sitChair: -1,
  sitProgress: 0
};

/* ---------------- input ---------------- */
const keys = createKeyState({ onRun: v => { playerState.run = v; } });

/* ---------------- camp audio (Web Audio synthesis) ---------------- */
const campAudio = createCampAudio();
const audioUI = campAudio.attachUI({
  unlockBtn: document.getElementById('audioUnlock'),
  mixer: document.getElementById('mixer'),
  chip: document.getElementById('mixerChip'),
  sliders: {
    fire: document.getElementById('mixFire'),
    bugs: document.getElementById('mixBugs'),
    wind: document.getElementById('mixWind')
  },
  muteBtn: document.getElementById('mixerMute')
});

/* ---------------- sit / 불멍 ---------------- */
const sitBtn = document.getElementById('sit');
const bulmongBtn = document.getElementById('bulmong');
const uiEl = document.getElementById('ui');
const bulmongBanner = document.getElementById('bulmongBanner');
let bulmong = false;
let bulmongT = 0;
const BULMONG_LIMIT = 600; /* 10 min */
const bulmongTimerEl = document.getElementById('bulmongTimer');
let shootingStar = null;
let bulmongEnded = false;

let toastEl = null, toastTimer = 0;

function makeChatBubbleSprite(text){
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
  sprite.renderOrder = 30;
  return sprite;
}

function showToast(msg){
  if (!toastEl){
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:rgba(20,14,10,.82);border:1px solid rgba(255,154,74,.45);color:#ffe2c4;font:500 14px/1.2 system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .25s;z-index:50';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1800);
}

function wrapPi(a){
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

function nearestChair(){
  let best = -1, bestD = 1.65;
  for (let i = 0; i < chairs.length; i++){
    const ch = chairs[i];
    /* allow taking NPC-reserved chair — NPC will yield */
    const d = Math.hypot(player.position.x - ch.seatPos.x, player.position.z - ch.seatPos.z);
    if (d < bestD){ bestD = d; best = i; }
  }
  return best;
}

function setSit(on){
  if (on){
    const idx = nearestChair();
    if (idx < 0){
      showToast('의자 가까이 가서 눌러보세요');
      sitBtn.classList.remove('on');
      sitBtn.textContent = 'SIT';
      return false;
    }
    playerState.pose = 'sit';
    playerState.sitChair = idx;
    playerState.sitProgress = 0;
    sitBtn.classList.add('on');
    sitBtn.textContent = 'SITTING';
    if (typeof openReason === 'function') openReason();
    return true;
  }
  playerState.pose = 'idle';
  playerState.sitChair = -1;
  sitBtn.classList.remove('on');
  sitBtn.textContent = 'SIT';
  roastProgress = 0;
  if (typeof roastBtn !== 'undefined') roastBtn.classList.remove('on');
  if (stickGroup) stickGroup.visible = false;
  if (bulmong) setBulmong(false);
  return true;
}

function setBulmong(on){
  bulmong = on;
  bulmongT = 0;
  bulmongBtn.classList.toggle('on', on);
  bulmongBtn.textContent = on ? '불멍 ON' : '불멍';
  uiEl.classList.toggle('hide', on);
  bulmongBanner.classList.toggle('show', on);
  if (audioUI) audioUI.setBulmongMode(on);
  if (bulmongTimerEl){
    bulmongTimerEl.classList.toggle('show', on);
    if (on){ bulmongEnded = false; bulmongT = 0; }
  }
  if (on && playerState.pose !== 'sit'){
    /* auto-sit if near a chair; otherwise just lock camera on fire from current spot */
    setSit(true);
  }
}

sitBtn.addEventListener('click', () => setSit(playerState.pose !== 'sit'));
bulmongBtn.addEventListener('click', () => setBulmong(!bulmong));
/* keydown bound after social init */


/* ---------------- multiplayer ---------------- */
const statusText = document.getElementById('statusText');
const findSiteBtn = document.getElementById('findSite');
let netFireLevel = 0.55;

const campNet = createCampNet({
  scene,
  getState: () => ({
    x: player.position.x,
    z: player.position.z,
    yaw: playerState.yaw,
    pose: playerState.pose,
    on: playerState.speed > 0.15 ? 1 : 0
  }),
  onYou: (name, color) => {
    /* nickname UI applyMe wired below once nick exists */
    if (campNet._applyYou) campNet._applyYou(name, color);
  },
  onStatus: (info) => {
    if (info.full) {
      statusText.textContent = '지금은 만석';
      findSiteBtn.classList.remove('show');
      showToast('지금은 만석');
      return;
    }
    if (info.fireLevel != null) netFireLevel = info.fireLevel;
    if (!info.online) {
      statusText.textContent = (info.site || 1) + '번 모닥불 · 혼자 (재연결 중)';
      findSiteBtn.classList.remove('show');
      return;
    }
    const n = Math.max(1, info.siteN || 1);
    statusText.textContent = (info.site || 1) + '번 모닥불 · 지금 ' + n + '명이 불을 보고 있어요';
    findSiteBtn.classList.add('show');
  },
  onEvent: (ev) => {
    if (ev.t === 'full') showToast('지금은 만석');
    if (ev.t === 'site' && ev.fireLevel != null) netFireLevel = ev.fireLevel;
    if (ev.t === 'welcome' && ev.fireLevel != null) netFireLevel = ev.fireLevel;
    if (ev.t === 'wish' && ev.text && typeof spawnWishFX === 'function') spawnWishFX(ev.text);
  }
});

findSiteBtn.addEventListener('click', () => {
  if (campNet.resite()) showToast('다른 모닥불을 찾는 중…');
});

/* ---------------- social: chat / emotes / reason / block ---------------- */
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const chatBtn = document.getElementById('chatBtn');
const reasonPanel = document.getElementById('reasonPanel');
const peerMenu = document.getElementById('peerMenu');
let chatOpen = false;
let reasonPicked = false;
let selfBubble = null, selfBubbleUntil = 0;
let peerMenuTarget = null;
let localEmote = null, localEmoteUntil = 0;

function clearHeldKeys(){
  for (const k in keys) keys[k] = false;
  playerState.run = 0;
}

function openChat(){
  if (chatOpen) return;
  chatOpen = true;
  chatBox.classList.add('open');
  clearHeldKeys();
  chatInput.value = '';
  setTimeout(() => chatInput.focus(), 10);
}
function closeChat(){
  chatOpen = false;
  chatBox.classList.remove('open');
  chatInput.blur();
}
function sendChatNow(){
  const text = chatInput.value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  closeChat();
  if (!text) return;
  campNet.sendChat(text);
  if (selfBubble) scene.remove(selfBubble);
  selfBubble = makeChatBubbleSprite(text);
  scene.add(selfBubble);
  selfBubbleUntil = performance.now() + 5000;
}

chatBtn.addEventListener('click', e => { e.stopPropagation(); openChat(); });
chatInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter'){ e.preventDefault(); sendChatNow(); }
  if (e.code === 'Escape'){ e.preventDefault(); closeChat(); }
});

document.querySelectorAll('#emoteBar [data-emote]').forEach(btn => {
  btn.addEventListener('click', () => {
    const em = btn.getAttribute('data-emote');
    campNet.sendEmote(em);
    localEmote = em;
    localEmoteUntil = performance.now() + 2200;
  });
});

function openReason(){
  if (reasonPicked) return;
  reasonPanel.classList.add('open');
}
function pickReason(r){
  reasonPicked = true;
  reasonPanel.classList.remove('open');
  campNet.sendReason(r);
  showToast(r);
}
reasonPanel.querySelectorAll('[data-reason]').forEach(btn => {
  btn.addEventListener('click', () => pickReason(btn.getAttribute('data-reason')));
});

peerMenu.querySelectorAll('[data-act]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!peerMenuTarget) return;
    const act = btn.getAttribute('data-act');
    if (act === 'block'){
      campNet.block(peerMenuTarget.id);
      showToast('차단했습니다');
    } else if (act === 'report'){
      campNet.report(peerMenuTarget.id, peerMenuTarget.name, 'user report');
      showToast('신고가 접수되었습니다');
    }
    peerMenu.classList.remove('open');
    peerMenuTarget = null;
  });
});

/* click peer to open block/report (desktop) */
renderer.domElement.addEventListener('click', e => {
  if (chatOpen || reasonPanel.classList.contains('open')) return;
  /* raycast-ish: pick nearest peer in screen radius */
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const mouse = new THREE.Vector2(nx, ny);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  let best = null, bestD = 1.2;
  for (const p of campNet.peers.values()){
    if (p.hidden) continue;
    const sp = p.rig.group.position.clone(); sp.y += 1.2;
    const d = raycaster.ray.distanceSqToPoint(sp);
    const along = raycaster.ray.direction.dot(sp.clone().sub(raycaster.ray.origin));
    if (along < 0.5) continue;
    if (d < bestD * bestD){ bestD = Math.sqrt(d); best = p; }
  }
  if (best && bestD < 0.85){
    peerMenuTarget = best;
    peerMenu.style.left = e.clientX + 'px';
    peerMenu.style.top = e.clientY + 'px';
    peerMenu.classList.add('open');
  } else {
    peerMenu.classList.remove('open');
  }
});



addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || chatOpen || wishOpen) {
    if (e.code === 'Escape' && chatOpen) { closeChat(); e.preventDefault(); }
    if (e.code === 'Escape' && wishOpen) { closeWish(); e.preventDefault(); }
    return;
  }
  if (e.code === 'Enter' && !e.repeat){ openChat(); e.preventDefault(); return; }
  if (e.code === 'Digit1' && !e.repeat){ campNet.sendEmote('wave'); localEmote='wave'; localEmoteUntil=performance.now()+2200; }
  if (e.code === 'Digit2' && !e.repeat){ campNet.sendEmote('nod'); localEmote='nod'; localEmoteUntil=performance.now()+2200; }
  if (e.code === 'Digit3' && !e.repeat){ campNet.sendEmote('cheers'); localEmote='cheers'; localEmoteUntil=performance.now()+2200; }
  if (e.code === 'KeyF' && !e.repeat) setSit(playerState.pose !== 'sit');
  if (e.code === 'KeyB' && !e.repeat) setBulmong(!bulmong);
  if (e.code === 'Escape'){
    if (reasonPanel.classList.contains('open')) reasonPanel.classList.remove('open');
    else if (peerMenu.classList.contains('open')) peerMenu.classList.remove('open');
    else if (wishOpen) closeWish();
    else if (bulmong) setBulmong(false);
    else if (playerState.pose === 'sit' || playerState.pose === 'roast') setSit(false);
  }
});

/* ---------------- fire interactions (log / wish / marshmallow) ---------------- */
const addLogBtn = document.getElementById('addLog');
const wishBtn = document.getElementById('wishBtn');
const roastBtn = document.getElementById('roastBtn');
const wishBox = document.getElementById('wishBox');
const wishInput = document.getElementById('wishInput');
let wishOpen = false;
let roastProgress = 0; /* 0..1 cook, >1.15 burnt */
let stickGroup = null;
const wishFX = []; /* {mesh, age, life, sparks[]} */

function ensureStick(){
  if (stickGroup) return stickGroup;
  stickGroup = new THREE.Group();
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.02, 1.35, 5),
    new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.9 })
  );
  stick.rotation.z = Math.PI / 2;
  stick.position.set(0.55, 0, 0);
  const mallow = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff5e6, roughness: 0.85, emissive: new THREE.Color(0x221100), emissiveIntensity: 0.1 })
  );
  mallow.position.set(1.15, 0, 0);
  stickGroup.add(stick, mallow);
  stickGroup.userData.mallow = mallow;
  stickGroup.visible = false;
  player.add(stickGroup);
  stickGroup.position.set(0.15, 1.35, 0.35);
  return stickGroup;
}

addLogBtn.addEventListener('click', () => {
  if (campNet.sendLog()) showToast('장작을 넣었습니다');
  else showToast('연결되면 장작을 넣을 수 있어요');
});

function openWish(){
  wishOpen = true;
  wishBox.classList.add('open');
  clearHeldKeys();
  wishInput.value = '';
  setTimeout(() => wishInput.focus(), 10);
}
function closeWish(){
  wishOpen = false;
  wishBox.classList.remove('open');
  wishInput.blur();
}
wishBtn.addEventListener('click', () => openWish());
wishInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter'){
    e.preventDefault();
    const text = wishInput.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    closeWish();
    if (!text) return;
    if (!campNet.sendWish(text)) showToast('연결되면 소원을 태울 수 있어요');
    spawnWishFX(text);
  }
  if (e.code === 'Escape'){ e.preventDefault(); closeWish(); }
});

function spawnWishFX(text){
  /* paper card flies into fire then sparks — label via textContent on DOM overlay briefly */
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.35, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.8, side: THREE.DoubleSide })
  );
  paper.position.copy(player.position);
  paper.position.y = 1.4;
  scene.add(paper);
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(20,14,10,.75);border:1px solid rgba(255,200,140,.35);color:#ffe8d0;font:500 13px/1.2 system-ui,sans-serif;pointer-events:none;z-index:40;opacity:1;transition:opacity 1.2s';
  label.textContent = text; /* XSS-safe */
  document.body.appendChild(label);
  setTimeout(() => { label.style.opacity = '0'; setTimeout(() => label.remove(), 1400); }, 1800);
  const sparks = [];
  for (let i = 0; i < (isMobile ? 10 : 18); i++){
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 4, 4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.08 + Math.random()*0.06, 1, 0.55) })
    );
    s.position.set(0, 0.6, 0);
    s.visible = false;
    scene.add(s);
    sparks.push({ mesh: s, vx: (Math.random()-0.5)*2.5, vy: 1.5+Math.random()*2.5, vz: (Math.random()-0.5)*2.5 });
  }
  wishFX.push({ paper, age: 0, life: 2.8, sparks, phase: 0 });
}

roastBtn.addEventListener('click', () => {
  if (playerState.pose === 'roast'){
    playerState.pose = 'sit';
    roastBtn.classList.remove('on');
    roastProgress = 0;
    if (stickGroup) stickGroup.visible = false;
  } else {
    if (playerState.pose !== 'sit'){
      if (!setSit(true)) return;
    }
    playerState.pose = 'roast';
    roastBtn.classList.add('on');
    roastProgress = 0;
    ensureStick().visible = true;
  }
});


/* ---------------- nickname + outfit ---------------- */
const nick = setupNicknameUI({
  storageKeyPrefix: 'embers',
  playerRig,
  player,
  getPlayerTag: () => playerTag,
  setPlayerTag: (t) => { playerTag = t; },
  defaultColor: 4,
  defaultTagName: '캠퍼',
  sendProfile: (name, colorIdx) => campNet.sendProfile(name, colorIdx),
  onApplied: (me) => { if (me.name) campNet.setName(me.name); }
});
campNet._applyYou = (name, color) => {
  if (nick && nick.applyMe) nick.applyMe(name, color, true);
};
if (nick.ME && nick.ME.name) campNet.setName(nick.ME.name);

/* ---------------- look + joystick ---------------- */
const canvasEl = renderer.domElement;
const look = createLookControls(canvasEl, {
  pitch: -0.12,
  shouldIgnore: () => bulmong
});
const stick = document.getElementById('stick');
const knob = document.getElementById('knob');
const moveVec = createJoystick(stick, knob);

/* ---------------- collision ---------------- */
const obstacles = [
  { x: -7.5, z: 4.5, w: 2.6, d: 2.2 },
  { x: 8.2, z: 3.2, w: 2.6, d: 2.2 },
  { x: 2.8, z: -4.2, w: 0.6, d: 0.6 },
  { x: 0, z: 0, w: 1.6, d: 1.6 } /* fire ring */
];
function collide(p, r){
  collideWorld(p, r, { half: HALF }, obstacles);
}

/* ---------------- camera ---------------- */
const camTarget = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const camPos = new THREE.Vector3(player.position.x, 3.4, player.position.z + 7);
camera.position.copy(camPos);
const smoothTarget = new THREE.Vector3(0, 1.4, 0);

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
let appReady = false, hintHidden = false;
let lastFrame = 0;
const BULMONG_FPS = 30;
const BULMONG_FRAME = 1000 / BULMONG_FPS;

function tick(now){
  requestAnimationFrame(tick);

  /* mobile + 불멍 only: 30fps cap (desktop uncapped) */
  if (isMobile && bulmong){
    if (now - lastFrame < BULMONG_FRAME - 2) return;
    lastFrame = now;
  }

  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (bulmong) bulmongT += dt;

  /* --- time of day (entry-based dusk → night → dawn) --- */
  {
    const u = ((performance.now() - entryTime) / 1000) / TOD_CYCLE;
    const phase = u - Math.floor(u); /* 0..1 */
    /* 0 dusk, 0.35 night, 0.75 dawn, 1 dusk */
    let dusk = 0, night = 0, dawn = 0;
    if (phase < 0.35){ dusk = 1 - phase/0.35; night = phase/0.35; }
    else if (phase < 0.75){ night = 1 - (phase-0.35)/0.4; dawn = (phase-0.35)/0.4; }
    else { dawn = 1 - (phase-0.75)/0.25; dusk = (phase-0.75)/0.25; }
    const bg = new THREE.Color().setRGB(
      0.02*dusk + 0.01*night + 0.04*dawn,
      0.03*dusk + 0.02*night + 0.05*dawn,
      0.06*dusk + 0.04*night + 0.08*dawn
    );
    scene.background.copy(bg);
    scene.fog.color.setRGB(0.05*dusk + 0.03*night + 0.07*dawn, 0.07*dusk + 0.05*night + 0.08*dawn, 0.12*dusk + 0.08*night + 0.14*dawn);
    scene.fog.density = 0.009 + night * 0.005;
    ambLight.intensity = 0.35 + dusk * 0.25 + dawn * 0.35;
    hemiLight.intensity = 0.45 + dusk * 0.25 + dawn * 0.4;
    moon.intensity = 0.25 + night * 0.45;
  }

  /* --- NPC yield chairs to nearby players / peers --- */
  for (const npc of npcs){
    const ch = chairs[npc.chairIdx];
    let needYield = false;
    const pd = Math.hypot(player.position.x - ch.seatPos.x, player.position.z - ch.seatPos.z);
    if (pd < 1.8 && (playerState.pose === 'sit' || playerState.pose === 'roast') && playerState.sitChair === npc.chairIdx) needYield = true;
    if (!needYield && campNet && campNet.peers){
      for (const p of campNet.peers.values()){
        if (p.hidden) continue;
        if (Math.hypot(p.x - ch.seatPos.x, p.z - ch.seatPos.z) < 1.5 && (p.pose === 'sit' || p.pose === 'roast')){
          needYield = true; break;
        }
      }
    }
    if (needYield && npc.home){
      npc.home = false;
      ch.reserved = false;
      /* step back from fire */
      const ang = ch.angle;
      npc.rig.group.position.set(Math.cos(ang) * (CHAIR_R + 2.2), 0, Math.sin(ang) * (CHAIR_R + 2.2));
      npc.rig.group.position.y = 0;
      npc.rig.legL.rotation.x = 0; npc.rig.legR.rotation.x = 0;
      npc.rig.armL.rotation.x = -0.3; npc.rig.armR.rotation.x = -0.3;
      npc.rig.group.rotation.y = ang + Math.PI;
    } else if (!needYield && !npc.home){
      npc.yieldT += dt;
      if (npc.yieldT > 4){
        npc.yieldT = 0;
        /* return if chair free */
        let occupied = (playerState.sitChair === npc.chairIdx);
        if (!occupied && campNet){
          for (const p of campNet.peers.values()){
            if (Math.hypot(p.x - ch.seatPos.x, p.z - ch.seatPos.z) < 1.2){ occupied = true; break; }
          }
        }
        if (!occupied){
          npc.home = true;
          ch.reserved = true;
          npc.rig.group.position.copy(ch.seatPos);
          npc.rig.group.position.y = 0.42;
          npc.rig.group.rotation.y = ch.faceYaw;
          npc.rig.legL.rotation.x = -1.4; npc.rig.legR.rotation.x = -1.4;
        }
      }
    } else {
      npc.yieldT = 0;
      if (npc.home && npc.kind === 'guitar'){
        npc.rig.armR.rotation.x = -1.1 + Math.sin(elapsed * 5) * 0.15;
      }
    }
  }

  /* --- 10분 불멍 timer --- */
  if (bulmong){
    const left = Math.max(0, BULMONG_LIMIT - bulmongT);
    if (bulmongTimerEl){
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      bulmongTimerEl.textContent = m + ':' + String(s).padStart(2, '0');
    }
    if (left <= 0 && !bulmongEnded){
      bulmongEnded = true;
      netFireLevel = Math.min(netFireLevel, 0.12);
      showToast('불멍 10분 · 불이 잦아듭니다');
      /* one shooting star */
      if (!shootingStar){
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0]), 3));
        shootingStar = new THREE.Points(geo, new THREE.PointsMaterial({
          color: 0xfff5d0, size: 0.8, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, sizeAttenuation: true
        }));
        shootingStar.userData = { t: 0, x0: -40 + Math.random()*20, y0: 28, z0: -30 };
        scene.add(shootingStar);
      }
    }
  }
  if (shootingStar){
    shootingStar.userData.t += dt;
    const tt = shootingStar.userData.t;
    const x = shootingStar.userData.x0 + tt * 28;
    const y = shootingStar.userData.y0 - tt * 10;
    const z = shootingStar.userData.z0 + tt * 6;
    shootingStar.geometry.attributes.position.setXYZ(0, x, y, z);
    shootingStar.geometry.attributes.position.needsUpdate = true;
    shootingStar.material.opacity = Math.max(0, 1 - tt / 1.8);
    if (tt > 1.8){ scene.remove(shootingStar); shootingStar = null; }
  }

  /* --- fire particles + lights (server fireLevel + local flicker) --- */
  const windX = Math.sin(elapsed * 0.35) * 0.25;
  const windZ = Math.cos(elapsed * 0.28) * 0.18;
  const flicker = 0.72 + 0.28 * (0.5 + 0.5 * n1(elapsed, 7.2));
  const fl = Math.max(0.05, Math.min(1, netFireLevel));
  const emberOnly = fl < 0.18;
  const fireVis = emberOnly ? 0.08 : (0.25 + fl * 0.85);
  campAudio.setFireLevel(fl * (0.7 + flicker * 0.3));
  /* scale effective particle count via opacity / size; hide most when ember */
  flames.pts.visible = !emberOnly;
  smokes.pts.visible = !emberOnly;
  updateParticles(flames, dt, windX * 0.4, windZ * 0.4, 0.25, (0.55 + fl * 0.7) * (0.9 + flicker * 0.35));
  updateParticles(embers, dt, windX, windZ, 0.35, 0.7 + fl * 0.5);
  updateParticles(smokes, dt, windX * 1.2, windZ * 1.2, 0.9, (0.6 + fl * 0.6) * (1 + flicker * 0.2));
  flames.mat.opacity = emberOnly ? 0 : flames.opts.opacity * fireVis;
  smokes.mat.opacity = emberOnly ? 0 : smokes.opts.opacity * (0.4 + fl * 0.6);

  fireLight.intensity = (emberOnly ? 8 : 18 + fl * 28) * (0.85 + flicker * 0.25) + n1(elapsed, 11) * 2;
  fireLight.color.set(emberOnly ? 0xff3300 : 0xff7a28);
  fireLight.position.x = n1(elapsed, 5.5) * 0.12;
  fireLight.position.z = n1(elapsed + 1.2, 4.8) * 0.12;
  fireLight.position.y = 1.05 + n1(elapsed, 6.2) * 0.18;
  fireLightB.intensity = emberOnly ? 3 : 5 + fl * 10 * flicker;
  emberBed.material.emissiveIntensity = (emberOnly ? 1.2 : 1.6) + fl * 1.6 * flicker;
  emberGlow.material.opacity = (emberOnly ? 0.35 : 0.4) + fl * 0.35 * flicker;
  lantern.userData.light.intensity = 3.8 + Math.sin(elapsed * 2.4) * 0.5;
  lantern.userData.glass.material.emissiveIntensity = 1.5 + Math.sin(elapsed * 2.4) * 0.4;

  /* wish paper flight */
  for (let i = wishFX.length - 1; i >= 0; i--){
    const w = wishFX[i];
    w.age += dt;
    const u = w.age / w.life;
    if (w.age < 1.1){
      w.paper.position.lerp(new THREE.Vector3(0, 0.9, 0), 1 - Math.pow(0.04, dt));
      w.paper.rotation.z += dt * 2.5;
      w.paper.rotation.x += dt * 1.2;
    } else {
      w.paper.visible = false;
      for (const s of w.sparks){
        s.mesh.visible = true;
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.vy -= 2.2 * dt;
      }
    }
    if (w.age >= w.life){
      scene.remove(w.paper);
      for (const s of w.sparks) scene.remove(s.mesh);
      wishFX.splice(i, 1);
    }
  }

  /* marshmallow cook when roasting near fire */
  if (playerState.pose === 'roast'){
    ensureStick().visible = true;
    const dist = Math.hypot(player.position.x, player.position.z);
    const near = dist < 4.2;
    if (near) roastProgress += dt * 0.12;
    else roastProgress = Math.max(0, roastProgress - dt * 0.03);
    const m = stickGroup.userData.mallow;
    const mat = m.material;
    if (roastProgress < 0.85){
      mat.color.setRGB(1, 0.96 - roastProgress * 0.25, 0.9 - roastProgress * 0.45);
      mat.emissiveIntensity = 0.1 + roastProgress * 0.3;
    } else if (roastProgress < 1.15){
      mat.color.setRGB(0.55, 0.28, 0.1);
      mat.emissiveIntensity = 0.45;
    } else {
      mat.color.setRGB(0.12, 0.08, 0.06);
      mat.emissiveIntensity = 0.05;
    }
    stickGroup.rotation.z = -0.35;
    stickGroup.rotation.y = Math.sin(elapsed * 0.8) * 0.08;
  } else if (stickGroup){
    stickGroup.visible = false;
  }

  /* --- movement (disabled while sitting / bulmong) --- */
  let ix = 0, iz = 0;
  if (chatOpen || wishOpen) clearHeldKeys();
  const canMove = playerState.pose !== 'sit' && playerState.pose !== 'roast' && !bulmong && !chatOpen && !wishOpen;
  if (canMove){
    if (keys['KeyW'] || keys['ArrowUp']) iz -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) iz += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    ix += moveVec.x; iz += moveVec.y;
  } else {
    moveVec.x = 0; moveVec.y = 0;
  }
  const mag = Math.min(1, Math.hypot(ix, iz));
  if (mag > 0.02){ ix /= Math.max(mag, 0.0001); iz /= Math.max(mag, 0.0001); }
  else { ix = 0; iz = 0; }
  const walking = mag > 0.05;
  if (walking && playerState.pose === 'sit') setSit(false);
  const targetSpeed = walking ? (playerState.run ? 5.0 : 2.5) * Math.min(1, mag * 1.4) : 0;
  playerState.speed = THREE.MathUtils.damp(playerState.speed, targetSpeed, 9, dt);

  const yaw = look.yaw;
  const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  tmpDir.set(fwdX * (-iz) + rightX * ix, 0, fwdZ * (-iz) + rightZ * ix);
  if (tmpDir.lengthSq() > 0 && canMove){
    tmpDir.normalize();
    player.position.x += tmpDir.x * playerState.speed * dt;
    player.position.z += tmpDir.z * playerState.speed * dt;
    collide(player.position, 0.42);
    const wantYaw = Math.atan2(tmpDir.x, tmpDir.z);
    let diff = wrapPi(wantYaw - playerState.yaw);
    playerState.yaw += diff * Math.min(1, dt * 12);
  }

  /* sit: walk/snap toward chair, face fire */
  if (playerState.pose === 'sit' && playerState.sitChair >= 0){
    const ch = chairs[playerState.sitChair];
    playerState.sitProgress = Math.min(1, playerState.sitProgress + dt * 1.6);
    const t = playerState.sitProgress;
    player.position.x = THREE.MathUtils.lerp(player.position.x, ch.seatPos.x, 1 - Math.pow(0.02, dt));
    player.position.z = THREE.MathUtils.lerp(player.position.z, ch.seatPos.z, 1 - Math.pow(0.02, dt));
    let dy = wrapPi(ch.faceYaw - playerState.yaw);
    playerState.yaw += dy * Math.min(1, dt * 4);
    /* camera slowly turns toward fire */
    const toFire = Math.atan2(-player.position.x, -player.position.z);
    /* look.yaw is camera orbit around player; ease so fire is in view */
    const wantLook = toFire + Math.PI; /* behind player looking at fire through player */
    let ld = wrapPi(wantLook - look.yaw);
    look.yaw += ld * Math.min(1, dt * 1.2);
    look.pitch = THREE.MathUtils.damp(look.pitch, -0.08, 2.5, dt);
  }

  playerState.sitMix = THREE.MathUtils.damp(
    playerState.sitMix, (playerState.pose === 'sit' || playerState.pose === 'roast') ? 1 : 0, 6, dt);

  /* walk cycle */
  const moving = playerState.speed > 0.15 && playerState.sitMix < 0.5;
  playerState.bob += dt * (moving ? playerState.speed * 3.4 : 0);
  const swing = Math.sin(playerState.bob) * Math.min(1, playerState.speed / 3);
  const idle = Math.abs(Math.sin(elapsed * 1.8)) * 0.015;

  let legLx = swing * 0.85, legRx = -swing * 0.85;
  let armLx = -swing * 0.7, armRx = swing * 0.7;
  let armLz = 0.12, armRz = -0.12;
  let bodyY = moving ? Math.abs(Math.sin(playerState.bob)) * 0.05 : idle;
  let headY = 1.92;

  if (playerState.sitMix > 0.01){
    /* blend toward sit / roast */
    bodyY = THREE.MathUtils.lerp(bodyY, 0.42, playerState.sitMix);
    headY = THREE.MathUtils.lerp(headY, 1.78, playerState.sitMix);
    legLx = THREE.MathUtils.lerp(legLx, -1.4, playerState.sitMix);
    legRx = THREE.MathUtils.lerp(legRx, -1.4, playerState.sitMix);
    const roast = playerState.pose === 'roast';
    armLx = THREE.MathUtils.lerp(armLx, roast ? -0.25 : -0.9, playerState.sitMix);
    armRx = THREE.MathUtils.lerp(armRx, roast ? -1.55 : -0.9, playerState.sitMix);
    armLz = THREE.MathUtils.lerp(armLz, roast ? 0.2 : 0.4, playerState.sitMix);
    armRz = THREE.MathUtils.lerp(armRz, roast ? -0.1 : -0.4, playerState.sitMix);
  }

  if (localEmote && performance.now() < localEmoteUntil){
    if (localEmote === 'wave'){ armRx = -0.2 + Math.sin(performance.now() * 0.02) * 1.2; armRz = -0.6; }
    else if (localEmote === 'nod'){ headY = 1.92 + Math.sin(performance.now() * 0.015) * 0.04; }
    else if (localEmote === 'cheers'){ armLx = -2.2; armRx = -2.2; armLz = 0.5; armRz = -0.5; }
  } else { localEmote = null; }

  pLegL.rotation.x = legLx;
  pLegR.rotation.x = legRx;
  pArmL.rotation.x = armLx;
  pArmR.rotation.x = armRx;
  pArmL.rotation.z = armLz;
  pArmR.rotation.z = armRz;
  pTorso.rotation.z = moving ? 0 : Math.sin(elapsed * 1.2) * 0.02;
  pTorso.rotation.x = playerState.sitMix * 0.16;
  player.position.y = bodyY;
  pHead.position.y = headY;
  player.rotation.y = playerState.yaw;
  pChest.material.emissiveIntensity = 1.4 + flicker * 0.8;

  /* --- camera --- */
  if (bulmong){
    /* lock on fire with slow drift */
    const drift = bulmongT;
    const radius = 5.2 + Math.sin(drift * 0.15) * 0.45;
    const ang = drift * 0.08 + look.yaw * 0.15;
    const height = 1.55 + Math.sin(drift * 0.22) * 0.25;
    camDesired.set(
      Math.sin(ang) * radius,
      height,
      Math.cos(ang) * radius
    );
    camera.position.lerp(camDesired, 1 - Math.pow(0.08, dt));
    camTarget.set(
      fireLight.position.x * 0.3,
      0.85 + Math.sin(drift * 0.3) * 0.12,
      fireLight.position.z * 0.3
    );
    smoothTarget.lerp(camTarget, 1 - Math.pow(0.05, dt));
    camera.lookAt(smoothTarget);
    bloom.strength = isMobile ? 0.5 : 0.72;
  } else {
    const dist = isMobile ? 6.4 : 5.8;
    const height = 2.45 + look.pitch * 3.0;
    camDesired.set(
      player.position.x + Math.sin(yaw) * dist,
      player.position.y + height,
      player.position.z + Math.cos(yaw) * dist
    );
    camDesired.x = THREE.MathUtils.clamp(camDesired.x, -HALF + 1.5, HALF - 1.5);
    camDesired.z = THREE.MathUtils.clamp(camDesired.z, -HALF + 1.5, HALF - 1.5);
    camDesired.y = THREE.MathUtils.clamp(camDesired.y, 1.1, 12);
    camera.position.lerp(camDesired, 1 - Math.pow(0.0022, dt));
    camTarget.set(player.position.x, player.position.y + 1.55, player.position.z);
    smoothTarget.lerp(camTarget, 1 - Math.pow(0.0009, dt));
    camera.lookAt(smoothTarget);
    bloom.strength = isMobile ? 0.42 : 0.58;
  }

  campNet.update(dt);
  campNet.filterBubblesByRange(player.position.x, player.position.z, 8);
  if (selfBubble){
    selfBubble.position.set(player.position.x, player.position.y + 2.55, player.position.z);
    if (performance.now() > selfBubbleUntil){
      scene.remove(selfBubble); selfBubble = null;
    }
  }

  rimLight.intensity = 2.5 + flicker * 2;
  renderer.toneMappingExposure = 1.0 + flicker * 0.06;
  composer.render();

  if (!appReady){ appReady = true; app.classList.add('ready'); }
  if (!hintHidden && elapsed > 10){
    document.getElementById('hint').classList.add('hide');
    hintHidden = true;
  }
}
requestAnimationFrame(tick);

