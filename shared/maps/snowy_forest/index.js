/**
 * Snowy Forest -- map bundle. Everything the rest of the game needs to know
 * about this map is re-exported from here.
 */

export { TERRAIN, heightAt, normalAt, slopeAt, isWalkable, CABIN_SITE, CABIN_BASE_Y } from './terrain.js';
export { CABIN, CABIN_BOXES, CABIN_PARTS, WINDOWS } from './cabin.js';
export { PROPS, SPAWN_POINTS, TREE_VARIANTS } from './props.js';
export { collideCapsule, raycastWorld, raycastTerrain, isBlocked, KIND, COLLIDER_COUNT } from './collision.js';

export const MAP_INFO = {
  id: 'snowy_forest',
  name: 'Whiteout Ridge',
  description: 'A frozen pine basin ringed by mountains. One hunting cabin, no cover you did not earn.',
  environment: {
    fogColor: 0xa8bccd,
    fogDensity: 0.0092,
    skyTop: 0x8fa9c4,
    skyBottom: 0xd8e3ec,
    sunColor: 0xffe9d0,
    sunIntensity: 1.35,
    ambientSky: 0xa9c4de,
    ambientGround: 0xe8f1f7,
    ambientIntensity: 0.85,
    sunAzimuth: 2.4,
    sunElevation: 0.32,
    snowfallRate: 1.0,
    windDirection: [0.55, -0.28],
    windStrength: 1.4
  }
};
