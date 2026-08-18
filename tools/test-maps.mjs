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
import { createColliderWorld } from '../shared/maps/ColliderWorld.js';
import { KIND } from '../shared/maps/kinds.js';
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
    } else if (c.type === 3) {                // tube
      // Only the ones standing on end can be reached by a horizontal probe.
      if (c.axis !== 1) continue;
      if (y + PLAYER.HEIGHT <= c.from || y >= c.to) continue;
      gap = Math.abs(Math.hypot(x - c.u, z - c.v) - c.rOut);
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

/**
 * The cave has to be enterable through its one mouth and sealed everywhere else.
 * Both halves matter: a cave you cannot walk into is scenery, and a cave with a
 * second way in is not what was asked for.
 */
function testCave(map) {
  const { heightAt, collideCapsule, CHAMBER, CAVE } = map;
  const dt = 1 / 60;

  const inside = (p) =>
    p[0] > CHAMBER.minX && p[0] < CHAMBER.maxX &&
    p[2] > CHAMBER.minZ && p[2] < CHAMBER.maxZ;

  const walk = (fromX, fromZ, dx, dz) => {
    const pos = [fromX, heightAt(fromX, fromZ), fromZ];
    let vx = 0, vz = 0;
    for (let step = 0; step < 900; step++) {
      vx += (dx * MOVE.WALK - vx) * 0.35;
      vz += (dz * MOVE.WALK - vz) * 0.35;
      pos[0] += vx * dt;
      pos[2] += vz * dt;
      pos[1] = Math.max(pos[1] - 9 * dt, heightAt(pos[0], pos[2]));
      collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, PLAYER.STEP_HEIGHT);
    }
    return pos;
  };

  // in through the mouth
  const entered = walk(CAVE.x, CAVE.z + CAVE.halfD + CAVE.mouthLen + 6, 0, -1);
  assert.ok(inside(entered), `could not walk into the cave (ended at ${entered.map((v) => v.toFixed(1))})`);
  ok('cave is enterable through its mouth');

  assert.ok(CHAMBER.ceilY - CHAMBER.floorY > PLAYER.HEIGHT + 0.5,
    'not enough headroom to stand up inside the cave');
  ok(`cave has ${(CHAMBER.ceilY - CHAMBER.floorY).toFixed(1)} m of headroom`);

  // and not through anything else
  const sides = [[0, 1, 'back'], [1, 0, 'west'], [-1, 0, 'east']];
  const breaches = sides.filter(([dx, dz]) =>
    inside(walk(CAVE.x - dx * (CAVE.halfW + 8), CAVE.z - dz * (CAVE.halfD + 8), dx, dz)));
  assert.strictEqual(breaches.length, 0,
    `cave has extra ways in: ${breaches.map((b) => b[2]).join(', ')}`);
  ok('cave has exactly one entrance');
}

/** Buildings you are told you can enter must actually be enterable. */
function testHuts(map) {
  const { heightAt, collideCapsule, HUTS } = map;
  const dt = 1 / 60;
  const dirs = { plusZ: [0, 1], minusZ: [0, -1], plusX: [1, 0], minusX: [-1, 0] };

  for (const hut of HUTS) {
    const [ox, oz] = dirs[hut.door];
    const reach = Math.max(hut.halfW, hut.halfD) + 7;
    const pos = [hut.x + ox * reach, 0, hut.z + oz * reach];
    pos[1] = heightAt(pos[0], pos[2]);
    let vx = 0, vz = 0;

    for (let step = 0; step < 800; step++) {
      vx += (-ox * MOVE.WALK - vx) * 0.35;
      vz += (-oz * MOVE.WALK - vz) * 0.35;
      pos[0] += vx * dt;
      pos[2] += vz * dt;
      pos[1] = Math.max(pos[1] - 9 * dt, heightAt(pos[0], pos[2]));
      collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, PLAYER.STEP_HEIGHT);
    }

    const inside = Math.abs(pos[0] - hut.x) < hut.halfW && Math.abs(pos[2] - hut.z) < hut.halfD;
    assert.ok(inside, `could not walk into the hut at ${hut.x.toFixed(0)},${hut.z.toFixed(0)}`);
    assert.ok(hut.wallH > PLAYER.HEIGHT + 0.4, 'not enough headroom inside the hut');
  }
  ok(`all ${HUTS.length} huts are enterable and stand-up-able`);
}

/**
 * A map with no ground fails every assumption above, so it gets its own suite.
 *
 * The failure this one is written to catch is the opposite of an invisible wall:
 * a hull with a gap in it. A pressurised module is a hollow tube, and a hollow
 * shape is only as sealed as the arithmetic that produced it -- there is no mesh
 * to eyeball. Fly at the inside of it from every direction and prove nobody gets
 * out except through a door.
 */
