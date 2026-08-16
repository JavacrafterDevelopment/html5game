/**
 * Wire protocol.
 *
 * HARDCORE RULE, ENFORCED HERE AT THE PROTOCOL LEVEL:
 * the server never tells a client that it damaged or killed somebody. There is no
 * "you hit" or "you killed" message in this file at all, so no client -- not even a
 * modified one -- can render a hitmarker or a kill feed. The only time full detail
 * about a death is transmitted is to the player who just died (S_YOU_DIED).
 * Everyone else receives S_PLAYER_DIED, which carries no killer identity.
 */

// ---- client -> server ----
export const C = {
  JOIN: 'join',            // { name, primary }
  INPUT: 'input',          // { seq, p:[x,y,z], y:yaw, t:pitch, st:stateBits, wp:weaponId }
  FIRE: 'fire',            // { o:[x,y,z], d:[x,y,z], md:maxDist, wp:weaponId, seq }
  RELOAD: 'reload',        // { wp }
  SWITCH: 'switch',        // { wp }
  LOADOUT: 'loadout',      // { primary }  (applies on next respawn)
  PING: 'ping',            // { t }
  CHAT: 'chat',            // { text } -- also carries slash commands like /map grass
  MAP_READY: 'mapready'    // client finished rebuilding after a map change
};

// ---- server -> client ----
export const S = {
  WELCOME: 'welcome',      // full match + map info, your id
  SNAPSHOT: 'snapshot',    // { t, players: [...], self: {...} }
  PLAYER_JOIN: 'pjoin',    // { id, name }
  PLAYER_LEAVE: 'pleave',  // { id }
  PLAYER_DIED: 'pdied',    // { id, dir, hitY } -- NO killer identity. Ragdoll trigger only.
  YOU_DIED: 'ydied',       // { by, byName, weapon, dist, killerHp, respawnAt, headshot }
  RESPAWN: 'respawn',      // { pos, yaw, hp, ammo }
  SCORES: 'scores',        // { list: [{id,name,kills,deaths,ping}] }
  MATCH_STATE: 'mstate',   // { state, target, timeLeft, leaderId }
  MATCH_OVER: 'mover',     // { winnerId, winnerName, list }
  MATCH_RESET: 'mreset',   // {}
  SHOT_FIRED: 'shot',      // { id, o, d, wp } -- so others hear/see it. Never sent to the shooter.
  PONG: 'pong',            // { t }
  BLOOD: 'blood',          // { p, d, a } -- a wound, in the world. No shooter, no victim id.
  MAP_CHANGE: 'mapchange', // { map, by, inMs } -- everyone rebuilds and respawns
  NOTICE: 'notice',        // { text } -- server message in the chat log
  CHAT: 'chat',            // { id, name, text }
  ERROR: 'error'           // { code, message }
};

/** Packed movement state bits sent every input frame. */
export const STATE_BITS = {
  CROUCH: 1 << 0,
  SPRINT: 1 << 1,
  ADS: 1 << 2,
  AIRBORNE: 1 << 3,
  MOVING: 1 << 4,
  FIRING: 1 << 5,
  RELOADING: 1 << 6,
  /** Set by the SERVER, not the client: this player is wounded and leaving a trail. */
  BLEEDING: 1 << 7
};

export const MATCH_STATE = {
  WAITING: 'waiting',
  LIVE: 'live',
  OVER: 'over'
};

/** Death causes reported to the victim only. */
export const DEATH_CAUSE = {
  GUNSHOT: 'gunshot',
  FALL: 'fall',
  WORLD: 'world'
};

export function encode(type, data) {
  return JSON.stringify(data ? { m: type, ...data } : { m: type });
}

export function decode(str) {
  try {
    const obj = JSON.parse(str);
    if (!obj || typeof obj.m !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

/** Usernames: printable, trimmed, deduplicated by the server. */
export function sanitizeName(raw) {
  // Strip control characters and angle brackets only; names are rendered as textContent.
  const STRIP = new RegExp('[\\u0000-\\u001F\\u007F<>]', 'g');
  let s = String(raw == null ? '' : raw).replace(STRIP, '').trim();
  s = s.replace(/\s+/g, ' ');
  if (s.length > 16) s = s.slice(0, 16);
  if (s.length < 1) s = '';
  return s;
}
