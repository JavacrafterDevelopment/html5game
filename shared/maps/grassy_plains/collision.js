/**
 * Grassy Plains -- collision.
 *
 * Every collider here corresponds to something you can actually see, and is sized to
 * match it rather than to bound it. Grass, flowers and bushes have no collider at
 * all. The boundary is the hedge ring, which is solid because its cylinders overlap,
 * not because of a scripted wall.
 */

import { TERRAIN, heightAt, normalAt } from './terrain.js';
import { HUT_BOXES } from './huts.js';
import { PROPS, fieldRuns, SPAWN_CANDIDATES } from './props.js';
import { PLAYER } from '../../config.js';
import { KIND } from '../kinds.js';
import { createColliderWorld } from '../ColliderWorld.js';

const world = createColliderWorld({
  heightAt,
  normalAt,
  hardRadius: TERRAIN.hardRadius,
  kinds: KIND
});

// ------------------------------------------------------------------ huts
for (const b of HUT_BOXES) world.addBox(b.min, b.max, b.kind);

// ------------------------------------------------------------------ trees
// Trunk only, sized to the drawn trunk. Canopies never block a bullet -- being shot
// through leaves you cannot see past is the kind of thing that feels broken.
for (const t of PROPS.trees) {
  world.addCylinder(t.x, t.z, t.r, t.y - 0.6, t.y + t.h * 0.55, KIND.TREE);
}
for (const t of PROPS.woods) {
  world.addCylinder(t.x, t.z, t.r, t.y - 0.6, t.y + t.h * 0.55, KIND.TREE);
}

// ------------------------------------------------------------------ hedge
for (const h of PROPS.hedge) {
  world.addCylinder(h.x, h.z, h.r, h.y - 0.5, h.y + h.h, KIND.PROP);
}

// ------------------------------------------------------------------ rocks
for (const r of PROPS.rocks) {
  const squashedH = r.r * r.squash;
  world.addSphere(r.x, r.y + squashedH * 0.5, r.z, r.r * 0.86, KIND.ROCK);
}

// -------------------------------------------------------------- haystacks
for (const h of PROPS.haystacks) {
  world.addCylinder(h.x, h.z, h.r * 0.95, h.y - 0.3, h.y + h.h, KIND.HAY);
}

// ------------------------------------------------------------------ wells
for (const w of PROPS.wells) {
  world.addCylinder(w.x, w.z, w.r, w.y - 0.5, w.y + w.h, KIND.ROCK);
}

// ------------------------------------------------------------------ carts
for (const c of PROPS.carts) {
  const w = c.quarter ? c.d : c.w;
  const d = c.quarter ? c.w : c.d;
  world.addBox(
    [c.x - w / 2, c.y, c.z - d / 2],
    [c.x + w / 2, c.y + c.h, c.z + d / 2],
    KIND.WOOD
  );
}

// ----------------------------------------------------------------- fences
// One long thin axis-aligned box per run. Fence posts and rails are drawn inside
// exactly this volume, so the fence is never wider than it looks.
for (const f of PROPS.fields) {
  for (const run of fieldRuns(f)) {
    const half = f.thickness / 2;
    if (run.axis === 'x') {
      const y = heightAt((run.from + run.to) / 2, run.fixed);
      world.addBox(
        [run.from, y - 0.6, run.fixed - half],
        [run.to, y + f.height, run.fixed + half],
        KIND.FENCE
      );
    } else {
      const y = heightAt(run.fixed, (run.from + run.to) / 2);
      world.addBox(
        [run.fixed - half, y - 0.6, run.from],
        [run.fixed + half, y + f.height, run.to],
        KIND.FENCE
      );
    }
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
