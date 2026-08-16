/**
 * Grassy Plains -- deterministic prop scatter.
 *
 * Boundary design note: instead of an invisible wall or a slope you slide off, the
 * play area is closed by a real hedgerow -- a dense ring of overlapping cylinder
 * colliders, rendered as a thick hedge. You can see it, you can shoot over it, and
 * you cannot walk through it, because the gaps are narrower than a player.
 * The numeric clamp still exists but sits 30 m further out, behind the woods.
 */

import { makeRng } from '../../math/num.js';
import { TERRAIN, heightAt, slopeAt, HUT_SITES } from './terrain.js';
import { nearCave } from './cave.js';

const R = TERRAIN.playRadius;

export const TREE_VARIANTS = { OAK: 0, BIRCH: 1, SCRUB: 2, POPLAR: 3 };

function makeSpacer(cell) {
  const grid = new Map();
  const key = (a, b) => a * 100000 + b;
  return {
    tryPlace(x, z, minDist) {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      const span = Math.ceil(minDist / cell);
      for (let i = cx - span; i <= cx + span; i++) {
        for (let j = cz - span; j <= cz + span; j++) {
          const arr = grid.get(key(i, j));
          if (!arr) continue;
          for (const p of arr) if (Math.hypot(p[0] - x, p[1] - z) < minDist) return false;
        }
      }
      const k = key(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([x, z]);
      return true;
    }
  };
}

/** Distance to the nearest hut pad, so nothing spawns inside somebody's house. */
function nearHut(x, z, pad = 4) {
  for (const s of HUT_SITES) {
    if (Math.hypot(s.x - x, s.z - z) < s.pad + pad) return true;
  }
  return false;
}

function generate() {
  const rng = makeRng(TERRAIN.seed ^ 0x9a17);
  const spacer = makeSpacer(6);
  const trees = [];
  const rocks = [];
  const haystacks = [];
  const bushes = [];
  const flowers = [];
  const wells = [];
  const carts = [];


  // ------------------------------------------------------------- open trees
  for (let attempt = 0; attempt < 3000 && trees.length < 120; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R - 6);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (nearHut(x, z, 6) || nearCave(x, z, 6)) continue;
    if (slopeAt(x, z) > 0.4) continue;
    if (!spacer.tryPlace(x, z, 9)) continue;

    const roll = rng();
    let variant, h;
    if (roll < 0.45) { variant = TREE_VARIANTS.OAK; h = 7 + rng() * 4; }
    else if (roll < 0.7) { variant = TREE_VARIANTS.BIRCH; h = 8 + rng() * 4; }
    else if (roll < 0.88) { variant = TREE_VARIANTS.POPLAR; h = 10 + rng() * 5; }
    else { variant = TREE_VARIANTS.SCRUB; h = 3.2 + rng() * 1.6; }

    trees.push({
      x, z, y: heightAt(x, z), h,
      r: 0.16 + h * 0.028,
      rot: rng() * Math.PI * 2,
      lean: (rng() - 0.5) * 0.05,
      variant
    });
  }

  // ------------------------------------------------------- boundary woods
  // Visual only. The hedge below is what actually stops you.
  const woods = [];
  for (let i = 0; i < 900; i++) {
    const a = rng() * Math.PI * 2;
    const rad = TERRAIN.treelineInner + 2 + rng() * (TERRAIN.treelineOuter - TERRAIN.treelineInner);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h = 9 + rng() * 8;
    woods.push({
      x, z, y: heightAt(x, z), h,
      r: 0.2 + h * 0.026,
      rot: rng() * Math.PI * 2,
      lean: (rng() - 0.5) * 0.05,
      variant: rng() < 0.5 ? TREE_VARIANTS.OAK : TREE_VARIANTS.POPLAR
    });
  }

  // --------------------------------------------------------------- hedge
  // Overlapping cylinders: centres 1.15 m apart with 0.78 m radius leaves a gap far
  // narrower than a 0.7 m-wide player, so the ring is solid without a single
  // invisible collider.
  const hedge = [];
  const hedgeRadius = TERRAIN.playRadius + 5.5;
  const step = 1.15;
  const count = Math.round((Math.PI * 2 * hedgeRadius) / step);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const wob = Math.sin(a * 7.3) * 1.1 + Math.cos(a * 3.1) * 0.8;
    const rad = hedgeRadius + wob;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    hedge.push({
      x, z, y: heightAt(x, z),
      r: 0.78,
      h: 1.9 + Math.sin(a * 11.7) * 0.28 + Math.cos(a * 5.3) * 0.2
    });
  }

  // --------------------------------------------------------------- rocks
  for (let attempt = 0; attempt < 900 && rocks.length < 42; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R - 5);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (nearHut(x, z, 5) || nearCave(x, z, 5)) continue;
    if (!spacer.tryPlace(x, z, 7)) continue;
    const r = 0.6 + rng() * 1.7;
    rocks.push({ x, z, y: heightAt(x, z), r, squash: 0.55 + rng() * 0.3, rot: rng() * Math.PI * 2 });
  }

  // ----------------------------------------------------------- haystacks
  for (let attempt = 0; attempt < 700 && haystacks.length < 26; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R - 8);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (nearHut(x, z, 5) || nearCave(x, z, 5)) continue;
    if (slopeAt(x, z) > 0.22) continue;
    if (!spacer.tryPlace(x, z, 8)) continue;
    haystacks.push({
      x, z, y: heightAt(x, z),
      r: 0.85 + rng() * 0.45,
      h: 1.25 + rng() * 0.5,
      rot: rng() * Math.PI * 2
    });
  }

  // --------------------------------------------------------- wells, carts
  const vx = HUT_SITES.length ? HUT_SITES[0].x : 0;
  const vz = HUT_SITES.length ? HUT_SITES[0].z : 0;
  const wellX = HUT_SITES[0].x + 7, wellZ = HUT_SITES[0].z + 6;
  wells.push({ x: wellX, z: wellZ, y: heightAt(wellX, wellZ), r: 1.05, h: 0.95 });
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 20 + rng() * 45;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (nearHut(x, z, 3) || nearCave(x, z, 3)) continue;
    if (!spacer.tryPlace(x, z, 6)) continue;
    carts.push({
      x, z, y: heightAt(x, z),
      // right-angle rotations only, so the collider stays an exact axis-aligned box
      quarter: Math.floor(rng() * 2),
      w: 2.6, d: 1.35, h: 1.05
    });
  }

  // ----------------------------------------------- bushes + flowers (no collision)
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R + 3);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (nearHut(x, z, 3) || nearCave(x, z, 3)) continue;
    bushes.push({ x, z, y: heightAt(x, z), r: 0.5 + rng() * 0.9, rot: rng() * Math.PI * 2 });
  }
  for (let i = 0; i < 420; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (R + 2);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    flowers.push({
      x, z, y: heightAt(x, z),
      kind: Math.floor(rng() * 3),
      r: 0.7 + rng() * 1.6,
      rot: rng() * Math.PI * 2
    });
  }

  return { trees, woods, hedge, rocks, haystacks, bushes, flowers, wells, carts };
}

