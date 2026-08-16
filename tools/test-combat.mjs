/**
 * Combat + hardcore-rules integration test.
 *
 * Drives the real GameServer through mock connections -- no sockets, no browser --
 * and asserts the things that actually define this game:
 *
 *   1. shots resolve against lag-compensated hitboxes
 *   2. the SHOOTER is told nothing at all about hits or kills
 *   3. the VICTIM gets the full report
 *   4. bystanders see a body drop, with no killer identity attached
 *   5. world geometry blocks bullets
 *   6. fire rate is enforced server-side
 *
 * Usage:  runtime\node\node.exe tools\test-combat.mjs
 */

import assert from 'node:assert';
import { GameServer } from '../server/core/GameServer.js';
import { C, S, encode } from '../shared/protocol.js';
import { PLAYER } from '../shared/config.js';
import { heightAt } from '../shared/maps/snowy_forest/terrain.js';
import { isBlocked } from '../shared/maps/snowy_forest/collision.js';
import { CABIN } from '../shared/maps/snowy_forest/cabin.js';

let passed = 0;
function ok(label) { passed++; console.log('  ok  ' + label); }

function mockConn(name) {
  const listeners = {};
  return {
    name,
    sent: [],
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    fire(ev, ...args) { (listeners[ev] || []).forEach((f) => f(...args)); },
    send(str) { this.sent.push(JSON.parse(str)); return true; },
    ping() {}, close() {},
    of(type) { return this.sent.filter((m) => m.m === type); },
    clear() { this.sent.length = 0; }
  };
}

function join(game, conn, name, primary = 'ak47') {
  game.handleConnection(conn);
  conn.fire('message', encode(C.JOIN, { name, primary }));
  const welcome = conn.of(S.WELCOME)[0];
  assert.ok(welcome, `${name} did not receive a welcome`);
  return game.players.get(welcome.id);
}

/** Put a player somewhere and backfill their rewind history so lag comp can see them. */
function place(player, x, z) {
  const y = heightAt(x, z);
  player.pos = [x, y, z];
  player.history.length = 0;
  const now = Date.now();
  for (let t = now - 700; t <= now; t += 50) {
    player.history.push({ t, x, y, z, yaw: player.yaw, crouch: false });
  }
}

/** Aim from shooter's eye at a point on the target, and fire. */
function shootAt(conn, shooter, target, aimY) {
  const ox = shooter.pos[0], oy = shooter.pos[1] + shooter.eyeHeight, oz = shooter.pos[2];
  const tx = target.pos[0], ty = target.pos[1] + aimY, tz = target.pos[2];
  let dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;
  conn.fire('message', encode(C.FIRE, { wp: shooter.weaponId, o: [ox, oy, oz], d: [dx, dy, dz] }));
  return len;
}

/** Find two spots with clear line of sight between them, out in the open. */
function findClearPair(distance) {
  for (let ring = 10; ring < 70; ring += 7) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const ax = Math.cos(a) * ring, az = Math.sin(a) * ring;
      const bx = ax + Math.cos(a + Math.PI / 2) * distance;
      const bz = az + Math.sin(a + Math.PI / 2) * distance;
      const ay = heightAt(ax, az) + PLAYER.EYE_HEIGHT;
      const by = heightAt(bx, bz) + 1.0;
      if (Math.hypot(bx, bz) > 85) continue;
      if (!isBlocked(ax, ay, az, bx, by, bz)) return [[ax, az], [bx, bz]];
    }
  }
  throw new Error('no clear firing lane found on this map');
}

