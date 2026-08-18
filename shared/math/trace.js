/**
 * Ray / volume intersection routines used for bullet tracing and hit registration.
 * Plain arrays and scalars only -- no Three.js -- so the server can use them too.
 */

/**
 * Ray vs axis-aligned box.
 * @returns distance along ray, or -1 for no hit.
 */
export function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, maxDist) {
  let tmin = 0, tmax = maxDist;
  // X slab
  if (Math.abs(dx) < 1e-8) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv, t2 = (maxX - ox) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y slab
  if (Math.abs(dy) < 1e-8) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv, t2 = (maxY - oy) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z slab
  if (Math.abs(dz) < 1e-8) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv, t2 = (maxZ - oz) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin > 0 ? tmin : (tmax > 0 ? tmax : -1);
}

/** Ray vs sphere. Returns nearest positive distance or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return -1;
  return t;
}

/**
 * Ray vs a Y-axis-aligned finite cylinder (tree trunks, posts).
 * Returns nearest positive distance or -1.
 */
export function rayCylinderY(ox, oy, oz, dx, dy, dz, cx, cz, r, yMin, yMax, maxDist) {
  const mx = ox - cx, mz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;                      // ray is vertical: ignore
  const b = 2 * (mx * dx + mz * dz);
  const c = mx * mx + mz * mz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const inv2a = 1 / (2 * a);
  let t = (-b - s) * inv2a;
  if (t < 0) t = (-b + s) * inv2a;
  if (t < 0 || t > maxDist) return -1;
  const y = oy + dy * t;
  if (y < yMin || y > yMax) return -1;
  return t;
}

/**
 * Ray vs vertical capsule (player hitbox). Body only -- heads are separate spheres.
 * Capsule runs from (cx, yBottom, cz) to (cx, yTop, cz) with radius r.
 */
export function rayCapsuleY(ox, oy, oz, dx, dy, dz, cx, cz, yBottom, yTop, r, maxDist) {
  // Side surface
  const tSide = rayCylinderY(ox, oy, oz, dx, dy, dz, cx, cz, r, yBottom, yTop, maxDist);
  // End caps
  const tA = raySphere(ox, oy, oz, dx, dy, dz, cx, yBottom, cz, r, maxDist);
  const tB = raySphere(ox, oy, oz, dx, dy, dz, cx, yTop, cz, r, maxDist);
  let best = -1;
  for (const t of [tSide, tA, tB]) {
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** Squared distance between two 3D points. */
export function dist2(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

/** Normalise a 3-array in place, returns the array. */
export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

/**
 * Ray vs an axis-aligned TUBE: a finite cylinder with a bore down the middle.
 *
 * This is the shape of a space station module, and having it as a primitive is the
 * difference between a hull that is exactly where it is drawn and one that is
 * approximated by boxes. `rIn = 0` degenerates to a solid cylinder, which is how
 * end caps and bulkhead discs are built.
 *
 * `axis` is 0/1/2 for X/Y/Z. (u, v) locate the axis line in the remaining two
 * coordinates, in ascending index order: (y,z) for X, (x,z) for Y, (x,y) for Z.
 *
 * The bore is genuinely open -- a shot fired down an open hatch goes through.
 *
 * @returns distance along the ray, or -1 for no hit.
 */
export function rayTube(ox, oy, oz, dx, dy, dz, axis, u, v, from, to, rIn, rOut, maxDist) {
  const o = axis === 0 ? ox : axis === 1 ? oy : oz;
  const d = axis === 0 ? dx : axis === 1 ? dy : dz;
  const op = axis === 0 ? oy : ox;
  const dp = axis === 0 ? dy : dx;
  const oq = axis === 2 ? oy : oz;
  const dq = axis === 2 ? dy : dz;

  // --- axial slab ---
  let sMin = 0, sMax = maxDist;
  if (Math.abs(d) < 1e-8) {
    if (o < from || o > to) return -1;
  } else {
    const inv = 1 / d;
    let t1 = (from - o) * inv, t2 = (to - o) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > sMin) sMin = t1;
    if (t2 < sMax) sMax = t2;
    if (sMin > sMax) return -1;
  }

  const mp = op - u, mq = oq - v;
  const A = dp * dp + dq * dq;

  // Ray parallel to the axis: it is either down the bore, through the wall the
  // long way, or clean past. Radial distance never changes, so one test settles it.
  if (A < 1e-12) {
    const rr = Math.hypot(mp, mq);
    if (rr < rIn || rr > rOut) return -1;
    return sMin > 0 ? sMin : (sMax > 0 ? sMax : -1);
  }

  const B = 2 * (mp * dp + mq * dq);
  const solve = (r) => {
    const C = mp * mp + mq * mq - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const inv2a = 1 / (2 * A);
    return [(-B - s) * inv2a, (-B + s) * inv2a];
  };

  const outer = solve(rOut);
  if (!outer) return -1;
  const lo = Math.max(outer[0], sMin);
  const hi = Math.min(outer[1], sMax);
  if (lo > hi) return -1;

  // Subtract the bore. What is left is the wall, and its first face is the hit.
  let t = lo;
  if (rIn > 0) {
    const inner = solve(rIn);
    if (inner && inner[0] <= lo && inner[1] >= hi) return -1;   // all bore, no wall
    if (inner && inner[0] <= lo && inner[1] > lo) t = inner[1]; // started in the bore
  }
  if (t < 0) t = hi > 0 ? 0 : -1;                               // started inside the wall
  if (t < 0 || t > maxDist) return -1;
  return t;
}
