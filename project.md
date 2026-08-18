# WHITEOUT — project reference

A hardcore multiplayer FPS that runs entirely in the browser. One person starts the
server; everyone else joins by typing an IP and port into Chrome. No installs, no
accounts, no internet connection required.

**The whole project is portable.** Node is bundled inside the folder and there are
zero npm dependencies. Zip it, copy it to a machine with nothing installed, unzip,
double-click `start.bat`.

---

## 1. Quick start

### Hosting

```bash
start.bat
```

That's it. The console prints the addresses other people should open:

```
  On this computer:
      http://localhost:8080

  Other players on your network open one of these in Chrome:
      http://192.168.1.136:8080       (Ethernet)
```

### Joining

Open `http://<host-ip>:8080` in Chrome (or Edge/Firefox). Type a callsign, pick a
primary weapon, hit **DEPLOY**.

### Options

```bash
start.bat --port 9000          # different port
start.bat --kill-target 50     # shorter match
start.bat --max-players 8      # smaller lobby
start.bat --verbose            # log rejected shots and static requests
```

Defaults live in [`server/config/server.config.js`](server/config/server.config.js).

### If other machines can't connect

The server is listening on every interface, so it is almost always Windows Firewall.
The first time you run it, Windows asks whether to allow Node — say yes, and tick
**Private networks**. If you dismissed that prompt, allow it manually:

```bash
netsh advfirewall firewall add rule name="Whiteout" dir=in action=allow protocol=TCP localport=8080
```

Everyone must be on the same network (same Wi-Fi/LAN). Playing over the internet
needs port forwarding, which is out of scope here.

---

## 2. What "hardcore" means here

This is the design centre of the whole project, and it is enforced at the protocol
level rather than by politely not drawing things.

| While you are alive | What the game tells you |
|---|---|
| You hit someone | **Blood, in the world.** No hitmarker, no sound, no numbers. |
| You killed someone | **Nothing.** No notification, no kill feed, no score popup. |
| Someone died nearby | You see a body drop. Not who dropped it. |
| You take damage | Red vignette + directional arc + your health bar. |
| You die | Everything: who, what weapon, from how far, and how much health they had left. |

Two shots from a rifle kill. Every rifle headshot kills. The M700 kills with one
round anywhere it lands. You will lose fights you thought you were winning.

Blood is the one deliberate exception, and it is a **world** effect rather than a UI
one: it appears on the victim, visible to everyone including bystanders, exactly
like a real wound. The `blood` message carries a position and a direction and no
identities whatsoever, so it still cannot become a hitmarker or a kill
confirmation. You can see that somebody is bleeding. You still cannot tell whether
they are about to drop.

**How it's enforced:** [`shared/protocol.js`](shared/protocol.js) contains no
"you hit" or "you killed" message at all. The server's `resolveShot()` returns
nothing to the shooter. `S_PLAYER_DIED` — the message everyone else receives —
carries the corpse's id and a hit direction for the ragdoll, and no killer identity.
The only detailed death report in the entire protocol is `S_YOU_DIED`, sent to
exactly one person: the player who just died.

A modified client cannot draw a hitmarker, because the information required to draw
one never crosses the wire. `tools/test-combat.mjs` asserts this.

---

## 3. Project layout

