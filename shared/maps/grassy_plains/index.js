/**
 * Grassy Plains -- map bundle.
 */

export { TERRAIN, heightAt, normalAt, slopeAt, isWalkable, HUT_SITES } from './terrain.js';
export { HUTS, HUT_BOXES } from './huts.js';
export { PROPS, SHEEP_HERDS, TREE_VARIANTS, fieldRuns } from './props.js';
export { collideCapsule, raycastWorld, raycastTerrain, isBlocked, KIND, COLLIDER_COUNT, COLLIDERS, SPAWN_POINTS } from './collision.js';

export const MAP_INFO = {
  id: 'grassy_plains',
  name: 'Hollowmere',
  description: 'Open farmland under a big sky. A handful of huts, a lot of grass, and nowhere to hide that the wind does not show.',
  environment: {
    fogColor: 0xbfd4e0,
    fogDensity: 0.0042,
    skyTop: 0x4d84c4,
    skyBottom: 0xc4dced,
    sunColor: 0xfff2d8,
    sunIntensity: 1.7,
    ambientSky: 0x9dc4e8,
    ambientGround: 0x6f8a4a,
    ambientIntensity: 0.75,
    sunAzimuth: 1.05,
    sunElevation: 0.62,
    // Wind drives the grass, the airborne motes and the cloud drift. One vector so
    // everything visibly agrees about which way it is blowing.
    windDirection: [0.82, 0.57],
    windStrength: 1.0,
    windGustiness: 0.45,
    grassColorA: 0x5f8a3c,
    grassColorB: 0x86a83f,
    grassColorDry: 0xa8a95c
  }
};
