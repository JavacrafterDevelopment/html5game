/**
 * World collision for the Snowy Forest.
 *
 * Used by the client for player movement and impact effects, and by the server for
 * bullet occlusion (so you cannot shoot through the cabin or a tree trunk).
 * Everything is built from the shared deterministic layout, so both agree exactly.
 */

import { TERRAIN, heightAt, normalAt } from './terrain.js';
import { CABIN_BOXES } from './cabin.js';
import { PROPS } from './props.js';
import { rayAABB, raySphere, rayCylinderY } from '../../math/trace.js';

export const KIND = { TERRAIN: 'terrain', WALL: 'wall', FLOOR: 'floor', ROOF: 'roof', PROP: 'prop', TREE: 'tree', ROCK: 'rock', WOOD: 'wood' };

const TYPE_BOX = 0, TYPE_CYL = 1, TYPE_SPHERE = 2;

/** Flat list of every solid in the map. */
const colliders = [];

function addBox(min, max, kind) {
  colliders.push({ type: TYPE_BOX, min, max, kind });
}
function addCylinder(x, z, r, y0, y1, kind) {
  colliders.push({ type: TYPE_CYL, x, z, r, y0, y1, kind });
}
function addSphere(x, y, z, r, kind) {
  colliders.push({ type: TYPE_SPHERE, x, y, z, r, kind });
}

// cabin
for (const b of CABIN_BOXES) addBox(b.min.slice(), b.max.slice(), b.kind);

// trees -- trunk only, foliage never blocks a bullet
for (const t of PROPS.trees) {
  addCylinder(t.x, t.z, t.r * 0.95, t.y - 1.0, t.y + Math.min(t.h * 0.45, 6.0), KIND.TREE);
}

// stumps
for (const s of PROPS.stumps) {
  addCylinder(s.x, s.z, s.r * 0.95, s.y - 0.5, s.y + s.h, KIND.WOOD);
}

// boulders -- closely match squashed height and radius
for (const r of PROPS.rocks) {
  const squashedH = r.r * r.squash;
  addSphere(r.x, r.y + squashedH * 0.45, r.z, r.r * Math.min(0.85, r.squash * 0.8 + 0.12), KIND.ROCK);
}

// fallen logs, segmented along the rotated cylinder axis to eliminate oversized AABBs
for (const l of PROPS.logs) {
  const cos = Math.cos(l.rot), sin = Math.sin(l.rot);
  const halfLen = l.len / 2;
  const segments = Math.max(3, Math.ceil(l.len / (l.r * 1.5)));
  for (let s = 0; s < segments; s++) {
    const offset = -halfLen + (s / (segments - 1)) * l.len;
    const px = l.x + cos * offset;
    const pz = l.z + sin * offset;
    addCylinder(px, pz, l.r * 0.95, l.y, l.y + l.r * 2, KIND.WOOD);
  }
}

// ---------------------------------------------------------------- spatial index
const CELL = 8;
const grid = new Map();
const cellKey = (ix, iz) => ix * 100003 + iz;

