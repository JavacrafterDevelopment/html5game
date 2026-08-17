/**
 * Procedural weapon models: AK-47, M4A1, Glock 17, M700.
 *
 * Built from primitives at real-world scale, muzzle pointing down -Z so a model can
 * be parented straight to the camera with no corrective rotation.
 *
 * Each builder returns a `sight` point -- the exact spot on the weapon the shooter's
 * eye lines up with. The view model aims by translating that point onto the screen
 * centre, which means the irons always line up no matter how the model was drawn.
 */

import * as THREE from '../core/three.js';
import { parseBase64GLB, loadGLB } from '../core/GLBParser.js';
import { AK_GLB_BASE64 } from '../assets/AKModelData.js';
import { clamp, lerp } from '/shared/math/num.js';

let cachedAK47 = null;
try {
  cachedAK47 = parseBase64GLB(AK_GLB_BASE64);
} catch (err) {
  console.warn('Failed to parse bundled AK GLB model:', err);
}

let cachedM4 = null;

/** Try each candidate URL in turn; returns null if none of them load. */
async function loadFirst(urls, label) {
  for (const url of urls) {
    try {
      return await loadGLB(url);
    } catch { /* try the next one */ }
  }
  console.warn(`Failed to load ${label}, falling back to the procedural model.`);
  return null;
}

/** Preload binary weapon assets before deployment */
export async function preloadWeaponModels() {
  const jobs = [];
  if (!cachedAK47) {
    jobs.push(loadFirst(['/client/assets/ak.glb', '/assets/ak.glb'], 'ak.glb')
      .then((m) => { if (m) cachedAK47 = m; }));
  }
  if (!cachedM4) {
    jobs.push(loadFirst(['/assets/m4.glb', '/client/assets/m4.glb'], 'm4.glb')
      .then((m) => { if (m) cachedM4 = m; }));
  }
  await Promise.all(jobs);
}

// ------------------------------------------------------------------ materials
let M = null;
function materials() {
  if (M) return M;
  M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.42, metalness: 0.88 }),
    blued: new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.34, metalness: 0.92 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.78, metalness: 0.05 }),
    polymerLight: new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.72, metalness: 0.05 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.62, metalness: 0.02 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x4e2d18, roughness: 0.6, metalness: 0.02 }),
    tape: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.92, metalness: 0.0 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x101c26, roughness: 0.08, metalness: 0.6,
      emissive: 0x0a1a26, emissiveIntensity: 0.4
    }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb0883a, roughness: 0.35, metalness: 0.9 }),
    sight: new THREE.MeshStandardMaterial({ color: 0xe9f2f7, roughness: 0.5, metalness: 0.2 })
  };
  return M;
}

// ------------------------------------------------------------------- builder
class GunBuilder {
  constructor() {
    this.group = new THREE.Group();
    this.mats = materials();
  }

  box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    this.group.add(m);
    return m;
  }

  /** Cylinder lying along Z (the barrel axis). */
  tube(rTop, rBot, len, mat, x = 0, y = 0, z = 0, seg = 10) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  /** Cylinder along Y (grips, turrets). */
  post(rTop, rBot, len, mat, x = 0, y = 0, z = 0, seg = 8) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, seg), mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  /** Trigger guard: three thin bars forming a loop. */
  triggerGuard(mat, y, z, width = 0.02) {
    this.box(width, 0.008, 0.075, mat, 0, y - 0.042, z);
    this.box(width, 0.038, 0.008, mat, 0, y - 0.023, z - 0.034);
    this.box(width, 0.038, 0.008, mat, 0, y - 0.023, z + 0.034);
    this.box(0.008, 0.03, 0.01, mat, 0, y - 0.018, z - 0.005);   // trigger blade
  }

  finish(data) {
    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });
    return { group: this.group, ...data };
  }
}