```
html5game/
├── start.bat                  ← host the game (Windows)
├── start.sh                   ← host the game (macOS/Linux, needs system Node)
├── package.json               ← zero dependencies, on purpose
├── project.md                 ← this file
├── runtime/
│   └── node/                  ← bundled Node 22 + npm. This is what makes it portable.
├── assets/
│   ├── ak.glb                 ← AK-47 model
│   └── m4.glb                 ← M4A1 model, 18 separately named parts
│
├── server/                    ← authoritative game server (Node)
│   ├── index.js                 entry point, HTTP + WebSocket + LAN address printout
│   ├── config/
│   │   └── server.config.js     port, player cap, kill target, CLI overrides
│   ├── core/
│   │   ├── GameServer.js        message routing, hit registration, hardcore rules
│   │   └── Player.js            per-player state + lag-compensation history buffer
│   ├── gamemodes/
│   │   └── FreeForAll.js        scoring, win condition, spawn selection
│   └── net/
│       ├── websocket.js         hand-rolled RFC 6455 server (no `ws` dependency)
│       └── static.js            static file serving, gzip, path whitelist
│
├── shared/                    ← imported by BOTH server and browser
│   ├── config.js                physics, timings, match rules
│   ├── weapons.js               the weapon table (single source of truth)
│   ├── protocol.js              message types + name sanitising
│   ├── math/
│   │   ├── num.js               seeded RNG, value noise, fbm, lerp/damp
│   │   └── trace.js             ray vs box / sphere / cylinder / capsule
│   └── maps/
│       ├── index.js             map registry + /map name aliases
│       ├── active.js            THE ACTIVE MAP — everything routes through here
│       ├── kinds.js             surface kinds (drives impact effects)
│       ├── ColliderWorld.js     shared capsule solver + ray tracing
│       ├── snowy_forest/
│       │   ├── index.js         map bundle
│       │   ├── terrain.js       analytic heightfield  ← ground truth for "where is the ground"
│       │   ├── props.js         deterministic tree/rock/log scatter + spawn candidates
│       │   ├── cabin.js         cabin geometry as collision boxes
│       │   └── collision.js     collider list + validated spawn points
│       ├── grassy_plains/
│       │   ├── index.js         map bundle
│       │   ├── terrain.js       gentle heightfield + levelled hut and cave pads
│       │   ├── props.js         trees, hedgerow, haystacks, sheep herds
│       │   ├── huts.js          two enterable huts as collision boxes
│       │   ├── cave.js          rock chamber with a single mouth
│       │   └── collision.js     collider list + validated spawn points
│       └── iss/
│           ├── index.js         map bundle + zero-g movement profile
│           ├── terrain.js       the ABSENCE of terrain, stated explicitly
│           ├── station.js       every part of the station, as data. one list.
│           ├── asteroids.js     the rocks, likewise. some with holes through them.
│           └── collision.js     collider list + validated spawn points
│
├── client/                    ← everything the browser loads
│   ├── index.html
│   ├── vendor/three.module.js   Three.js r160, vendored (never a CDN)
│   ├── styles/                  main.css, menu.css, hud.css
│   └── js/
│       ├── main.js              boot: build world → ask for callsign → connect
│       ├── assets/AKModelData.js  AK GLB inlined as base64, so it loads offline
│       ├── core/
│       │   ├── Game.js          the orchestrator and the frame loop
│       │   ├── Input.js         pointer lock, keys, mouse
│       │   ├── Settings.js      quality tiers, sensitivity, persistence
│       │   ├── three.js         single import point for Three
│       │   ├── GLBParser.js     minimal glTF-binary reader (no loader library)
│       │   └── GeoUtils.js      geometry merge / vertex colouring
│       ├── net/NetClient.js     WebSocket + server clock estimation
│       ├── player/
│       │   ├── LocalPlayer.js   movement, collision, camera, recoil, bob
│       │   ├── RemotePlayer.js  snapshot interpolation, nameplates
│       │   └── Ragdoll.js       verlet ragdoll + corpse manager
│       ├── characters/
│       │   ├── Soldier.js       the procedural soldier rig
│       │   ├── CamoTexture.js   winter camo painted onto a canvas at runtime
│       │   └── Animator.js      procedural walk/aim/crouch/sprint poses
│       ├── weapons/
│       │   ├── WeaponModels.js  AK/M4 from GLB, Glock/M700 from primitives,
│       │   │                    plus the M4's part-driven reload choreography
│       │   ├── ViewModel.js     first-person placement, ADS, recoil, reload
│       │   ├── WeaponController.js  firing, ammo, spread, switching
│       │   └── Scope.js         true magnified optic for the M700
│       ├── maps/
│       │   ├── MapRegistry.js
│       │   ├── snowy_forest/
│       │   │   ├── SnowyForestMap.js   scene assembly
│       │   │   ├── TerrainMesh.js      heightfield → mesh, snow/rock painting
│       │   │   ├── Foliage.js          instanced forest
│       │   │   ├── CabinMesh.js        log cabin built from the collision boxes
│       │   │   └── Sky.js              sky dome + light rig
│       │   ├── grassy_plains/
│       │   │   ├── GrassyPlainsMap.js  scene assembly
│       │   │   ├── TerrainMesh.js      green terrain painting
│       │   │   ├── GrassField.js       instanced wind-swayed grass
│       │   │   ├── HutMesh.js          huts built from the collision boxes
│       │   │   ├── CaveMesh.js         cave rock, clamped inside its collider
│       │   │   ├── Props.js            trees, hedge, haystacks, carts
│       │   │   ├── Sheep.js            wandering flocks
│       │   │   └── Sky.js              summer sky + drifting clouds
│       │   └── iss/
│       │       ├── ISSMap.js           scene assembly
│       │       ├── StationMesh.js      station drawn from the shared parts list
│       │       ├── Asteroids.js        rocks drawn from the shared parts list
│       │       ├── SunGlare.js         full-screen glare, occluded by the station
│       │       └── Sky.js              starfield, sun, Earth, light rig, cabin lamps
│       ├── effects/
│       │   ├── Snowfall.js      GPU snow, camera-tiled
│       │   ├── WindMotes.js     wind streak lines + motes, camera-tiled
│       │   ├── Blood.js         hit mist, bleed trails, death pools
│       │   └── Impacts.js       tracers, muzzle flash, debris, brass
│       ├── audio/AudioEngine.js procedural gunshots, footsteps, wind (no audio files)
│       └── ui/
│           ├── JoinScreen.js    callsign + weapon select
│           ├── HUD.js           health, ammo, crosshair, damage feedback
│           ├── Scoreboard.js    TAB and respawn scoreboard
│           └── DeathScreen.js   death report + respawn timer + match over
│
└── tools/
    ├── test-all.mjs            run every server-side suite
    ├── check.mjs               syntax-check every source file
    ├── test-handshake.mjs      WebSocket RFC 6455 conformance
    ├── test-maps.mjs           invisible-wall / spawn / boundary integrity
    ├── test-combat.mjs         combat, hardcore rules, map switching
    └── browser-check.js        paste-into-console client smoke test
```

---

## 4. Architecture

### The client/server split

Movement is **client-authoritative**; combat is **server-authoritative**.

- The client simulates its own movement and reports where it is. That makes movement
  perfectly responsive, which matters far more for feel than the trust it costs on a
  LAN. The server clamps physically impossible motion instead of rubber-banding.
- Health, ammo, fire rate, hit registration and scoring are all decided by the
  server. The client never tells the server "I hit someone" — it only says
  "I fired, from here, in this direction."

### Shared map code is the reason this works

`shared/maps/snowy_forest/` is imported by both sides. The terrain is a pure
analytic function of `(x, z)`, and the props are generated from a seed with a
deterministic RNG. So:

- The client tessellates the heightfield into a mesh; the server calls `heightAt()`.
- The client builds cabin meshes from the same boxes the server uses for collision.
- Nobody transfers a map file, and nobody can disagree about where a wall is.

A practical consequence: the cabin's window openings are genuine gaps in the
collision box list, so bullets pass through them and players don't — with no
special-case code anywhere.

### Netcode

| | |
|---|---|
| Transport | WebSocket, JSON messages |
| Server tick | 60 Hz |
| Snapshots | 20 Hz |
| Client input | 60 Hz |
| Interpolation delay | 110 ms |
| Lag compensation | RTT/2 + interpolation delay, capped at 320 ms |

Remote players are rendered ~110 ms in the past and interpolated between the two
snapshots bracketing that time. When you fire, the server rewinds every other player
to where *your* screen showed them and traces against that — so shooting where you
saw someone actually connects.

The client tracks the server clock from pong round-trips and uses the median of the
last nine samples, which survives a single delayed packet.

### Hitboxes