function indexCollider(i, minX, minZ, maxX, maxZ) {
  const i0 = Math.floor(minX / CELL), i1 = Math.floor(maxX / CELL);
  const j0 = Math.floor(minZ / CELL), j1 = Math.floor(maxZ / CELL);
  for (let ix = i0; ix <= i1; ix++) {
    for (let iz = j0; iz <= j1; iz++) {
      const k = cellKey(ix, iz);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
  }
}

colliders.forEach((c, i) => {
  if (c.type === TYPE_BOX) indexCollider(i, c.min[0], c.min[2], c.max[0], c.max[2]);
  else if (c.type === TYPE_CYL) indexCollider(i, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  else indexCollider(i, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
});

function queryCells(minX, minZ, maxX, maxZ, out) {
  out.length = 0;
  const seen = new Set();
  const i0 = Math.floor(minX / CELL), i1 = Math.floor(maxX / CELL);
  const j0 = Math.floor(minZ / CELL), j1 = Math.floor(maxZ / CELL);
  for (let ix = i0; ix <= i1; ix++) {
    for (let iz = j0; iz <= j1; iz++) {
      const arr = grid.get(cellKey(ix, iz));
      if (!arr) continue;
      for (const idx of arr) {
        if (!seen.has(idx)) { seen.add(idx); out.push(idx); }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- movement
const scratch = [];

/**
 * Resolve a vertical-cylinder player against the world.
 * `pos` is the FEET position and is mutated in place.
 *
 * @returns {{grounded:boolean, groundY:number, hitWall:boolean, ceiling:boolean}}
 */
export function collideCapsule(pos, radius, height, stepHeight = 0.55) {
  const result = { grounded: false, groundY: -Infinity, hitWall: false, ceiling: false };

  // --- world bounds: the mountains are the wall, this is just a backstop ---
  const rad = Math.hypot(pos[0], pos[2]);
  if (rad > TERRAIN.hardRadius) {
    const s = TERRAIN.hardRadius / rad;
    pos[0] *= s;
    pos[2] *= s;
    result.hitWall = true;
  }

  // --- solids ---
  // Two passes: the first resolves horizontally and lifts onto low ledges, which
  // keeps the player from getting stuck on the porch lip or a log.
  for (let pass = 0; pass < 2; pass++) {
    const list = queryCells(pos[0] - radius - 1, pos[2] - radius - 1, pos[0] + radius + 1, pos[2] + radius + 1, scratch);
    for (const idx of list) {
      const c = colliders[idx];
      if (c.type === TYPE_BOX) resolveBox(pos, radius, height, c, stepHeight, result);
      else if (c.type === TYPE_CYL) resolveCylinder(pos, radius, height, c, stepHeight, result);
      else resolveSphere(pos, radius, height, c, result);
    }
  }

  // --- terrain ---
  const gh = heightAt(pos[0], pos[2]);
  if (pos[1] < gh) {
    pos[1] = gh;
    result.grounded = true;
    if (gh > result.groundY) result.groundY = gh;
  } else if (pos[1] <= gh + 0.05) {
    result.grounded = true;
    if (gh > result.groundY) result.groundY = gh;
  }
  if (gh > result.groundY) result.groundY = gh;

  return result;
}

function resolveBox(pos, radius, height, c, stepHeight, result) {
  const minX = c.min[0] - radius, maxX = c.max[0] + radius;
  const minZ = c.min[2] - radius, maxZ = c.max[2] + radius;
  const feetY = pos[1], headY = pos[1] + height;

  if (pos[0] <= minX || pos[0] >= maxX || pos[2] <= minZ || pos[2] >= maxZ) return;
  if (headY <= c.min[1] || feetY >= c.max[1]) return;

  // Step up onto low ledges instead of being blocked by them.
  const topY = c.max[1];
  if (topY - feetY > 0 && topY - feetY <= stepHeight) {
    pos[1] = topY;
    result.grounded = true;
    if (topY > result.groundY) result.groundY = topY;
    return;
  }

  // Minimum translation along the cheapest axis.
  const penX1 = pos[0] - minX, penX2 = maxX - pos[0];
  const penZ1 = pos[2] - minZ, penZ2 = maxZ - pos[2];
  const penUp = topY - feetY;          // push out through the top
  const penDown = headY - c.min[1];    // push out through the bottom

  let best = Math.min(penX1, penX2, penZ1, penZ2, penUp, penDown);

  if (best === penUp) {
    pos[1] = topY;
    result.grounded = true;
    if (topY > result.groundY) result.groundY = topY;
  } else if (best === penDown) {
    pos[1] = c.min[1] - height;
    result.ceiling = true;
  } else if (best === penX1) { pos[0] = minX; result.hitWall = true; }
  else if (best === penX2) { pos[0] = maxX; result.hitWall = true; }
  else if (best === penZ1) { pos[2] = minZ; result.hitWall = true; }
  else { pos[2] = maxZ; result.hitWall = true; }
}

function resolveCylinder(pos, radius, height, c, stepHeight, result) {
  const feetY = pos[1], headY = pos[1] + height;
  if (headY <= c.y0 || feetY >= c.y1) return;
  const dx = pos[0] - c.x, dz = pos[2] - c.z;
  const d = Math.hypot(dx, dz);
  const rr = c.r + radius;
  if (d >= rr) return;

  if (c.y1 - feetY > 0 && c.y1 - feetY <= stepHeight) {
    pos[1] = c.y1;
    result.grounded = true;
    if (c.y1 > result.groundY) result.groundY = c.y1;
    return;
  }
  if (d < 1e-5) { pos[0] += rr; result.hitWall = true; return; }
  const push = (rr - d) / d;
  pos[0] += dx * push;
  pos[2] += dz * push;
  result.hitWall = true;
}

function resolveSphere(pos, radius, height, c, result) {
  // Closest point on the player's vertical segment to the sphere centre.
  const segY = Math.max(pos[1], Math.min(c.y, pos[1] + height));
  const dx = pos[0] - c.x, dy = segY - c.y, dz = pos[2] - c.z;
  const d = Math.hypot(dx, dy, dz);
  const rr = c.r + radius;
  if (d >= rr || d < 1e-5) return;
  const push = (rr - d) / d;
  const nx = dx * push, ny = dy * push, nz = dz * push;
  // Mostly-upward contacts become ground, everything else pushes sideways.
  if (ny > Math.abs(nx) && ny > Math.abs(nz)) {
    pos[1] += ny;
    result.grounded = true;
    if (pos[1] > result.groundY) result.groundY = pos[1];
  } else {
    pos[0] += nx;
    pos[2] += nz;
    result.hitWall = true;
  }
}

// ---------------------------------------------------------------- raycasting

/** Terrain raymarch with bisection refinement. Returns distance or -1. */
export function raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
  let t = 0;
  let prevT = 0;
  let prevAbove = oy - heightAt(ox, oz);
  if (prevAbove < -0.3) {
    t = 0.35;
    prevT = t;
    prevAbove = (oy + dy * t) - heightAt(ox + dx * t, oz + dz * t);
    if (prevAbove < 0) return 0;
  } else if (prevAbove < 0) {
    prevAbove = 0.01;
  }

  while (t < maxDist) {
    const above = (oy + dy * t) - heightAt(ox + dx * t, oz + dz * t);
    if (above < 0) {
      // bisect between prevT (above ground) and t (below ground)
      let lo = prevT, hi = t;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5;
        const a = (oy + dy * mid) - heightAt(ox + dx * mid, oz + dz * mid);
        if (a < 0) hi = mid; else lo = mid;
      }
      return hi;
    }
    prevT = t;
    prevAbove = above;
    // Adaptive: stride further when high above the ground.
    t += Math.max(0.35, Math.min(5, Math.max(0.1, above) * 0.65));
  }
  return -1;
}

const rayScratch = [];

/**
 * Cast against every solid in the map plus the terrain.
 * @returns {{dist:number, point:number[], normal:number[], kind:string}|null}
 */
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let bestT = maxDist;
  let bestKind = null;
  let bestCollider = null;

  // Walk the XZ grid so long shots do not test every prop on the map.
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  let ix = Math.floor(ox / CELL);
  let iz = Math.floor(oz / CELL);
  const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(CELL / dx);
  const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : Math.abs(CELL / dz);
  let tMaxX = Math.abs(dx) < 1e-9 ? Infinity
    : (((dx > 0 ? (ix + 1) * CELL : ix * CELL) - ox) / dx);
  let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity
    : (((dz > 0 ? (iz + 1) * CELL : iz * CELL) - oz) / dz);

  const seen = new Set();
  let travelled = 0;
  let guard = 0;

  while (travelled <= bestT && guard++ < 4096) {
    const arr = grid.get(cellKey(ix, iz));
    if (arr) {
      for (const idx of arr) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const c = colliders[idx];
        let t = -1;
        if (c.type === TYPE_BOX) {
          t = rayAABB(ox, oy, oz, dx, dy, dz, c.min[0], c.min[1], c.min[2], c.max[0], c.max[1], c.max[2], bestT);
        } else if (c.type === TYPE_CYL) {
          t = rayCylinderY(ox, oy, oz, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1, bestT);
        } else {
          t = raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, c.r, bestT);
        }
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestKind = c.kind;
          bestCollider = c;
        }
      }
    }
    if (tMaxX < tMaxZ) { travelled = tMaxX; ix += stepX; tMaxX += tDeltaX; }
    else { travelled = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ; }
    if (travelled > maxDist) break;
  }

  const tTerrain = raycastTerrain(ox, oy, oz, dx, dy, dz, Math.min(bestT, maxDist));
  if (tTerrain >= 0 && tTerrain < bestT) {
    const px = ox + dx * tTerrain, py = oy + dy * tTerrain, pz = oz + dz * tTerrain;
    return { dist: tTerrain, point: [px, py, pz], normal: normalAt(px, pz), kind: KIND.TERRAIN };
  }

  if (bestKind === null) return null;

  const px = ox + dx * bestT, py = oy + dy * bestT, pz = oz + dz * bestT;
  return { dist: bestT, point: [px, py, pz], normal: colliderNormal(bestCollider, px, py, pz), kind: bestKind };
}

function colliderNormal(c, px, py, pz) {
  if (c.type === TYPE_SPHERE) {
    const nx = px - c.x, ny = py - c.y, nz = pz - c.z;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  if (c.type === TYPE_CYL) {
    const nx = px - c.x, nz = pz - c.z;
    const l = Math.hypot(nx, nz) || 1;
    return [nx / l, 0, nz / l];
  }
  // Box: pick the face the hit point is closest to.
  const eps = 1e-3;
  if (Math.abs(px - c.min[0]) < eps) return [-1, 0, 0];
  if (Math.abs(px - c.max[0]) < eps) return [1, 0, 0];
  if (Math.abs(py - c.min[1]) < eps) return [0, -1, 0];
  if (Math.abs(py - c.max[1]) < eps) return [0, 1, 0];
  if (Math.abs(pz - c.min[2]) < eps) return [0, 0, -1];
  return [0, 0, 1];
}

/** Quick line-of-sight test used by the server before awarding a hit. */
export function isBlocked(ox, oy, oz, tx, ty, tz) {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return false;
  const hit = raycastWorld(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist - 0.05);
  return hit !== null;
}

export const COLLIDER_COUNT = colliders.length;