function marker(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ------------------------------------------------------------------- AK-47
function buildAK47() {
  if (cachedAK47) {
    const group = new THREE.Group();
    const model = cachedAK47.clone(true);
    // Point muzzle down -Z:
    model.rotation.y = Math.PI / 2;
    group.add(model);

    group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });

    const muzzle = marker(group, 0, 0.0, -0.47);
    const eject = marker(group, 0.032, 0.02, 0.06);

    return {
      group,
      muzzle,
      eject,
      shared: true,                     // geometry belongs to the cache, never dispose it
      sight: new THREE.Vector3(0, 0.054, -0.22),
      id: 'ak47'
    };
  }

  const b = new GunBuilder();
  const m = b.mats;

  // receiver
  b.box(0.070, 0.098, 0.335, m.steel, 0, 0.005, -0.03);
  b.box(0.074, 0.028, 0.30, m.blued, 0, 0.056, -0.05);          // dust cover
  b.box(0.030, 0.022, 0.09, m.blued, 0.036, 0.045, 0.02);       // charging handle rail

  // barrel + gas system
  b.tube(0.0115, 0.0115, 0.42, m.blued, 0, 0.030, -0.33);
  b.tube(0.017, 0.017, 0.215, m.blued, 0, 0.062, -0.245);        // gas tube
  b.box(0.026, 0.036, 0.045, m.blued, 0, 0.052, -0.145);         // gas block

  // wood furniture
  b.box(0.056, 0.062, 0.195, m.wood, 0, 0.012, -0.255);          // lower handguard
  b.box(0.050, 0.040, 0.150, m.wood, 0, 0.070, -0.248);          // upper handguard
  b.box(0.048, 0.030, 0.070, m.woodDark, 0, -0.008, -0.165);     // grip ledge

  // muzzle
  b.tube(0.0165, 0.0165, 0.055, m.blued, 0, 0.030, -0.545);
  b.box(0.020, 0.048, 0.028, m.blued, 0, 0.062, -0.505);         // front sight base
  b.post(0.0022, 0.0022, 0.024, m.sight, 0, 0.090, -0.505);      // front post

  // rear sight
  b.box(0.030, 0.014, 0.038, m.blued, 0, 0.073, -0.155);
  b.box(0.008, 0.010, 0.006, m.sight, 0, 0.081, -0.152);

  // magazine: three segments approximate the classic banana curve
  b.box(0.030, 0.090, 0.072, m.blued, 0, -0.078, -0.055, 0.10, 0, 0);
  b.box(0.030, 0.075, 0.066, m.blued, 0, -0.150, -0.078, 0.34, 0, 0);
  b.box(0.030, 0.045, 0.058, m.blued, 0, -0.208, -0.118, 0.62, 0, 0);

  // pistol grip
  b.box(0.034, 0.125, 0.050, m.polymer, 0, -0.088, 0.055, 0.30, 0, 0);
  b.triggerGuard(m.blued, -0.030, -0.005);

  // stock
  b.box(0.050, 0.072, 0.255, m.wood, 0, -0.028, 0.245, -0.06, 0, 0);
  b.box(0.048, 0.086, 0.030, m.woodDark, 0, -0.043, 0.375, -0.06, 0, 0);   // butt plate
  b.box(0.040, 0.038, 0.110, m.wood, 0, 0.005, 0.165);                     // tang

  const muzzle = marker(b.group, 0, 0.030, -0.575);
  const eject = marker(b.group, 0.042, 0.040, -0.02);
  return b.finish({
    muzzle, eject,
    sight: new THREE.Vector3(0, 0.086, -0.30),   // eye line: down the iron sights
    id: 'ak47'
  });
}

// ------------------------------------------------------------------- M4A1
/**
 * m4.glb ships as 18 separately named nodes under `M4_Carbine_Root`, already
 * pointing down -Z at life size (0.84 m flash hider to buttplate), so it needs no
 * corrective rotation -- only the sight tilt below.
 */
const M4_GEO = {
  // Rear aperture centre: where the shooter's eye sits.
  sight: new THREE.Vector3(0, 0.0955, 0.152),
  // The front post tip is 9.5 mm proud of the aperture across a 38 cm sight
  // radius. Translating the aperture to screen centre is not enough on its own --
  // without pitching the rifle nose-down by that angle the post floats about
  // 1.4 degrees above the ring when you aim.
  tilt: -0.025,
  muzzle: [0, 0.033, -0.452],
  eject: [0.030, 0.024, 0.070]
};

const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const easeOut = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Magazine keyframes, in the rest frame of the magazine well. (0,0,0) is seated.
 * It is pulled straight down, brought up into the off-hand where it stays for the
 * whole throw, then arced back into the fresh rifle.
 */
