/**
 * ISS -- map bundle.
 *
 * The odd one out: no ground, no gravity, and a movement mode that the player
 * controller switches to on its own the moment this map goes active.
 */

export { TERRAIN, heightAt, normalAt, slopeAt, isWalkable, radiusAt, boundaryPressure } from './terrain.js';
export { STATION_PARTS, STATION_BOUNDS, TRUSS, WINGS, BORE, COLLAR_R, NODES, DOORWAYS, INTERIOR_PROBES, partBounds } from './station.js';
export { ASTEROID_PARTS, ASTEROID_GROUPS } from './asteroids.js';
export { collideCapsule, raycastWorld, raycastTerrain, isBlocked, KIND, COLLIDER_COUNT, COLLIDERS, SPAWN_POINTS } from './collision.js';

export const MAP_INFO = {
  id: 'iss',
  name: 'Orbital',
  description: 'The station, 400 km up. No floor, no ceiling, and no up unless you decide there is one.',

  /**
   * How you move here. LocalPlayer reads this off the active map every frame, so
   * flipping to this map turns off gravity and turns on the thrusters without the
   * controller having to know the map exists.
   */
  movement: {
    mode: 'zerog',
    /** Metres per second you settle at on the translation thrusters. */
    speed: 8.0,
    boostSpeed: 12.5,
    /** How hard the thrusters bite. Higher is snappier and less like flying. */
    thrust: 3.4,
    /** How fast you coast to a stop with nothing held. Low means a long glide. */
    drift: 0.55,
    /** Roll rate on the Q/E side thrusters, radians per second. */
    rollRate: 1.85,
    /** Roll authority bleeds off when you let go, rather than stopping dead. */
    rollDamp: 7.0,

    /**
     * The airborne spread penalty exists to punish a player who jumped and lost
     * their footing. Out here there is no footing to lose -- floating IS the
     * standing position -- so applying it means every weapon permanently shoots
     * like it is mid-jump. On the M700 that is five hundred times its aimed spread,
     * which is why the sniper felt broken on this map and was.
     *
     * What replaces it is already in the weapon table: spreadMoveAdd. Hold still
     * and you are the steadiest firing platform there is; drift and you are not.
     */
    airborneSpread: false,

    /**
     * Recoil as momentum. Multiplied by the weapon's kickBack to get metres per
     * second of shove per round, so a Glock nudges and the M700 kicks properly.
     * Fire a burst without holding W and you will end up going backwards -- and
     * because drifting widens your cone, spraying costs you accuracy twice over.
     */
    recoilPush: 5.0
  },

  /** Everybody is in an EMU on this map. See client/js/characters/Soldier.js. */
  characters: 'astronaut',

  environment: {
    /** Vacuum. Nothing between you and the thing you are shooting at. */
    fogColor: 0x000000,
    fogDensity: 0,
    skyTop: 0x000000,
    skyBottom: 0x02030a,

    /** A white sun, unfiltered by any atmosphere, hung high off the starboard bow. */
    sunColor: 0xffffff,
    sunIntensity: 3.1,
    sunAzimuth: 0.90,
    sunElevation: 0.95,
    /** Angular radius of the disc in the sky shader. The real one is about 0.0047. */
    sunAngularRadius: 0.019,

    /**
     * Shadows in vacuum go absolutely black, which looks correct in a photograph and
     * unreadable in a game. The fill is Earth: a broad blue bounce from below, which
     * is genuinely where the light comes from up here.
     */
    ambientSky: 0x121a2a,
    ambientGround: 0x4a86bd,
    ambientIntensity: 1.15,
    earthFill: 0x5c99d6,
    earthFillIntensity: 0.80,

    /** Earth, drawn in the sky shader so it stays put however far you fly. */
    earthDirection: [0.10, -0.97, -0.22],
    earthAngularRadius: 0.74,

    starDensity: 1.0,
    milkyWayTilt: 0.55,

    /** What a bullet throws off aluminium and MLI: bright metal, no dust. */
    impactColor: [0.82, 0.85, 0.90],
    /**
     * Multiplier on the usual pull, for everything that falls: debris, blood, and
     * the bodies. Zero, so a body you shoot drifts away tumbling instead of
     * dropping toward a floor that is not there.
     */
    gravityScale: 0
  }
};
