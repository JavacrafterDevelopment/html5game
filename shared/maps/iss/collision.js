/**
 * ISS -- collision.
 *
 * One loop. Every part of the station goes in, and nothing else does, so a collider
 * here cannot disagree with what is drawn: they are the same list.
 *
 * The world is built with hasTerrain:false. There is no ground to fall to, so the
 * solver never clamps you upward and never marches a heightfield looking for one.
 */

import { TERRAIN, heightAt, normalAt } from './terrain.js';
import { STATION_PARTS, STATION_BOUNDS } from './station.js';
import { PLAYER } from '../../config.js';
import { makeRng } from '../../math/num.js';
import { KIND } from '../kinds.js';
import { createColliderWorld } from '../ColliderWorld.js';

const world = createColliderWorld({
  heightAt,
  normalAt,
  hardRadius: TERRAIN.hardRadius,
  hardY: TERRAIN.hardY,
  hasTerrain: false,
  kinds: KIND
});

for (const p of STATION_PARTS) {
  if (p.s === 'tube') world.addTube(p.axis, p.u, p.v, p.from, p.to, p.rIn, p.rOut, p.kind);
  else world.addBox(p.min, p.max, p.kind);
}

world.build();

// ---------------------------------------------------------------- spawn points
/**
 * Half of these are inside the pressurised stack and half are outside on the hull,
 * which is what keeps fights from collapsing into one long corridor duel.
 *
 * A spawn is only kept if the real solver leaves it exactly where it was put. In a
 * map made of hollow tubes that check earns its keep: a point 20 cm off the axis of
 * a module reads as fine on paper and is inside the wall in practice.
 */
function clear(x, y, z) {
  const pos = [x, y, z];
  world.collideCapsule(pos, PLAYER.RADIUS, PLAYER.HEIGHT, 0);
  return Math.hypot(pos[0] - x, pos[1] - y, pos[2] - z) < 0.02;
}

/** Feet offset so a 1.8 m capsule ends up centred on wherever you aimed it. */
const CENTRED = -PLAYER.HEIGHT * 0.5;

function generateSpawns() {
  const rng = makeRng(TERRAIN.seed ^ 0x155);
  const out = [];

  // --- down the pressurised stack, facing along the corridor ---
  for (let z = -26; z <= 25; z += 3.6) {
    out.push({ x: 0, y: CENTRED, z, yaw: z < 0 ? Math.PI : 0 });
  }
  // --- the radial modules ---
  for (const [x, z, yaw] of [
    [6.0, -22, Math.PI / 2], [9.0, -22, Math.PI / 2],       // Columbus
    [-6.5, -22, -Math.PI / 2], [-10.5, -22, -Math.PI / 2],  // Kibo
    [6.2, -2, Math.PI / 2],                                  // Quest, by the hatch
    [-4.5, -2, -Math.PI / 2], [-11.5, -2, -Math.PI / 2]      // Tranquility, Leonardo
  ]) {
    out.push({ x, y: CENTRED, z, yaw });
  }

  // --- outside, on a shell around the station ---
  // Aimed inward, because being dropped into vacuum facing away from the only
  // landmark on the map is disorienting in a way that is not fun.
  const mid = [
    (STATION_BOUNDS.min[0] + STATION_BOUNDS.max[0]) * 0.5,
    0,
    (STATION_BOUNDS.min[2] + STATION_BOUNDS.max[2]) * 0.5
  ];
  for (let attempt = 0; attempt < 4000 && out.length < 58; attempt++) {
    const a = rng() * Math.PI * 2;
    const el = (rng() - 0.5) * 1.5;
    const rad = 26 + rng() * 42;
    const x = mid[0] + Math.cos(a) * Math.cos(el) * rad;
    const y = mid[1] + Math.sin(el) * rad;
    const z = mid[2] + Math.sin(a) * Math.cos(el) * rad;
    if (Math.hypot(x, y, z) > TERRAIN.playRadius - 8) continue;
    if (Math.abs(y) > TERRAIN.hardY - 12) continue;
    let tooClose = false;
    for (const o of out) {
      if (Math.hypot(o.x - x, o.y - y, o.z - z) < 11) { tooClose = true; break; }
    }
    if (tooClose) continue;
    out.push({ x, y, z, yaw: Math.atan2(mid[0] - x, mid[2] - z) });
  }

  return out;
}

export const SPAWN_POINTS = generateSpawns().filter((sp) => clear(sp.x, sp.y, sp.z));

export const collideCapsule = world.collideCapsule;
export const raycastWorld = world.raycastWorld;
export const raycastTerrain = world.raycastTerrain;
export const isBlocked = world.isBlocked;
export const COLLIDER_COUNT = world.count;
/** Exposed so tools/test-maps.mjs can prove the hull is sealed and nothing floats. */
export const COLLIDERS = world.colliders;
export { KIND };