const MAG_KEYS = [
  { t: 0.00, p: [0, 0, 0], r: [0, 0, 0] },
  { t: 0.12, p: [0, -0.10, 0.02], r: [0.10, 0.00, 0.12] },
  // Held up where the camera can see it. These offsets are relative to the hip
  // pose in shared/weapons.js -- move that and the magazine leaves the frame.
  { t: 0.30, p: [-0.10, 0.190, -0.15], r: [0.55, 0.85, 0.35] },
  { t: 0.72, p: [-0.08, 0.205, -0.16], r: [0.42, 1.25, 0.28] },
  { t: 0.88, p: [0, 0.006, 0], r: [0, 0, 0] },
  { t: 0.93, p: [0, 0, 0], r: [0, 0, 0] }
];

function sampleMag(t, outPos, outRot) {
  let a = MAG_KEYS[0], b = MAG_KEYS[MAG_KEYS.length - 1];
  for (let i = 0; i < MAG_KEYS.length - 1; i++) {
    if (t >= MAG_KEYS[i].t && t <= MAG_KEYS[i + 1].t) { a = MAG_KEYS[i]; b = MAG_KEYS[i + 1]; break; }
    if (t > MAG_KEYS[i].t) { a = MAG_KEYS[i]; b = MAG_KEYS[i + 1]; }
  }
  const k = easeInOut(seg(t, a.t, b.t));
  outPos.set(
    lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k)
  );
  outRot.set(
    lerp(a.r[0], b.r[0], k), lerp(a.r[1], b.r[1], k), lerp(a.r[2], b.r[2], k)
  );
}

/**
 * The reload.
 *
 * The joke: the magazine is the part you keep. Rip it out, hurl the rifle down
 * range, take a fresh rifle off screen, slam the same magazine into it.
 *
 * The thrown rifle and the fresh one are the same object. It is well outside the
 * frustum between t=0.36 and t=0.50, so the hard cut from "tumbling away" to
 * "rising into frame" is never visible.
 */
function makeM4Reload(parts) {
  const { gun, stash, mag, magHome, magSeat, charge, bolt } = parts;
  const magPos = new THREE.Vector3();
  const magRot = new THREE.Euler();
  let active = false;

  return {
    // The rifle is airborne for most of this; aiming through it makes no sense.
    blocksAds: true,

    begin() {
      active = true;
      // magSeat shares the magazine well's frame, so handing it across at
      // (0,0,0) does not move it a millimetre.
      magSeat.add(mag);
    },

    update(t, pose) {
      if (!active) return;

      // ---- the rifle -------------------------------------------------------
      const fly = seg(t, 0.12, 0.40);
      if (t < 0.12) {
        // still in hand, rolling right so the magazine well faces the camera
        const out = easeOut(seg(t, 0, 0.12));
        gun.visible = true;
        gun.position.set(0, 0, 0);
        gun.rotation.set(0, 0, -0.30 * out);
      } else if (fly < 1) {
        // Thrown away: a real projectile, so linear in time rather than eased --
        // it leaves the hand fast and gravity takes over. It has to clear the
        // BOTTOM edge of the frame well before it is hidden, otherwise the swap
        // to the fresh rifle reads as the old one blinking out of existence.
        // At fly=0.8 the whole rifle is already below the frustum.
        const f = fly;
        gun.visible = true;
        gun.position.set(-0.50 * f, 0.55 * f - 3.6 * f * f, -1.9 * f);
        gun.rotation.set(-7.5 * f, 1.3 * f, 2.4 * f);
      } else if (t < 0.50) {
        gun.visible = false;   // empty hands, one magazine, one beat
      } else {
        // a fresh one swings up from below the frame, canted over
        const r = 1 - easeOut(seg(t, 0.50, 0.74));
        gun.visible = true;
        gun.position.set(0.20 * r, -0.75 * r, 0);
        gun.rotation.set(0.55 * r, -0.50 * r, -0.90 * r);
      }

      // ---- the magazine ----------------------------------------------------
      sampleMag(t, magPos, magRot);
      stash.position.set(magPos.x, magPos.y, magPos.z);
      stash.rotation.copy(magRot);

      // ---- charging handle, once the magazine is home -----------------------
      const yank = Math.sin(seg(t, 0.90, 1.0) * Math.PI);
      charge.position.z = yank * 0.055;
      bolt.position.z = yank * 0.050;

      // ---- what the whole viewmodel does ------------------------------------
      const swell = Math.sin(clamp(t, 0, 1) * Math.PI);
      pose.pos.y -= swell * 0.035;
      pose.rot.x += swell * 0.10;
      if (t > 0.88 && t < 0.94) pose.pos.y += Math.sin((t - 0.88) * 105) * 0.010;
    },

    end() {
      active = false;
      magHome.add(mag);
      gun.visible = true;
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
      stash.position.set(0, 0, 0);
      stash.rotation.set(0, 0, 0);
      charge.position.z = 0;
      bolt.position.z = 0;
    }
  };
}

