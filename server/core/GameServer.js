/**
 * Authoritative game server.
 *
 * Split of responsibility:
 *   client  -> simulates its own movement, sends position + look + fire events
 *   server  -> owns health, ammo, fire rate, hit registration, scoring, spawning
 *
 * Hit registration is lag compensated: when a shot arrives we rewind every other
 * player to where the shooter's screen showed them (their RTT/2 plus the client's
 * interpolation delay) and trace against that.
 *
 * THE HARDCORE RULE lives here too. `resolveShot` deliberately sends nothing back
 * to the shooter -- no hit confirmation, no kill confirmation, nothing. The only
 * detailed death report in the whole protocol goes to the player who died.
 */

import { NET, MATCH, PLAYER, WORLD } from '../../shared/config.js';
import { C, S, MATCH_STATE, encode, decode, sanitizeName, DEATH_CAUSE } from '../../shared/protocol.js';
import { getWeapon, isValidPrimary, damageAtRange, zoneMultiplier, HITZONE, PRIMARY_CHOICES, DEFAULT_SECONDARY } from '../../shared/weapons.js';
import { raycastWorld, mapDescriptor, setActiveMap, getActiveMapId, mapIds } from '../../shared/maps/active.js';
import { resolveMapId } from '../../shared/maps/index.js';
import { raySphere, rayCapsuleY } from '../../shared/math/trace.js';
import { Player } from './Player.js';
import { FreeForAll } from '../gamemodes/FreeForAll.js';

const MAX_REWIND_MS = 320;
/** How long clients get to rebuild the scene before play resumes without them. */
const MAP_SWITCH_TIMEOUT_MS = 20000;

export class GameServer {
  constructor(options = {}) {
    this.verbose = options.verbose ?? false;
    this.maxPlayers = options.maxPlayers ?? NET.MAX_PLAYERS;
    this.players = new Map();          // id -> Player
    this.connections = new Map();      // conn -> Player | null
    this.mode = new FreeForAll({ killTarget: options.killTarget ?? MATCH.KILL_TARGET });
    this.mode.start();
    this.tickCount = 0;
    this.lastSnapshotAt = 0;
    this.resetAt = 0;
    this.mapSwitch = null;
    this.lastMapChangeAt = 0;

    this._tickTimer = null;
    this._pingTimer = null;
  }

  start() {
    const interval = 1000 / NET.TICK_RATE;
    this._tickTimer = setInterval(() => this.tick(), interval);
    this._pingTimer = setInterval(() => this.pingAll(), NET.PING_INTERVAL_MS);
  }

  stop() {
    clearInterval(this._tickTimer);
    clearInterval(this._pingTimer);
  }

  get playerList() {
    return [...this.players.values()];
  }

  // ------------------------------------------------------------ connections

  handleConnection(conn) {
    this.connections.set(conn, null);

    conn.on('message', (raw) => {
      if (typeof raw !== 'string') return;
      const msg = decode(raw);
      if (!msg) return;
      try {
        this.handleMessage(conn, msg);
      } catch (err) {
        if (this.verbose) console.error('  message error:', err.message);
      }
    });

    conn.on('pong', () => {
      const sentAt = conn._pingSentAt;
      if (sentAt) {
        const rtt = Date.now() - sentAt;
        const player = this.connections.get(conn);
        // Smooth it; a single spike should not swing lag compensation.
        if (player) player.rtt = player.rtt * 0.7 + Math.min(rtt, 600) * 0.3;
      }
      conn._lastPongAt = Date.now();
    });

    conn.on('close', () => this.handleDisconnect(conn));
    conn.on('error', () => this.handleDisconnect(conn));

    conn._lastPongAt = Date.now();
  }

  handleDisconnect(conn) {
    const player = this.connections.get(conn);
    this.connections.delete(conn);
    if (!player) return;
    this.players.delete(player.id);
    if (this.mapSwitch) {
      this.mapSwitch.pending.delete(player.id);
      if (this.mapSwitch.pending.size === 0) this.finishMapChange();
    }
    this.broadcast(S.PLAYER_LEAVE, { id: player.id });
    this.broadcastScores();
    console.log(`  - ${player.name} left (${this.players.size} online)`);
  }

