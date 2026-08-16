/**
 * Grassy Plains -- terrain field.
 *
 * Deliberately gentle. The snowy map used near-vertical mountains as its boundary,
 * which works there but produces slide-back behaviour that can feel like an unseen
 * wall. Here the ground never gets steep: the play area is bounded by a genuinely
 * dense treeline you can see and walk into, and the numeric clamp sits far behind
 * it where no one will ever reach it.
 *
 * Hut pads are flattened here rather than in the building code, so a hut is always
 * sitting on level ground and never floats or buries a corner.
 */

import { fbm, smoothstep, lerp, clamp, makeRng } from '../../math/num.js';

export const TERRAIN = {
  seed: 7331,
  extent: 150,
  playRadius: 95,      // open ground ends here
  treelineInner: 99,   // dense woods start
  treelineOuter: 116,
  hardRadius: 132,     // numeric backstop, far behind the woods
  meshResolution: 176
};

const S = TERRAIN.seed;

function hill(x, z, cx, cz, radius, height) {
  const d = Math.hypot(x - cx, z - cz);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return height * t * t * (3 - 2 * t);
}

/** Open rolling farmland, before any hut pads are levelled. */
function rawHeight(x, z) {
  let h = fbm(x * 0.0085, z * 0.0085, 4, S) * 5.0;
  h += fbm(x * 0.031, z * 0.031, 3, S + 11) * 1.25;
  h += fbm(x * 0.115, z * 0.115, 2, S + 29) * 0.28;

  // a few broad swells so the plains are not a flat table
  h += hill(x, z, -44, 38, 42, 6.5);
  h += hill(x, z, 52, 44, 36, 5.0);
  h += hill(x, z, -18, -58, 34, 4.2);

  // a shallow dry creek winding across, good low cover
  const creek = Math.abs(z + 6 - Math.sin(x * 0.038) * 18 - Math.cos(x * 0.017) * 9);
  h -= smoothstep(11, 0, creek) * 1.9;

  // The rim lifts gently into wooded high ground. Nothing here exceeds a slope you
  // can comfortably walk up -- the trees are what stop you, not the gradient.
  const r = Math.hypot(x, z);
  const rim = smoothstep(TERRAIN.playRadius - 6, TERRAIN.extent, r);
  h += rim * rim * 26;

  return h;
}

/**
 * The cave sits in the middle of the map. Its floor is the terrain itself, so the
 * ground under it has to be dead level -- a sloped floor inside a box-walled chamber
 * would leave gaps under the walls.
 */
export const CAVE_SITE = { x: 0, z: 0, radius: 15, falloff: 30 };
export const CAVE_BASE_Y = rawHeight(CAVE_SITE.x, CAVE_SITE.z);

/**
 * Hut sites. Only two, deliberately: this map is meant to read as open plains, and
 * every building is one more thing between you and the horizon.
 *
 * Generated here rather than in huts.js because the terrain has to level their pads,
 * and heightAt must stay a pure function of (x, z).
 */
function generateSites() {
  const sites = [
    { x: -38, z: 26, w: 7.0, d: 5.8 },
    { x: 34, z: -30, w: 6.4, d: 6.4 }
  ];
  for (const s of sites) {
    s.pad = Math.max(s.w, s.d) * 0.85 + 4.0;
    s.baseY = rawHeight(s.x, s.z);
  }
  return sites;
}

export const HUT_SITES = generateSites();

// Bounding circle so heightAt can reject the common case in one test.
const SITE_BOUND = (() => {
  let maxR = 0;
  for (const s of HUT_SITES) maxR = Math.max(maxR, Math.hypot(s.x, s.z) + s.pad + 12);
  return maxR;
})();

/** Ground height in metres. */
export function heightAt(x, z) {
  let h = rawHeight(x, z);

  // cave floor: level, and it wins over everything else
  const cd = Math.hypot(x - CAVE_SITE.x, z - CAVE_SITE.z);
  if (cd < CAVE_SITE.falloff) {
    h = lerp(h, CAVE_BASE_Y, smoothstep(CAVE_SITE.falloff, CAVE_SITE.radius, cd));
  }

  if (Math.hypot(x, z) < SITE_BOUND) {
    for (let i = 0; i < HUT_SITES.length; i++) {
      const s = HUT_SITES[i];
      const dx = x - s.x, dz = z - s.z;
      const outer = s.pad + 10;
      if (dx * dx + dz * dz > outer * outer) continue;
      const d = Math.hypot(dx, dz);
      const t = smoothstep(outer, s.pad, d);
      if (t > 0) h = lerp(h, s.baseY, t);
    }
  }
  return h;
}

export function normalAt(x, z, eps = 0.7) {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function slopeAt(x, z, eps = 0.7) {
  return clamp(1 - normalAt(x, z, eps)[1], 0, 1);
}

export function isWalkable(x, z) {
  return Math.hypot(x, z) < TERRAIN.playRadius && slopeAt(x, z) < 0.35;
}