export const PROPS = generate();

/** Where sheep flocks graze. Clients simulate the animals around these anchors. */
export const SHEEP_HERDS = (() => {
  const rng = makeRng(TERRAIN.seed ^ 0x5432);
  const out = [];
  for (let attempt = 0; attempt < 400 && out.length < 5; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = 18 + Math.sqrt(rng()) * (R - 32);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (nearHut(x, z, 10) || nearCave(x, z, 12)) continue;
    if (slopeAt(x, z) > 0.2) continue;
    let ok = true;
    for (const h of out) if (Math.hypot(h.x - x, h.z - z) < 34) ok = false;
    if (!ok) continue;
    out.push({ x, z, radius: 9 + rng() * 7, count: 4 + Math.floor(rng() * 4) });
  }
  return out;
})();

function generateSpawns() {
  const rng = makeRng(TERRAIN.seed ^ 0xbeef);
  const out = [];
  const spacer = makeSpacer(10);
  for (let attempt = 0; attempt < 5000 && out.length < 30; attempt++) {
    const a = rng() * Math.PI * 2;
    const rad = 10 + Math.sqrt(rng()) * (R - 20);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (slopeAt(x, z) > 0.22) continue;
    if (nearHut(x, z, 3) || nearCave(x, z, 4)) continue;
    if (!spacer.tryPlace(x, z, 15)) continue;

    let blocked = false;
    for (const t of PROPS.trees) if (Math.hypot(t.x - x, t.z - z) < 2.5) { blocked = true; break; }
    if (!blocked) for (const h of PROPS.haystacks) if (Math.hypot(h.x - x, h.z - z) < 3) { blocked = true; break; }
    if (blocked) continue;

    out.push({ x, y: heightAt(x, z), z, yaw: Math.atan2(-x, -z) + (rng() - 0.5) * 1.2 });
  }
  return out;
}

/** Candidates only. collision.js filters these against real geometry. */
export const SPAWN_CANDIDATES = generateSpawns();