function testOrbit(id, map) {
  console.log(`\n--- ${id} (${map.MAP_INFO.name}) --- zero-g`);
  const { STATION_PARTS, partBounds, collideCapsule, SPAWN_POINTS, TERRAIN, BORE } = map;
  const R = PLAYER.FLIGHT_RADIUS, H = PLAYER.FLIGHT_HEIGHT;
  const dt = 1 / 60;

  // ------------------------------------------------ 1. nothing floats
  // Every part has to touch another one. This is the check that the plains map
  // never had, and the reason it grew fences standing in mid-air.
  const bounds = STATION_PARTS.map(partBounds);
  const touching = (a, b, tol = 0.06) =>
    a.min[0] - tol <= b.max[0] && b.min[0] - tol <= a.max[0] &&
    a.min[1] - tol <= b.max[1] && b.min[1] - tol <= a.max[1] &&
    a.min[2] - tol <= b.max[2] && b.min[2] - tol <= a.max[2];
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const i = stack.pop();
    for (let j = 0; j < bounds.length; j++) {
      if (!seen.has(j) && touching(bounds[i], bounds[j])) { seen.add(j); stack.push(j); }
    }
  }
  const floating = STATION_PARTS.filter((_, i) => !seen.has(i)).map((p) => p.name);
  assert.strictEqual(floating.length, 0, `parts attached to nothing: ${floating.join(', ')}`);
  ok(`all ${STATION_PARTS.length} parts are attached to the structure`);

  // ------------------------------------------------ 2. the hull is sealed
  // Built again with the doorways plugged, so that ANY escape is a defect. The
  // doorways are proved separately in step 3.
  const sealed = createColliderWorld({
    heightAt: () => -1e6, normalAt: () => [0, 1, 0],
    hardRadius: 900, hardY: 900, hasTerrain: false, kinds: KIND
  });
  for (const p of STATION_PARTS) {
    if (p.s === 'tube') sealed.addTube(p.axis, p.u, p.v, p.from, p.to, p.rIn, p.rOut, p.kind);
    else sealed.addBox(p.min, p.max, p.kind);
  }
  for (const d of map.DOORWAYS) sealed.addTube(d.axis, d.u, d.v, d.from, d.to, 0, d.r, KIND.HULL);
  sealed.build();

  // The pressurised volume: every tube bore, plus the middle of each node, which
  // no single collar bore covers.
  const hubs = STATION_PARTS.filter((p) => p.look === 'collar' && /-collar\+x$/.test(p.name))
    .map((p) => [p.from - 2.05, p.u, p.v]);
  const inside = (p, tol = 0.5) => {
    for (const [hx, hy, hz] of hubs) {
      if (Math.abs(p[0] - hx) <= 2.05 + tol && Math.abs(p[1] - hy) <= 2.05 + tol &&
          Math.abs(p[2] - hz) <= 2.05 + tol) return true;
    }
    for (const t of STATION_PARTS) {
      if (t.s !== 'tube' || t.rIn <= 0) continue;
      const a = p[t.axis];
      if (a < t.from - tol || a > t.to + tol) continue;
      const perp = t.axis === 0 ? [1, 2] : t.axis === 1 ? [0, 2] : [0, 1];
      if (Math.hypot(p[perp[0]] - t.u, p[perp[1]] - t.v) <= t.rIn + tol) return true;
    }
    return false;
  };

  const DIRS = 1200;
  let escapes = 0;
  let worst = null;
  for (const start of map.INTERIOR_PROBES) {
    for (let i = 0; i < DIRS; i++) {
      // Fibonacci-ish sphere, so the sample is even rather than clumped at a pole.
      const u = (i + 0.5) / DIRS, phi = Math.acos(1 - 2 * u), th = i * 2.399963;
      const d = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
      const pos = [start[0], start[1] - H * 0.5, start[2]];
      for (let step = 0; step < 420; step++) {
        pos[0] += d[0] * 14 * dt;
        pos[1] += d[1] * 14 * dt;
        pos[2] += d[2] * 14 * dt;
        sealed.collideCapsule(pos, R, H, 0);
      }
      if (!inside([pos[0], pos[1] + H * 0.5, pos[2]])) {
        escapes++;
        if (!worst) worst = { from: start, dir: d.map((v) => +v.toFixed(2)), to: pos.map((v) => +v.toFixed(1)) };
      }
    }
  }
  assert.strictEqual(escapes, 0,
    `${escapes} of ${map.INTERIOR_PROBES.length * DIRS} flights left the pressurised hull through a wall: ${JSON.stringify(worst)}`);
  ok(`hull is sealed: 0 escapes in ${map.INTERIOR_PROBES.length * DIRS} flights from ${map.INTERIOR_PROBES.length} compartments`);

  // ------------------------------------------------ 3. the doorways are open
  // The other half of the same coin. A station you cannot get into is scenery.
  function fly(from, dir, steps = 900) {
    const pos = from.slice();
    for (let i = 0; i < steps; i++) {
      pos[0] += dir[0] * 12 * dt;
      pos[1] += dir[1] * 12 * dt;
      pos[2] += dir[2] * 12 * dt;
      collideCapsule(pos, R, H, 0);
    }
    return pos;
  }
  // Out of the node the airlock actually hangs off, down its real centreline.
  const home = [map.NODES[1].x, map.NODES[1].y - H * 0.5, map.NODES[1].z];
  const fore = fly([0, -H * 0.5, -42], [0, 0, 1]);
  assert.ok(fore[2] > 40,
    `could not fly the length of the stack from the forward hatch (stopped at z=${fore[2].toFixed(1)})`);
  const aft = fly([0, -H * 0.5, 42], [0, 0, -1]);
  assert.ok(aft[2] < -40,
    `could not fly the length of the stack from the aft hatch (stopped at z=${aft[2].toFixed(1)})`);
  ok('the stack is a through-tunnel: forward hatch to aft hatch, both ways');

  const out = fly(home.slice(), [1, 0, 0]);
  assert.ok(out[0] > 12, `could not fly out of the airlock (stopped at x=${out[0].toFixed(1)})`);
  ok(`the airlock is open: reached ${out[0].toFixed(1)} m outboard from the node`);

  // ------------------------------------------------ 4. spawns are in clear space
  const bad = [];
  for (const sp of SPAWN_POINTS) {
    const pos = [sp.x, sp.y, sp.z];
    collideCapsule(pos, R, H, 0);
    const moved = Math.hypot(pos[0] - sp.x, pos[1] - sp.y, pos[2] - sp.z);
    if (moved > 0.02) bad.push({ x: +sp.x.toFixed(1), y: +sp.y.toFixed(1), z: +sp.z.toFixed(1) });
  }
  assert.strictEqual(bad.length, 0, `spawns inside structure: ${JSON.stringify(bad.slice(0, 5))}`);
  assert.ok(SPAWN_POINTS.length >= 20, `only ${SPAWN_POINTS.length} usable spawn points`);
  ok(`all ${SPAWN_POINTS.length} spawn points are in clear space`);

  // ------------------------------------------------ 5. every contact is real
  // The ground maps' phantom-push test, in three dimensions: sample the open
  // volume, and every time the solver moves the player, prove something solid was
  // close enough to justify it. Once there are rocks out here, "nothing may ever
  // touch you" is no longer the right assertion -- but "nothing may touch you that
  // is not there" still is.
  let sampled = 0, contacts = 0;
  const phantoms = [];
  for (let i = 0; i < 20000; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random() * 2 - 1);
    const rad = 14 + Math.random() * (TERRAIN.playRadius - 18);
    const p = [Math.cos(a) * Math.cos(e) * rad, Math.sin(e) * rad, Math.sin(a) * Math.cos(e) * rad];
    const before = p.slice();
    sampled++;
    collideCapsule(p, R, H, 0);
    if (Math.hypot(p[0] - before[0], p[1] - before[1], p[2] - before[2]) < 0.001) continue;
    contacts++;
    // Measured against the whole capsule, not just the point the sample names.
    // That point is the FEET; something touching the top of a 0.92 m body is most
    // of a metre away from it, and calling that a phantom would fail every
    // legitimate contact above the waist.
    let gap = Infinity;
    for (let k = 0; k <= 4; k++) {
      const q = [before[0], before[1] + (H * k) / 4, before[2]];
      gap = Math.min(gap, nearestSolidGap(map.COLLIDERS, q));
    }
    if (gap > R + 0.15) {
      phantoms.push({ at: before.map((v) => +v.toFixed(1)), gap: +gap.toFixed(2) });
    }
  }
  if (phantoms.length) console.error('  phantom contacts at:', phantoms.slice(0, 6));
  assert.strictEqual(phantoms.length, 0,
    `${phantoms.length} of ${contacts} contacts had nothing solid within reach -- invisible walls`);
  ok(`${sampled} samples of open space, ${contacts} legitimate contacts, 0 invisible walls`);

  // ------------------------------------------------ 6. the rocks
  const bores = map.ASTEROID_PARTS.filter((r) => r.s === 'tube');
  // A holed rock is several collinear segments, so count rocks, not segments.
  const holedRocks = new Set(bores.map((r) => r.name.replace(/s\d+$/, '')));
  assert.ok(map.ASTEROID_GROUPS.length >= 10,
    `only ${map.ASTEROID_GROUPS.length} rocks -- not enough to take cover behind`);
  assert.ok(holedRocks.size >= 4, `only ${holedRocks.size} rocks have a hole through them`);
  ok(`${map.ASTEROID_GROUPS.length} rocks, ${holedRocks.size} of them holed`);

  // A hole you cannot fly through is a texture. Enter each bore from well outside
  // and require the player to come out the far end.
  // Fly each rock's bore once, entering at the outermost segment.
  const entries = new Map();
  for (const t of bores) {
    const k = t.name.replace(/s\d+$/, '');
    const cur = entries.get(k);
    if (!cur || t.from < cur.from) entries.set(k, t);
  }
  const flown = [];
  for (const t of entries.values()) {
    const perp = t.axis === 0 ? [1, 2] : t.axis === 1 ? [0, 2] : [0, 1];
    const start = [0, 0, 0], step = [0, 0, 0];
    start[t.axis] = t.from - 18;
    start[perp[0]] = t.u;
    start[perp[1]] = t.v;
    start[1] -= H * 0.5;
    step[t.axis] = 1;
    const far = bores.filter((b) => b.name.replace(/s\d+$/, '') === t.name.replace(/s\d+$/, ''))
      .reduce((m, b) => Math.max(m, b.to), -Infinity);
    const end = fly(start, step, 700);
    if (end[t.axis] > far + 6) flown.push(t.name);
  }
  assert.strictEqual(flown.length, entries.size,
    `only ${flown.length} of ${entries.size} bores are actually flyable`);
  ok(`all ${entries.size} bores can be flown straight through`);

  // And the rocks must not have closed anything the station needs open.
  for (const t of bores) {
    assert.ok(t.rIn * 2 > PLAYER.FLIGHT_HEIGHT + 1.0,
      `bore ${t.name} is only ${(t.rIn * 2).toFixed(1)} m across`);
  }

  assert.ok(BORE * 2 > PLAYER.FLIGHT_HEIGHT + 1.0, 'the bore is too tight to fly a body down');
  ok(`module bore is ${(BORE * 2).toFixed(1)} m across, comfortably wider than a tucked body`);
}

