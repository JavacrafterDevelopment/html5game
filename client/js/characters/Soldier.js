/**
 * The soldier: a procedurally built winter-warfare operator.
 *
 * Built as a bone hierarchy of rigid parts rather than a skinned mesh. That choice
 * is deliberate -- the exact same parts can be handed to the ragdoll solver on death
 * and driven from particle positions, with no skinning to unwind.
 *
 * Every limb mesh has its origin at its PROXIMAL joint and extends down -Y.
 * Animation therefore = rotate the bone; ragdoll = point -Y at the next particle.
 */

import * as THREE from '../core/three.js';
import { getCamoMaterials } from './CamoTexture.js';
import { getSuitMaterials } from './SpaceSuit.js';

/** Skeleton measurements, metres. Sums to the 1.80 m player height in shared/config.js. */
export const RIG = {
  hipY: 0.95,
  spineLen: 0.16,
  chestLen: 0.20,
  neckLen: 0.19,
  headOffset: 0.07,
  headRadius: 0.105,
  shoulderX: 0.195,
  shoulderY: 0.095,
  upperArm: 0.29,
  lowerArm: 0.26,
  handLen: 0.10,
  hipX: 0.105,
  thigh: 0.45,
  shin: 0.40,
  footLen: 0.235
};

function makeLimb(rTop, rBot, len, material, segments = 7) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, segments, 1);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.userData.limbLength = len;
  return m;
}

function makeBox(w, h, d, material, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function joint(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** A bearing ring round a limb. Suits are full of them and soldiers have none. */
function makeRing(parent, radius, thickness, material, y = 0) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 14), material);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  parent.add(m);
  return m;
}

/**
 * @param {{ shadows?: boolean, style?: string }} opts
 *   style 'astronaut' swaps the materials and the hardware bolted to the rig, and
 *   nothing else -- same bones, same proportions, same limb origins. That is what
 *   lets the animator and the ragdoll solver stay unaware there are two of these.
 * @returns {{ group: THREE.Group, bones: object, parts: object, weaponMount: THREE.Object3D }}
 */
