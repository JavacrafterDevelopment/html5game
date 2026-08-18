/**
 * The rocks, drawn.
 *
 * Geometry comes from shared/maps/iss/asteroids.js -- the same list the collider is
 * built from -- so a rock is drawn exactly where and how big its collider is.
 *
 * The lumpiness is deliberately small: ±2.2% of the radius. It is tempting to
 * displace a rock much harder, and the moment you do, half its surface is drawn
 * outside its own collider (you can see rock and shoot straight through it) and the
 * other half is drawn inside (bullets stop in mid-air short of it). Keeping the
 * amplitude under a quarter of a metre keeps both errors below the threshold
 * tools/browser-check.js enforces, and flat shading on a subdivided icosahedron
 * supplies far more of the "this is a rock" than displacement ever did.
 *
 * The bores are NOT noised. A tunnel you fly down has to be exactly the tunnel the
 * collider thinks it is.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries } from '../../core/GeoUtils.js';
import { ASTEROID_PARTS } from '/shared/maps/iss/index.js';

const PERP = [[1, 2], [0, 2], [0, 1]];
const SEG = 26;
const AMP = 0.022;

/**
 * Smooth lumpiness as a multiplier on the radius, from the direction alone.
 *
 * Evaluated on each vertex's own position in the rock's local frame, which is what
 * makes the barrel of a holed rock and the flat ring capping it agree exactly along
 * their shared seam -- same point in, same answer out, no crack.
 */
function lumps(x, y, z, seed) {
  const n = Math.sin(x * 2.9 + seed) * 0.5
    + Math.sin(y * 3.7 + seed * 1.3) * 0.3
    + Math.sin(z * 4.6 + seed * 2.1) * 0.2;
  return 1 + AMP * n;
}

/** Rock: grey, brown-stained, pitted. */
function paintRock(ctx, S) {
  ctx.fillStyle = '#565a5e';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    const v = 62 + Math.floor(Math.random() * 44);
    ctx.fillStyle = `rgba(${v},${v - 3},${v - 8},${0.20 + Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * S, Math.random() * S, 6 + Math.random() * 40,
      5 + Math.random() * 30, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // iron staining
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(112,84,58,${0.06 + Math.random() * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * S, Math.random() * S, 10 + Math.random() * 46,
      8 + Math.random() * 34, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // craters: a dark floor with a lit rim on one side
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 30;
    ctx.fillStyle = 'rgba(30,32,35,0.42)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(150,152,155,0.30)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y - r * 0.12, r * 0.94, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke();
  }
}

function rockMaterial() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  paintRock(c.getContext('2d'), 512);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.95, metalness: 0.03, flatShading: true
  });
}

/** Whole-radius displacement, for a blob. */
function displace(geo, seed) {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = lumps(x, y, z, seed);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  pos.needsUpdate = true;
  return geo;
}

/**
 * Radial displacement about the Y axis, leaving the axial coordinate alone.
 *
 * Which matters: a holed rock is a barrel with a flat ring capping each end, and if
 * the barrel's rim slides along the axis while the ring's does not, the two stop
 * meeting and a hairline crack opens all the way round the mouth of the tunnel.
 */
function displaceRadialY(geo, seed) {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = lumps(x, y, z, seed);
    pos.setXYZ(i, x * k, y, z * k);
  }
  pos.needsUpdate = true;
  return geo;
}

function orient(geo, axis) {
  if (axis === 0) geo.rotateZ(-Math.PI / 2);
  else if (axis === 2) geo.rotateX(Math.PI / 2);
  return geo;
}

/** Turn a geometry inside out, so a bore is lit as a wall and not as a hole. */
function flip(geo) {
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) {
    nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  }
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
  }
  return geo;
}

export function createAsteroids({ shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'asteroids';
  const geos = [];
  let seed = 3.1;
  let lastRock = null;

  for (const part of ASTEROID_PARTS) {
    // One noise field per ROCK, not per part. A holed rock is three segments end to
    // end, and if each one lumps to its own seed then the ring bridging a step is
    // displaced by a different amount from the segment it is bridging to, and the
    // joint opens up all the way round.
    const rock = part.name.replace(/(s\d+|-lump\d+)$/, '');
    if (rock !== lastRock) { seed += 1.618; lastRock = rock; }

    if (part.s === 'sphere') {
      const g = new THREE.IcosahedronGeometry(part.r, 2);
      displace(g, seed);
      g.translate(part.x, part.y, part.z);
      geos.push(g);
      continue;
    }

    // A holed rock. Built in a local frame with the axis along Y so the barrel and
    // the end rings can share one noise field, then turned onto its real axis.
    const len = part.to - part.from;
    const pieces = [];

    const barrel = new THREE.CylinderGeometry(part.rOut, part.rOut, len, SEG, 3, true);
    displaceRadialY(barrel, seed);
    pieces.push(barrel);

    // The bore stays exactly the size the collider says it is.
    pieces.push(flip(new THREE.CylinderGeometry(part.rIn, part.rIn, len, SEG, 1, true)));

    for (const end of [0, 1]) {
      // end 0 is the +axis face, so it is the part's `to` end. A null means the
      // segment next door is fatter and draws this step itself.
      const inner = end ? part.capFromR : part.capToR;
      if (inner === null || inner === undefined) continue;
      const ring = new THREE.RingGeometry(inner, part.rOut, SEG, 1);
      ring.rotateX(end ? Math.PI / 2 : -Math.PI / 2);
      ring.translate(0, end ? -len / 2 : len / 2, 0);
      // Every rim except the bore's moves, by the same amount the barrel it meets
      // moved. The bore edge is left exactly where the collider puts it.
      const pos = ring.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (Math.hypot(x, z) <= part.rIn + 1e-3) continue;
        const k = lumps(x, y, z, seed);
        pos.setXYZ(i, x * k, y, z * k);
      }
      pos.needsUpdate = true;
      pieces.push(ring);
    }

    const merged = mergeGeometries(pieces);
    orient(merged, part.axis);
    const p = [0, 0, 0];
    const [iu, iv] = PERP[part.axis];
    p[part.axis] = (part.from + part.to) * 0.5;
    p[iu] = part.u;
    p[iv] = part.v;
    merged.translate(p[0], p[1], p[2]);
    geos.push(merged);
  }

  const mesh = new THREE.Mesh(mergeGeometries(geos), rockMaterial());
  mesh.name = 'asteroid-field';
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  group.add(mesh);
  group.userData.material = mesh.material;
  return group;
}
