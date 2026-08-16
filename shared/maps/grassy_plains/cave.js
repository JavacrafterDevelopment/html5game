/**
 * The cave at the centre of the map.
 *
 * Built as a rock structure sitting ON the terrain rather than carved INTO it. That
 * is not a shortcut, it is forced by the collision model: the heightfield always
 * pushes a player up out of the ground, so there is no way to be legitimately below
 * it. Standing the chamber on level ground gives a real interior with a real floor
 * for free, and the rocky exterior hides the fact that it is a mound rather than a
 * hole.
 *
 * Exactly one entrance, on the +Z side, with a short walled approach so it reads as
 * a cave mouth instead of a doorway.
 */

import { CAVE_SITE, CAVE_BASE_Y } from './terrain.js';
import { KIND } from '../kinds.js';

const CX = CAVE_SITE.x;
const CZ = CAVE_SITE.z;
const BASE = CAVE_BASE_Y;

export const CAVE = {
  x: CX,
  z: CZ,
  baseY: BASE,
  halfW: 11.0,        // outer footprint
  halfD: 9.5,
  wallT: 3.0,         // thick rock, so it looks like a hill from outside
  innerH: 3.6,        // headroom in the chamber
  roofT: 2.6,
  entranceHalf: 1.7,
  entranceH: 2.45,    // comfortably taller than a 1.8 m player
  mouthLen: 4.5       // walled approach sticking out of the +Z face
};

const { halfW, halfD, wallT, innerH, roofT, entranceHalf, entranceH, mouthLen } = CAVE;

/** Inner chamber bounds. */
export const CHAMBER = {
  minX: CX - halfW + wallT,
  maxX: CX + halfW - wallT,
  minZ: CZ - halfD + wallT,
  maxZ: CZ + halfD - wallT,
  floorY: BASE,
  ceilY: BASE + innerH
};

const box = (minX, minY, minZ, maxX, maxY, maxZ, kind = KIND.ROCK) => ({
  min: [minX, minY, minZ], max: [maxX, maxY, maxZ], kind
});

function build() {
  const out = [];
  const top = BASE + innerH;
  const roofTop = top + roofT;

  // --- side walls (run the full depth) ---
  out.push(box(CX - halfW, BASE - 2, CZ - halfD, CX - halfW + wallT, roofTop, CZ + halfD));
  out.push(box(CX + halfW - wallT, BASE - 2, CZ - halfD, CX + halfW, roofTop, CZ + halfD));

  // --- back wall (-Z), solid ---
  out.push(box(CX - halfW + wallT, BASE - 2, CZ - halfD, CX + halfW - wallT, roofTop, CZ - halfD + wallT));

  // --- front wall (+Z), split around the single entrance ---
  const fz0 = CZ + halfD - wallT, fz1 = CZ + halfD;
  out.push(box(CX - halfW + wallT, BASE - 2, fz0, CX - entranceHalf, roofTop, fz1));
  out.push(box(CX + entranceHalf, BASE - 2, fz0, CX + halfW - wallT, roofTop, fz1));
  // lintel over the entrance
  out.push(box(CX - entranceHalf, BASE + entranceH, fz0, CX + entranceHalf, roofTop, fz1));

  // --- roof over the chamber ---
  out.push(box(CX - halfW + wallT, top, CZ - halfD + wallT, CX + halfW - wallT, roofTop, CZ + halfD - wallT));

  // --- the mouth: two wing walls and a lintel sticking out of the front face ---
  const mz0 = CZ + halfD, mz1 = CZ + halfD + mouthLen;
  out.push(box(CX - entranceHalf - 2.2, BASE - 2, mz0, CX - entranceHalf, BASE + entranceH + 1.6, mz1));
  out.push(box(CX + entranceHalf, BASE - 2, mz0, CX + entranceHalf + 2.2, BASE + entranceH + 1.6, mz1));
  out.push(box(CX - entranceHalf, BASE + entranceH, mz0, CX + entranceHalf, BASE + entranceH + 1.6, mz1));

  // --- a couple of boulders inside for cover, well clear of the walls ---
  out.push(box(CX - 4.2, BASE, CZ - 2.4, CX - 2.8, BASE + 1.05, CZ - 1.0));
  out.push(box(CX + 3.0, BASE, CZ + 1.2, CX + 4.6, BASE + 0.9, CZ + 2.6));

  return out;
}

export const CAVE_BOXES = build();

/** Render-side description. */
export const CAVE_PARTS = {
  ...CAVE,
  chamber: CHAMBER,
  roofTop: BASE + innerH + roofT,
  mouthZ: [CZ + halfD, CZ + halfD + mouthLen],
  boxes: CAVE_BOXES
};

/** True if a point is inside the chamber -- used to keep grass and props out. */
export function insideCave(x, z, pad = 2) {
  return x > CHAMBER.minX - pad && x < CHAMBER.maxX + pad &&
         z > CHAMBER.minZ - pad && z < CHAMBER.maxZ + pad + mouthLen;
}

/** Footprint including the walls and the mouth, for prop exclusion. */
export function nearCave(x, z, pad = 0) {
  return x > CX - halfW - pad && x < CX + halfW + pad &&
         z > CZ - halfD - pad && z < CZ + halfD + mouthLen + pad;
}