function buildM4A1() {
  if (cachedM4) return buildM4A1FromGLB();
  return buildM4A1Procedural();
}

function buildM4A1FromGLB() {
  const group = new THREE.Group();

  // tilt pivots about the rear aperture so the irons line up down -Z
  const tilt = new THREE.Group();
  tilt.position.copy(M4_GEO.sight);
  tilt.rotation.x = M4_GEO.tilt;
  group.add(tilt);

  // `gun` is everything that gets thrown; `stash` is the off-hand holding the
  // magazine. Both are pure animation frames parked at the origin, so the
  // choreography can assign position/rotation outright and reset to zero without
  // having to remember a rest offset. The offset that undoes the tilt pivot lives
  // one level down, where nothing animates it.
  const gun = new THREE.Group();
  tilt.add(gun);
  const gunRest = new THREE.Group();
  gunRest.position.copy(M4_GEO.sight).negate();
  gun.add(gunRest);

  const stash = new THREE.Group();
  tilt.add(stash);
  const magSeat = new THREE.Group();
  magSeat.position.copy(gunRest.position);
  stash.add(magSeat);

  const model = cachedM4.clone(true);
  gunRest.add(model);

  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
  });

  const part = (name) => model.getObjectByName(name) || new THREE.Object3D();
  const mag = part('M4_Magazine');
  const magHome = mag.parent || model;

  const muzzle = marker(gunRest, M4_GEO.muzzle[0], M4_GEO.muzzle[1], M4_GEO.muzzle[2]);
  const eject = marker(gunRest, M4_GEO.eject[0], M4_GEO.eject[1], M4_GEO.eject[2]);

  const reload = makeM4Reload({
    gun, stash, mag, magHome, magSeat,
    charge: part('M4_ChargingHandle'),
    bolt: part('M4_BoltCarrier')
  });

  return {
    group,
    muzzle,
    eject,
    reload,
    shared: true,                       // geometry belongs to the cache, never dispose it
    sight: M4_GEO.sight.clone(),
    id: 'm4a1'
  };
}

function buildM4A1Procedural() {
  const b = new GunBuilder();
  const m = b.mats;

  // receivers
  b.box(0.048, 0.062, 0.245, m.polymerLight, 0, 0.022, -0.055);
  b.box(0.044, 0.070, 0.150, m.polymerLight, 0, -0.036, 0.01);
  b.box(0.052, 0.014, 0.285, m.polymer, 0, 0.058, -0.10);          // flat-top rail
  for (let i = 0; i < 9; i++) {
    b.box(0.054, 0.006, 0.012, m.polymer, 0, 0.066, -0.215 + i * 0.030);
  }

  // RIS handguard
  b.box(0.056, 0.056, 0.235, m.polymer, 0, 0.022, -0.300);
  b.box(0.062, 0.014, 0.235, m.polymer, 0, 0.052, -0.300);
  b.box(0.014, 0.056, 0.235, m.polymer, -0.030, 0.022, -0.300);
  b.box(0.014, 0.056, 0.235, m.polymer, 0.030, 0.022, -0.300);

  // barrel
  b.tube(0.0095, 0.0095, 0.28, m.blued, 0, 0.022, -0.46);
  b.tube(0.014, 0.014, 0.055, m.blued, 0, 0.022, -0.585);          // flash hider
  b.box(0.006, 0.010, 0.030, m.polymer, 0, 0.034, -0.585);

  // front sight tower
  b.box(0.024, 0.060, 0.030, m.polymer, 0, 0.052, -0.415);
  b.post(0.0022, 0.0022, 0.026, m.sight, 0, 0.086, -0.415);

  // carry-handle style rear aperture
  b.box(0.030, 0.030, 0.040, m.polymer, 0, 0.078, -0.02);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0028, 5, 12), m.polymer);
  ring.position.set(0, 0.083, -0.012);
  b.group.add(ring);

  // magazine
  b.box(0.028, 0.175, 0.062, m.polymer, 0, -0.145, -0.035, 0.09, 0, 0);
  b.box(0.030, 0.014, 0.064, m.polymerLight, 0, -0.232, -0.043, 0.09, 0, 0);

  // grip + trigger
  b.box(0.032, 0.118, 0.048, m.polymer, 0, -0.092, 0.052, 0.28, 0, 0);
  b.triggerGuard(m.polymerLight, -0.030, 0.0);

  // buffer tube + collapsible stock
  b.tube(0.019, 0.019, 0.20, m.polymerLight, 0, -0.002, 0.16);
  b.box(0.048, 0.070, 0.120, m.polymer, 0, -0.012, 0.205);
  b.box(0.046, 0.088, 0.026, m.polymer, 0, -0.020, 0.272);
  b.box(0.028, 0.040, 0.070, m.polymer, 0, -0.048, 0.185);         // cheek weld

  // charging handle
  b.box(0.040, 0.012, 0.030, m.polymerLight, 0, 0.040, 0.075);

  const muzzle = marker(b.group, 0, 0.022, -0.615);
  const eject = marker(b.group, 0.030, 0.036, -0.03);
  return b.finish({
    muzzle, eject,
    sight: new THREE.Vector3(0, 0.083, -0.28),
    id: 'm4a1'
  });
}

