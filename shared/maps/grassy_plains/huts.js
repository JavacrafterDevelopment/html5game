/**
 * Village huts: mud-brick walls under a thatched hip roof.
 *
 * Same discipline as the snowy map's cabin -- one description produces both the
 * collision boxes and the meshes, so what you can hide behind is exactly what stops
 * a bullet. Window bands are true gaps in the collision list, which makes them
 * shootable through without a single special case.
 */

import { makeRng } from '../../math/num.js';
import { HUT_SITES, TERRAIN } from './terrain.js';
import { KIND } from '../kinds.js';

const WALL_H = 2.65;
const WALL_T = 0.34;
const DOOR_HALF = 0.85;
const DOOR_H = 2.25;      // comfortably taller than a 1.80 m player
const SILL_LOW = 1.05;
const SILL_HIGH = 1.85;
const WIN_HALF = 0.62;
const ROOF_RISE = 1.7;
const EAVE = 0.55;

const box = (minX, minY, minZ, maxX, maxY, maxZ, kind) => ({
  min: [minX, minY, minZ], max: [maxX, maxY, maxZ], kind
});

/**
 * One wall running along X, with optional window gaps and an optional doorway.
 * Bands: floor->sill (solid except doors), sill band (gaps), sill->top (solid).
 */
function wallAlongX(out, cx, halfW, zMin, zMax, floorY, windows, door) {
  const top = floorY + WALL_H;

  // low band -- solid unless there is a door
  if (door) {
    out.push(box(cx - halfW, floorY, zMin, cx - DOOR_HALF, floorY + SILL_LOW, zMax, KIND.WALL));
    out.push(box(cx + DOOR_HALF, floorY, zMin, cx + halfW, floorY + SILL_LOW, zMax, KIND.WALL));
  } else {
    out.push(box(cx - halfW, floorY, zMin, cx + halfW, floorY + SILL_LOW, zMax, KIND.WALL));
  }

  // window band -- solid between the openings (and the doorway stays open)
  const cuts = windows.map((w) => [cx + w - WIN_HALF, cx + w + WIN_HALF]);
  if (door) cuts.push([cx - DOOR_HALF, cx + DOOR_HALF]);
  cuts.sort((a, b) => a[0] - b[0]);

  let cursor = cx - halfW;
  for (const [a, b] of cuts) {
    if (a > cursor) out.push(box(cursor, floorY + SILL_LOW, zMin, a, floorY + SILL_HIGH, zMax, KIND.WALL));
    cursor = Math.max(cursor, b);
  }
  if (cursor < cx + halfW) {
    out.push(box(cursor, floorY + SILL_LOW, zMin, cx + halfW, floorY + SILL_HIGH, zMax, KIND.WALL));
  }

  // Doorway band. The window band only reaches 1.85 m and the player is 1.80 m --
  // walking through a 5 cm gap works in theory and feels awful, so the door is cut
  // all the way to DOOR_H and only the header above it is solid.
  if (door) {
    out.push(box(cx - halfW, floorY + SILL_HIGH, zMin, cx - DOOR_HALF, floorY + DOOR_H, zMax, KIND.WALL));
    out.push(box(cx + DOOR_HALF, floorY + SILL_HIGH, zMin, cx + halfW, floorY + DOOR_H, zMax, KIND.WALL));
    out.push(box(cx - halfW, floorY + DOOR_H, zMin, cx + halfW, top, zMax, KIND.WALL));
  } else {
    out.push(box(cx - halfW, floorY + SILL_HIGH, zMin, cx + halfW, top, zMax, KIND.WALL));
  }
}