export function createSoldier(opts = {}) {
  const suited = opts.style === 'astronaut';
  const mats = suited ? getSuitMaterials() : getCamoMaterials();
  const shadows = opts.shadows !== false;

  const group = new THREE.Group();
  const bones = {};
  const parts = {};

  // ------------------------------------------------------------- torso
  const hips = joint(group, 0, RIG.hipY, 0);
  bones.hips = hips;

  const pelvis = makeBox(0.30, 0.26, 0.22, mats.camo, 0, -0.09, 0);
  hips.add(pelvis);
  parts.pelvis = pelvis;

  // belt
  const belt = makeBox(0.315, 0.06, 0.235, mats.webbing, 0, -0.02, 0);
  hips.add(belt);

  const spine = joint(hips, 0, RIG.spineLen, 0);
  bones.spine = spine;
  const chest = joint(spine, 0, RIG.chestLen, 0);
  bones.chest = chest;

  // ribcage: two stacked boxes taper the silhouette from shoulders to waist
  const torso = makeBox(0.40, 0.30, 0.235, mats.camo, 0, -0.13, 0);
  chest.add(torso);
  parts.torso = torso;
  const upperChest = makeBox(0.435, 0.20, 0.255, mats.camo, 0, 0.0, 0);
  chest.add(upperChest);

  if (suited) {
    // Hard upper torso: the fibreglass shell everything else hangs off.
    const hut = makeBox(0.455, 0.44, 0.335, mats.gearLight, 0, -0.09, 0.005);
    chest.add(hut);
    chest.add(makeBox(0.475, 0.055, 0.35, mats.metal, 0, 0.075, 0.005));      // neck ring line
    chest.add(makeBox(0.475, 0.05, 0.35, mats.metal, 0, -0.30, 0.005));       // waist bearing
    // Display and control module, on the chest where it can be read upside down.
    chest.add(makeBox(0.20, 0.155, 0.075, mats.gear, 0, -0.13, 0.20));
    chest.add(makeBox(0.135, 0.075, 0.02, mats.trim, 0, -0.10, 0.245));
    chest.add(makeBox(0.155, 0.028, 0.02, mats.stripe, 0, -0.185, 0.245));
    // The PLSS: the backpack that is the actual spacecraft.
    chest.add(makeBox(0.415, 0.50, 0.235, mats.gearLight, 0, -0.10, -0.235));
    chest.add(makeBox(0.435, 0.045, 0.255, mats.metal, 0, 0.10, -0.235));
    chest.add(makeBox(0.30, 0.16, 0.14, mats.gear, 0, -0.40, -0.30));         // SAFER pack
    chest.add(makeBox(0.075, 0.075, 0.075, mats.webbing, -0.175, -0.40, -0.30));
    chest.add(makeBox(0.075, 0.075, 0.075, mats.webbing, 0.175, -0.40, -0.30));
    // Tether reels, clipped to the front of the shell.
    chest.add(makeBox(0.085, 0.085, 0.055, mats.metal, -0.20, -0.235, 0.14));
    chest.add(makeBox(0.085, 0.085, 0.055, mats.metal, 0.20, -0.235, 0.14));
  } else {
    // plate carrier over the top
    const vest = makeBox(0.415, 0.42, 0.30, mats.gearLight, 0, -0.10, 0.005);
    chest.add(vest);
    const vestTrim = makeBox(0.44, 0.05, 0.31, mats.webbing, 0, 0.06, 0.005);
    chest.add(vestTrim);
    // magazine pouches across the front
    for (let i = -1; i <= 1; i++) {
      chest.add(makeBox(0.095, 0.15, 0.075, mats.webbing, i * 0.115, -0.16, 0.155));
    }
    // shoulder straps
    chest.add(makeBox(0.075, 0.10, 0.25, mats.webbing, -0.16, 0.08, 0));
    chest.add(makeBox(0.075, 0.10, 0.25, mats.webbing, 0.16, 0.08, 0));
    // small pack on the back
    chest.add(makeBox(0.30, 0.34, 0.145, mats.camo, 0, -0.10, -0.185));
    chest.add(makeBox(0.19, 0.10, 0.09, mats.webbing, 0, -0.24, -0.25));
  }

  // ------------------------------------------------------------- head
  const neck = joint(chest, 0, RIG.neckLen, 0);
  bones.neck = neck;
  neck.add(makeLimb(0.05, 0.055, 0.10, mats.face, 6));

  const head = joint(neck, 0, RIG.headOffset, 0);
  bones.head = head;

  const skullGeo = new THREE.SphereGeometry(RIG.headRadius, 14, 12);
  skullGeo.scale(1.0, 1.13, 1.06);
  skullGeo.translate(0, 0.06, 0.005);
  const skull = new THREE.Mesh(skullGeo, mats.face);
  skull.castShadow = shadows;
  head.add(skull);
  parts.head = skull;

  if (suited) {
    // The bubble, and the gold sun visor pulled down over the front of it. Both
    // are opaque: a real EVA visor is a mirror from outside, so modelling it that
    // way is free and avoids sorting a transparent sphere in front of a face.
    const shellGeo = new THREE.SphereGeometry(RIG.headRadius * 1.72, 18, 14);
    shellGeo.translate(0, 0.055, 0.005);
    const shell = new THREE.Mesh(shellGeo, mats.helmet);
    shell.castShadow = shadows;
    head.add(shell);

    const visorGeo = new THREE.SphereGeometry(RIG.headRadius * 1.76, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.44);
    const visor = new THREE.Mesh(visorGeo, mats.visor);
    visor.rotation.x = Math.PI / 2;
    visor.position.set(0, 0.055, 0.005);
    head.add(visor);
    // The white frame round the edge of the visor.
    const frame = new THREE.Mesh(new THREE.TorusGeometry(RIG.headRadius * 1.51, 0.017, 6, 20), mats.helmet);
    frame.position.set(0, 0.055, 0.075);
    head.add(frame);
    // Neck ring, where the helmet locks onto the torso shell.
    head.add(makeBox(0.20, 0.045, 0.20, mats.metal, 0, -0.115, 0.005));
    // EVA lamps and the little TV camera on the yoke over the top.
    head.add(makeBox(0.30, 0.05, 0.075, mats.gear, 0, 0.235, 0.02));
    head.add(makeBox(0.055, 0.055, 0.045, mats.lamp, -0.135, 0.235, 0.055));
    head.add(makeBox(0.055, 0.055, 0.045, mats.lamp, 0.135, 0.235, 0.055));
    head.add(makeBox(0.05, 0.05, 0.06, mats.trim, 0, 0.275, 0.03));
  } else {
    // helmet: cut sphere + brim, in the same white camo as the uniform
    const helmetGeo = new THREE.SphereGeometry(RIG.headRadius * 1.16, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
    helmetGeo.translate(0, 0.075, 0);
    const helmet = new THREE.Mesh(helmetGeo, mats.helmet);
    helmet.castShadow = shadows;
    head.add(helmet);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(RIG.headRadius * 1.09, 0.016, 6, 18), mats.helmet);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.072;
    head.add(brim);
    // helmet camo band + NVG mount stub
    head.add(makeBox(0.075, 0.045, 0.045, mats.webbing, 0, 0.135, 0.10));

    // goggles
    const goggles = makeBox(0.205, 0.055, 0.045, mats.goggle, 0, 0.055, 0.088);
    head.add(goggles);
    head.add(makeBox(0.215, 0.022, 0.03, mats.webbing, 0, 0.055, -0.06));
  }

  // ------------------------------------------------------------- arms
  function buildArm(side) {
    const s = side === 'L' ? -1 : 1;
    const clav = joint(chest, s * 0.075, RIG.shoulderY, 0);
    const shoulder = joint(clav, s * (RIG.shoulderX - 0.075), 0, 0);
    bones['shoulder' + side] = shoulder;

    // deltoid cap
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.072, 9, 7), mats.camoLimb);
    cap.castShadow = shadows;
    shoulder.add(cap);

    const upper = makeLimb(0.062, 0.05, RIG.upperArm, mats.camoLimb);
    upper.castShadow = shadows;
    shoulder.add(upper);
    parts['upperArm' + side] = upper;

    const elbow = joint(shoulder, 0, -RIG.upperArm, 0);
    bones['elbow' + side] = elbow;
    const lower = makeLimb(0.05, 0.042, RIG.lowerArm, mats.camoLimb);
    lower.castShadow = shadows;
    elbow.add(lower);
    parts['lowerArm' + side] = lower;
    // elbow pad
    elbow.add(makeBox(0.085, 0.09, 0.085, mats.gear, 0, -0.03, 0.01));

    if (suited) {
      // Shoulder and elbow bearings, plus the red bands the commander wears. They
      // are what stop a white suit from reading as a snowman.
      makeRing(shoulder, 0.068, 0.014, mats.metal, -0.012);
      makeRing(elbow, 0.052, 0.013, mats.metal, -0.008);
      shoulder.add(makeBox(0.108, 0.05, 0.108, mats.stripe, 0, -0.185, 0));
      elbow.add(makeBox(0.092, 0.042, 0.092, mats.stripe, 0, -0.17, 0));
    }

    const wrist = joint(elbow, 0, -RIG.lowerArm, 0);
    bones['wrist' + side] = wrist;
    const hand = makeBox(0.062, RIG.handLen, 0.085, mats.glove, 0, -RIG.handLen / 2, 0.005);
    hand.castShadow = shadows;
    wrist.add(hand);
    if (suited) makeRing(wrist, 0.046, 0.012, mats.metal, -0.008);
    parts['hand' + side] = hand;
    return wrist;
  }

  const wristL = buildArm('L');
  const wristR = buildArm('R');

  // Reference point on the right hand (used for muzzle-adjacent effects).
  const weaponMount = new THREE.Object3D();
  weaponMount.position.set(0, -0.075, 0.03);
  wristR.add(weaponMount);
  bones.weaponMount = weaponMount;

  // The weapon itself hangs off a dedicated anchor on the chest rather than the
  // hand. The animator points this anchor exactly along the player's aim, so a
  // remote player's muzzle always agrees with the direction the server traced --
  // posing two arms with IK would look nicer and line up worse.
  const weaponAnchor = joint(chest, 0.155, -0.02, 0.26);
  bones.weaponAnchor = weaponAnchor;

  // ------------------------------------------------------------- legs
  function buildLeg(side) {
    const s = side === 'L' ? -1 : 1;
    const hip = joint(hips, s * RIG.hipX, -0.02, 0);
    bones['hip' + side] = hip;

    const thigh = makeLimb(0.092, 0.072, RIG.thigh, mats.camoLimb);
    thigh.castShadow = shadows;
    hip.add(thigh);
    parts['thigh' + side] = thigh;

    const knee = joint(hip, 0, -RIG.thigh, 0);
    bones['knee' + side] = knee;
    knee.add(makeBox(0.10, 0.10, 0.10, suited ? mats.gearLight : mats.gear, 0, -0.02, 0.015));

    const shin = makeLimb(0.072, 0.05, RIG.shin, mats.camoLimb);
    shin.castShadow = shadows;
    knee.add(shin);
    parts['shin' + side] = shin;

    if (suited) {
      makeRing(hip, 0.098, 0.015, mats.metal, -0.03);
      knee.add(makeBox(0.086, 0.042, 0.086, mats.stripe, 0, -0.18, 0));
    }

    const ankle = joint(knee, 0, -RIG.shin, 0);
    bones['ankle' + side] = ankle;
    const boot = makeBox(0.105, 0.095, RIG.footLen, mats.boot, 0, -0.042, 0.052);
    boot.castShadow = shadows;
    ankle.add(boot);
    parts['foot' + side] = boot;
    // boot cuff
    ankle.add(makeBox(0.115, 0.10, 0.115, mats.boot, 0, 0.03, 0));
  }

  buildLeg('L');
  buildLeg('R');

  if (!shadows) {
    group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }

  return { group, bones, parts, weaponMount, mats };
}

/** Free the geometries owned by one soldier instance (materials are shared). */
export function disposeSoldier(soldier) {
  soldier.group.traverse((o) => {
    if (o.isMesh && o.geometry) o.geometry.dispose();
  });
}