  pingAll() {
    const now = Date.now();
    for (const [conn] of this.connections) {
      if (now - (conn._lastPongAt || now) > NET.TIMEOUT_MS) {
        conn.close(1001, 'timeout');
        this.handleDisconnect(conn);
        continue;
      }
      conn._pingSentAt = now;
      conn.ping();
    }
  }

  // ------------------------------------------------------------ messages

  handleMessage(conn, msg) {
    const player = this.connections.get(conn);

    if (msg.m === C.JOIN) return this.handleJoin(conn, msg);
    if (!player) return;

    switch (msg.m) {
      case C.INPUT: this.handleInput(player, msg); break;
      case C.FIRE: this.handleFire(player, msg); break;
      case C.RELOAD: this.handleReload(player, msg); break;
      case C.SWITCH: this.handleSwitch(player, msg); break;
      case C.LOADOUT: this.handleLoadout(player, msg); break;
      case C.CHAT: this.handleChat(player, msg); break;
      case C.MAP_READY: this.handleMapReady(player); break;
      case C.PING: this.send(player, S.PONG, { t: msg.t, s: Date.now() }); break;
      default: break;
    }
  }

  handleJoin(conn, msg) {
    if (this.connections.get(conn)) return;   // already joined

    if (this.players.size >= this.maxPlayers) {
      conn.send(encode(S.ERROR, { code: 'full', message: 'Server is full' }));
      conn.close(1000, 'full');
      return;
    }

    let name = sanitizeName(msg.name);
    if (!name) name = 'Operator';
    name = this.uniqueName(name);

    const primary = isValidPrimary(msg.primary) ? msg.primary : PRIMARY_CHOICES[0];
    const player = new Player(conn, name, primary);

    this.players.set(player.id, player);
    this.connections.set(conn, player);

    const spawn = this.mode.pickSpawn(player, this.playerList);
    player.spawn(spawn);

    this.send(player, S.WELCOME, {
      id: player.id,
      name: player.name,
      map: mapDescriptor(),
      match: this.mode.serialize(),
      spawn: { pos: player.pos, yaw: player.yaw },
      loadout: { primary: player.primary, secondary: player.secondary },
      config: {
        tickRate: NET.TICK_RATE,
        snapshotRate: NET.SNAPSHOT_RATE,
        interpDelay: NET.INTERP_DELAY_MS,
        respawnMs: MATCH.RESPAWN_MS,
        killTarget: this.mode.killTarget
      },
      players: this.playerList.filter((p) => p !== player).map((p) => ({ id: p.id, name: p.name }))
    });

    this.broadcast(S.PLAYER_JOIN, { id: player.id, name: player.name }, player.id);
    this.broadcastScores();
    console.log(`  + ${player.name} joined (${this.players.size} online)`);
  }

  uniqueName(base) {
    const taken = new Set(this.playerList.map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}(${i})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base + Math.floor(Math.random() * 1000);
  }

  handleInput(player, msg) {
    player.applyInput(msg, Date.now());
  }

  handleSwitch(player, msg) {
    if (msg.wp === player.primary || msg.wp === player.secondary) {
      player.weaponId = msg.wp;
    }
  }

  handleReload(player, msg) {
    const id = typeof msg.wp === 'string' ? msg.wp : player.weaponId;
    if (id !== player.primary && id !== player.secondary) return;
    player.startReload(id, Date.now());
  }

  handleLoadout(player, msg) {
    if (isValidPrimary(msg.primary)) {
      player.pendingPrimary = msg.primary;
    }
  }

  handleChat(player, msg) {
    const text = sanitizeName(String(msg.text || '')).slice(0, 90);
    if (!text) return;
    if (text.startsWith('/')) {
      this.handleCommand(player, text);
      return;
    }
    this.broadcast(S.CHAT, { id: player.id, name: player.name, text });
  }

