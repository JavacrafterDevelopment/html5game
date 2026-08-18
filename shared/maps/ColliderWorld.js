/**
 * Shared collision engine.
 *
 * A map supplies its heightfield and a list of solids; this provides the capsule
 * resolution and ray tracing on top. Both live in shared/ so the browser and the
 * server run byte-identical collision -- the wall you hide behind is the wall that
 * stops the bullet.
 *
 * Only three collider shapes exist, and the choice matters more than it looks:
 *
 *   box      - axis-aligned only. An AABB is exactly as wide as it looks from every
 *              angle, so buildings and fences never catch you on empty air.
 *   cylinder - anything round and upright: trunks, posts, haystacks, hedges.
 *   sphere   - boulders.
 *
 * Rotated boxes are deliberately unsupported. An AABB fitted around a rotated object
 * is bigger than the object, and that gap is exactly what an invisible wall is.
 */

import { rayAABB, raySphere, rayCylinderY, rayTube } from '../math/trace.js';

const TYPE_BOX = 0, TYPE_CYL = 1, TYPE_SPHERE = 2, TYPE_TUBE = 3;
const CELL = 8;

/** World axis indices of a tube's two perpendicular coordinates, (u, v). */
const PERP = [[1, 2], [0, 2], [0, 1]];

/**
 * @param {object} opts
 * @param {boolean} [opts.hasTerrain] false for a world with no ground at all (orbit).
 *   Skips the heightfield entirely rather than faking one far below, which would
 *   otherwise cost a terrain march on every single bullet.
 * @param {number} [opts.hardY] optional vertical backstop, mirroring hardRadius.
 */