// ------------------------------------------------------------------- Glock 17
function buildGlock17() {
  const b = new GunBuilder();
  const m = b.mats;

  // slide
  b.box(0.026, 0.033, 0.172, m.blued, 0, 0.020, -0.030);
  b.box(0.027, 0.012, 0.172, m.blued, 0, 0.037, -0.030);
  for (let i = 0; i < 6; i++) {                                    // rear serrations
    b.box(0.028, 0.026, 0.004, m.steel, 0, 0.020, 0.018 + i * 0.008);
  }

  // frame
  b.box(0.024, 0.030, 0.140, m.polymer, 0, -0.006, -0.020);
  b.box(0.026, 0.012, 0.055, m.polymer, 0, -0.020, -0.070);        // accessory rail
  b.tube(0.0058, 0.0058, 0.020, m.steel, 0, 0.018, -0.118);        // barrel crown

  // grip
  b.box(0.026, 0.115, 0.038, m.polymer, 0, -0.072, 0.030, 0.26, 0, 0);
  b.box(0.028, 0.016, 0.040, m.polymerLight, 0, -0.128, 0.045, 0.26, 0, 0);
  b.box(0.027, 0.030, 0.030, m.polymer, 0, -0.030, 0.028, 0.26, 0, 0);   // beavertail

  b.triggerGuard(m.polymer, -0.012, -0.008, 0.016);

  // sights: white dot front, notch rear
  b.box(0.004, 0.008, 0.005, m.sight, 0, 0.042, -0.108);
  b.box(0.014, 0.008, 0.006, m.blued, 0, 0.042, 0.044);
  b.box(0.003, 0.006, 0.004, m.sight, -0.005, 0.042, 0.044);
  b.box(0.003, 0.006, 0.004, m.sight, 0.005, 0.042, 0.044);

  const muzzle = marker(b.group, 0, 0.018, -0.130);
  const eject = marker(b.group, 0.016, 0.030, -0.01);
  return b.finish({
    muzzle, eject,
    sight: new THREE.Vector3(0, 0.045, -0.05),
    id: 'glock17'
  });
}

