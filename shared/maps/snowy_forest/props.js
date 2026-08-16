/**
 * Deterministic prop scatter: trees, boulders, deadfall, stumps, drifts.
 * Generated from the map seed at module load, so every client and the server
 * end up with byte-identical forests without transferring anything.
 */

import { makeRng, smoothstep } from '../../math/num.js';
import { TERRAIN, heightAt, slopeAt } from './terrain.js';
import { CABIN_SITE } from './terrain.js';

const CLEARING_RADIUS = 16.5;   // no trees inside the cabin clearing

export const TREE_VARIANTS = {
  TALL_PINE: 0,
  PINE: 1,
  FIR: 2,
  DEAD: 3
};

function tooCloseToCabin(x, z, pad = 0) {
  return Math.hypot(x - CABIN_SITE.x, z - CABIN_SITE.z) < CLEARING_RADIUS + pad;
}

/** Uniform-grid spatial index used to enforce minimum spacing while scattering. */
function makeSpacer(cell) {
  const grid = new Map();
  const key = (cx, cz) => cx * 100000 + cz;
  return {
    tryPlace(x, z, minDist) {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      const span = Math.ceil(minDist / cell);
      for (let i = cx - span; i <= cx + span; i++) {
        for (let j = cz - span; j <= cz + span; j++) {
          const arr = grid.get(key(i, j));
          if (!arr) continue;
          for (const p of arr) {
            if (Math.hypot(p[0] - x, p[1] - z) < minDist) return false;
          }
        }
      }
      const k = key(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([x, z]);
      return true;
    }
  };
}

function generate() {
  const rng = makeRng(TERRAIN.seed ^ 0x5eed);
  const spacer = makeSpacer(6);
  const trees = [];
  const rocks = [];
  const logs = [];
  const stumps = [];
  const drifts = [];

  const R = TERRAIN.playRadius;

  // --- trees ---
  for (let attempt = 0; attempt < 6000 && trees.length < 430; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R + 12);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (Math.hypot(x, z) > R + 14) continue;
    if (tooCloseToCabin(x, z)) continue;
    if (slopeAt(x, z) > 0.55) continue;

    // Density falls off in the middle of the bowl so there are firing lanes,
    // and thickens toward the treeline.
    const r = Math.hypot(x, z);
    const density = 0.35 + smoothstep(10, 70, r) * 0.65;
    if (rng() > density) continue;
    if (!spacer.tryPlace(x, z, 3.1)) continue;

    const roll = rng();
    let variant, height;
    if (roll < 0.42) { variant = TREE_VARIANTS.TALL_PINE; height = 11 + rng() * 5.5; }
    else if (roll < 0.76) { variant = TREE_VARIANTS.PINE; height = 8 + rng() * 3.5; }
    else if (roll < 0.94) { variant = TREE_VARIANTS.FIR; height = 5.5 + rng() * 2.5; }
    else { variant = TREE_VARIANTS.DEAD; height = 7 + rng() * 5; }

    trees.push({
      x, z,
      y: heightAt(x, z),
      h: height,
      r: 0.16 + height * 0.021,
      rot: rng() * Math.PI * 2,
      lean: (rng() - 0.5) * 0.06,
      variant
    });
  }

  // --- boulders ---
  for (let attempt = 0; attempt < 1200 && rocks.length < 74; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R + 4);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (tooCloseToCabin(x, z, -6)) continue;
    if (!spacer.tryPlace(x, z, 4.5)) continue;
    const r = 0.7 + rng() * 2.3;
    rocks.push({
      x, z,
      y: heightAt(x, z) - r * 0.34,
      r,
      rot: rng() * Math.PI * 2,
      squash: 0.62 + rng() * 0.3,
      seed: Math.floor(rng() * 100000)
    });
  }

  // --- fallen logs (waist-high cover) ---
  for (let attempt = 0; attempt < 900 && logs.length < 34; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R - 6);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (tooCloseToCabin(x, z, -8)) continue;
    if (slopeAt(x, z) > 0.28) continue;
    if (!spacer.tryPlace(x, z, 7)) continue;
    logs.push({
      x, z,
      y: heightAt(x, z),
      len: 4 + rng() * 4.5,
      r: 0.34 + rng() * 0.22,
      rot: rng() * Math.PI * 2
    });
  }

  // --- stumps ---
  for (let attempt = 0; attempt < 700 && stumps.length < 40; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R - 3);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (tooCloseToCabin(x, z, -10)) continue;
    if (!spacer.tryPlace(x, z, 5)) continue;
    stumps.push({ x, z, y: heightAt(x, z), r: 0.4 + rng() * 0.35, h: 0.5 + rng() * 0.6, rot: rng() * Math.PI * 2 });
  }

  // --- snow drifts (visual only, no collision) ---
  for (let i = 0; i < 150; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R + 8);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    drifts.push({
      x, z, y: heightAt(x, z),
      rx: 1.5 + rng() * 4.5,
      rz: 1.5 + rng() * 4.5,
      h: 0.25 + rng() * 0.6,
      rot: rng() * Math.PI * 2
    });
  }

  return { trees, rocks, logs, stumps, drifts };
}

export const PROPS = generate();

/** Spawn points: spread around the bowl, on walkable ground, clear of the cabin. */
function generateSpawns() {
  const rng = makeRng(TERRAIN.seed ^ 0xd00d);
  const out = [];
  const spacer = makeSpacer(10);
  for (let attempt = 0; attempt < 4000 && out.length < 30; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = 12 + Math.sqrt(rng()) * (TERRAIN.playRadius - 22);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (slopeAt(x, z) > 0.26) continue;
    if (!spacer.tryPlace(x, z, 14)) continue;
    // keep spawns out of tree trunks
    let blocked = false;
    for (const t of PROPS.trees) {
      if (Math.hypot(t.x - x, t.z - z) < 2.2) { blocked = true; break; }
    }
    if (blocked) continue;
    out.push({ x, y: heightAt(x, z), z, yaw: Math.atan2(-x, -z) + (rng() - 0.5) * 1.2 });
  }
  // Two spawns on the cabin porch side so the building is contested.
  out.push({ x: CABIN_SITE.x + 9, y: heightAt(CABIN_SITE.x + 9, CABIN_SITE.z + 12), z: CABIN_SITE.z + 12, yaw: -2.2 });
  out.push({ x: CABIN_SITE.x - 12, y: heightAt(CABIN_SITE.x - 12, CABIN_SITE.z - 6), z: CABIN_SITE.z - 6, yaw: 1.1 });
  return out;
}

/** Candidates only. collision.js filters these against real geometry. */
export const SPAWN_CANDIDATES = generateSpawns();
