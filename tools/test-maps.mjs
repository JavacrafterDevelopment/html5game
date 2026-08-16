/**
 * Map integrity tests -- mostly about invisible walls.
 *
 * The failure this is written to catch: a collider that is bigger than the thing it
 * represents (an AABB fitted around a rotated log, a sphere fitted around a squashed
 * boulder). In play that is indistinguishable from an invisible wall, and it is very
 * hard to find by walking around.
 *
 * The check is direct: sample thousands of points of open ground, push a player
 * capsule through the real collision solver, and every time the solver moves the
 * player sideways, prove there is a real collider close enough to justify it.
 *
 * Usage:  runtime\node\node.exe tools\test-maps.mjs
 */

import assert from 'node:assert';
import { MAPS } from '../shared/maps/index.js';
import { PLAYER, MOVE } from '../shared/config.js';

let checks = 0;
const ok = (msg) => { checks++; console.log('  ok  ' + msg); };

/** Nearest horizontal gap between a point and any collider surface. */
function nearestSurfaceGap(colliders, x, z, y) {
  let best = Infinity;
  for (const c of colliders) {
    let gap;
    if (c.type === 0) {                       // box
      if (y + PLAYER.HEIGHT <= c.min[1] || y >= c.max[1]) continue;
      const dx = Math.max(c.min[0] - x, 0, x - c.max[0]);
      const dz = Math.max(c.min[2] - z, 0, z - c.max[2]);
      gap = Math.hypot(dx, dz);
    } else if (c.type === 1) {                // cylinder
      if (y + PLAYER.HEIGHT <= c.y0 || y >= c.y1) continue;
      gap = Math.hypot(x - c.x, z - c.z) - c.r;
    } else {                                  // sphere
      const dy = Math.max(c.y - (y + PLAYER.HEIGHT), 0, y - c.y);
      const r = Math.sqrt(Math.max(0, c.r * c.r - dy * dy));
      gap = Math.hypot(x - c.x, z - c.z) - r;
    }
    if (gap < best) best = gap;
  }
  return best;
}

