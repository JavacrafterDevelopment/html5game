/**
 * Weapon definitions. Single source of truth for both sides:
 *  - the server uses `damage`, `headMult`, `rpm`, `range`, `magSize` to validate and resolve shots
 *  - the client additionally uses `view` (view-model placement) and `feel` (recoil/spread/audio)
 *
 * Balance note: this is a HARDCORE shooter. Time-to-kill is deliberately brutal --
 * rifles kill in 2-3 body shots, every rifle headshot is lethal, the M700 is a
 * one-shot kill anywhere it lands.
 */

import { SLOTS } from './config.js';

export const WEAPONS = {
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    fullName: 'Kalashnikov AK-47',
    class: 'Assault Rifle',
    slot: SLOTS.PRIMARY,
    // --- gameplay (server-authoritative) ---
    damage: 55,
    headMult: 2.0,          // 110 -> lethal headshot
    legMult: 0.9,
    rpm: 600,
    auto: true,
    magSize: 30,
    reserveMags: 5,
    reloadMs: 2300,
    reloadEmptyMs: 3000,
    range: { start: 45, end: 110, minMult: 0.68 },
    muzzleVelocity: 715,
    // --- feel (client) ---
    feel: {
      adsMs: 260,
      adsFov: 50,
      moveMult: 0.94,
      spreadHip: 0.042,
      spreadAds: 0.0016,
      spreadMoveAdd: 0.030,
      spreadAirAdd: 0.075,
      spreadPerShot: 0.0075,
      spreadMax: 0.11,
      spreadRecover: 0.10,
      recoilV: 0.0125,
      recoilH: 0.0052,
      recoilRecover: 7.0,
      kickBack: 0.052,
      shakeAmount: 0.9,
      shellEject: true
    },
    audio: { pitch: 0.82, body: 118, crack: 0.95, tail: 0.55 },
    // --- view model placement (client) ---
    view: {
      hip: [0.24, -0.21, -0.46],
      ads: [0, -0.062, -0.30],
      hipRot: [0.02, -0.06, 0],
      scale: 1.0
    }
  },

  m4a1: {
    id: 'm4a1',
    name: 'M4A1',
    fullName: 'Colt M4A1 Carbine',
    class: 'Assault Rifle',
    slot: SLOTS.PRIMARY,
    damage: 50,
    headMult: 2.1,          // 105 -> lethal headshot
    legMult: 0.9,
    rpm: 800,
    auto: true,
    magSize: 30,
    reserveMags: 5,
    reloadMs: 2150,
    reloadEmptyMs: 2850,
    range: { start: 40, end: 100, minMult: 0.70 },
    muzzleVelocity: 880,
    feel: {
      adsMs: 225,
      adsFov: 48,
      moveMult: 0.97,
      spreadHip: 0.038,
      spreadAds: 0.0013,
      spreadMoveAdd: 0.027,
      spreadAirAdd: 0.070,
      spreadPerShot: 0.0058,
      spreadMax: 0.095,
      spreadRecover: 0.11,
      recoilV: 0.0092,
      recoilH: 0.0038,
      recoilRecover: 8.5,
      kickBack: 0.040,
      shakeAmount: 0.72,
      shellEject: true
    },
    audio: { pitch: 1.04, body: 150, crack: 1.0, tail: 0.45 },
    view: {
      hip: [0.24, -0.20, -0.44],
      ads: [0, -0.058, -0.28],
      hipRot: [0.02, -0.06, 0],
      scale: 1.0
    }
  },

  glock17: {
    id: 'glock17',
    name: 'Glock 17',
    fullName: 'Glock 17 9x19mm',
    class: 'Sidearm',
    slot: SLOTS.SECONDARY,
    damage: 38,
    headMult: 2.0,          // 76 -> two headshots
    legMult: 0.85,
    rpm: 450,               // semi-auto: this is the mechanical cap
    auto: false,
    magSize: 17,
    reserveMags: 4,
    reloadMs: 1650,
    reloadEmptyMs: 2200,
    range: { start: 22, end: 55, minMult: 0.80 },
    muzzleVelocity: 375,
    feel: {
      adsMs: 175,
      adsFov: 56,
      moveMult: 1.0,
      spreadHip: 0.048,
      spreadAds: 0.0026,
      spreadMoveAdd: 0.024,
      spreadAirAdd: 0.06,
      spreadPerShot: 0.010,
      spreadMax: 0.10,
      spreadRecover: 0.13,
      recoilV: 0.0135,
      recoilH: 0.0044,
      recoilRecover: 10.0,
      kickBack: 0.030,
      shakeAmount: 0.55,
      shellEject: true
    },
    audio: { pitch: 1.25, body: 205, crack: 0.7, tail: 0.3 },
    view: {
      hip: [0.20, -0.19, -0.36],
      ads: [0, -0.053, -0.26],
      hipRot: [0.03, -0.05, 0],
      scale: 1.0
    }
  },

  m700: {
    id: 'm700',
    name: 'M700',
    fullName: 'Remington M700 .308',
    class: 'Sniper Rifle',
    slot: SLOTS.PRIMARY,
    damage: 150,            // one shot, one kill, anywhere
    headMult: 2.0,
    legMult: 1.0,
    rpm: 45,                // bolt cycle
    auto: false,
    magSize: 5,
    reserveMags: 6,
    reloadMs: 2900,
    reloadEmptyMs: 3400,
    range: { start: 200, end: 400, minMult: 1.0 },  // no practical falloff
    muzzleVelocity: 850,
    boltActionMs: 1150,     // forced re-chamber after every shot
    feel: {
      adsMs: 420,
      adsFov: 50,           // outer-lens FOV; true magnification handled by the scope render
      moveMult: 0.86,
      spreadHip: 0.085,     // hipfiring a bolt gun is a joke, as it should be
      spreadAds: 0.0002,
      spreadMoveAdd: 0.045,
      spreadAirAdd: 0.10,
      spreadPerShot: 0.02,
      spreadMax: 0.14,
      spreadRecover: 0.08,
      recoilV: 0.048,
      recoilH: 0.0075,
      recoilRecover: 4.0,
      kickBack: 0.14,
      shakeAmount: 2.1,
      shellEject: false     // ejects on bolt cycle instead
    },
    audio: { pitch: 0.62, body: 90, crack: 1.35, tail: 1.0 },
    scope: {
      magnification: 6.0,   // 6x through the glass
      zoomedFov: 13,
      swayAmount: 0.0016,
      swaySpeed: 0.9,
      holdBreathMs: 4000
    },
    view: {
      hip: [0.26, -0.22, -0.52],
      ads: [0, -0.043, -0.20],
      hipRot: [0.02, -0.06, 0],
      scale: 1.0
    }
  }
};