  /** Slash commands typed into chat. */
  handleCommand(player, text) {
    const [rawCmd, ...args] = text.slice(1).split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    switch (cmd) {
      case 'map': {
        if (!args.length) {
          this.send(player, S.NOTICE, {
            text: `Current map: ${mapDescriptor().name}. Try /map ${mapIds().join(' or /map ')}`
          });
          return;
        }
        const target = resolveMapId(args[0]);
        if (!target) {
          this.send(player, S.NOTICE, { text: `Unknown map "${args[0]}". Available: ${mapIds().join(', ')}` });
          return;
        }
        if (target === getActiveMapId()) {
          this.send(player, S.NOTICE, { text: `Already playing ${mapDescriptor().name}.` });
          return;
        }
        if (this.mapSwitch) {
          this.send(player, S.NOTICE, { text: 'A map change is already in progress.' });
          return;
        }
        const now = Date.now();
        if (now - this.lastMapChangeAt < 15000) {
          const wait = Math.ceil((15000 - (now - this.lastMapChangeAt)) / 1000);
          this.send(player, S.NOTICE, { text: `Map was just changed. Wait ${wait}s.` });
          return;
        }
        this.changeMap(target, player);
        return;
      }
      case 'maps':
        this.send(player, S.NOTICE, { text: 'Maps: ' + mapIds().join(', ') });
        return;
      case 'help':
        this.send(player, S.NOTICE, { text: 'Commands: /map <name>, /maps, /help' });
        return;
      default:
        this.send(player, S.NOTICE, { text: `Unknown command "/${cmd}". Try /help` });
    }
  }

  /**
   * Move the entire server to another map.
   *
   * Everything about where the ground is and what stops a bullet comes from the
   * active map module, so flipping it here changes the server's physics instantly.
   * Clients need time to build the new scene, so play is suspended until they report
   * back (or a deadline passes), then everyone respawns fresh.
   */
  changeMap(mapId, requester = null) {
    if (!setActiveMap(mapId)) return false;

    const descriptor = mapDescriptor();
    this.lastMapChangeAt = Date.now();
    this.mapSwitch = {
      deadline: Date.now() + MAP_SWITCH_TIMEOUT_MS,
      pending: new Set(this.players.keys())
    };

    // Nobody is alive or shootable while the world is being rebuilt.
    for (const p of this.players.values()) {
      p.alive = false;
      p.respawnAt = 0;
      p.history.length = 0;
    }

    this.broadcast(S.MAP_CHANGE, {
      map: descriptor,
      by: requester ? requester.name : 'the server',
      timeoutMs: MAP_SWITCH_TIMEOUT_MS
    });
    console.log(`  * map -> ${descriptor.name}${requester ? ` (by ${requester.name})` : ''}`);
    return true;
  }

  handleMapReady(player) {
    if (!this.mapSwitch) {
      // No switch in progress: this is someone who joined while the server was
      // already on a non-default map and has just finished building it. They put
      // themselves on hold to do that, so give them a fresh spawn to come back on.
      const spawn = this.mode.pickSpawn(player, this.playerList);
      player.spawn(spawn);
      player.respawnAt = 0;
      this.send(player, S.RESPAWN, {
        pos: player.pos, yaw: player.yaw, hp: player.hp,
        weapon: player.weaponId, ammo: this.ammoFor(player)
      });
      return;
    }
    this.mapSwitch.pending.delete(player.id);
    if (this.mapSwitch.pending.size === 0) this.finishMapChange();
  }

  finishMapChange() {
    if (!this.mapSwitch) return;
    this.mapSwitch = null;
    this.mode.recentSpawns.length = 0;

    for (const p of this.players.values()) {
      const spawn = this.mode.pickSpawn(p, this.playerList);
      p.spawn(spawn);
      p.respawnAt = 0;
      this.send(p, S.RESPAWN, {
        pos: p.pos, yaw: p.yaw, hp: p.hp,
        weapon: p.weaponId, ammo: this.ammoFor(p)
      });
    }
    this.broadcastScores();
    console.log(`  * map change complete (${this.players.size} players respawned)`);
  }

