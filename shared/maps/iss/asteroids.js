/**
 * The rocks, as data.
 *
 * Same discipline as station.js: one list, consumed by the collider and by the
 * renderer, so a rock cannot be drawn anywhere it does not exist. The one rule that
 * differs is that these are NOT attached to anything and are not supposed to be --
 * they are debris in orbit, and the station's connectivity test is scoped to the
 * station for exactly that reason.
 *
 * Two kinds:
 *
 *   solid  - a cluster of two to five overlapping spheres. A single sphere reads as
 *            a ball; a cluster reads as a rock, and every sphere in it is still an
 *            exact collider.
 *   holed  - a TUBE, which is the shape of a rock with a hole bored through it and
 *            is a primitive the collider already has. Lumps are hung round the
 *            outside for silhouette, and every one of them is kept at least its own
 *            radius clear of the bore, so nothing can ever partly block the hole.
 *
 * Placement is rejection-sampled against the station, the flight lanes down the
 * pressurised stack and out of the airlock, and the other rocks. Generated from a
 * fixed seed, so every client and the server produce the identical field.
 */

import { makeRng } from '../../math/num.js';
import { KIND } from '../kinds.js';
import { STATION_BOUNDS } from './station.js';

/** Rocks are hull-hard as far as a bullet is concerned. */
const ROCK = KIND.ROCK;

/** Nothing may sit inside the station's own volume, plus this much clearance. */
const STATION_MARGIN = 7.0;
/**
 * Flight lanes that have to stay open: down the middle of the pressurised stack,
 * and straight out of the Quest airlock. Both are tested in tools/test-maps.mjs,
 * and both are how you get in and out of the station.
 */
const LANES = [
  { axis: 2, u: 0, v: 0, from: -140, to: 140, r: 9.0 },     // the stack, fore and aft
  { axis: 0, u: 0, v: -2, from: 9.0, to: 60, r: 8.0 }       // out of the airlock
];

const PARTS = [];
const GROUPS = [];

function sphere(name, x, y, z, r) {
  PARTS.push({ name, look: 'rock', s: 'sphere', x, y, z, r, kind: ROCK });
  return PARTS[PARTS.length - 1];
}

/**
 * @param {number|null} capFromR inner radius of the ring that caps this end, or
 *   null for "the segment next to me is fatter, so it draws the step itself". A
 *   holed rock is several segments of different girth end to end, and without this
 *   every joint draws two coincident rings and z-fights with itself.
 */
function tube(name, axis, u, v, from, to, rIn, rOut, capFromR, capToR) {
  PARTS.push({
    name, look: 'rockbore', s: 'tube', axis, u, v, from, to, rIn, rOut, kind: ROCK,
    capFromR, capToR
  });
  return PARTS[PARTS.length - 1];
}

/** True if a sphere of this radius would foul the station or a flight lane. */
function blocked(x, y, z, r) {
  const b = STATION_BOUNDS;
  const m = STATION_MARGIN + r;
  if (x > b.min[0] - m && x < b.max[0] + m &&
      y > b.min[1] - m && y < b.max[1] + m &&
      z > b.min[2] - m && z < b.max[2] + m) return true;

  for (const lane of LANES) {
    const p = [x, y, z];
    const a = p[lane.axis];
    if (a < lane.from - r || a > lane.to + r) continue;
    const perp = lane.axis === 0 ? [1, 2] : lane.axis === 1 ? [0, 2] : [0, 1];
    if (Math.hypot(p[perp[0]] - lane.u, p[perp[1]] - lane.v) < lane.r + r) return true;
  }
  return false;
}

function farFromOthers(x, y, z, r) {
  for (const g of GROUPS) {
    if (Math.hypot(g.x - x, g.y - y, g.z - z) < g.r + r + 9) return false;
  }
  return true;
}

