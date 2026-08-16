/**
 * Grassy Plains dressing: trees, the boundary hedge and woods, rocks, haystacks,
 * fences, wells, carts, bushes and flowers.
 *
 * Everything with a collider is drawn to match that collider's real size. Bushes
 * and flowers have no collider at all, so they are free to be any shape.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries, setVertexColor, gradientVertexColor, roughenGeometry } from '../../core/GeoUtils.js';
import { PROPS, TREE_VARIANTS } from '/shared/maps/grassy_plains/props.js';
import { heightAt } from '/shared/maps/grassy_plains/terrain.js';
import { makeRng } from '/shared/math/num.js';

const BARK = 0x4a3a28;
const BARK_PALE = 0xa8a294;
const LEAF_DARK = 0x35602c;
const LEAF_LIGHT = 0x6d9a3c;
const HEDGE_DARK = 0x2f5127;
const HEDGE_LIGHT = 0x4d7a33;
const STONE = 0x8a8378;

function instanced(geo, mat, count, name, shadows = true) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.name = name;
  m.castShadow = shadows;
  m.receiveShadow = true;
  m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return m;
}

/** Broadleaf tree: trunk plus a few overlapping canopy blobs. */
function buildBroadleaf(seed, { pale = false, tall = false } = {}) {
  const rng = makeRng(seed);
  const parts = [];

  const trunkH = tall ? 0.62 : 0.44;
  const trunk = new THREE.CylinderGeometry(0.026, 0.05, trunkH, 7);
  trunk.translate(0, trunkH / 2, 0);
  setVertexColor(trunk, pale ? BARK_PALE : BARK);
  parts.push(trunk);

  const blobs = tall ? 6 : 5;
  for (let i = 0; i < blobs; i++) {
    const r = (tall ? 0.21 : 0.26) * (0.75 + rng() * 0.5);
    const g = new THREE.IcosahedronGeometry(r, 0);
    const a = (i / blobs) * Math.PI * 2 + rng();
    const spread = tall ? 0.12 : 0.2;
    g.translate(
      Math.cos(a) * spread * rng(),
      // Poplars stack foliage up the trunk; a single blob on a bare pole reads as
      // a canopy floating in the sky with nothing holding it up.
      trunkH + (tall ? 0.02 : 0.16) + (tall ? (i / blobs) * 0.42 : rng() * 0.18),
      Math.sin(a) * spread * rng()
    );
    gradientVertexColor(g, LEAF_DARK, LEAF_LIGHT, 0.9);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function buildScrub(seed) {
  const rng = makeRng(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(0.3 * (0.7 + rng() * 0.6), 0);
    g.translate((rng() - 0.5) * 0.3, 0.28 + rng() * 0.2, (rng() - 0.5) * 0.3);
    gradientVertexColor(g, 0x2f4f26, 0x5c8734, 0.9);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

function buildHedgeBlob(seed) {
  const rng = makeRng(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  roughenGeometry(g, 0.4, rng);
  gradientVertexColor(g, HEDGE_DARK, HEDGE_LIGHT, 0.8);
  return g;
}

function buildRock(seed) {
  const rng = makeRng(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  roughenGeometry(g, 0.5, rng);
  gradientVertexColor(g, 0x6d6659, STONE, 1.4);
  return g;
}

/**
 * Haystack, normalised into a 0..1 tall unit cylinder so that scaling by
 * (radius, height, radius) produces exactly the collider's dimensions. Authoring it
 * any taller than 1.0 would make the visible stack overhang its own collider, which
 * is the "shot through a solid object" bug in reverse.
 */
function buildHaystack() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.86, 1.0, 0.42, 9);
  body.translate(0, 0.21, 0);
  gradientVertexColor(body, 0xa8863c, 0xd8bd6a, 0.9);
  parts.push(body);
  const cap = new THREE.ConeGeometry(0.92, 0.60, 9);
  cap.translate(0, 0.70, 0);
  gradientVertexColor(cap, 0xc0a052, 0xe0c87e, 0.8);
  parts.push(cap);
  return mergeGeometries(parts);
}

export function createProps({ shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'plains-props';

  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const hayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b563a, roughness: 0.9 });
  const dummy = new THREE.Object3D();

  // ----------------------------------------------------------------- trees
  const geoms = {
    [TREE_VARIANTS.OAK]: buildBroadleaf(101),
    [TREE_VARIANTS.BIRCH]: buildBroadleaf(202, { pale: true }),
    [TREE_VARIANTS.POPLAR]: buildBroadleaf(303, { tall: true }),
    [TREE_VARIANTS.SCRUB]: buildScrub(404)
  };

  const allTrees = [...PROPS.trees, ...PROPS.woods];
  const byVariant = new Map();
  for (const t of allTrees) {
    if (!byVariant.has(t.variant)) byVariant.set(t.variant, []);
    byVariant.get(t.variant).push(t);
  }
  for (const [variant, list] of byVariant) {
    const mesh = instanced(geoms[variant], foliageMat, list.length, 'trees-' + variant, shadows);
    list.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.lean, t.rot, t.lean * 0.6);
      const w = 1 + (((t.rot * 31) % 1) - 0.5) * 0.25;
      dummy.scale.set(t.h * w, t.h, t.h * w);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // ----------------------------------------------------------------- hedge
  if (PROPS.hedge.length) {
    const mesh = instanced(buildHedgeBlob(55), foliageMat, PROPS.hedge.length, 'hedge', shadows);
    PROPS.hedge.forEach((h, i) => {
      // Drawn a touch wider than the collider so you never see daylight through a
      // gap you cannot walk through.
      dummy.position.set(h.x, h.y + h.h * 0.42, h.z);
      dummy.rotation.set(0, (h.x + h.z) * 0.7, 0);
      dummy.scale.set(h.r * 1.5, h.h * 0.72, h.r * 1.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // ----------------------------------------------------------------- rocks
  if (PROPS.rocks.length) {
    const geosR = [buildRock(7), buildRock(8), buildRock(9)];
    const buckets = [[], [], []];
    PROPS.rocks.forEach((r, i) => buckets[i % 3].push(r));
    buckets.forEach((bucket, bi) => {
      if (!bucket.length) return;
      const mesh = instanced(geosR[bi], rockMat, bucket.length, 'rocks-' + bi, shadows);
      bucket.forEach((r, i) => {
        dummy.position.set(r.x, r.y + r.r * r.squash * 0.5, r.z);
        dummy.rotation.set(0, r.rot, 0);
        dummy.scale.set(r.r * 0.9, r.r * r.squash, r.r * 0.9);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    });
  }

  // ------------------------------------------------------------- haystacks
  if (PROPS.haystacks.length) {
    const mesh = instanced(buildHaystack(), hayMat, PROPS.haystacks.length, 'haystacks', shadows);
    PROPS.haystacks.forEach((h, i) => {
      dummy.position.set(h.x, h.y, h.z);
      dummy.rotation.set(0, h.rot, 0);
      dummy.scale.set(h.r, h.h, h.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // -------------------------------------------------------- wells and carts
  const structural = [];
  for (const w of PROPS.wells) {
    const ring = new THREE.CylinderGeometry(w.r, w.r * 1.05, w.h, 12);
    ring.translate(w.x, w.y + w.h / 2, w.z);
    setVertexColor(ring, STONE);
    structural.push(ring);
    const hole = new THREE.CylinderGeometry(w.r * 0.72, w.r * 0.72, 0.08, 12);
    hole.translate(w.x, w.y + w.h + 0.02, w.z);
    setVertexColor(hole, 0x1b1a17);
    structural.push(hole);
    for (const s of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.1, 1.5, 0.1);
      post.translate(w.x + s * w.r * 0.8, w.y + w.h + 0.75, w.z);
      setVertexColor(post, 0x6b563a);
      structural.push(post);
    }
    const beam = new THREE.BoxGeometry(w.r * 1.9, 0.11, 0.11);
    beam.translate(w.x, w.y + w.h + 1.5, w.z);
    setVertexColor(beam, 0x6b563a);
    structural.push(beam);
  }
  for (const c of PROPS.carts) {
    const w = c.quarter ? c.d : c.w;
    const d = c.quarter ? c.w : c.d;
    const bed = new THREE.BoxGeometry(w, 0.22, d);
    bed.translate(c.x, c.y + c.h - 0.3, c.z);
    setVertexColor(bed, 0x6b563a);
    structural.push(bed);
    for (const sx of [-1, 1]) {
      const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 10);
      wheel.rotateZ(Math.PI / 2);
      if (c.quarter) wheel.rotateY(Math.PI / 2);
      wheel.translate(
        c.x + (c.quarter ? 0 : sx * w * 0.32),
        c.y + 0.42,
        c.z + (c.quarter ? sx * d * 0.32 : 0)
      );
      setVertexColor(wheel, 0x4f4026);
      structural.push(wheel);
    }
    const side = new THREE.BoxGeometry(w, 0.42, 0.09);
    side.translate(c.x, c.y + c.h - 0.02, c.z + (c.quarter ? 0 : d * 0.45));
    setVertexColor(side, 0x7a6444);
    structural.push(side);
  }
  if (structural.length) {
    const mesh = new THREE.Mesh(mergeGeometries(structural),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    mesh.name = 'structures';
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ------------------------------------------- bushes + flowers (no collision)
  if (PROPS.bushes.length) {
    const mesh = instanced(buildScrub(606), foliageMat, PROPS.bushes.length, 'bushes', false);
    PROPS.bushes.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.set(b.r, b.r * 0.85, b.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Wildflowers. Tiny blobs rather than quads: an untextured plane reads as a
  // little grey card lying on the grass, which is worse than no flowers at all.
  const flowerColors = [0xf2e9a0, 0xe8dcff, 0xffd0dc];
  for (let k = 0; k < 3; k++) {
    const list = PROPS.flowers.filter((f) => f.kind === k);
    if (!list.length) continue;
    const g = new THREE.IcosahedronGeometry(0.035, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: flowerColors[k], roughness: 0.85, emissive: flowerColors[k], emissiveIntensity: 0.12
    });
    const perPatch = 7;
    const mesh = instanced(g, mat, list.length * perPatch, 'flowers-' + k, false);
    const rng = makeRng(900 + k);
    let idx = 0;
    for (const f of list) {
      for (let i = 0; i < perPatch; i++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * f.r;
        const px = f.x + Math.cos(a) * rr;
        const pz = f.z + Math.sin(a) * rr;
        dummy.position.set(px, heightAt(px, pz) + 0.14 + rng() * 0.1, pz);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.scale.setScalar(0.8 + rng() * 0.7);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    group.add(mesh);
  }

  return group;
}