  // ------------------------------------------------------------ combat

  handleFire(player, msg) {
    const now = Date.now();
    if (this.mode.state !== MATCH_STATE.LIVE) return;
    if (this.mapSwitch) return;   // world is being rebuilt; nobody can shoot

    const weaponId = typeof msg.wp === 'string' ? msg.wp : player.weaponId;
    const reason = player.canFire(weaponId, now);
    if (reason) {
      if (this.verbose && reason !== 'too-fast') console.log(`  shot rejected (${player.name}): ${reason}`);
      return;
    }
    const weapon = getWeapon(weaponId);

    const d = msg.d;
    if (!Array.isArray(d) || d.length !== 3) return;
    let [dx, dy, dz] = d;
    const dlen = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(dlen) || dlen < 1e-5) return;
    dx /= dlen; dy /= dlen; dz /= dlen;

    // Trust the muzzle position only if it is plausibly attached to the player.
    let ox = player.pos[0], oy = player.pos[1] + player.eyeHeight, oz = player.pos[2];
    if (Array.isArray(msg.o) && msg.o.length === 3 && msg.o.every(Number.isFinite)) {
      const dist = Math.hypot(msg.o[0] - ox, msg.o[1] - oy, msg.o[2] - oz);
      if (dist < 2.5) { ox = msg.o[0]; oy = msg.o[1]; oz = msg.o[2]; }
    }

    player.consumeShot(weaponId, now);

    // Everybody except the shooter gets the report, so they can hear the crack
    // and see the muzzle flash. The shooter renders their own shot locally.
    this.broadcast(S.SHOT_FIRED, {
      id: player.id,
      o: [r2(ox), r2(oy), r2(oz)],
      d: [r3(dx), r3(dy), r3(dz)],
      wp: weaponId
    }, player.id);