export function createColliderWorld({ heightAt, normalAt, hardRadius, kinds, hasTerrain = true, hardY = Infinity }) {
  const colliders = [];
  const grid = new Map();
  const cellKey = (ix, iz) => ix * 100003 + iz;
  let built = false;

  function addBox(min, max, kind) {
    colliders.push({ type: TYPE_BOX, min: min.slice(), max: max.slice(), kind });
  }
  function addCylinder(x, z, r, y0, y1, kind) {
    colliders.push({ type: TYPE_CYL, x, z, r, y0, y1, kind });
  }
  function addSphere(x, y, z, r, kind) {
    colliders.push({ type: TYPE_SPHERE, x, y, z, r, kind });
  }
  /**
   * A tube: an axis-aligned cylinder with an open bore. Pass rIn = 0 for a solid
   * cylinder or a bulkhead disc. See rayTube for the (u, v) convention.
   */
  function addTube(axis, u, v, from, to, rIn, rOut, kind) {
    colliders.push({ type: TYPE_TUBE, axis, u, v, from, to, rIn, rOut, kind });
  }

  function index(i, minX, minZ, maxX, maxZ) {
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

  function build() {
    grid.clear();
    colliders.forEach((c, i) => {
      if (c.type === TYPE_BOX) index(i, c.min[0], c.min[2], c.max[0], c.max[2]);
      else if (c.type === TYPE_TUBE) {
        const b = tubeBoundsXZ(c);
        index(i, b[0], b[1], b[2], b[3]);
      } else index(i, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
    });
    built = true;
  }

  /** A tube's footprint on the XZ grid. */
  function tubeBoundsXZ(c) {
    if (c.axis === 0) return [c.from, c.v - c.rOut, c.to, c.v + c.rOut];
    if (c.axis === 2) return [c.u - c.rOut, c.from, c.u + c.rOut, c.to];
    return [c.u - c.rOut, c.v - c.rOut, c.u + c.rOut, c.v + c.rOut];
  }

  const scratch = [];
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

  // ------------------------------------------------------------- movement
  function collideCapsule(pos, radius, height, stepHeight = 0.55) {
    const result = { grounded: false, groundY: -Infinity, hitWall: false, ceiling: false };
    if (!built) build();

    const rad = Math.hypot(pos[0], pos[2]);
    if (rad > hardRadius) {
      const s = hardRadius / rad;
      pos[0] *= s;
      pos[2] *= s;
      result.hitWall = true;
    }

    // Two passes: the first lifts onto low ledges, the second resolves whatever the
    // lift introduced. Keeps doorsteps and cart beds from snagging.
    for (let pass = 0; pass < 2; pass++) {
      const list = queryCells(pos[0] - radius - 1, pos[2] - radius - 1,
        pos[0] + radius + 1, pos[2] + radius + 1, scratch);
      for (const idx of list) {
        const c = colliders[idx];
        if (c.type === TYPE_BOX) resolveBox(pos, radius, height, c, stepHeight, result);
        else if (c.type === TYPE_CYL) resolveCylinder(pos, radius, height, c, stepHeight, result);
        else if (c.type === TYPE_TUBE) resolveTube(pos, radius, height, c, result);
        else resolveSphere(pos, radius, height, c, result);
      }
    }

    if (!hasTerrain) {
      if (pos[1] > hardY) { pos[1] = hardY; result.hitWall = true; }
      else if (pos[1] < -hardY) { pos[1] = -hardY; result.hitWall = true; }
      return result;
    }

    const gh = heightAt(pos[0], pos[2]);
    if (pos[1] < gh) {
      pos[1] = gh;
      result.grounded = true;
    } else if (pos[1] <= gh + 0.05) {
      result.grounded = true;
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

    const topY = c.max[1];
    if (topY - feetY > 0 && topY - feetY <= stepHeight) {
      pos[1] = topY;
      result.grounded = true;
      if (topY > result.groundY) result.groundY = topY;
      return;
    }

    const penX1 = pos[0] - minX, penX2 = maxX - pos[0];
    const penZ1 = pos[2] - minZ, penZ2 = maxZ - pos[2];
    const penUp = topY - feetY;
    const penDown = headY - c.min[1];
    const best = Math.min(penX1, penX2, penZ1, penZ2, penUp, penDown);

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
    const segY = Math.max(pos[1], Math.min(c.y, pos[1] + height));
    const dx = pos[0] - c.x, dy = segY - c.y, dz = pos[2] - c.z;
    const d = Math.hypot(dx, dy, dz);
    const rr = c.r + radius;
    if (d >= rr || d < 1e-5) return;
    const push = (rr - d) / d;
    const nx = dx * push, ny = dy * push, nz = dz * push;
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

  /**
   * Capsule vs tube.
   *
   * Two surfaces, and which one applies depends on which side of the wall you are
   * on: the OUTER skin has to clear the nearest point of the capsule, while the
   * bore has to contain its FARTHEST point. Getting that backwards is what makes a
   * player standing upright in a horizontal module rise gently through the ceiling,
   * because the middle of a 1.8 m capsule is always the closest bit to the axis.
   *
   * A hollow tube is never resolved along its own axis: those ends are open hatches
   * and pushing somebody back out of one would be an invisible wall. A solid tube
   * (rIn = 0, i.e. a bulkhead disc or a strut) does resolve axially, or you could
   * never land on the flat face of one.
   */
  function resolveTube(pos, radius, height, c, result) {
    const a = c.axis;
    const [iu, iv] = PERP[a];
    // A hollow tube's ends are open, so its span is measured against the capsule's
    // centre line and nothing more. Padding it by the capsule radius would let a
    // module reach 35 cm past its own hatch and grab somebody who is really in the
    // module next door -- which at a right-angle junction means two tubes fighting
    // over the same body and flinging it out through the wall. A solid tube keeps
    // the pad: its ends are faces you are meant to bump into.
    const pad = c.rIn > 0 ? 0 : radius;
    const capMin = (a === 1 ? pos[1] : pos[a] - pad);
    const capMax = (a === 1 ? pos[1] + height : pos[a] + pad);
    if (capMax <= c.from || capMin >= c.to) return;

    // Perpendicular offsets at the nearest and farthest points of the capsule's
    // centre line. They only differ for a tube that runs horizontally, where the
    // upright capsule crosses the section instead of sitting in it as a disc.
    let nu, nv, fu, fv;
    if (a === 1) {
      nu = fu = pos[iu] - c.u;
      nv = fv = pos[iv] - c.v;
    } else {
      const yIsU = iu === 1;
      const cy = yIsU ? c.u : c.v;
      const y0 = pos[1], y1 = pos[1] + height;
      const yNear = cy < y0 ? y0 : cy > y1 ? y1 : cy;
      const yFar = Math.abs(y0 - cy) > Math.abs(y1 - cy) ? y0 : y1;
      if (yIsU) {
        nu = yNear - c.u; fu = yFar - c.u;
        nv = fv = pos[iv] - c.v;
      } else {
        nu = fu = pos[iu] - c.u;
        nv = yNear - c.v; fv = yFar - c.v;
      }
    }

    const dNear = Math.hypot(nu, nv);
    const dFar = Math.hypot(fu, fv);
    const bore = c.rIn > radius ? c.rIn : 0;      // a bore too narrow to fit is solid

    if (bore > 0 && dFar <= bore - radius) return;   // clear inside the bore
    if (dNear >= c.rOut + radius) return;            // clear outside the hull

    // Least-penetration wins, exactly as the box resolver does it -- with one
    // veto. If the nearest part of the capsule is inside the bore then some of the
    // body is in the passage, and the only sane answer is to keep it there; pushing
    // "out" from there means out through the hull.
    const outPush = (bore > 0 && dNear < bore) ? Infinity : c.rOut + radius - dNear;
    const inPush = bore > 0 ? dFar - (bore - radius) : Infinity;
    const axialLo = bore > 0 ? Infinity : capMax - c.from;
    const axialHi = bore > 0 ? Infinity : c.to - capMin;
    const best = Math.min(outPush, inPush, axialLo, axialHi);

    if (best === axialLo || best === axialHi) {
      const delta = best === axialLo ? -best : best;
      if (a === 1) {
        pos[1] += delta;
        if (delta > 0) { result.grounded = true; if (pos[1] > result.groundY) result.groundY = pos[1]; }
        else result.ceiling = true;
      } else {
        pos[a] += delta;
        result.hitWall = true;
      }
      return;
    }

    let ux, uv, delta;
    if (best === inPush) {
      const d = dFar || 1;
      ux = -fu / d; uv = -fv / d; delta = inPush;
    } else {
      const d = dNear || 1;
      ux = dNear < 1e-6 ? 1 : nu / d;
      uv = dNear < 1e-6 ? 0 : nv / d;
      delta = outPush;
    }
    pos[iu] += ux * delta;
    pos[iv] += uv * delta;

    // Whichever of the two moved axes was Y decides how it reads to the controller.
    const yPush = iu === 1 ? ux * delta : iv === 1 ? uv * delta : 0;
    if (yPush > Math.abs(iu === 1 ? uv * delta : ux * delta)) {
      result.grounded = true;
      if (pos[1] > result.groundY) result.groundY = pos[1];
    } else if (yPush < 0) {
      result.ceiling = true;
      result.hitWall = true;
    } else {
      result.hitWall = true;
    }
  }

  // ------------------------------------------------------------ raycasting
  function raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    let t = 0, prevT = 0;
    if (oy - heightAt(ox, oz) < 0) return 0;
    while (t < maxDist) {
      const above = (oy + dy * t) - heightAt(ox + dx * t, oz + dz * t);
      if (above < 0) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5;
          if ((oy + dy * mid) - heightAt(ox + dx * mid, oz + dz * mid) < 0) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prevT = t;
      t += Math.max(0.35, Math.min(6, above * 0.65));
    }
    return -1;
  }

  function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!built) build();
    let bestT = maxDist;
    let bestKind = null;
    let bestCollider = null;

    // DDA across the XZ grid so a 400 m shot does not test every prop on the map.
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    let ix = Math.floor(ox / CELL);
    let iz = Math.floor(oz / CELL);
    const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(CELL / dx);
    const tDeltaZ = Math.abs(dz) < 1e-9 ? Infinity : Math.abs(CELL / dz);
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (((dx > 0 ? (ix + 1) * CELL : ix * CELL) - ox) / dx);
    let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (((dz > 0 ? (iz + 1) * CELL : iz * CELL) - oz) / dz);

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
          } else if (c.type === TYPE_TUBE) {
            t = rayTube(ox, oy, oz, dx, dy, dz, c.axis, c.u, c.v, c.from, c.to, c.rIn, c.rOut, bestT);
          } else {
            t = raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y, c.z, c.r, bestT);
          }
          if (t >= 0 && t < bestT) { bestT = t; bestKind = c.kind; bestCollider = c; }
        }
      }
      if (tMaxX < tMaxZ) { travelled = tMaxX; ix += stepX; tMaxX += tDeltaX; }
      else { travelled = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ; }
      if (travelled > maxDist) break;
    }

    const tTerrain = hasTerrain ? raycastTerrain(ox, oy, oz, dx, dy, dz, Math.min(bestT, maxDist)) : -1;
    if (tTerrain >= 0 && tTerrain < bestT) {
      const px = ox + dx * tTerrain, py = oy + dy * tTerrain, pz = oz + dz * tTerrain;
      return { dist: tTerrain, point: [px, py, pz], normal: normalAt(px, pz), kind: kinds.TERRAIN };
    }
    if (bestKind === null) return null;

    const px = ox + dx * bestT, py = oy + dy * bestT, pz = oz + dz * bestT;
    return { dist: bestT, point: [px, py, pz], normal: colliderNormal(bestCollider, px, py, pz), kind: bestKind };
  }

  function colliderNormal(c, px, py, pz) {
    if (c.type === TYPE_TUBE) {
      const a = c.axis;
      const [iu, iv] = PERP[a];
      const p = [px, py, pz];
      const av = p[a];
      // A flat end reads as a cap; anything else is the barrel, inside or out.
      if (Math.abs(av - c.from) < 1e-3) return a === 0 ? [-1, 0, 0] : a === 1 ? [0, -1, 0] : [0, 0, -1];
      if (Math.abs(av - c.to) < 1e-3) return a === 0 ? [1, 0, 0] : a === 1 ? [0, 1, 0] : [0, 0, 1];
      const du = p[iu] - c.u, dv = p[iv] - c.v;
      const d = Math.hypot(du, dv) || 1;
      const sign = Math.abs(d - c.rOut) <= Math.abs(d - c.rIn) ? 1 : -1;
      const n = [0, 0, 0];
      n[iu] = (du / d) * sign;
      n[iv] = (dv / d) * sign;
      return n;
    }
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
    const eps = 1e-3;
    if (Math.abs(px - c.min[0]) < eps) return [-1, 0, 0];
    if (Math.abs(px - c.max[0]) < eps) return [1, 0, 0];
    if (Math.abs(py - c.min[1]) < eps) return [0, -1, 0];
    if (Math.abs(py - c.max[1]) < eps) return [0, 1, 0];
    if (Math.abs(pz - c.min[2]) < eps) return [0, 0, -1];
    return [0, 0, 1];
  }

  function isBlocked(ox, oy, oz, tx, ty, tz) {
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return false;
    return raycastWorld(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist - 0.05) !== null;
  }

  return {
    addBox, addCylinder, addSphere, addTube, build,
    collideCapsule, raycastWorld, raycastTerrain, isBlocked,
    get count() { return colliders.length; },
    colliders
  };
}