/** Primaries the player may choose from in the loadout screen. */
export const PRIMARY_CHOICES = ['ak47', 'm4a1', 'm700'];
/** Everyone carries the Glock. */
export const DEFAULT_SECONDARY = 'glock17';

export const WEAPON_IDS = Object.keys(WEAPONS);

export function getWeapon(id) {
  return WEAPONS[id] || WEAPONS.ak47;
}

export function isValidPrimary(id) {
  return PRIMARY_CHOICES.includes(id);
}

/** Rounds per second -> milliseconds between shots. */
export function fireIntervalMs(w) {
  if (w.boltActionMs) return w.boltActionMs;
  return 60000 / w.rpm;
}

/**
 * Damage after distance falloff. Shared so the client could predict it,
 * but only the server's result actually counts.
 */
export function damageAtRange(w, distance) {
  const r = w.range;
  if (distance <= r.start) return w.damage;
  if (distance >= r.end) return w.damage * r.minMult;
  const t = (distance - r.start) / (r.end - r.start);
  return w.damage * (1 + (r.minMult - 1) * t);
}

/** Hit zone multipliers. */
export const HITZONE = { HEAD: 'head', BODY: 'body', LEG: 'leg' };

export function zoneMultiplier(w, zone) {
  if (zone === HITZONE.HEAD) return w.headMult;
  if (zone === HITZONE.LEG) return w.legMult;
  return 1;
}