/** Same, for walls running along Z. */
function wallAlongZ(out, cz, halfD, xMin, xMax, floorY, windows, door) {
  const top = floorY + WALL_H;

  if (door) {
    out.push(box(xMin, floorY, cz - halfD, xMax, floorY + SILL_LOW, cz - DOOR_HALF, KIND.WALL));
    out.push(box(xMin, floorY, cz + DOOR_HALF, xMax, floorY + SILL_LOW, cz + halfD, KIND.WALL));
  } else {
    out.push(box(xMin, floorY, cz - halfD, xMax, floorY + SILL_LOW, cz + halfD, KIND.WALL));
  }

  const cuts = windows.map((w) => [cz + w - WIN_HALF, cz + w + WIN_HALF]);
  if (door) cuts.push([cz - DOOR_HALF, cz + DOOR_HALF]);
  cuts.sort((a, b) => a[0] - b[0]);

  let cursor = cz - halfD;
  for (const [a, b] of cuts) {
    if (a > cursor) out.push(box(xMin, floorY + SILL_LOW, cursor, xMax, floorY + SILL_HIGH, a, KIND.WALL));
    cursor = Math.max(cursor, b);
  }
  if (cursor < cz + halfD) {
    out.push(box(xMin, floorY + SILL_LOW, cursor, xMax, floorY + SILL_HIGH, cz + halfD, KIND.WALL));
  }

  if (door) {
    out.push(box(xMin, floorY + SILL_HIGH, cz - halfD, xMax, floorY + DOOR_H, cz - DOOR_HALF, KIND.WALL));
    out.push(box(xMin, floorY + SILL_HIGH, cz + DOOR_HALF, xMax, floorY + DOOR_H, cz + halfD, KIND.WALL));
    out.push(box(xMin, floorY + DOOR_H, cz - halfD, xMax, top, cz + halfD, KIND.WALL));
  } else {
    out.push(box(xMin, floorY + SILL_HIGH, cz - halfD, xMax, top, cz + halfD, KIND.WALL));
  }
}

/**
 * Hip roof approximated by shrinking slabs. Four steps is enough to read as a
 * pitched thatch roof and keeps the collider count sane.
 */
function roofBoxes(out, cx, cz, halfW, halfD, floorY) {
  const top = floorY + WALL_H;
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const w0 = (halfW + EAVE) * (1 - t0 * 0.82);
    const d0 = (halfD + EAVE) * (1 - t0 * 0.82);
    const y0 = top + t0 * ROOF_RISE;
    const y1 = top + t1 * ROOF_RISE + 0.06;
    out.push(box(cx - w0, y0, cz - d0, cx + w0, y1, cz + d0, KIND.THATCH));
  }
}

function buildHut(site, rng) {
  const halfW = site.w / 2;
  const halfD = site.d / 2;
  const floorY = site.baseY + 0.12;      // low mud sill, well under step height
  const boxes = [];

  // floor pad
  boxes.push(box(site.x - halfW - 0.3, site.baseY - 1.2, site.z - halfD - 0.3,
    site.x + halfW + 0.3, floorY, site.z + halfD + 0.3, KIND.FLOOR));

  // Doors always face the middle of the map, so the village reads as facing inward.
  const towardCentre = Math.abs(site.x) > Math.abs(site.z)
    ? (site.x > 0 ? 'minusX' : 'plusX')
    : (site.z > 0 ? 'minusZ' : 'plusZ');

  const winA = [-halfW * 0.42, halfW * 0.42];
  const winB = [0];

  wallAlongX(boxes, site.x, halfW, site.z - halfD - WALL_T, site.z - halfD, floorY,
    towardCentre === 'minusZ' ? [] : winA, towardCentre === 'minusZ');
  wallAlongX(boxes, site.x, halfW, site.z + halfD, site.z + halfD + WALL_T, floorY,
    towardCentre === 'plusZ' ? [] : winA, towardCentre === 'plusZ');
  wallAlongZ(boxes, site.z, halfD, site.x - halfW - WALL_T, site.x - halfW, floorY,
    towardCentre === 'minusX' ? [] : winB, towardCentre === 'minusX');
  wallAlongZ(boxes, site.z, halfD, site.x + halfW, site.x + halfW + WALL_T, floorY,
    towardCentre === 'plusX' ? [] : winB, towardCentre === 'plusX');

  roofBoxes(boxes, site.x, site.z, halfW, halfD, floorY);

  return {
    ...site,
    halfW, halfD, floorY,
    wallH: WALL_H, wallT: WALL_T, roofRise: ROOF_RISE, eave: EAVE,
    sillLow: SILL_LOW, sillHigh: SILL_HIGH, winHalf: WIN_HALF,
    doorHalf: DOOR_HALF, door: towardCentre,
    windowsX: winA, windowsZ: winB,
    wallTint: rng(),
    boxes
  };
}

function build() {
  const rng = makeRng(TERRAIN.seed ^ 0x4111);
  return HUT_SITES.map((s) => buildHut(s, rng));
}

export const HUTS = build();

/** Every solid box belonging to a hut, in world space. */
export const HUT_BOXES = HUTS.flatMap((h) => h.boxes);
