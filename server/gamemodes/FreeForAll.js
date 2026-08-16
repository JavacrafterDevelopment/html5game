/**
 * Free For All -- first player to reach the kill target wins.
 *
 * The mode owns scoring, the win condition and spawn selection. Keeping it in its
 * own file means adding TDM or Search later is a matter of writing a sibling class
 * with the same three hooks: onKill, pickSpawn, isOver.
 */

import { MATCH } from '../../shared/config.js';
import { MATCH_STATE } from '../../shared/protocol.js';
import { spawnPoints } from '../../shared/maps/active.js';

export class FreeForAll {
  constructor(options = {}) {
    this.id = 'ffa';
    this.name = MATCH.MODE_NAME;
    this.killTarget = options.killTarget ?? MATCH.KILL_TARGET;
    this.state = MATCH_STATE.WAITING;
    this.startedAt = 0;
    this.endedAt = 0;
    this.winnerId = 0;
    this.recentSpawns = [];
  }

  start() {
    this.state = MATCH_STATE.LIVE;
    this.startedAt = Date.now();
    this.endedAt = 0;
    this.winnerId = 0;
  }

  reset(players) {
    for (const p of players) {
      p.kills = 0;
      p.deaths = 0;
      p.streak = 0;
      p.bestStreak = 0;
    }
    this.recentSpawns.length = 0;
    this.start();
  }

  /** @returns {boolean} true when this kill ended the match */
  onKill(killer, victim) {
    if (this.state !== MATCH_STATE.LIVE) return false;
    if (killer && killer !== victim) {
      killer.addKill();
    } else if (killer === victim) {
      // Suicide (fall damage / out of bounds) costs you a point, floored at zero.
      victim.kills = Math.max(0, victim.kills - 1);
    }
    victim.kill();

    if (killer && killer.kills >= this.killTarget) {
      this.state = MATCH_STATE.OVER;
      this.endedAt = Date.now();
      this.winnerId = killer.id;
      return true;
    }
    return false;
  }

  isOver() {
    return this.state === MATCH_STATE.OVER;
  }

  get leader() {
    return this._leader || null;
  }

  updateLeader(players) {
    let best = null;
    for (const p of players) {
      if (!best || p.kills > best.kills) best = p;
    }
    this._leader = best;
    return best;
  }

  /**
   * Pick the spawn that is furthest from anybody who could shoot you the moment
   * you appear. Recently used spawns are penalised so two players do not
   * materialise on top of each other.
   */
  pickSpawn(player, players) {
    // Resolved per call: the active map can change mid-match via /map.
    const SPAWN_POINTS = spawnPoints();
    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      const sp = SPAWN_POINTS[i];
      let nearestEnemy = Infinity;

      for (const other of players) {
        if (other === player || !other.alive) continue;
        const d = Math.hypot(other.pos[0] - sp.x, other.pos[2] - sp.z);
        if (d < nearestEnemy) nearestEnemy = d;
      }

      // Distance is good, but stop caring past ~60 m so the whole map stays in play.
      let score = Math.min(nearestEnemy, 60);
      if (nearestEnemy < MATCH.MIN_SPAWN_DISTANCE) score -= 120;
      if (this.recentSpawns.includes(i)) score -= 35;
      score += Math.random() * 12;

      if (score > bestScore) {
        bestScore = score;
        best = { index: i, point: sp };
      }
    }

    if (!best) {
      const idx = Math.floor(Math.random() * SPAWN_POINTS.length);
      best = { index: idx, point: SPAWN_POINTS[idx] };
    }

    this.recentSpawns.push(best.index);
    if (this.recentSpawns.length > 4) this.recentSpawns.shift();

    return best.point;
  }

  serialize() {
    return {
      mode: this.id,
      name: this.name,
      state: this.state,
      target: this.killTarget,
      winnerId: this.winnerId,
      elapsed: this.startedAt ? Date.now() - this.startedAt : 0
    };
  }
}
