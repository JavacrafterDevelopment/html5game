/**
 * The cave.
 *
 * The rock walls are drawn by filling the same boxes the collider uses, then buried
 * under a pile of irregular boulders so the silhouette reads as a rocky outcrop
 * rather than a shed. The boulders are decoration only — every one of them sits
 * inside the box volume that already stops you, so none of them can catch you on
 * something you cannot see.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries, setVertexColor, roughenGeometry } from '../../core/GeoUtils.js';
import { CAVE, CAVE_BOXES, CHAMBER } from '/shared/maps/grassy_plains/cave.js';
import { makeRng } from '/shared/math/num.js';

const ROCK_DARK = 0x4a4740;
const ROCK_MID = 0x6a655c;
const ROCK_LIGHT = 0x857f74;

function boxGeo(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  setVertexColor(g, color);
  return g;
}

export function createCave({ shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'cave';

  const rng = makeRng(90210);
  const solid = [];

  // ---- the structural boxes, exactly as the collider sees them ----
  for (const b of CAVE_BOXES) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    solid.push(boxGeo(w, h, d,
      (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2,
      ROCK_DARK));
  }

  const structural = new THREE.Mesh(mergeGeometries(solid),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0.02 }));
  structural.name = 'cave-structure';
  structural.castShadow = shadows;
  structural.receiveShadow = true;
  structural.matrixAutoUpdate = false;
  group.add(structural);

  // ---- boulder skin ----
  // Placed strictly within the wall footprint so they never stick out past collision.
  const rockGeos = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    roughenGeometry(g, 0.55, makeRng(500 + i));
    rockGeos.push(g);
  }
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0.02, flatShading: true
  });
  for (const g of rockGeos) {
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.setHex(i % 3 === 0 ? ROCK_MID : ROCK_LIGHT);
      const shade = 0.75 + Math.abs(pos.getY(i)) * 0.3;
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  const placements = [];
  const top = CAVE.baseY + CAVE.innerH + CAVE.roofT;

  // The whole boulder skin has to stay INSIDE the collision footprint. A rock that
  // pokes out past the wall is the inverse of an invisible wall: something you can
  // see and walk straight through. This clamps each boulder's centre so that its
  // full radius still fits within the solid volume.
  const minX = CAVE.x - CAVE.halfW, maxX = CAVE.x + CAVE.halfW;
  const minZ = CAVE.z - CAVE.halfD, maxZ = CAVE.z + CAVE.halfD;
  // roughenGeometry() pushes vertices out by up to 28%, so the drawn rock is
  // wider than its nominal radius. Clamp against the real silhouette, not the
  // radius we asked for.
  const BULGE = 1.28;
  const fit = (v, lo, hi, r) => {
    const e = r * BULGE;
    return hi - lo < e * 2 ? (lo + hi) / 2 : Math.min(Math.max(v, lo + e), hi - e);
  };

  const push = (x, y, z, r, sq, rot) => {
    // Anything too fat to fit inside the wall thickness is simply skipped.
    if (maxX - minX < r * BULGE * 2 || maxZ - minZ < r * BULGE * 2) return;
    placements.push({ x: fit(x, minX, maxX, r), y, z: fit(z, minZ, maxZ, r), r, sq, rot });
  };

  // boulders along the four wall faces
  for (let i = 0; i < 170; i++) {
    const edge = Math.floor(rng() * 4);
    const r = 0.8 + rng() * 1.9;
    let x, z;
    const inset = r * 0.55 + CAVE.wallT * rng() * 0.4;
    if (edge === 0) { x = minX + inset; z = CAVE.z + (rng() - 0.5) * CAVE.halfD * 2; }
    else if (edge === 1) { x = maxX - inset; z = CAVE.z + (rng() - 0.5) * CAVE.halfD * 2; }
    else if (edge === 2) { x = CAVE.x + (rng() - 0.5) * CAVE.halfW * 2; z = minZ + inset; }
    else { x = CAVE.x + (rng() - 0.5) * CAVE.halfW * 2; z = maxZ - inset; }

    // keep the mouth clear
    if (edge === 3 && Math.abs(x - CAVE.x) < CAVE.entranceHalf + r + 0.8) continue;

    const y = CAVE.baseY + rng() * (top - CAVE.baseY) * 0.9;
    push(x, y, z, r, 0.55 + rng() * 0.5, rng() * Math.PI * 2);
  }

  // a crown over the roof so it is not a flat lid -- sunk so it barely proud of it
  for (let i = 0; i < 80; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (CAVE.halfW - CAVE.wallT * 0.5);
    const r = 0.9 + rng() * 1.8;
    const sq = 0.5 + rng() * 0.4;
    push(
      CAVE.x + Math.cos(a) * rad,
      top - r * sq * 0.75,
      CAVE.z + Math.sin(a) * rad * (CAVE.halfD / CAVE.halfW),
      r, sq, rng() * Math.PI * 2
    );
  }

  // scree banked against the base, still inside the footprint
  for (let i = 0; i < 70; i++) {
    const edge = Math.floor(rng() * 4);
    const r = 0.3 + rng() * 0.7;
    let x, z;
    if (edge === 0) { x = minX + r; z = CAVE.z + (rng() - 0.5) * CAVE.halfD * 1.9; }
    else if (edge === 1) { x = maxX - r; z = CAVE.z + (rng() - 0.5) * CAVE.halfD * 1.9; }
    else if (edge === 2) { x = CAVE.x + (rng() - 0.5) * CAVE.halfW * 1.9; z = minZ + r; }
    else { x = CAVE.x + (rng() - 0.5) * CAVE.halfW * 1.9; z = maxZ - r; }
    if (edge === 3 && Math.abs(x - CAVE.x) < CAVE.entranceHalf + r + 0.8) continue;
    push(x, CAVE.baseY + r * 0.25, z, r, 0.45 + rng() * 0.3, rng() * Math.PI * 2);
  }

  // the two wing walls flanking the mouth, clamped to their own narrow volumes
  const mz0 = CAVE.z + CAVE.halfD, mz1 = mz0 + CAVE.mouthLen;
  for (const side of [-1, 1]) {
    const wx0 = side < 0 ? CAVE.x - CAVE.entranceHalf - 2.2 : CAVE.x + CAVE.entranceHalf;
    const wx1 = side < 0 ? CAVE.x - CAVE.entranceHalf : CAVE.x + CAVE.entranceHalf + 2.2;
    for (let i = 0; i < 26; i++) {
      const r = 0.4 + rng() * 0.65;
      if (wx1 - wx0 < r * BULGE * 2 || mz1 - mz0 < r * BULGE * 2) continue;
      placements.push({
        x: fit(wx0 + rng() * (wx1 - wx0), wx0, wx1, r),
        y: CAVE.baseY + rng() * (CAVE.entranceH + 1.4),
        z: fit(mz0 + rng() * (mz1 - mz0), mz0, mz1, r),
        r, sq: 0.5 + rng() * 0.45, rot: rng() * Math.PI * 2
      });
    }
  }

  const buckets = [[], [], []];
  placements.forEach((p, i) => buckets[i % 3].push(p));
  const dummy = new THREE.Object3D();
  buckets.forEach((bucket, bi) => {
    if (!bucket.length) return;
    const mesh = new THREE.InstancedMesh(rockGeos[bi], rockMat, bucket.length);
    mesh.name = 'cave-rocks-' + bi;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    bucket.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.r, p.r * p.sq, p.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  });

  // ---- interior dressing: stalagmites and a lighter floor ring ----
  const inner = [];
  const spikeCount = 22;
  for (let i = 0; i < spikeCount; i++) {
    const fromCeiling = rng() < 0.45;
    const x = CHAMBER.minX + 0.9 + rng() * (CHAMBER.maxX - CHAMBER.minX - 1.8);
    const z = CHAMBER.minZ + 0.9 + rng() * (CHAMBER.maxZ - CHAMBER.minZ - 1.8);
    const h = 0.4 + rng() * 0.9;
    const r = 0.10 + rng() * 0.18;
    const g = new THREE.ConeGeometry(r, h, 6);
    if (fromCeiling) {
      g.rotateX(Math.PI);
      g.translate(x, CHAMBER.ceilY - h / 2, z);
    } else {
      g.translate(x, CHAMBER.floorY + h / 2, z);
    }
    setVertexColor(g, ROCK_MID);
    inner.push(g);
  }
  const innerMesh = new THREE.Mesh(mergeGeometries(inner),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 }));
  innerMesh.name = 'cave-interior';
  innerMesh.castShadow = false;
  innerMesh.receiveShadow = true;
  innerMesh.matrixAutoUpdate = false;
  group.add(innerMesh);

  // A dim warm bounce so the chamber is readable without being lit like outdoors.
  const glow = new THREE.PointLight(0xffd9a8, 1.5, 26, 2);
  glow.position.set(CAVE.x, CHAMBER.floorY + 2.2, CAVE.z + 1.5);
  group.add(glow);

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
