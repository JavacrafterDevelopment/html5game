/**
 * Snowy Forest -- collision.
 *
 * Only the collider list lives here; the capsule solver and ray tracing come from
 * the shared ColliderWorld, so both maps behave identically underfoot.
 *
 * Sizing is deliberately tight rather than conservative. A collider larger than the
 * thing it represents is indistinguishable, in play, from an invisible wall.
 */

import { TERRAIN, heightAt, normalAt } from './terrain.js';
import { CABIN_BOXES } from './cabin.js';
import { PROPS, SPAWN_CANDIDATES } from './props.js';
import { PLAYER } from '../../config.js';
import { KIND } from '../kinds.js';
import { createColliderWorld } from '../ColliderWorld.js';

const world = createColliderWorld({
  heightAt,
  normalAt,
  hardRadius: TERRAIN.hardRadius,
  kinds: KIND
});

// cabin
for (const b of CABIN_BOXES) world.addBox(b.min, b.max, b.kind);

// trees -- trunk only, foliage never blocks a bullet
for (const t of PROPS.trees) {
  world.addCylinder(t.x, t.z, t.r * 0.95, t.y - 1.0, t.y + Math.min(t.h * 0.45, 6.0), KIND.TREE);
}

// stumps
for (const s of PROPS.stumps) {
  world.addCylinder(s.x, s.z, s.r * 0.95, s.y - 0.5, s.y + s.h, KIND.WOOD);
}

// boulders -- closely match the squashed height and radius that get drawn
for (const r of PROPS.rocks) {
  const squashedH = r.r * r.squash;
  world.addSphere(r.x, r.y + squashedH * 0.45, r.z, r.r * Math.min(0.85, r.squash * 0.8 + 0.12), KIND.ROCK);
}

// Fallen logs, segmented along the rotated axis. A single AABB around a diagonal log
// is far bigger than the log and catches players on empty snow.
for (const l of PROPS.logs) {
  const cos = Math.cos(l.rot), sin = Math.sin(l.rot);
  const halfLen = l.len / 2;
  const segments = Math.max(3, Math.ceil(l.len / (l.r * 1.5)));
  for (let s = 0; s < segments; s++) {
    const offset = -halfLen + (s / (segments - 1)) * l.len;
    world.addCylinder(l.x + cos * offset, l.z + sin * offset, l.r * 0.95, l.y, l.y + l.r * 2, KIND.WOOD);
  }
}

world.build();

// ---------------------------------------------------------------- spawn points
// Candidates are generated against the heightfield alone, which cannot know about
// props. Filter them through the real solver so a spawn can never drop a player
// inside a boulder or a wall -- this has to happen here, after every collider is
// registered, which is why the final list lives in this file.
export const SPAWN_POINTS = (() => {
  const good = SPAWN_CANDIDATES.filter((sp) => {
    const pos = [sp.x, heightAt(sp.x, sp.z), sp.z];
    const res = world.collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, PLAYER.STEP_HEIGHT);
    return res.grounded && Math.hypot(pos[0] - sp.x, pos[2] - sp.z) < 0.15;
  });
  return good.length >= 8 ? good : SPAWN_CANDIDATES;
})();


export const collideCapsule = world.collideCapsule;
export const raycastWorld = world.raycastWorld;
export const raycastTerrain = world.raycastTerrain;
export const isBlocked = world.isBlocked;
export const COLLIDER_COUNT = world.count;
/** Exposed so tools/test-maps.mjs can prove every push-back has real geometry behind it. */
export const COLLIDERS = world.colliders;
export { KIND };
