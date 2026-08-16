/**
 * Server-side player record.
 *
 * Movement is client-authoritative (the client simulates and reports where it is)
 * but everything that decides a fight -- health, ammo, fire rate, hit registration --
 * is resolved here. A rewind buffer of recent positions lets us do lag compensation,
 * so shooting where you saw someone actually connects.
 */

import { PLAYER, NET, MOVE } from '../../shared/config.js';
import { STATE_BITS } from '../../shared/protocol.js';
import { getWeapon, DEFAULT_SECONDARY, fireIntervalMs } from '../../shared/weapons.js';

let nextId = 1;

export class Player {
  constructor(conn, name, primary) {
    this.id = nextId++;
    this.conn = conn;
    this.name = name;
    this.joinedAt = Date.now();

    // loadout
    this.primary = primary;
    this.secondary = DEFAULT_SECONDARY;
    this.pendingPrimary = primary;      // applied on next respawn
    this.weaponId = primary;

    // transform
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.stateBits = 0;

    // combat
    this.hp = PLAYER.MAX_HP;
    this.alive = false;
    this.respawnAt = 0;
    this.lastDamageAt = 0;
    this.lastAttackerId = 0;

    // scoring
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.bestStreak = 0;

    // ammo, keyed by weapon id
    this.ammo = {};
    this.resetAmmo();

    // fire-rate policing
    this.lastShotAt = 0;
    this.shotsThisSecond = 0;
    this.shotWindowStart = 0;

    // networking
    this.rtt = 60;
    this.lastInputAt = Date.now();
    this.lastSeq = -1;
    this.history = [];        // { t, x, y, z, yaw, crouch }

    this.warnings = 0;
  }

  get crouching() { return (this.stateBits & STATE_BITS.CROUCH) !== 0; }
  get height() { return this.crouching ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT; }
  get eyeHeight() { return this.crouching ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT; }
  get headCenter() {
    const scale = this.crouching ? PLAYER.CROUCH_HEIGHT / PLAYER.HEIGHT : 1;
    return PLAYER.HEAD_CENTER * scale;
  }
  get weapon() { return getWeapon(this.weaponId); }

  resetAmmo() {
    for (const id of [this.primary, this.secondary]) {
      const w = getWeapon(id);
      this.ammo[id] = { mag: w.magSize, reserve: w.magSize * w.reserveMags, reloadingUntil: 0 };
    }
  }

  spawn(point) {
    this.pos = [point.x, point.y, point.z];
    this.yaw = point.yaw;
    this.pitch = 0;
    this.hp = PLAYER.MAX_HP;
    this.alive = true;
    this.stateBits = 0;
    this.primary = this.pendingPrimary;
    this.weaponId = this.primary;
    this.resetAmmo();
    this.lastShotAt = 0;
    this.history.length = 0;
    this.pushHistory(Date.now());
  }

  kill() {
    this.alive = false;
    this.hp = 0;
    this.streak = 0;
    this.deaths++;
    this.respawnAt = Date.now() + 5000;
  }

  addKill() {
    this.kills++;
    this.streak++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
  }

  /** Record the current transform for later rewind. */
  pushHistory(now) {
    this.history.push({
      t: now,
      x: this.pos[0], y: this.pos[1], z: this.pos[2],
      yaw: this.yaw,
      crouch: this.crouching
    });
    const cutoff = now - NET.HISTORY_MS;
    while (this.history.length > 2 && this.history[0].t < cutoff) this.history.shift();
  }