function build() {
  const rng = makeRng(0x1551);
  let solid = 0, holed = 0;
  const WANT_SOLID = 11, WANT_HOLED = 6;

  for (let attempt = 0; attempt < 9000 && (solid < WANT_SOLID || holed < WANT_HOLED); attempt++) {
    const wantHole = holed < WANT_HOLED && (solid >= WANT_SOLID || rng() < 0.42);

    // Aimed above and below the station, and off both ends. Those are the open
    // volumes a fight actually crosses, and the ones with nothing to hide behind.
    const a = rng() * Math.PI * 2;
    const band = rng();
    const y = band < 0.42 ? 20 + rng() * 34
      : band < 0.80 ? -15 - rng() * 32
        : (rng() - 0.5) * 30;
    const rad = 26 + rng() * 46;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;

    const size = wantHole ? 6.4 + rng() * 3.0 : 4.6 + rng() * 3.4;
    if (Math.hypot(x, y, z) > 88) continue;
    if (blocked(x, y, z, size + 2)) continue;
    if (!farFromOthers(x, y, z, size)) continue;

    const tag = (wantHole ? 'bore' : 'rock') + (wantHole ? holed : solid);
    if (wantHole) {
      // A bore wide enough to fly a body down without threading a needle.
      const axis = Math.floor(rng() * 3);
      const rIn = 3.0 + rng() * 0.9;
      const rOut = size;
      const half = rOut * (0.70 + rng() * 0.35);
      const c = [x, y, z];
      const perp = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];

      // Three collinear segments of different girth, not one clean barrel. A
      // constant-radius tube reads as a length of pipe however much you stick to
      // it; a stepped profile reads as a rock with a hole worn through, and each
      // step is still exactly one collider.
      const prof = [0.62 + rng() * 0.14, 0.86 + rng() * 0.14, 1.0, 0.66 + rng() * 0.20];
      const cuts = [-1, -0.52 + rng() * 0.12, -0.08 + rng() * 0.14, 0.40 + rng() * 0.16, 1];
      for (let i = 0; i < 4; i++) {
        const ro = rOut * prof[i];
        const prev = i > 0 ? rOut * prof[i - 1] : null;
        const next = i < 3 ? rOut * prof[i + 1] : null;
        tube(tag + 's' + i, axis, c[perp[0]], c[perp[1]],
          c[axis] + cuts[i] * half, c[axis] + cuts[i + 1] * half, rIn, ro,
          prev === null ? rIn : (prev < ro ? prev : null),
          next === null ? rIn : (next < ro ? next : null));
      }

      // Lumps for silhouette, hung out at or past the rim. Buried inside the
      // barrel they add nothing: what breaks a cylinder is an outline that is not
      // a cylinder. The invariant that matters is that no part of a lump may come
      // within the bore radius of the axis, or it hangs into the tunnel and
      // half-closes a hole the tests have already proved is flyable.
      const lumps = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < lumps; i++) {
        const lr = rOut * (0.34 + rng() * 0.28);
        const lo = Math.max(rIn + lr + 0.35, rOut * 0.72);
        const ring = lo + rng() * Math.max(0.2, rOut + lr * 0.6 - lo);
        if (ring - lr < rIn + 0.15) continue;
        const ang = rng() * Math.PI * 2;
        const along = (rng() - 0.5) * 2.3 * half;
        const p = [0, 0, 0];
        p[axis] = c[axis] + along;
        p[perp[0]] = c[perp[0]] + Math.cos(ang) * ring;
        p[perp[1]] = c[perp[1]] + Math.sin(ang) * ring;
        sphere(`${tag}-lump${i}`, p[0], p[1], p[2], lr);
      }
      GROUPS.push({ x, y, z, r: rOut * 1.7 });
      holed++;
    } else {
      const blobs = 2 + Math.floor(rng() * 4);
      let reach = 0;
      for (let i = 0; i < blobs; i++) {
        const br = size * (i === 0 ? 1 : 0.45 + rng() * 0.45);
        const off = i === 0 ? 0 : size * (0.45 + rng() * 0.45);
        const ang = rng() * Math.PI * 2;
        const el = (rng() - 0.5) * Math.PI;
        const bx = x + Math.cos(ang) * Math.cos(el) * off;
        const by = y + Math.sin(el) * off;
        const bz = z + Math.sin(ang) * Math.cos(el) * off;
        sphere(`${tag}-${i}`, bx, by, bz, br);
        reach = Math.max(reach, off + br);
      }
      GROUPS.push({ x, y, z, r: reach });
      solid++;
    }
  }
}

build();

export const ASTEROID_PARTS = PARTS;
/** Rough bounding spheres, one per rock. Used by the tests to explain a contact. */
export const ASTEROID_GROUPS = GROUPS;