// ------------------------------------------------------------------- M700
function buildM700() {
  const b = new GunBuilder();
  const m = b.mats;

  // stock
  b.box(0.052, 0.078, 0.300, m.woodDark, 0, -0.032, 0.130);
  b.box(0.050, 0.060, 0.240, m.woodDark, 0, -0.030, -0.145);        // forend
  b.box(0.054, 0.052, 0.090, m.woodDark, 0, 0.006, 0.180);          // raised comb
  b.box(0.056, 0.100, 0.032, m.polymer, 0, -0.050, 0.288, -0.05, 0, 0);  // recoil pad
  b.box(0.050, 0.048, 0.070, m.woodDark, 0, -0.070, -0.015);        // pistol swell

  // receiver + heavy barrel
  b.box(0.040, 0.048, 0.215, m.blued, 0, 0.020, -0.075);
  b.tube(0.0125, 0.0155, 0.520, m.blued, 0, 0.026, -0.440);
  b.tube(0.0135, 0.0135, 0.030, m.steel, 0, 0.026, -0.700);         // crown

  // winter tape wrap on the barrel -- matches the uniform
  b.tube(0.0165, 0.0165, 0.055, m.tape, 0, 0.026, -0.300);
  b.tube(0.0160, 0.0160, 0.040, m.tape, 0, 0.026, -0.480);

  // bolt
  b.tube(0.0115, 0.0115, 0.150, m.steel, 0.021, 0.030, 0.010);
  b.post(0.0075, 0.0075, 0.055, m.steel, 0.034, 0.010, 0.070, 6).rotation.z = -0.55;
  b.post(0.011, 0.011, 0.014, m.steel, 0.046, -0.010, 0.070, 8);    // bolt knob

  // magazine floorplate + trigger
  b.box(0.036, 0.020, 0.090, m.blued, 0, -0.052, -0.040);
  b.triggerGuard(m.blued, -0.040, 0.010, 0.018);

  // ---- scope ----
  const scopeY = 0.108;
  b.tube(0.0195, 0.0195, 0.250, m.blued, 0, scopeY, -0.105);        // main tube
  b.tube(0.0315, 0.0315, 0.085, m.blued, 0, scopeY, -0.268);        // objective bell
  b.tube(0.0320, 0.0320, 0.012, m.steel, 0, scopeY, -0.312);        // objective ring
  b.tube(0.0270, 0.0270, 0.070, m.blued, 0, scopeY, 0.052);         // ocular bell
  b.tube(0.0255, 0.0255, 0.010, m.steel, 0, scopeY, 0.088);         // eyepiece ring
  // lenses
  const front = b.tube(0.0295, 0.0295, 0.004, m.glass, 0, scopeY, -0.316);
  front.name = 'objectiveLens';
  b.tube(0.0235, 0.0235, 0.004, m.glass, 0, scopeY, 0.092);
  // turrets
  b.post(0.0135, 0.0135, 0.030, m.blued, 0, scopeY + 0.028, -0.055, 8);
  b.post(0.0135, 0.0135, 0.030, m.blued, 0.028, scopeY, -0.055, 8).rotation.z = Math.PI / 2;
  // rings
  b.box(0.030, 0.040, 0.020, m.steel, 0, scopeY - 0.028, -0.185);
  b.box(0.030, 0.040, 0.020, m.steel, 0, scopeY - 0.028, -0.010);
  b.box(0.048, 0.014, 0.230, m.blued, 0, 0.048, -0.095);            // scope base rail

  // folded bipod under the forend
  b.box(0.014, 0.014, 0.090, m.polymer, -0.016, -0.062, -0.210, 0.25, 0, 0.2);
  b.box(0.014, 0.014, 0.090, m.polymer, 0.016, -0.062, -0.210, 0.25, 0, -0.2);

  const muzzle = marker(b.group, 0, 0.026, -0.718);
  const eject = marker(b.group, 0.030, 0.034, -0.02);
  return b.finish({
    muzzle, eject,
    sight: new THREE.Vector3(0, scopeY, 0.02),    // eye sits behind the ocular
    scopeCenter: new THREE.Vector3(0, scopeY, 0.06),
    id: 'm700'
  });
}

// ------------------------------------------------------------------ registry
const BUILDERS = {
  ak47: buildAK47,
  m4a1: buildM4A1,
  glock17: buildGlock17,
  m700: buildM700
};

/**
 * Build a fresh weapon model.
 * @param {string} id
 * @param {{ worldModel?: boolean }} opts world models are simplified + shadow-only tweaks
 */
export function createWeaponModel(id, opts = {}) {
  const build = BUILDERS[id] || BUILDERS.ak47;
  const result = build();

  if (opts.worldModel) {
    // Third-person copies never need the scope glass or the tiny rail detail.
    result.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  }
  return result;
}

export function disposeWeaponModel(model) {
  // GLB-backed models clone the cached scene, which SHARES geometry with it.
  // Disposing those buffers would blank the next copy of the weapon.
  if (model.shared) return;
  model.group.traverse((o) => {
    if (o.isMesh && o.geometry) o.geometry.dispose();
  });
}
