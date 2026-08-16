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