// ============================================================ tests
function run() {
  const game = new GameServer({ verbose: false });

  const connA = mockConn('A');
  const connB = mockConn('B');
  const connC = mockConn('C');
  const alpha = join(game, connA, 'Alpha', 'ak47');
  const bravo = join(game, connB, 'Bravo', 'ak47');
  const charlie = join(game, connC, 'Charlie', 'm4a1');

  assert.strictEqual(game.players.size, 3);
  ok('three players joined');

  // Rewind uses rtt; zero it so the test is deterministic.
  for (const p of [alpha, bravo, charlie]) p.rtt = 0;

  const [spotA, spotB] = findClearPair(14);
  place(alpha, spotA[0], spotA[1]);
  place(bravo, spotB[0], spotB[1]);
  place(charlie, spotA[0] + 2, spotA[1] + 2);

  // ---------------------------------------------------------------- 1: hit
  connA.clear(); connB.clear(); connC.clear();
  shootAt(connA, alpha, bravo, 1.1);          // centre mass
  assert.ok(bravo.hp < PLAYER.MAX_HP, `expected Bravo to take damage, hp=${bravo.hp}`);
  assert.strictEqual(bravo.hp, PLAYER.MAX_HP - 55, 'AK body shot should do 55');
  ok(`body shot registered (Bravo at ${bravo.hp} hp)`);

  // ------------------------------------------------- 2: shooter learns nothing
  const shooterMessages = connA.sent.map((m) => m.m);
  assert.ok(!shooterMessages.includes(S.YOU_DIED), 'shooter must not get a death report');
  const leakedHit = connA.sent.some((m) =>
    JSON.stringify(m).toLowerCase().includes('hit') ||
    m.m === 'hitmarker' || m.m === 'damage' || m.m === 'kill');
  assert.ok(!leakedHit, 'shooter received something that looks like hit feedback: ' + JSON.stringify(connA.sent));
  ok('shooter received no hit feedback of any kind');

  // ---------------------------------------------------------------- 3: kill
  connA.clear(); connB.clear(); connC.clear();
  alpha.lastShotAt = 0;                       // bypass the rate limiter for the test
  shootAt(connA, alpha, bravo, 1.1);
  assert.strictEqual(bravo.alive, false, 'second AK body shot should be lethal');
  ok('two body shots kill (hardcore TTK)');

  // -------------------------------------------------- 4: victim gets the story
  const died = connB.of(S.YOU_DIED)[0];
  assert.ok(died, 'victim received no YOU_DIED');
  assert.strictEqual(died.byName, 'Alpha', 'victim should be told who killed them');
  assert.strictEqual(died.weaponName, 'AK-47', 'victim should be told the weapon');
  assert.ok(died.dist > 10 && died.dist < 20, `distance looks wrong: ${died.dist}`);
  assert.strictEqual(died.killerHp, 100, 'victim should see the killer remaining health');
  assert.ok(Array.isArray(died.dir), 'victim needs a hit direction for the ragdoll');
  ok(`victim told: killed by ${died.byName} / ${died.weaponName} / ${died.dist}m / ${died.killerHp}hp left`);

  // ------------------------------------------- 5: bystanders get no killer id
  const bodyDrop = connC.of(S.PLAYER_DIED)[0];
  assert.ok(bodyDrop, 'bystander should see the body drop');
  assert.strictEqual(bodyDrop.id, bravo.id, 'body drop should identify the corpse');
  assert.strictEqual(bodyDrop.by, undefined, 'body drop must not name the killer');
  assert.ok(!('byName' in bodyDrop), 'body drop must not name the killer');
  ok('bystanders see a body with no killer identity');

  // the killer gets the same anonymous message everyone else does
  const killerView = connA.of(S.PLAYER_DIED)[0];
  assert.ok(killerView, 'killer should still see the ragdoll');
  assert.strictEqual(killerView.by, undefined, 'killer must not be told it was their kill');
  ok('killer sees only an anonymous body drop');

  // ------------------------------------------------------------ 6: scoring
  assert.strictEqual(alpha.kills, 1, 'killer should be credited');
  assert.strictEqual(bravo.deaths, 1, 'victim should be charged a death');
  const scores = connA.of(S.SCORES).pop();
  assert.ok(scores && scores.list.find((p) => p.name === 'Alpha').kills === 1);
  ok('scoreboard updated (only place a kill is ever shown)');

  // ------------------------------------------------------------ 7: headshot
  bravo.spawn({ x: spotB[0], y: heightAt(spotB[0], spotB[1]), z: spotB[1], yaw: 0 });
  place(bravo, spotB[0], spotB[1]);
  bravo.hp = PLAYER.MAX_HP;
  alpha.lastShotAt = 0;
  connB.clear();
  shootAt(connA, alpha, bravo, PLAYER.HEAD_CENTER);
  assert.strictEqual(bravo.alive, false, 'AK headshot should be a one-shot kill');
  assert.strictEqual(connB.of(S.YOU_DIED)[0].headshot, true, 'victim should be told it was a headshot');
  ok('headshot is lethal and reported to the victim');

  // ------------------------------------------------------- 8: walls stop rounds
  // Put the shooter outside the cabin and the target inside it, through a wall.
  const insideX = CABIN.x, insideZ = CABIN.z;
  const outsideX = CABIN.x, outsideZ = CABIN.z - 14;
  bravo.spawn({ x: insideX, y: CABIN.floorY, z: insideZ, yaw: 0 });
  place(bravo, insideX, insideZ);
  bravo.pos[1] = CABIN.floorY;
  for (const h of bravo.history) h.y = CABIN.floorY;
  bravo.hp = PLAYER.MAX_HP;
  place(alpha, outsideX, outsideZ);
  alpha.lastShotAt = 0;

  // aim at the low band of the wall, which is solid
  shootAt(connA, alpha, bravo, 0.5);
  assert.strictEqual(bravo.hp, PLAYER.MAX_HP,
    `cabin wall should have stopped the round, but Bravo took ${PLAYER.MAX_HP - bravo.hp} damage`);
  ok('cabin wall blocks bullets');

  // ...but the window band is a real hole, so a round through it connects
  alpha.lastShotAt = 0;
  const sillY = CABIN.floorY + (CABIN.sillLow + CABIN.sillHigh) / 2 - bravo.pos[1];
  shootAt(connA, alpha, bravo, sillY);
  assert.ok(bravo.hp < PLAYER.MAX_HP, 'a round through the window opening should connect');
  ok('window opening is genuinely shootable');

  // ------------------------------------------------------- 9: fire rate cap
  bravo.spawn({ x: spotB[0], y: heightAt(spotB[0], spotB[1]), z: spotB[1], yaw: 0 });
  place(bravo, spotB[0], spotB[1]);
  place(alpha, spotA[0], spotA[1]);
  bravo.hp = PLAYER.MAX_HP;
  alpha.lastShotAt = 0;
  alpha.ammo.ak47.mag = 30;

  shootAt(connA, alpha, bravo, 1.1);
  const hpAfterFirst = bravo.hp;
  for (let i = 0; i < 8; i++) shootAt(connA, alpha, bravo, 1.1);   // spam with no delay
  assert.strictEqual(bravo.hp, hpAfterFirst, 'rapid-fire spam should be rejected by the server');
  ok('server rejects shots faster than the weapon can cycle');

  // ------------------------------------------------------- 10: match target
  assert.strictEqual(game.mode.killTarget, 100, 'FFA should be first to 100');
  ok('game mode is Free For All to 100 kills');

  // -------------------------------------------- 11: loadout swap on respawn
  connB.clear();
  connB.fire('message', encode(C.LOADOUT, { primary: 'm700' }));
  assert.strictEqual(bravo.pendingPrimary, 'm700', 'loadout request should be queued');
  assert.strictEqual(bravo.primary, 'ak47', 'loadout must not change mid-life');
  ok('loadout change queues for the next life, not this one');

  bravo.spawn(game.mode.pickSpawn(bravo, game.playerList));
  assert.strictEqual(bravo.primary, 'm700', 'respawn should apply the queued primary');
  assert.strictEqual(bravo.weaponId, 'm700');
  assert.strictEqual(bravo.ammo.m700.mag, 5, 'new weapon should spawn with a full magazine');
  ok('queued loadout applies on respawn with correct ammo');

  // The respawn message must carry the weapon so the client can follow along,
  // otherwise it keeps the old rifle and every shot is rejected as 'wrong-weapon'.
  game.send(bravo, S.RESPAWN, {
    pos: bravo.pos, yaw: bravo.yaw, hp: bravo.hp,
    weapon: bravo.weaponId, ammo: game.ammoFor(bravo)
  });
  const respawnMsg = connB.of(S.RESPAWN).pop();
  assert.ok(respawnMsg, 'no respawn message sent');
  assert.strictEqual(respawnMsg.weapon, 'm700', 'respawn must tell the client what it is holding');
  ok('respawn message carries the active weapon');

  // -------------------------------------------------- 12: name sanitising
  const connD = mockConn('D');
  const evil = join(game, connD, '<img src=x onerror=alert(1)>', 'ak47');
  assert.ok(!evil.name.includes('<') && !evil.name.includes('>'), 'angle brackets must be stripped');
  assert.ok(evil.name.length <= 16, 'names must be length limited');
  ok(`hostile callsign sanitised to "${evil.name}"`);

  const connE = mockConn('E');
  const dupe = join(game, connE, 'Alpha', 'ak47');
  assert.notStrictEqual(dupe.name, 'Alpha', 'duplicate names must be disambiguated');
  ok(`duplicate callsign became "${dupe.name}"`);

  game.stop();
  console.log(`\n${passed} checks passed.`);
}

try {
  run();
} catch (err) {
  console.error('\nFAILED:', err.message);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}
