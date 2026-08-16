/**
 * Shared tuning constants. Imported by BOTH the Node server and the browser client,
 * so the two always agree on physics, timings and match rules.
 */

export const NET = {
  DEFAULT_PORT: 8080,
  TICK_RATE: 60,          // server simulation ticks per second
  SNAPSHOT_RATE: 20,      // state broadcasts per second
  INPUT_RATE: 60,         // client input sends per second
  INTERP_DELAY_MS: 110,   // how far in the past remote players are rendered
  HISTORY_MS: 1200,       // per-player position history kept for lag compensation
  MAX_PLAYERS: 16,
  PING_INTERVAL_MS: 2000,
  TIMEOUT_MS: 20000,
  MAX_MESSAGE_BYTES: 64 * 1024
};

export const MATCH = {
  MODE_ID: 'ffa',
  MODE_NAME: 'Free For All',
  KILL_TARGET: 100,
  RESPAWN_MS: 5000,
  POST_MATCH_MS: 20000,
  MIN_SPAWN_DISTANCE: 25    // metres away from any living enemy when picking a spawn
};

export const PLAYER = {
  MAX_HP: 100,
  RADIUS: 0.35,
  HEIGHT: 1.80,
  CROUCH_HEIGHT: 1.25,
  EYE_HEIGHT: 1.62,
  CROUCH_EYE_HEIGHT: 1.02,
  HEAD_RADIUS: 0.17,
  HEAD_CENTER: 1.63,        // head sphere centre, metres above feet (standing)
  STEP_HEIGHT: 0.55,
  // Server-side sanity check. Generous so legitimate players are never rubber-banded.
  MAX_SPEED_TOLERANCE: 1.9
};

export const MOVE = {
  WALK: 4.5,
  SPRINT: 7.4,
  CROUCH: 2.2,
  ADS_MULT: 0.45,
  ACCEL: 70,
  AIR_ACCEL: 12,
  FRICTION: 11,
  AIR_FRICTION: 0.2,
  GRAVITY: 23,
  JUMP_VELOCITY: 7.3,
  /**
   * Ground steeper than this gives way under you and you slide back down.
   * This is how the snowy map's mountain ring is impassable without a fence --
   * shared so tools/test-maps.mjs can prove the boundary really holds.
   */
  SLIDE_SLOPE: 0.44,
  SLIDE_ACCEL: 46,
  // View
  FOV: 78,
  MOUSE_SENS: 0.0022
};

export const DAMAGE = {
  // Hardcore: no hit feedback of any kind, and a very short time-to-kill.
  FALL_DAMAGE_MIN_SPEED: 14,
  FALL_DAMAGE_SCALE: 9
};

export const WORLD = {
  MAP_ID: 'snowy_forest',
  SEED: 1337,
  // Playable bowl. Beyond PLAY_RADIUS the terrain climbs into impassable mountains.
  PLAY_RADIUS: 92,
  BOUNDS: 130,
  MAX_BULLET_RANGE: 400
};

/** Weapon slots a player carries. */
export const SLOTS = { PRIMARY: 0, SECONDARY: 1 };