/**
 * Distance from a point to the nearest solid surface, 0 if inside one.
 *
 * This is what turns "the solver moved me" into "the solver moved me for a reason".
 * Every shape the orbital map uses needs a case here; a shape that falls through
 * would silently excuse a genuine invisible wall.
 */
function nearestSolidGap(colliders, p) {
  let best = Infinity;
  for (const c of colliders) {
    let gap;
    if (c.type === 0) {                            // box
      const dx = Math.max(c.min[0] - p[0], 0, p[0] - c.max[0]);
      const dy = Math.max(c.min[1] - p[1], 0, p[1] - c.max[1]);
      const dz = Math.max(c.min[2] - p[2], 0, p[2] - c.max[2]);
      gap = Math.hypot(dx, dy, dz);
    } else if (c.type === 1) {                     // Y cylinder
      const radial = Math.max(0, Math.hypot(p[0] - c.x, p[2] - c.z) - c.r);
      const axial = Math.max(c.y0 - p[1], 0, p[1] - c.y1);
      gap = Math.hypot(radial, axial);
    } else if (c.type === 2) {                     // sphere
      gap = Math.max(0, Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z) - c.r);
    } else {                                       // tube
      const perp = c.axis === 0 ? [1, 2] : c.axis === 1 ? [0, 2] : [0, 1];
      const d = Math.hypot(p[perp[0]] - c.u, p[perp[1]] - c.v);
      const radial = d > c.rOut ? d - c.rOut : (d < c.rIn ? c.rIn - d : 0);
      const axial = Math.max(c.from - p[c.axis], 0, p[c.axis] - c.to);
      gap = Math.hypot(radial, axial);
    }
    if (gap < best) best = gap;
  }
  return best;
}

for (const [id, map] of Object.entries(MAPS)) {
  if (map.MAP_INFO.movement?.mode === 'zerog') {
    testOrbit(id, map);
    continue;
  }
  testMap(id, map);
  if (map.CHAMBER) testCave(map);
  if (map.HUTS) testHuts(map);
}
console.log(`\n${checks} checks passed.`);