  /**
   * Where this player was at time `t`, interpolated. Used to rewind the world to
   * what the shooter actually saw on their screen.
   */
  getPositionAt(t) {
    const h = this.history;
    if (h.length === 0) return { x: this.pos[0], y: this.pos[1], z: this.pos[2], crouch: this.crouching };
    if (t >= h[h.length - 1].t) {
      const last = h[h.length - 1];
      return { x: last.x, y: last.y, z: last.z, crouch: last.crouch };
    }
    if (t <= h[0].t) return { x: h[0].x, y: h[0].y, z: h[0].z, crouch: h[0].crouch };

    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i], a = h[i - 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        const f = span > 0 ? (t - a.t) / span : 0;
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          crouch: f < 0.5 ? a.crouch : b.crouch
        };
      }
    }
    const last = h[h.length - 1];
    return { x: last.x, y: last.y, z: last.z, crouch: last.crouch };
  }

  /**
   * Accept a movement update. Rejects only physically impossible motion --
   * we stay generous so that lag never rubber-bands an honest player.
   */
  applyInput(msg, now) {
    if (typeof msg.seq === 'number') {
      if (msg.seq <= this.lastSeq) return false;   // stale or duplicate
      this.lastSeq = msg.seq;
    }
    const p = msg.p;
    if (!Array.isArray(p) || p.length !== 3) return false;
    if (!p.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;

    if (this.alive) {
      const dt = Math.max(0.001, (now - this.lastInputAt) / 1000);
      const dx = p[0] - this.pos[0];
      const dz = p[2] - this.pos[2];
      const horizontal = Math.hypot(dx, dz);
      const maxStep = MOVE.SPRINT * PLAYER.MAX_SPEED_TOLERANCE * Math.min(dt, 0.5) + 0.6;
      if (horizontal > maxStep) {
        // Too fast to be real: clamp toward the reported position rather than
        // snapping back, which would look like rubber-banding on a laggy link.
        const s = maxStep / horizontal;
        this.pos[0] += dx * s;
        this.pos[2] += dz * s;
        this.pos[1] = p[1];
        this.warnings++;
      } else {
        this.pos[0] = p[0];
        this.pos[1] = p[1];
        this.pos[2] = p[2];
      }
    } else {
      this.pos[0] = p[0]; this.pos[1] = p[1]; this.pos[2] = p[2];
    }

    if (typeof msg.y === 'number' && Number.isFinite(msg.y)) this.yaw = msg.y;
    if (typeof msg.t === 'number' && Number.isFinite(msg.t)) {
      this.pitch = Math.max(-1.55, Math.min(1.55, msg.t));
    }
    if (typeof msg.st === 'number') this.stateBits = msg.st | 0;
    if (typeof msg.wp === 'string' && (msg.wp === this.primary || msg.wp === this.secondary)) {
      this.weaponId = msg.wp;
    }

    this.lastInputAt = now;
    this.pushHistory(now);
    return true;
  }

  /**
   * Fire-rate and ammo gate. Returns null when the shot is allowed,
   * otherwise a short reason string (used only for server logging).
   */
  canFire(weaponId, now) {
    if (!this.alive) return 'dead';
    if (weaponId !== this.weaponId) return 'wrong-weapon';
    const w = getWeapon(weaponId);
    const state = this.ammo[weaponId];
    if (!state) return 'no-ammo-state';
    if (now < state.reloadingUntil) return 'reloading';
    if (state.mag <= 0) return 'empty';

    // 10% tolerance absorbs network jitter without allowing a rapid-fire script.
    const interval = fireIntervalMs(w) * 0.9;
    if (now - this.lastShotAt < interval) return 'too-fast';

    // Second line of defence: a hard cap on shots per second per weapon.
    if (now - this.shotWindowStart > 1000) {
      this.shotWindowStart = now;
      this.shotsThisSecond = 0;
    }
    const cap = Math.ceil((w.boltActionMs ? 60000 / w.boltActionMs : w.rpm) / 60 * 1.4) + 2;
    if (this.shotsThisSecond >= cap) return 'rate-cap';

    return null;
  }

  consumeShot(weaponId, now) {
    this.lastShotAt = now;
    this.shotsThisSecond++;
    const state = this.ammo[weaponId];
    if (state) state.mag = Math.max(0, state.mag - 1);
  }

  startReload(weaponId, now) {
    const w = getWeapon(weaponId);
    const state = this.ammo[weaponId];
    if (!state || state.reserve <= 0 || state.mag >= w.magSize) return false;
    if (now < state.reloadingUntil) return false;
    const empty = state.mag === 0;
    state.reloadingUntil = now + (empty ? w.reloadEmptyMs : w.reloadMs);
    state.pendingReload = true;
    return true;
  }

  /** Complete any reload whose timer has elapsed. */
  updateReload(now) {
    for (const id of Object.keys(this.ammo)) {
      const state = this.ammo[id];
      if (state.pendingReload && now >= state.reloadingUntil) {
        const w = getWeapon(id);
        const need = w.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        state.pendingReload = false;
      }
    }
  }

  /** Compact form sent to every other client each snapshot. */
  toSnapshot() {
    return {
      i: this.id,
      p: [round2(this.pos[0]), round2(this.pos[1]), round2(this.pos[2])],
      y: round3(this.yaw),
      t: round3(this.pitch),
      s: this.stateBits,
      w: this.weaponId,
      a: this.alive ? 1 : 0
    };
  }

  toScore() {
    return {
      id: this.id,
      name: this.name,
      kills: this.kills,
      deaths: this.deaths,
      streak: this.bestStreak,
      ping: Math.round(this.rtt),
      alive: this.alive
    };
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
