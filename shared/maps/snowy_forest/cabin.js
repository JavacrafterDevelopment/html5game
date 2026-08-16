/**
 * The cabin: one description, consumed twice.
 *  - the client turns `parts` into meshes
 *  - the server (and the client's own movement code) turns `boxes` into collision
 *
 * Walls around windows are split into a low band and a high band. The gap between
 * them is a real hole in the world: bullets pass through it, players do not. That
 * gives us shootable windows for free, with no special-case code anywhere.
 */

import { CABIN_SITE, CABIN_BASE_Y } from './terrain.js';

const CX = CABIN_SITE.x;
const CZ = CABIN_SITE.z;
const BASE = CABIN_BASE_Y;

export const CABIN = {
  x: CX,
  z: CZ,
  baseY: BASE,
  halfW: 6.6,          // along X
  halfD: 5.0,          // along Z
  floorY: BASE + 0.5,  // raised on a foundation
  wallH: 3.5,
  wallT: 0.32,
  ridgeH: 2.5,         // roof peak above the wall top
  doorHalf: 0.95,
  sillLow: 1.05,       // window opening, relative to floor
  sillHigh: 2.25
};

const { halfW, halfD, floorY, wallH, wallT, doorHalf, sillLow, sillHigh } = CABIN;
const TOP = floorY + wallH;

const box = (minX, minY, minZ, maxX, maxY, maxZ, kind) => ({
  min: [minX, minY, minZ],
  max: [maxX, maxY, maxZ],
  kind
});

/** Window openings, in local X (for Z-facing walls) or local Z (for X-facing walls). */
export const WINDOWS = {
  north: [-3.4, 0.6],   // centres along X on the -Z wall
  east: [0],            // centre along Z on the +X wall
  west: [-1.2]          // centre along Z on the -X wall
};
const WIN_HALF = 0.85;

/**
 * Build a wall that runs along X (facing -Z or +Z) with holes punched for windows
 * and, optionally, a doorway.
 */
function wallAlongX(zMin, zMax, windows, door) {
  const out = [];
  const cuts = [];
  for (const wc of windows) cuts.push([CX + wc - WIN_HALF, CX + wc + WIN_HALF]);
  if (door) cuts.push([CX - doorHalf, CX + doorHalf]);
  cuts.sort((a, b) => a[0] - b[0]);

  // Low band: solid everywhere except doorways.
  let cursor = CX - halfW;
  for (const [a, b] of cuts) {
    const isDoor = door && Math.abs((a + b) / 2 - CX) < 0.001;
    if (!isDoor) continue;
    if (a > cursor) out.push(box(cursor, floorY, zMin, a, floorY + sillLow, zMax, 'wall'));
    cursor = b;
  }
  if (cursor < CX + halfW) out.push(box(cursor, floorY, zMin, CX + halfW, floorY + sillLow, zMax, 'wall'));

  // Mid band: solid between the openings.
  cursor = CX - halfW;
  for (const [a, b] of cuts) {
    if (a > cursor) out.push(box(cursor, floorY + sillLow, zMin, a, floorY + sillHigh, zMax, 'wall'));
    cursor = Math.max(cursor, b);
  }
  if (cursor < CX + halfW) out.push(box(cursor, floorY + sillLow, zMin, CX + halfW, floorY + sillHigh, zMax, 'wall'));

  // High band: solid all the way across (door header included).
  out.push(box(CX - halfW, floorY + sillHigh, zMin, CX + halfW, TOP, zMax, 'wall'));
  return out;
}

/** Same idea for the walls running along Z. */
function wallAlongZ(xMin, xMax, windows) {
  const out = [];
  const cuts = windows.map((wc) => [CZ + wc - WIN_HALF, CZ + wc + WIN_HALF]).sort((a, b) => a[0] - b[0]);
  out.push(box(xMin, floorY, CZ - halfD, xMax, floorY + sillLow, CZ + halfD, 'wall'));
  let cursor = CZ - halfD;
  for (const [a, b] of cuts) {
    if (a > cursor) out.push(box(xMin, floorY + sillLow, cursor, xMax, floorY + sillHigh, a, 'wall'));
    cursor = Math.max(cursor, b);
  }
  if (cursor < CZ + halfD) out.push(box(xMin, floorY + sillLow, cursor, xMax, floorY + sillHigh, CZ + halfD, 'wall'));
  out.push(box(xMin, floorY + sillHigh, CZ - halfD, xMax, TOP, CZ + halfD, 'wall'));
  return out;
}