A head sphere (r 0.17 m, centred 1.63 m up) sitting on a body capsule (r 0.35 m).
The capsule's segment endpoints are inset by its own radius so the rounded top cap
stops under the chin rather than ballooning over the head — without that inset the
cap swallows the head sphere and every headshot silently registers as a body hit.
The head also wins any tie, since it sits inside the body's upper cap.

---

## 5. The maps

Three maps ship, and the whole server can move between them at runtime. Anyone can
type it in chat:

```
/map snow      →  Whiteout Ridge
/map grass     →  Hollowmere
/map iss       →  Orbital   (also /map space, /map station, /map orbit)
/maps          →  list them
/help          →  list commands
```

The server flips its active map — which instantly changes collision, spawns and
bullet tracing — tells every client to rebuild, suspends combat until they report
back, then respawns everybody. A 15-second cooldown stops map-vote spam, and a
client that fails to load can never stall the server: after 20 seconds play resumes
without it. Joining a server that is already on the other map works the same way —
the welcome message names the map and the client rebuilds before you spawn.

### About invisible walls

The ground maps are checked by [`tools/test-maps.mjs`](tools/test-maps.mjs), which exists
because an oversized collider is indistinguishable, in play, from an invisible wall
and is miserable to find by hand. It samples ~9,000 points of open ground per map,
pushes a player capsule through the real solver, and every time the solver moves the
player sideways it proves there is a real collider close enough to justify it. It
then walks a sprinting player at the edge of the world in 72 directions and asserts
that geometry — a hedge, a trunk, a slope too steep to stand on — stops them well
before the numeric clamp.

That test found two genuine bugs: the snowy map's mountains were too gentle to
trigger sliding, so a sprinting player could walk up them into the hard clamp; and
spawn points were only checked against the heightfield, so a few sat inside rocks.
Both are fixed, and spawns are now filtered through the collision solver itself.