function testMap(id, map) {
  console.log(`\n--- ${id} (${map.MAP_INFO.name}) ---`);
  const { heightAt, collideCapsule, COLLIDERS, TERRAIN, SPAWN_POINTS } = map;
  const R = TERRAIN.playRadius;

  // ------------------------------------------------ 1. no phantom push-backs
  let sampled = 0;
  let pushed = 0;
  const phantoms = [];
  const STEP = 1.7;

  for (let x = -R; x <= R; x += STEP) {
    for (let z = -R; z <= R; z += STEP) {
      if (Math.hypot(x, z) > R - 2) continue;
      sampled++;
      const y = heightAt(x, z);
      const pos = [x, y, z];
      collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, PLAYER.STEP_HEIGHT);
      const moved = Math.hypot(pos[0] - x, pos[2] - z);
      if (moved < 0.01) continue;
      pushed++;

      // A push is legitimate only if a real collider is within reach of the capsule.
      const gap = nearestSurfaceGap(COLLIDERS, x, z, y);
      if (gap > PLAYER.RADIUS + 0.12) {
        phantoms.push({ x: +x.toFixed(1), z: +z.toFixed(1), moved: +moved.toFixed(2), gap: +gap.toFixed(2) });
      }
    }
  }

  if (phantoms.length) {
    console.error('  phantom pushes at:', phantoms.slice(0, 8));
  }
  assert.strictEqual(phantoms.length, 0,
    `${phantoms.length} of ${pushed} push-backs had no collider within reach (invisible walls)`);
  ok(`${sampled} ground samples, ${pushed} legitimate contacts, 0 invisible walls`);

  // -------------------------------------------------- 2. spawns are standable
  const badSpawns = [];
  for (const sp of SPAWN_POINTS) {
    const pos = [sp.x, heightAt(sp.x, sp.z), sp.z];
    const res = collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, PLAYER.STEP_HEIGHT);
    const moved = Math.hypot(pos[0] - sp.x, pos[2] - sp.z);
    if (moved > 0.25 || !res.grounded) badSpawns.push({ x: +sp.x.toFixed(1), z: +sp.z.toFixed(1), moved: +moved.toFixed(2) });
  }
  assert.strictEqual(badSpawns.length, 0, `spawns inside geometry: ${JSON.stringify(badSpawns)}`);
  ok(`all ${SPAWN_POINTS.length} spawn points are clear and grounded`);

  // ------------------------------------------------ 3. the ground is continuous
  // A seam in the heightfield makes players pop and bullets miss. Steep is fine;
  // DISCONTINUOUS is not, so this is a ratio test rather than a slope threshold:
  // across a smooth surface, halving the sample distance halves the height change.
  // Across a step it does not change at all.
  let seams = 0;
  let worstSeam = null;
  for (let i = 0; i < 6000; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * R;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h0 = heightAt(x, z);
    const dFar = Math.abs(heightAt(x + 0.04, z + 0.04) - h0);
    const dNear = Math.abs(heightAt(x + 0.02, z + 0.02) - h0);
    if (dNear > 0.12 && dFar < dNear * 1.4) {
      seams++;
      if (!worstSeam || dNear > worstSeam.d) worstSeam = { x: +x.toFixed(1), z: +z.toFixed(1), d: dNear };
    }
  }
  assert.strictEqual(seams, 0, `heightfield has ${seams} discontinuities, worst ${JSON.stringify(worstSeam)}`);
  ok('heightfield is continuous everywhere (no seams or steps)');

  // -------------------------------------------- 4. the boundary is real geometry
  // Walk outward in many directions; the player must be stopped by something solid
  // well before the numeric clamp, otherwise the edge of the world is an invisible
  // wall.
  // The walk mirrors the real controller, slide included: a player who sprints
  // straight at the edge of the world must be stopped by something they can see --
  // a hedge, a trunk, or a slope too steep to stand on.
  const { normalAt, slopeAt } = map;
  let reachedClamp = 0;
  const dirs = 72;
  let maxReach = 0;
  const dt = 1 / 60;

  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pos = [0, heightAt(0, 0), 0];
    let vx = 0, vz = 0;

    for (let step = 0; step < 4000; step++) {
      // accelerate toward full sprint in the walk direction
      vx += (dx * MOVE.SPRINT - vx) * 0.35;
      vz += (dz * MOVE.SPRINT - vz) * 0.35;

      // mirrors LocalPlayer: no traction above the slide slope
      const slope = slopeAt(pos[0], pos[2], 0.9);
      if (slope > MOVE.SLIDE_SLOPE) {
        const n = normalAt(pos[0], pos[2], 0.9);
        const dl = Math.hypot(n[0], n[2]) || 1;
        const ux = -n[0] / dl, uz = -n[2] / dl;
        const along = vx * ux + vz * uz;
        if (along > 0) { vx -= ux * along; vz -= uz * along; }
        const push = (slope - MOVE.SLIDE_SLOPE) * MOVE.SLIDE_ACCEL * dt;
        vx += n[0] * push;
        vz += n[2] * push;
      }

      pos[0] += vx * dt;
      pos[2] += vz * dt;
      pos[1] = Math.max(pos[1] - 9 * dt, heightAt(pos[0], pos[2]));
      collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, PLAYER.STEP_HEIGHT);
    }

    const reach = Math.hypot(pos[0], pos[2]);
    maxReach = Math.max(maxReach, reach);
    if (reach > TERRAIN.hardRadius - 1.5) reachedClamp++;
  }
  assert.strictEqual(reachedClamp, 0,
    `${reachedClamp}/${dirs} directions walked all the way to the numeric clamp -- that edge is an invisible wall`);
  ok(`boundary holds by geometry in all ${dirs} directions (furthest reach ${maxReach.toFixed(1)} m, clamp at ${TERRAIN.hardRadius} m)`);
}

for (const [id, map] of Object.entries(MAPS)) testMap(id, map);
console.log(`\n${checks} checks passed.`);