/** Gable roof approximated by stepped slabs -- collidable and cheap. */
function roofBoxes() {
  const out = [];
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const y0 = TOP + t0 * CABIN.ridgeH;
    const y1 = TOP + t1 * CABIN.ridgeH + 0.18;
    const inset0 = t0 * halfD;
    const inset1 = t1 * halfD;
    // north slope
    out.push(box(CX - halfW - 0.5, y0, CZ - halfD - 0.45 + inset0, CX + halfW + 0.5, y1, CZ - halfD - 0.45 + inset1 + 0.35, 'roof'));
    // south slope
    out.push(box(CX - halfW - 0.5, y0, CZ + halfD + 0.45 - inset1 - 0.35, CX + halfW + 0.5, y1, CZ + halfD + 0.45 - inset0, 'roof'));
  }
  return out;
}

/** Everything solid about the cabin, in world space. */
export const CABIN_BOXES = [
  // foundation + floor slab
  box(CX - halfW - 0.35, BASE - 2.0, CZ - halfD - 0.35, CX + halfW + 0.35, floorY, CZ + halfD + 0.35, 'floor'),
  // porch deck in front of the door (+Z side)
  box(CX - 2.6, BASE - 1.0, CZ + halfD + 0.35, CX + 2.6, floorY, CZ + halfD + 2.9, 'floor'),
  // walls
  ...wallAlongX(CZ - halfD - wallT, CZ - halfD, WINDOWS.north, false),
  ...wallAlongX(CZ + halfD, CZ + halfD + wallT, [], true),
  ...wallAlongZ(CX + halfW, CX + halfW + wallT, WINDOWS.east),
  ...wallAlongZ(CX - halfW - wallT, CX - halfW, WINDOWS.west),
  // porch posts
  box(CX - 2.5, floorY, CZ + halfD + 2.6, CX - 2.2, floorY + 2.7, CZ + halfD + 2.9, 'prop'),
  box(CX + 2.2, floorY, CZ + halfD + 2.6, CX + 2.5, floorY + 2.7, CZ + halfD + 2.9, 'prop'),
  // chimney
  box(CX + halfW - 1.9, floorY, CZ - halfD - 1.0, CX + halfW - 0.7, TOP + CABIN.ridgeH + 1.2, CZ - halfD - 0.05, 'prop'),
  // interior furniture: a table and two crates, useful cover through the windows
  box(CX - 1.3, floorY, CZ - 1.1, CX + 1.3, floorY + 0.78, CZ + 0.5, 'prop'),
  box(CX + 3.6, floorY, CZ + 2.1, CX + 4.6, floorY + 1.0, CZ + 3.1, 'prop'),
  box(CX - 4.9, floorY, CZ - 3.4, CX - 3.7, floorY + 1.15, CZ - 2.2, 'prop'),
  ...roofBoxes()
];

/** Render-side description (the client builds meshes from this). */
export const CABIN_PARTS = {
  origin: [CX, BASE, CZ],
  halfW, halfD, floorY, wallH, wallT, ridgeH: CABIN.ridgeH,
  top: TOP,
  door: { halfWidth: doorHalf, height: sillHigh + 0.35 },
  windows: WINDOWS,
  windowHalf: WIN_HALF,
  sillLow, sillHigh,
  porch: { minX: CX - 2.6, maxX: CX + 2.6, minZ: CZ + halfD + 0.35, maxZ: CZ + halfD + 2.9 },
  chimney: { x: CX + halfW - 1.3, z: CZ - halfD - 0.5, top: TOP + CABIN.ridgeH + 1.2 }
};