A map with no ground fails every assumption in that suite, so the ISS gets its own
one — see [§5.3](#orbital--the-iss) and [§13](#13-testing).

### Whiteout Ridge — snowy forest

A frozen pine basin ringed by impassable mountains, roughly 185 m across.

- **Terrain** — layered fbm noise, three interior hills, a frozen creek bed, and a
  ridged mountain ring that climbs hard past 76 m from the centre. You can't climb
  the mountains because they're genuinely too steep: above a slope threshold the
  snow gives way and you slide back down. There is no invisible wall.
- **Forest** — 430 trees in four variants (tall pine, pine, fir, dead), scattered by
  seeded rejection sampling that avoids steep ground and the cabin clearing, and
  thins toward the middle of the bowl so there are firing lanes. Drawn as a handful
  of `InstancedMesh` draw calls. Trunks block bullets; foliage doesn't.
- **The cabin** — a log cabin on a raised foundation with a porch, a stone chimney,
  a gable roof and four window openings. Walls are drawn by filling the collision
  boxes with stacked logs, so cover and geometry always agree.
- **Weather** — ~7,900 GPU snow particles in two layers. All motion happens in the
  vertex shader, and the particle box is re-tiled around the camera each frame, so
  flakes look world-locked while you run through them with no CPU cost.
- **Lighting** — low winter sun, hemisphere bounce off the snow, exponential fog,
  and a shadow frustum that follows the player.

Spawns: 32 candidate points; the server picks the one furthest from any living
enemy, penalising recently used spawns.

---

### Hollowmere — grassy plains

Wide open plains: rolling grassland, two thatched huts, haystacks, hedgerows, sheep,
and a rock cave at the centre. Deliberately gentle underfoot — nothing here is steep
enough to slide on, and there is very little between you and the horizon.

**The cave** sits in the middle of the map with exactly one entrance, on its south
side. It is built as a rock chamber standing ON the terrain rather than carved INTO
it — that is forced by the collision model, since the heightfield always pushes a
player up out of the ground, so there is no legitimate way to be below it. Standing
the chamber on levelled ground gives a real floor and 3.6 m of headroom for free,
and a skin of boulders hides the fact that it is a mound rather than a hole. Every
one of those boulders is clamped inside the collision volume: rock drawn outside its
collider is the inverse of an invisible wall, and just as bad.

- **Grass** — 38,000 instanced tufts (roughly 1.4 per square metre around you) with
  the wind baked into the vertex shader via `onBeforeCompile`, so the blades still
  receive the scene's lighting, fog and shadows. Two details make the wind *readable*
  rather than a generic wobble: a constant lean downwind, and a phase that advances
  along the wind vector, so gusts travel across the field as visible waves instead of
  every blade moving in unison. Distant blades shrink into the painted ground rather
  than popping out.
- **Wind** — long flowing streak lines in the air, Ghost of Tsushima style: instanced
  ribbons stretched along the wind vector and rolled to face the camera, fading in
  and out on their own gust cycles. Streaks seen end-on are hidden rather than drawn
  as smears. Dust motes ride along for grain. The same wind vector drives the grass
  and the drifting clouds, so everything agrees about which way it is blowing.
- **No fences.** They were removed: thin axis-aligned rails made contact feel
  unreliable, and an open plain is the point of the map.
- **Sheep** — five flocks that graze, amble around their anchor, and scatter when a
  gun goes off near them. Ambient only: no collider, no hitbox, no network traffic.
  Each client simulates its own flock, which nobody notices.
- **Huts** — two of them, both enterable. Mud-brick walls under a thatched hip roof,
  drawn by filling the same boxes the collider uses, with shootable window bands like
  the cabin. Doorways are cut to 2.25 m: the window band tops out at 1.85 m, and
  walking a 1.80 m player through a 5 cm gap works on paper and feels terrible.
- **The boundary is a hedgerow** — not an invisible wall, and not a slope you slide
  off. It is a ring of overlapping cylinders drawn as a thick hedge; the gaps
  between them are narrower than a player, so it is solid because of its geometry.

### Orbital — the ISS

The station, 400 km up. No floor, no ceiling, and no up unless you decide there is
one. Roughly 110 m of truss across, 55 m of pressurised stack fore to aft.

**Flying.** `MAP_INFO.movement.mode` is `'zerog'`, and `LocalPlayer` reads that off
the active map every frame — so nothing in the controller knows this map exists, it
just stops applying gravity when the map says there is none. W and S still mean
forward and back; they follow where you are looking rather than the ground. A and D
strafe, space and crouch translate along your own up axis, shift is a boost. **Q and
E are the side thrusters**, and the bank they put in *stays where you leave it* —
there is no horizon to level against and nothing to level you, so holding E for two
seconds leaves you flying upside down and staying there.

Velocity approaches the commanded speed exponentially rather than being set outright
(thrusters have a spool-up) and coasts back down on a much slower constant, so
letting go leaves you drifting instead of stopping dead.

Three details that are easy to get wrong:

- **The sign of the roll is not the one you would guess.** The camera looks down its
  own −Z, so a *positive* rotation about that axis turns the image clockwise and
  drops the right-hand side of the horizon — which is what banking **left** looks
  like from inside. `E` therefore feeds a NEGATIVE roll. Written the obvious way
  round, both keys do the opposite of what they say, which is exactly how they
  shipped the first time.
- **Banked over, the mouse has to be rotated too.** Yaw is a world-Y rotation, so at
  180° of bank a right-hand mouse move turns you left on screen. `look()` rotates the
  incoming delta by the bank angle, which keeps "mouse right" meaning right as you
  see it. Without it, flying inverted does not feel inverted, it feels broken.
- **The movement hull is a tuck, not a stance.** A player standing to attention is
  1.8 m of rigid capsule that cannot duck, and threading that through a 4 m hatch
  means either building corridors nobody would mistake for the ISS or wedging people
  in the doorways. In zero-g the movement capsule is `PLAYER.FLIGHT_HEIGHT` (0.92 m)
  by `FLIGHT_RADIUS` (0.40 m). Shots are still traced against the full-size capsule
  and head sphere, so nothing about aiming or hit registration changes.

**Everybody is an astronaut.** `MAP_INFO.characters` is `'astronaut'`, which swaps
the soldier rig's materials and the hardware bolted to it — white EMU, gold sun
visor, PLSS backpack, joint bearings, red commander stripes — and changes nothing
else. Same bones, same proportions, same limb origins, so the animator and the
ragdoll solver never learn there are two kinds of person in this game. Remote players
hang off their midriff rather than their feet in free fall and carry pitch and bank
with them, so somebody flying head-first down a module looks like it.

**Bodies tumble.** `environment.gravityScale` is 0, which the ragdoll solver, the
impact debris and the blood all read. A round into the hull throws a spray of bright
metal that travels dead straight until it is out of sight, and a body you shoot
inherits the motion its owner had, spins, and drifts away.

Four separate things had to change for that last part, because the solver was built
for corpses that land and stay landed:

- **Damping** goes from 0.986 per step to 0.9995. Air is what slows a tumbling body
  and there is none; at the ground value a corpse loses more than half its speed
  every second and stops looking like it is in orbit almost immediately. A slow
  separate bleed (6%/s) is kept so a body settles into a gentle drift after half a
  minute rather than leaving the map.
- **Sleeping is off.** Bodies sleep when they come to rest on something. Nothing out
  here ever does, so a body allowed to fall asleep just freezes in mid-air — the
  exact opposite of floating.
- **Ground friction is off**, so brushing the hull deflects a body instead of
  grabbing it.
- **Spin is seeded explicitly.** Verlet has no angular velocity to set, so the
  rotation goes straight into the particle velocities as *v = ω × r* about the body's
  middle, and the distance constraints carry it from there. The axis comes from
  where the round landed — torque is lever × force — so a square hit on the chest
  barely turns anybody and a head shot sends them end over end. A body that
  translates without rotating reads instantly as a prop being slid along a table.

The corpse also inherits its owner's velocity now, which `RemotePlayer` measures
from its own rendered motion. That was previously hardcoded to zero for everyone but
the local player.

#### The station is one list

Every single thing you can see on this map is one entry in
[`shared/maps/iss/station.js`](shared/maps/iss/station.js), and every entry is a
collider. There is no second list. That is a direct response to how the plains map
grew fences that were drawn from one table and collided from another and drifted
apart into scenery hanging in mid-air. Here the renderer walks the same array, so a
part cannot be drawn somewhere it does not exist.

Decoration is allowed on one condition: it must sit **inside** the collision volume
it belongs to. Truss bracing, cupola window mullions and interior panelling are all
drawn inside solids a player can never reach, so they can be angled and crossed as
much as they like. The only things that break the surface are handrails, hull ribs
and the avionics boxes, none by more than 15 cm — the price of the station looking
like the ISS instead of like plumbing. `tools/browser-check.js` fires several hundred
rays at the station from every side and asserts the drawn surface and the collision
surface agree; it reports the worst overhang, currently 0.15 m.

#### A module is a tube, because a module is a tube

The shared collider grew a fourth primitive for this map: an axis-aligned **tube**, a
finite cylinder with a bore down the middle (`rIn = 0` degenerates to a solid
cylinder — bulkhead discs, masts, struts). It is worth the code because a station
module genuinely is that shape, so the hull is exactly where it is drawn rather than
approximated by boxes. Boxes were the alternative and they are much worse than they
sound: an AABB round a 5 m cylinder overshoots by 87 cm at the corners, and that gap
*is* an invisible wall.

Capsule-vs-tube has one non-obvious rule. Which surface applies depends on which side
of the wall you are on: the **outer** skin has to clear the *nearest* point of the
capsule, while the bore has to contain its *farthest*. Getting that backwards makes a
player standing in a horizontal module rise gently through the ceiling, because the
middle of a capsule is always the closest bit to the axis.

#### Nodes, and why they are six rings

A hollow shape has to come from the shape of each piece, because a solid is a *union*
of primitives and a union cannot have a hole punched in it. So a node — Unity,
Harmony, Tranquility — is six berthing collars meeting at a hub with nothing in the
middle, plus eight corner blocks.

The corner blocks are not decoration. Six rings alone technically close the hub, but
only just: along the (1,1,1) diagonal the wall they form is a couple of hundred
millimetres thick, and a body wedged in that corner is being pushed by three rings at
once, each of which resolves it somewhere the other two disagree with — the result is
a player fired out through the corner at speed. That is not a hypothetical: the first
version leaked on 51 of 13,200 test flights, all of them in the same corner
directions. The blocks make the corner a metre and a half of plain box, which resolves
unambiguously, and they cannot foul a hatch because a block needs 1.60 m of clearance
on all three axes at once, so the nearest it comes to a port axis is 2.26 m against a
2.05 m bore.

#### The doors are real

Three ways in, and the whole pressurised stack is a clear sight line end to end:

- **forward**, through PMA-2 on Harmony's nose
- **aft**, out the back of Zvezda
- **the Quest airlock**, off Unity's starboard port, with its outer hatch swung back
  and parked well clear of its own doorway

Fly in the front and you can fly 55 m and out the back. Shoot down it and the round
goes the same way. `tools/test-maps.mjs` proves both halves of this: it builds a
second copy of the station with the three doorways *plugged* and demands that
absolutely nothing escapes it in 14,400 flights from 12 compartments, then flies
through each doorway on the real map to prove it is open. Plugging the doors matters
— without it a genuine hull leak can hide behind "well, it probably went out of a
hatch".

#### The rocks

A field of seventeen asteroids sits round the station, above and below it and off
both ends -- the open volumes a fight actually crosses, and the ones that had
nothing to hide behind. Six of them have a hole bored straight through that you can
fly down, which is the tube primitive again: a rock with a tunnel in it is exactly
the shape the collider already had a name for.

Three things they are not allowed to do, all of them enforced:

- **Foul the station or a flight lane.** Placement is rejection-sampled against the
  station's own volume plus 7 m, and against two lanes: the length of the
  pressurised stack, and straight out of the Quest airlock.
- **Half-close their own tunnel.** The lumps hung on a holed rock for silhouette
  are kept at least their own radius clear of the bore, so no lump can reach into
  the hole. `tools/test-maps.mjs` flies a player through all six to prove it.
- **Be drawn anywhere they are not.** The vertex displacement is only ±2.2% of the
  radius. It is tempting to gnarl a rock far harder, and the moment you do, half its
  surface is drawn outside its collider (visible rock you shoot straight through)
  and the other half inside (bullets stopping in mid-air short of it). The bores are
  not displaced at all: a tunnel you fly down has to be exactly the tunnel the
  collider thinks it is.

A holed rock is four collinear tube segments of different girth rather than one
barrel, because a constant-radius tube reads as a length of pipe no matter what you
stick to it. Each step is still exactly one collider, and the rings that bridge them
are drawn only where the step is actually exposed -- otherwise every joint draws two
coincident rings and z-fights with itself.

The rocks are deliberately NOT attached to anything, which is why the station's
"nothing floats" test is scoped to the station. Debris in orbit floats; that is what
it is for.

#### The sky

Stars, one white sun and Earth are all drawn in the dome shader rather than as
objects, because anything real would have to sit somewhere and a 6,000 km planet
placed 90 m away is a thing you can fly into. Painted on the dome they stay where
they belong — infinitely far — however far across the map you thrust.

The starfield is four layers of cell-hashed points with spectral tinting, thickening
along a tilted Milky Way with its own dust lanes. Earth gets a real terminator
computed from the surface normal, procedural continents and coastal shelf water, a
drifting cloud deck, city lights on the night side and a blue atmospheric limb. Three
bugs were worth the debugging:

- The surface normal was inverted, which lit the far side of the planet and left the
  face you were looking at in darkness.
- The ice caps used world Y for latitude — and since Earth hangs directly below the
  station, that meant staring straight down at a polar cap the size of the visible
  disc. The planet has its own tilted axis now.
- The normal barely turns per pixel at the middle of the disc and swings hard at the
  limb, so features sized sensibly at the edge get magnified enormously in the
  centre. All the surface frequencies are higher than they look like they need to be
  for exactly that reason.

Lighting is one hard white sun with shadows, plus a broad blue bounce from below,
which is genuinely where the fill light comes from up here — vacuum shadows go to
absolute black, which is truthful and unplayable. Metalness is deliberately held
around 0.4 on every metal in the scene: a metalness of 1 has no diffuse response at
all, and with no environment map to reflect, every ring, strut and gimbal renders as
a black silhouette.

Inside is lit by real lamps, one per compartment, taken from the layout's own list of
compartment centres so a module cannot be added later and left dark. The panels also
carry a dim self-illumination, because a strip light is emissive but does not *light*
anything, and a module lit only that way is a black tube with four glowing lines in
it.

**Sun glare.** Looking anywhere near the sun blooms, throws a six-point starburst
and a chain of lens ghosts down the line through the middle of the screen, and lifts
the whole frame with veiling glare -- which is the part that actually costs you your
target. It builds as you turn into it rather than switching on.

It is drawn as one full-screen additive quad, not through a post-processing chain,
because this project has no post chain and adding one for a single effect would cost
every frame on every map. Its vertex shader writes clip space directly, which is
also why it has to be kept out of the scope's second pass: through a 13 degree lens
the sun is somewhere else entirely. `Game._render` hands `map.overlays` to
`Scope.render` to hide for exactly that reason.

The detail that makes it read as light rather than as a sticker on the lens is that
it is **occluded**: one ray per frame through the shared collider, so putting a solar
array between yourself and the sun puts it out. That is the whole reason an array is
worth hiding behind up here.

**The Cupola** is a dead end you can fly into and look out of. Its panes are actually
transparent — opaque glass turns the best window on the station into a dark hole —
and it is the one place on any map where you can watch Earth go past.

## 6. Weapons

The AK-47 and M4A1 come from GLB models in `assets/`, parsed by the project's own
`client/js/core/GLBParser.js` (no loader library). Everything else is modelled from
primitives at real-world scale. All of it ships inside the folder — nothing is
fetched at runtime.

| | AK-47 | M4A1 | Glock 17 | M700 |
|---|---|---|---|---|
| Class | Assault Rifle | Assault Rifle | Sidearm | Sniper Rifle |
| Damage | 55 | 50 | 38 | 150 |
| Body shots to kill | 2 (3 far) | 2 (3 far) | 3 (4 far) | **1** |
| Headshot | lethal | lethal | 2 | lethal |
| RPM | 600 auto | 800 auto | 450 semi | bolt, 1.15 s cycle |
| Magazine | 30 | 30 | 17 | 5 |
| ADS time | 260 ms | 225 ms | 175 ms | 420 ms |

Everyone carries the Glock as a secondary. Primary is chosen on the join screen and
can be swapped from the death screen — it applies on your next life.

**Aiming down sights** is right mouse on every weapon. The ADS pose isn't
hand-authored: each model exposes its own sight point, and the view model translates
that point onto the screen centre, so the irons line up correctly for every gun
automatically.

Translation alone is not always enough. On the M4 the front post tip sits 9.5 mm
proud of the rear aperture across a 38 cm sight radius, so putting the aperture on
the crosshair leaves the post floating 1.4° above the ring. The model is therefore
built inside a group pitched nose-down by exactly that angle about the aperture,
which puts both on a line down −Z. Measured at full ADS, the post lands 4 px and the
aperture 10 px from screen centre on a 686 px frame.

The other number that matters is `view.ads[2]` in `shared/weapons.js` — the
eye-to-sight distance. A full-length carbine whose origin sits mid-receiver will
shove its buttstock out in *front* of the lens if this is too large, and the stock
then fills half the screen. It wants to be small enough that the stock ends up
behind the eye where a shouldered stock belongs (0.235 m for the M4).

### The M4's reload

The M4's GLB ships as 18 separately named nodes, so its reload drives the parts
directly instead of waving the whole weapon around. The joke is that the magazine is
the part you keep: rip it out, hurl the rifle down range, take a fresh rifle from
off screen, slam the same magazine into it, charge the bolt.

The thrown rifle and the fresh one are the same object. It is outside the frustum
from t≈0.34 to t≈0.57, so the hard cut from "tumbling away" to "rising into frame"
is never visible. Two things this depends on:

- The throw is **linear in time**, not eased — a real projectile leaves the hand
  fast and gravity takes over. Lobbed with an ease-in curve it just shrinks to a dot
  in the middle of the screen and then blinks out.
- It has to clear the **bottom** edge of the frame, not the far distance.

A model can own its own choreography by exposing a `reload` object with
`begin/update/end`; `ViewModel` hands it a pose it may steer, and falls back to the
generic drop-and-tilt animation for models that do not. Two structural rules apply
to anything written against that hook:

- The animation frames (`gun`, `stash`) sit at the **origin**, so `end()` can reset
  them to zero. Any rest offset lives one level below them. Putting the offset on
  the animated node instead walks the weapon 15 cm closer to your eye on every
  reload and never puts it back — `tools/browser-check.js` asserts against this.
- The magazine is reparented into a group that shares the magazine well's frame, so
  handing it across at (0,0,0) does not move it a millimetre.

**The M700's scope is a real optic**, not a FOV trick. The scene is rendered a
second time through a 13° camera into a texture, and that texture is shown inside
the lens circle. The world outside the scope stays at normal FOV. The shader adds
eye-relief shadow, edge distortion, chromatic fringing at the lens edge, and a
mil-dot reticle with holdover hashes. Sway is applied to the *image*, not the
reticle — which is what a wobbling rifle actually does. Mouse sensitivity scales
down with magnification.

### Recoil

There are two independent recoils on the ground and a third in orbit.

**Aim recoil** (`feel.recoilV/recoilH`) is a camera kick that partially recovers;
the remainder is drift you have to correct yourself. This one is gameplay.

**Visual recoil** (`feel.kickBack`) shoves and tilts the view model. This one is
presentation only — the shot has already been fired and the round has already gone
where the camera was pointing. It is damped hard while aiming (×0.32 on the
accumulator, ×0.58 on the camera kick), because a sight picture that swings several
degrees per round is unusable, and there is nothing to be gained from throwing the
target off the screen you are trying to shoot at.

Across a 12-round burst that works out to:

| | gun tilt, hip | gun tilt, ADS | aim climb, ADS |
|---|---|---|---|
| AK-47 | 2.1° | 0.7° | 0.4° |
| M4A1 | 1.8° | 0.6° | 0.3° |
| Glock 17 | 1.2° | 0.4° | 0.3° |
| M700 (3 shots) | 4.0° | 1.3° | 0.7° |

**Momentum recoil** (`recoilPush` in the map's movement profile, times the weapon's
`kickBack`) only exists where nothing is bracing you. On the ground the recoil of a
rifle goes into the planet through your boots; in orbit it goes into you. Every round
shoves you back down the barrel at about 0.18 m/s for a rifle and 0.43 m/s for the
M700, so a sustained burst has you travelling backwards unless you hold W against it.

That interacts with spread on purpose: drifting widens your cone, so spraying costs
you accuracy twice over — once from the shot-to-shot spread, and once from the
movement your own recoil just gave you.

Spread grows per shot and with movement, and the crosshair gap is computed from the
real cone angle, so the crosshair never lies to you.

**A bug worth recording.** Spread carries a penalty for being airborne, to punish
jumping and firing. In orbit you are *never* grounded, so every weapon carried that
penalty permanently — on the M700 that is 0.10 rad against an aimed spread of 0.0002,
five hundred times too wide, and the sniper was simply broken on that map. The
airborne term now only applies where there is a ground to be off
(`movement.airborneSpread`), and what replaces it is the movement term that was
already there: hold still in vacuum and you are the steadiest firing platform there
is (2 cm at 100 m); drift and you are not (5 m at 100 m at full speed). The scope's
"steady" test had the same shape of bug — it required a crouch, which can never
happen in free fall, so the sight swayed at full amplitude for the entire map.

### Muzzle flash

The flash is a **7.5 cm** camera-facing quad carrying a soft radial texture with a
few spikes, plus five thin, slow, growing smoke particles drifting off the barrel.

It has to be textured. An untextured quad has hard edges, so at any size worth
seeing it reads as a solid rectangle sitting on top of the sights — which is exactly
what the first version was, at 34–51 cm. The visible core now falls off to nothing
well inside the quad, so the geometry's own edge is never visible.

The accompanying point light is deliberately weak (1.6 intensity, 6 m range). On a
daylight snowfield a bright muzzle light blows out a quarter of the frame on every
round, which is its own kind of not being able to see what you are shooting at —
measured, it took blown-out pixels from 7.9% of the frame down to 2.5%.

---

## 7. Impacts and particle scale

Every particle in the game is sized as a **diameter in metres** and converted to
pixels in the shader:

```glsl
gl_PointSize = aSize * uPixelScale / distance;   // uPixelScale = bufferHeight / (2 tan(fov/2))
```

That uniform is recomputed each frame because it depends on the camera FOV, which
changes when you aim down sights. Sizing particles in arbitrary units instead is how
the first version ended up with snow puffs nine metres across and blood mist twenty
metres wide — they looked fine at one distance and absurd at every other. A player's
head is about 0.34 m across, which is the ceiling for anything here.

A bullet impact emits two things rather than one ball: fast, heavy **chips** thrown
up and back along the surface normal in a tight cone, and a few slow **puffs** of
disturbed dust that hang for a moment behind them. Ground impacts take their colour
from the active map (`environment.impactColor`), so a round into snow throws up
white and a round into a meadow throws up torn green.

## 8. Blood

Three effects, all in [`client/js/effects/Blood.js`](client/js/effects/Blood.js):

- **Mist** — a wound throws a spray of droplets along the round's path plus a
  hanging cloud that expands and thins out. Scales with the damage dealt.
- **Trails** — below about 60 health you drip as you move, on your screen and on
  everyone else's. The bleeding flag is set by the **server** when it builds each
  snapshot rather than reported by the client, so a modified client cannot stop
  itself bleeding.
- **Pools** — a corpse grows a pool underneath it, with irregular satellite stains
  so the edge is never a clean circle.

Stains are a single InstancedMesh with a per-instance alpha attribute, so a whole
match of blood costs one draw call. They soak away after about half a minute.

## 9. Characters and ragdolls

The soldier is a bone hierarchy of rigid parts (65 meshes) wearing procedurally
painted winter camo — an off-white base with grey and blue-grey blotches and printed
flecks, drawn onto a canvas at runtime. Plate carrier, magazine pouches, helmet with
a camo band, goggles, knee and elbow pads, boots, and a small pack.

Animation is entirely procedural: a stride cycle whose frequency scales with speed,
knees that only bend one way, torso lean under sprint, a crouch that folds the legs,
and a head that keeps looking where the player is looking regardless of what the
torso is doing.

The weapon hangs off a dedicated chest anchor rather than the hand, and the animator
points that anchor exactly along the player's aim. Two-armed IK would look slightly
nicer and line up considerably worse — this way a remote player's muzzle always
agrees with the direction the server traced.

**The map decides what people look like.** `MAP_INFO.characters` selects a style, and
`createSoldier({ style })` swaps the materials and the hardware bolted to the rig —
nothing else. Same bones, same proportions, same limb origins, which is precisely
what lets the animator and the ragdoll solver stay unaware there is more than one
kind of person in the game. In orbit that gives an EMU: white ortho-fabric scuffed
from handrails, a hard upper torso, a gold sun visor, a PLSS backpack and SAFER,
joint bearings at every hinge, and red commander stripes so two astronauts are not
the same white blob.

The visor is held at metalness 0.55 rather than 1.0 for the same reason as the
station's metals — with no environment map to reflect, a physically metallic visor
is a black hole where the face should be.

### Ragdolls

On death the body becomes a verlet particle system: 15 particles, 28 distance
constraints, 9 solver iterations per frame.

The important design choice is that the ragdoll **drives the existing bone
hierarchy** rather than detaching the meshes. Bone world orientations are solved
from particle pairs and converted back into local space, so everything strapped to
the rig — helmet, plate carrier, knee pads, the rifle in the hands — comes along for
free.

Per-part collision radii (a fat chest, thin wrists) stop settled bodies from
pancaking flat. Bullets shove the part they actually struck, headshots throw harder,
the corpse inherits the momentum it had, bodies settle and sleep, and old ones fade
out. A maximum of 8 corpses exist at once.

When *you* die, your own body ragdolls and the camera pulls back into a third-person
death view that orbits it, with a raycast to keep the camera out of terrain.

---

## 10. Audio

Every sound is synthesised at runtime from noise and oscillators — there is not a
single audio file in the project, which is a large part of why it unzips and runs
anywhere.

Gunshots are built the way a real report is shaped: a very short bright crack, a
body thump with weapon-specific resonance, a mechanical action clack, and a tail fed
through a synthesised valley reverb (decaying noise plus discrete slap-back echoes
off the treeline). Footsteps are soft filtered crunches in snow. There's a gusting
wind bed that ducks when you're scoped.

One sound worth calling out: **bullet crack**. When someone else's round passes
within ~3 m of your head, you hear it snap past, panned in 3D. In a game that tells
you nothing else, that's often your only warning.

There are, deliberately, no hit or kill sounds anywhere in `AudioEngine.js`.

---

## 11. Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| `Q` `E` | **Roll** — side thrusters, ISS only |
| Left mouse | Fire |
| **Right mouse** | **Aim down sights** |
| `R` | Reload |
| `1` / `2` | Primary / secondary |
| `Tab` (hold) | Scoreboard |
| `T` or `Enter` | Chat (also where `/map` goes) |
| `Esc` | Release mouse |

In orbit the same keys mean the same things pointed somewhere new: W and S still go
forward and back, they just follow where you are looking; space and crouch become
up and down thrusters; shift is a boost rather than a sprint. W does one more job
out there: every round you fire shoves you backwards, and holding it is how you
stop drifting away from the fight. `Q` and `E` are new,
and the bank they put in holds where you leave it — see [§5.3](#orbital--the-iss).

While the chat box is open the keyboard belongs to it: typing "wasd" in a message
does not queue movement, and the pause overlay stays down — releasing the mouse to
type is intentional, not a pause.

---

## 12. Tuning

Almost everything worth changing is in two files:

- [`shared/config.js`](shared/config.js) — movement speeds, gravity, jump height,
  player dimensions, tick rates, interpolation delay, respawn time, kill target.
- [`shared/weapons.js`](shared/weapons.js) — damage, RPM, magazines, reload times,
  falloff, ADS speed, recoil, spread, view-model placement, audio character.

Both are shared, so a change applies to the server and every client at once. Restart
the server and have players refresh.

Graphics quality auto-detects from CPU cores and device memory; override it in the
browser console:

```js
__whiteout.settings.set('quality', 'ultra')   // auto | low | medium | high | ultra
```

---

## 13. Testing

```bash
runtime\node\node.exe tools\test-all.mjs
```

Or individually:

```bash
runtime\node\node.exe tools\check.mjs            # syntax-check all source
runtime\node\node.exe tools\test-handshake.mjs   # WebSocket RFC 6455 conformance
runtime\node\node.exe tools\test-maps.mjs        # invisible walls, spawns, boundaries, hull seals
runtime\node\node.exe tools\test-combat.mjs      # combat, hardcore rules, /map
```

For the client, deploy into a match, open the console and paste
`tools/browser-check.js`.

Two of these exist because of bugs that were genuinely nasty to find:

- **`test-handshake.mjs`** — an incorrect `Sec-WebSocket-Accept` still produces a
  perfectly valid-looking `101 Switching Protocols` response, and a hand-rolled test
  client will happily talk over it. Every real browser silently drops the connection
  with code 1006 and no explanation. The test asserts against the RFC's own vector.
- **`browser-check.js`** — a `ShaderMaterial` that declares `fog: true` without fog
  uniforms makes Three throw *part way through a frame*. The world still renders,
  because opaque geometry is drawn first; everything queued behind it (snowfall,
  tracers, muzzle flashes, the entire scope overlay) silently vanishes. The check
  renders a full frame and asserts no material declares fog without the uniforms.

`test-maps.mjs` branches on the map's movement mode, because a map with no ground
fails every assumption the ground suite makes. The zero-g suite instead proves:

- **Nothing floats.** Every part of the station has to touch another one. This is
  the check the plains map never had, and the reason it grew fences standing in
  mid-air.
- **The hull is sealed.** It rebuilds the station with the three doorways plugged
  and flies a player hard in 1,200 directions out of each of 12 compartments —
  14,400 flights, and not one may leave the pressurised volume through a wall. This
  found a real leak in the node corners: 51 escapes, all in the same diagonal
  directions, fixed by adding the corner blocks.
- **The doorways are open.** Fly the length of the stack both ways, and out the
  airlock. A station you cannot get into is scenery.
- **Empty space is empty.** 4,000 points beyond the structure, zero contacts.

`browser-check.js` also guards four things that are easy to break by accident and
hard to notice from a single screenshot:

- **Weapon pose drift.** It runs a full reload to completion and asserts the muzzle
  ends up where it started. The M4's reload resets its animation frames to zero, so
  any rest offset stored on an animated node accumulates instead — one reload and
  the rifle is 15 cm closer to your eye, permanently.
- **Muzzle flash size.** It asserts the flash quad is under 13 cm and carries a
  texture. The flash is drawn a few centimetres from the eye; anything approaching
  the size of the weapon stops being a flash and starts being a wall.
- **Drawn geometry vs. collision geometry.** On the ISS it fires several hundred
  rays at the station from every side and asserts the drawn surface is never more
  than 30 cm proud of the surface that stops a bullet. This found truss bracing
  rotated about the wrong axis, standing nearly two metres clear of its own segment
  with no collider behind it.
- **The bank persists.** It holds `E` for 1.8 s, checks the player has gone past
  inverted, then releases and checks the bank is still there two seconds later. A
  roll that springs back to level is a lean, and the point of that map is being able
  to fly upside down.

---

## 14. Extending it

**A new weapon** — add an entry to `shared/weapons.js` and a builder in
`client/js/weapons/WeaponModels.js` returning `{ group, muzzle, eject, sight }`.
Add its id to `PRIMARY_CHOICES` to make it selectable. Nothing else needs touching.

**A new map** — create `shared/maps/<id>/` exporting `heightAt`, `collideCapsule`,
`raycastWorld`, `SPAWN_POINTS` and `MAP_INFO`, register it in
`shared/maps/index.js`; then a renderer in `client/js/maps/<id>/` with
`build/update/dispose`, registered in `client/js/maps/MapRegistry.js`.

**A new game mode** — write a sibling to `server/gamemodes/FreeForAll.js` with the
same three hooks: `onKill`, `pickSpawn`, `isOver`.

---

## 15. Known limitations

- The bundled `runtime/node` is the **Windows x64** build. On macOS/Linux,
  `start.sh` falls back to a system Node 18+ (the game itself is platform-agnostic).
- LAN only by default. Internet play needs port forwarding.
- Movement is client-authoritative, with sanity clamps rather than full server
  reconciliation. Fine among friends on a LAN; not hardened against a determined
  cheater.
- Bullets are hitscan. Muzzle velocities are in the weapon table but unused.
- One game mode. Two maps, switchable in-match with `/map`.
- Anyone can change the map. There are no admin roles — a 15-second cooldown is the
  only brake. Fine among friends; not what you would ship to strangers.
- Sheep are simulated per client rather than by the server, so two players will not
  see a given sheep in exactly the same place. They are scenery, not targets.

---

## 16. Credits

Three.js r160 (MIT), vendored in `client/vendor/`. Everything else — terrain,
weapons, characters, camo, animation, ragdoll physics, audio, the WebSocket server —
is generated by the code in this repository.