    this.resolveShot(player, weapon, ox, oy, oz, dx, dy, dz, now);
  }

  /**
   * Trace one bullet. Returns nothing to the shooter, by design.
   */
  resolveShot(shooter, weapon, ox, oy, oz, dx, dy, dz, now) {
    // How far the bullet can travel before the world stops it.
    let maxDist = WORLD.MAX_BULLET_RANGE;
    const worldHit = raycastWorld(ox, oy, oz, dx, dy, dz, maxDist);
    if (worldHit) maxDist = worldHit.dist;

    // Rewind everyone else to what the shooter saw.
    const rewindMs = Math.min(MAX_REWIND_MS, shooter.rtt * 0.5 + NET.INTERP_DELAY_MS);
    const rewindTime = now - rewindMs;

    let bestT = maxDist;
    let bestVictim = null;
    let bestZone = HITZONE.BODY;

    for (const other of this.players.values()) {
      if (other === shooter || !other.alive) continue;

      const p = other.getPositionAt(rewindTime);
      const height = p.crouch ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;
      const headScale = p.crouch ? PLAYER.CROUCH_HEIGHT / PLAYER.HEIGHT : 1;
      const headY = p.y + PLAYER.HEAD_CENTER * headScale;

      // Cheap reject: is the ray anywhere near this player at all?
      const toX = p.x - ox, toY = (p.y + height * 0.5) - oy, toZ = p.z - oz;
      const along = toX * dx + toY * dy + toZ * dz;
      if (along < -2 || along > bestT + 2) continue;
      const perpSq = (toX * toX + toY * toY + toZ * toZ) - along * along;
      if (perpSq > 4.0) continue;

      // Body capsule. The segment endpoints are inset by the capsule radius so the
      // rounded caps land at the feet and just under the chin -- otherwise the top
      // cap balloons over the head and every headshot registers as a body hit.
      const bodyBottom = p.y + PLAYER.RADIUS;
      const bodyTop = Math.max(bodyBottom, headY - PLAYER.HEAD_RADIUS - PLAYER.RADIUS);

      const tHead = raySphere(ox, oy, oz, dx, dy, dz, p.x, headY, p.z, PLAYER.HEAD_RADIUS, bestT);
      const tBody = rayCapsuleY(ox, oy, oz, dx, dy, dz, p.x, p.z, bodyBottom, bodyTop, PLAYER.RADIUS, bestT);

      // The head wins any tie: it sits inside the body's upper cap, so comparing
      // entry distances would quietly downgrade genuine headshots.
      let t = -1, zone = HITZONE.BODY;
      if (tHead >= 0) { t = tHead; zone = HITZONE.HEAD; }
      else if (tBody >= 0) {
        t = tBody;
        const hitY = oy + dy * t;
        zone = hitY < p.y + height * 0.42 ? HITZONE.LEG : HITZONE.BODY;
      }

      if (t >= 0 && t < bestT) {
        bestT = t;
        bestVictim = other;
        bestZone = zone;
      }
    }

    if (!bestVictim) return;

    const damage = damageAtRange(weapon, bestT) * zoneMultiplier(weapon, bestZone);
    this.applyDamage(bestVictim, shooter, damage, weapon, bestZone, bestT, [dx, dy, dz], oy + dy * bestT);
  }

  applyDamage(victim, attacker, amount, weapon, zone, distance, dir, hitY) {
    if (!victim.alive) return;
    victim.hp -= amount;
    victim.lastDamageAt = Date.now();
    victim.lastAttackerId = attacker ? attacker.id : 0;

    // A wound is a world event: everyone can see blood, nobody is told whose it is
    // or who caused it. This is the one concession to visible hit feedback, and it
    // carries no identities so it still cannot be turned into a hitmarker.
    this.broadcast(S.BLOOD, {
      p: [r2(victim.pos[0]), r2(hitY ?? victim.pos[1] + 1.1), r2(victim.pos[2])],
      d: dir ? [r3(dir[0]), r3(dir[1]), r3(dir[2])] : [0, 0, 1],
      a: Math.min(1, amount / 60),
      h: zone === HITZONE.HEAD ? 1 : 0
    });

    if (victim.hp > 0) return;

    this.killPlayer(victim, attacker, weapon, zone, distance, dir, hitY);
  }

  killPlayer(victim, attacker, weapon, zone, distance, dir, hitY) {
    const matchEnded = this.mode.onKill(attacker, victim);
    victim.respawnAt = Date.now() + MATCH.RESPAWN_MS;

    // --- the victim gets the full story ---
    this.send(victim, S.YOU_DIED, {
      by: attacker ? attacker.id : 0,
      byName: attacker ? attacker.name : 'The cold',
      weapon: weapon ? weapon.id : null,
      weaponName: weapon ? weapon.name : 'Environment',
      cause: attacker ? DEATH_CAUSE.GUNSHOT : DEATH_CAUSE.WORLD,
      dist: Math.round(distance * 10) / 10,
      killerHp: attacker ? Math.max(0, Math.round(attacker.hp)) : 0,
      killerKills: attacker ? attacker.kills : 0,
      killerPos: attacker ? [r2(attacker.pos[0]), r2(attacker.pos[1]), r2(attacker.pos[2])] : null,
      headshot: zone === HITZONE.HEAD,
      dir: dir ? [r3(dir[0]), r3(dir[1]), r3(dir[2])] : [0, 0, 1],
      hitY: r2(hitY ?? victim.pos[1] + 1),
      respawnAt: victim.respawnAt,
      respawnMs: MATCH.RESPAWN_MS
    });

    // --- everybody else only learns that a body dropped ---
    // No killer id, no victim-of-whom. Just enough to spawn a ragdoll.
    this.broadcast(S.PLAYER_DIED, {
      id: victim.id,
      dir: dir ? [r3(dir[0]), r3(dir[1]), r3(dir[2])] : [0, 0, 1],
      hitY: r2(hitY ?? victim.pos[1] + 1),
      headshot: zone === HITZONE.HEAD
    }, victim.id);

    this.broadcastScores();

    if (matchEnded) {
      this.endMatch(attacker);
    }
  }

  endMatch(winner) {
    this.resetAt = Date.now() + MATCH.POST_MATCH_MS;
    this.broadcast(S.MATCH_OVER, {
      winnerId: winner ? winner.id : 0,
      winnerName: winner ? winner.name : 'Nobody',
      list: this.scoreList(),
      resetIn: MATCH.POST_MATCH_MS
    });
    console.log(`  * MATCH OVER - ${winner ? winner.name : 'nobody'} wins with ${winner ? winner.kills : 0} kills`);
  }

  resetMatch() {
    this.mode.reset(this.playerList);
    this.resetAt = 0;
    this.mapSwitch = null;
    this.lastMapChangeAt = 0;
    this.broadcast(S.MATCH_RESET, { match: this.mode.serialize() });
    for (const p of this.players.values()) {
      const spawn = this.mode.pickSpawn(p, this.playerList);
      p.spawn(spawn);
      this.send(p, S.RESPAWN, {
        pos: p.pos,
        yaw: p.yaw,
        hp: p.hp,
        weapon: p.weaponId,
        ammo: this.ammoFor(p)
      });
    }
    this.broadcastScores();
    console.log('  * match reset');
  }

  // ------------------------------------------------------------ tick

  tick() {
    const now = Date.now();
    this.tickCount++;

    for (const p of this.players.values()) {
      p.updateReload(now);

      if (!this.mapSwitch && !p.alive && p.respawnAt && now >= p.respawnAt && this.mode.state === MATCH_STATE.LIVE) {
        const spawn = this.mode.pickSpawn(p, this.playerList);
        p.spawn(spawn);
        p.respawnAt = 0;
        this.send(p, S.RESPAWN, {
          pos: p.pos,
          yaw: p.yaw,
          hp: p.hp,
          weapon: p.weaponId,
          ammo: this.ammoFor(p)
        });
      }
    }

    if (this.resetAt && now >= this.resetAt) this.resetMatch();

    // A client that never reports back must not hold the whole server hostage.
    if (this.mapSwitch && now >= this.mapSwitch.deadline) this.finishMapChange();

    const snapshotInterval = 1000 / NET.SNAPSHOT_RATE;
    if (now - this.lastSnapshotAt >= snapshotInterval) {
      this.lastSnapshotAt = now;
      this.broadcastSnapshot(now);
    }

    // Scores refresh (ping column) every few seconds.
    if (this.tickCount % (NET.TICK_RATE * 3) === 0) this.broadcastScores();
  }

  ammoFor(player) {
    const state = player.ammo[player.weaponId];
    return state ? { mag: state.mag, reserve: state.reserve } : { mag: 0, reserve: 0 };
  }

  broadcastSnapshot(now) {
    if (this.players.size === 0) return;
    const all = this.playerList.map((p) => p.toSnapshot());

    for (const p of this.players.values()) {
      const others = all.filter((s) => s.i !== p.id);
      const state = p.ammo[p.weaponId];
      this.send(p, S.SNAPSHOT, {
        t: now,
        ps: others,
        self: {
          hp: Math.max(0, Math.round(p.hp)),
          alive: p.alive ? 1 : 0,
          mag: state ? state.mag : 0,
          reserve: state ? state.reserve : 0,
          reloading: state && state.pendingReload ? Math.max(0, state.reloadingUntil - now) : 0,
          respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - now)
        }
      });
    }
  }

  scoreList() {
    return this.playerList
      .map((p) => p.toScore())
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  broadcastScores() {
    this.broadcast(S.SCORES, { list: this.scoreList(), target: this.mode.killTarget });
  }

  // ------------------------------------------------------------ transport

  send(player, type, data) {
    if (!player || !player.conn) return;
    player.conn.send(encode(type, data));
  }

  broadcast(type, data, exceptId = 0) {
    const payload = encode(type, data);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      p.conn.send(payload);
    }
  }

  info() {
    return {
      map: mapDescriptor().name,
      mode: this.mode.name,
      state: this.mode.state,
      target: this.mode.killTarget,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      names: this.playerList.map((p) => p.name)
    };
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
