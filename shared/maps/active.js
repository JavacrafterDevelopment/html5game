/**
 * The active map.
 *
 * Everything that asks "where is the ground", "does this bullet hit a wall" or
 * "where do players spawn" goes through here rather than importing a specific map.
 * That is what makes `/map grass` possible: the server flips one switch, tells
 * every client to do the same, and all the physics follows.
 *
 * Both maps are imported statically and generate their layout at load. That costs a
 * few milliseconds once, and in exchange switching maps is instantaneous and can
 * never fail halfway through.
 */

import { MAPS, DEFAULT_MAP } from './index.js';

let activeId = DEFAULT_MAP;
let active = MAPS[DEFAULT_MAP];

const listeners = new Set();

/** @returns {boolean} true if the map actually changed */
export function setActiveMap(id) {
  if (!MAPS[id]) return false;
  if (id === activeId) return false;
  activeId = id;
  active = MAPS[id];
  for (const fn of listeners) fn(id);
  return true;
}

export function getActiveMapId() { return activeId; }
export function getActiveMap() { return active; }
export function mapExists(id) { return !!MAPS[id]; }
export function mapIds() { return Object.keys(MAPS); }

/** Notified whenever the active map changes. */
export function onMapChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------- delegates
// Thin wrappers rather than re-exported bindings, because the target module has to
// be resolved at call time -- the whole point is that it changes.

export function heightAt(x, z) { return active.heightAt(x, z); }
export function normalAt(x, z, eps) { return active.normalAt(x, z, eps); }
export function slopeAt(x, z, eps) { return active.slopeAt(x, z, eps); }
export function isWalkable(x, z) { return active.isWalkable(x, z); }

export function collideCapsule(pos, radius, height, stepHeight) {
  return active.collideCapsule(pos, radius, height, stepHeight);
}

export function raycastWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  return active.raycastWorld(ox, oy, oz, dx, dy, dz, maxDist);
}

export function raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
  return active.raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist);
}

export function isBlocked(ox, oy, oz, tx, ty, tz) {
  return active.isBlocked(ox, oy, oz, tx, ty, tz);
}

export function spawnPoints() { return active.SPAWN_POINTS; }
export function mapInfo() { return active.MAP_INFO; }

/**
 * How players move on this map. Maps that do not say get the default: feet on the
 * ground, gravity on. The ISS says 'zerog' and the controller changes behaviour
 * without ever having to name the map.
 */
export function movement() {
  return active.MAP_INFO.movement || DEFAULT_MOVEMENT;
}
const DEFAULT_MOVEMENT = {
  mode: 'ground',
  /** Being off the ground costs you accuracy, on maps that have a ground. */
  airborneSpread: true,
  /** Nothing pushes a player who is braced against the planet. */
  recoilPush: 0
};

/** Character style the map wants: 'soldier' by default, 'astronaut' up in orbit. */
export function characterStyle() { return active.MAP_INFO.characters || 'soldier'; }
export function terrainConfig() { return active.TERRAIN; }
export function colliderCount() { return active.COLLIDER_COUNT; }

/** Summary the server sends to clients on join and on map change. */
export function mapDescriptor() {
  const info = active.MAP_INFO;
  return {
    id: info.id,
    name: info.name,
    description: info.description,
    seed: active.TERRAIN.seed,
    environment: info.environment,
    movement: info.movement || DEFAULT_MOVEMENT
  };
}

export { KIND } from './kinds.js';
