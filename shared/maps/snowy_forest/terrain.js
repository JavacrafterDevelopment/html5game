/**
 * Snowy Forest -- terrain field.
 *
 * The heightfield is a pure analytic function of (x, z). That matters: the server
 * needs ground height for spawn placement and bullet tracing, the client needs it to
 * build the mesh and to walk on, and neither has to ship a heightmap to the other.
 */

import { fbm, ridge, smoothstep, lerp, clamp } from '../../math/num.js';

export const TERRAIN = {
  seed: 1337,
  extent: 140,          // world spans [-140, 140] on both axes
  playRadius: 92,       // beyond this the mountains take over
  hardRadius: 122,      // last-resort clamp, far up a cliff nobody can climb
  meshResolution: 168   // vertices per side when the client tessellates
};

const S = TERRAIN.seed;

/** Rounded hill contribution. */
function hill(x, z, cx, cz, radius, height) {
  const d = Math.hypot(x - cx, z - cz);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return height * t * t * (3 - 2 * t);
}

/** Terrain before any local flattening. */
function rawHeight(x, z) {
  let h = fbm(x * 0.0125, z * 0.0125, 4, S) * 7.5;
  h += fbm(x * 0.052, z * 0.052, 3, S + 11) * 1.7;
  h += fbm(x * 0.17, z * 0.17, 2, S + 29) * 0.38;

  // Interior terrain features: two ridges and a knoll give sightlines and cover.
  h += hill(x, z, 36, -48, 30, 13);
  h += hill(x, z, -58, 14, 24, 9.5);
  h += hill(x, z, 10, 64, 22, 8);
  h += hill(x, z, -14, -22, 16, 4.2);

  // A shallow frozen creek bed cutting across the bowl.
  const creek = Math.abs(z - 8 - Math.sin(x * 0.045) * 14);
  h -= smoothstep(9, 0, creek) * 2.6;

  // Mountain ring.
  //
  // The rise is packed into a narrow band on purpose. A gentle 30-degree climb still
  // reads as "mountain" from inside the bowl, but a sprinting player walks straight
  // up it and stops dead on the numeric clamp -- an invisible wall. Concentrating
  // the same height into r 80..112 puts the face past 70 degrees, which is steeper
  // than MOVE.SLIDE_SLOPE, so the snow gives way and slides you back down. The
  // boundary is then something you can see and feel rather than an arbitrary limit.
  const r = Math.hypot(x, z);
  const m = smoothstep(80, 112, r);
  h += m * m * (95 + ridge(x * 0.021, z * 0.021, 4, S + 77) * 40);

  return h;
}

/** Flat pad the cabin sits on, so the building never floats or clips a slope. */
export const CABIN_SITE = { x: -31, z: 37, radius: 11, falloff: 21 };
export const CABIN_BASE_Y = rawHeight(CABIN_SITE.x, CABIN_SITE.z);

/** Ground height in metres at any world position. */
export function heightAt(x, z) {
  const h = rawHeight(x, z);
  const d = Math.hypot(x - CABIN_SITE.x, z - CABIN_SITE.z);
  if (d >= CABIN_SITE.falloff) return h;
  const t = smoothstep(CABIN_SITE.falloff, CABIN_SITE.radius, d);
  return lerp(h, CABIN_BASE_Y, t);
}

/** Surface normal via central differences. */
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

/** 0 = flat, 1 = vertical. */
export function slopeAt(x, z, eps = 0.7) {
  const n = normalAt(x, z, eps);
  return clamp(1 - n[1], 0, 1);
}

/** True where a player can stand and props may be placed. */
export function isWalkable(x, z) {
  return Math.hypot(x, z) < TERRAIN.playRadius && slopeAt(x, z) < 0.42;
}
