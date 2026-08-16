/**
 * Forest dressing: pines, boulders, deadfall, stumps and drifts.
 *
 * Every prop type is a single InstancedMesh built from a merged, vertex-coloured
 * geometry, so the whole 430-tree forest costs a handful of draw calls. Positions
 * come from shared/maps/snowy_forest/props.js -- the same list the server uses for
 * bullet collision, so what you see behind is exactly what stops a round.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries, setVertexColor, gradientVertexColor, roughenGeometry } from '../../core/GeoUtils.js';
import { PROPS, TREE_VARIANTS } from '/shared/maps/snowy_forest/props.js';
import { makeRng } from '/shared/math/num.js';

const NEEDLE = 0x1d3327;
const NEEDLE_LIGHT = 0x2c4a36;
const SNOW = 0xeef5fa;
const BARK = 0x3b2a1d;
const BARK_GREY = 0x574c44;
const STONE = 0x69707a;

/** A conifer normalised to 1.0 units tall, so instance scale == tree height. */
function buildPine({ layers, spread, needleColor, trunkTop = 0.022, trunkBot = 0.034 }) {
  const parts = [];

  const trunk = new THREE.CylinderGeometry(trunkTop, trunkBot, 1.0, 6);
  trunk.translate(0, 0.5, 0);
  setVertexColor(trunk, BARK);
  parts.push(trunk);

  for (let i = 0; i < layers; i++) {
    const t = layers === 1 ? 0 : i / (layers - 1);
    const y = 0.20 + t * 0.70;
    const r = spread * (1 - t * 0.70);
    const h = 0.34 * (1 - t * 0.35);

    const cone = new THREE.ConeGeometry(r, h, 8, 1);
    cone.translate(0, y + h * 0.5, 0);
    gradientVertexColor(cone, needleColor, NEEDLE_LIGHT, 0.7);
    parts.push(cone);

    // snow sitting on top of each branch tier
    const cap = new THREE.ConeGeometry(r * 0.97, h * 0.52, 8, 1);
    cap.translate(0, y + h * 0.5 + h * 0.30, 0);
    gradientVertexColor(cap, 0xdae6f0, SNOW, 0.5);
    parts.push(cap);
  }

  return mergeGeometries(parts);
}

/** Bare, frost-killed tree. */
function buildDeadTree() {
  const parts = [];
  const rng = makeRng(4242);

  const trunk = new THREE.CylinderGeometry(0.014, 0.038, 1.0, 6);
  trunk.translate(0, 0.5, 0);
  setVertexColor(trunk, BARK_GREY);
  parts.push(trunk);

  for (let i = 0; i < 7; i++) {
    const t = 0.35 + rng() * 0.6;
    const len = 0.16 + rng() * 0.24;
    const branch = new THREE.CylinderGeometry(0.006, 0.014, len, 4);
    branch.translate(0, len * 0.5, 0);
    branch.rotateZ((rng() - 0.5) * 1.9);
    branch.rotateY(rng() * Math.PI * 2);
    branch.translate(0, t, 0);
    setVertexColor(branch, BARK_GREY);
    parts.push(branch);
  }
  return mergeGeometries(parts);
}

function buildRock(seed) {
  const rng = makeRng(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  roughenGeometry(geo, 0.55, rng);
  gradientVertexColor(geo, STONE, SNOW, 2.6);   // snow only settles on the crown
  return geo;
}

function buildLog() {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 8);
  geo.rotateZ(Math.PI / 2);            // lie it along X
  gradientVertexColor(geo, 0x4a3626, SNOW, 3.0);
  return geo;
}

function buildStump() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.92, 1.0, 1.0, 8);
  body.translate(0, 0.5, 0);
  setVertexColor(body, 0x483424);
  parts.push(body);
  const cap = new THREE.CylinderGeometry(0.95, 0.95, 0.10, 8);
  cap.translate(0, 1.02, 0);
  setVertexColor(cap, SNOW);
  parts.push(cap);
  return mergeGeometries(parts);
}

function buildDrift() {
  const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  setVertexColor(geo, SNOW);
  return geo;
}

function instanced(geometry, material, count, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

export function createFoliage({ shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'foliage';

  const foliageMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0.0
  });
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true
  });
  const woodMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0.0
  });
  const driftMat = new THREE.MeshStandardMaterial({
    color: 0xeef5fa, roughness: 0.95, metalness: 0.0
  });

  // ------------------------------------------------------------ trees
  const variantGeo = {
    [TREE_VARIANTS.TALL_PINE]: buildPine({ layers: 6, spread: 0.20, needleColor: NEEDLE }),
    [TREE_VARIANTS.PINE]: buildPine({ layers: 5, spread: 0.24, needleColor: 0x21382a }),
    [TREE_VARIANTS.FIR]: buildPine({ layers: 4, spread: 0.31, needleColor: 0x25402f, trunkBot: 0.045 }),
    [TREE_VARIANTS.DEAD]: buildDeadTree()
  };

  const byVariant = new Map();
  for (const t of PROPS.trees) {
    if (!byVariant.has(t.variant)) byVariant.set(t.variant, []);
    byVariant.get(t.variant).push(t);
  }

  const dummy = new THREE.Object3D();
  for (const [variant, trees] of byVariant) {
    const mesh = instanced(variantGeo[variant], foliageMat, trees.length, 'trees-' + variant);
    trees.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.lean, t.rot, t.lean * 0.7);
      // slight width variation keeps the forest from looking cloned
      const w = 1 + (((t.rot * 37) % 1) - 0.5) * 0.22;
      dummy.scale.set(t.h * w, t.h, t.h * w);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows;
    group.add(mesh);
  }

  // ------------------------------------------------------------ rocks
  const rockGeos = [buildRock(11), buildRock(22), buildRock(33)];
  const rockBuckets = [[], [], []];
  PROPS.rocks.forEach((r, i) => rockBuckets[i % 3].push(r));

  rockBuckets.forEach((bucket, bi) => {
    if (!bucket.length) return;
    const mesh = instanced(rockGeos[bi], rockMat, bucket.length, 'rocks-' + bi);
    bucket.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, r.rot, 0);
      dummy.scale.set(r.r, r.r * r.squash, r.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows;
    group.add(mesh);
  });

  // ------------------------------------------------------------ logs
  if (PROPS.logs.length) {
    const mesh = instanced(buildLog(), woodMat, PROPS.logs.length, 'logs');
    PROPS.logs.forEach((l, i) => {
      dummy.position.set(l.x, l.y + l.r, l.z);
      dummy.rotation.set(0, l.rot, 0);
      dummy.scale.set(l.len, l.r, l.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows;
    group.add(mesh);
  }

  // ------------------------------------------------------------ stumps
  if (PROPS.stumps.length) {
    const mesh = instanced(buildStump(), woodMat, PROPS.stumps.length, 'stumps');
    PROPS.stumps.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.r, s.h, s.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows;
    group.add(mesh);
  }

  // ------------------------------------------------------------ drifts
  if (PROPS.drifts.length) {
    const mesh = instanced(buildDrift(), driftMat, PROPS.drifts.length, 'drifts');
    PROPS.drifts.forEach((d, i) => {
      dummy.position.set(d.x, d.y - d.h * 0.25, d.z);
      dummy.rotation.set(0, d.rot, 0);
      dummy.scale.set(d.rx, d.h, d.rz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
