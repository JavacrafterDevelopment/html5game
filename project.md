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
│       └── grassy_plains/
│           ├── index.js         map bundle
│           ├── terrain.js       gentle heightfield + levelled hut pads
│           ├── props.js         trees, hedgerow, fields, haystacks, sheep herds
│           ├── huts.js          village huts as collision boxes
│           └── collision.js     collider list + validated spawn points
│
├── client/                    ← everything the browser loads
│   ├── index.html
│   ├── vendor/three.module.js   Three.js r160, vendored (never a CDN)
│   ├── styles/                  main.css, menu.css, hud.css
│   └── js/
│       ├── main.js              boot: build world → ask for callsign → connect
│       ├── core/
│       │   ├── Game.js          the orchestrator and the frame loop
│       │   ├── Input.js         pointer lock, keys, mouse
│       │   ├── Settings.js      quality tiers, sensitivity, persistence
│       │   ├── three.js         single import point for Three
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
│       │   ├── WeaponModels.js  AK-47, M4A1, Glock 17, M700 built from primitives
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
│       │   └── grassy_plains/
│       │       ├── GrassyPlainsMap.js  scene assembly
│       │       ├── TerrainMesh.js      green terrain painting
│       │       ├── GrassField.js       instanced wind-swayed grass
│       │       ├── HutMesh.js          huts built from the collision boxes
│       │       ├── Props.js            trees, hedge, fences, haystacks, carts
│       │       ├── Sheep.js            wandering flocks
│       │       └── Sky.js              summer sky + drifting clouds
│       ├── effects/
│       │   ├── Snowfall.js      GPU snow, camera-tiled
│       │   ├── WindMotes.js     visible wind, camera-tiled
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

Two maps ship, and the whole server can move between them at runtime. Anyone can
type it in chat:

```
/map snow      →  Whiteout Ridge
/map grass     →  Hollowmere
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

Both maps are checked by [`tools/test-maps.mjs`](tools/test-maps.mjs), which exists
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

Open summer farmland: rolling fields, a village of thatched huts, fenced paddocks,
haystacks, hedgerows and sheep. Deliberately gentle underfoot — nothing here is
steep enough to slide on.

- **Grass** — 16,000 instanced tufts with the wind baked into the vertex shader via
  `onBeforeCompile`, so the blades still receive the scene's lighting, fog and
  shadows. Two details make the wind *readable* rather than a generic wobble: a
  constant lean downwind, and a phase that advances along the wind vector, so gusts
  travel across the field as visible waves instead of every blade moving in unison.
  Distant blades shrink into the painted ground rather than popping out.
- **Wind** — one vector drives the grass, the drifting clouds and a thin haze of
  airborne motes, so everything visibly agrees about which way it is blowing. The
  motes use the same camera-tiling trick as the snowfall: world-locked, zero CPU.
- **Sheep** — five flocks that graze, amble around their anchor, and scatter when a
  gun goes off near them. Ambient only: no collider, no hitbox, no network traffic.
  Each client simulates its own flock, which nobody notices.
- **Huts** — mud-brick walls under a thatched hip roof, drawn by filling the same
  boxes the collider uses, with shootable window bands like the cabin.
- **The boundary is a hedgerow** — not an invisible wall, and not a slope you slide
  off. It is a ring of overlapping cylinders drawn as a thick hedge; the gaps
  between them are narrower than a player, so it is solid because of its geometry.

## 6. Weapons

All four are modelled from primitives at real-world scale — no downloaded assets.

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

**The M700's scope is a real optic**, not a FOV trick. The scene is rendered a
second time through a 13° camera into a texture, and that texture is shown inside
the lens circle. The world outside the scope stays at normal FOV. The shader adds
eye-relief shadow, edge distortion, chromatic fringing at the lens edge, and a
mil-dot reticle with holdover hashes. Sway is applied to the *image*, not the
reticle — which is what a wobbling rifle actually does. Mouse sensitivity scales
down with magnification.

Recoil is a camera kick that partially recovers; the remainder is drift you have to
correct yourself. Spread grows per shot and with movement, and the crosshair gap is
computed from the real cone angle, so the crosshair never lies to you.

---

## 7. Blood

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

## 8. Characters and ragdolls

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

## 9. Audio

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

## 10. Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| Left mouse | Fire |
| **Right mouse** | **Aim down sights** |
| `R` | Reload |
| `1` / `2` | Primary / secondary |
| `Tab` (hold) | Scoreboard |
| `T` or `Enter` | Chat (also where `/map` goes) |
| `Esc` | Release mouse |

While the chat box is open the keyboard belongs to it: typing "wasd" in a message
does not queue movement, and the pause overlay stays down — releasing the mouse to
type is intentional, not a pause.

---

## 11. Tuning

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

## 12. Testing

```bash
runtime\node\node.exe tools\test-all.mjs
```

Or individually:

```bash
runtime\node\node.exe tools\check.mjs            # syntax-check all source
runtime\node\node.exe tools\test-handshake.mjs   # WebSocket RFC 6455 conformance
runtime\node\node.exe tools\test-maps.mjs        # invisible walls, spawns, boundaries
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

---

## 13. Extending it

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

## 14. Known limitations

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

## 15. Credits

Three.js r160 (MIT), vendored in `client/vendor/`. Everything else — terrain,
weapons, characters, camo, animation, ragdoll physics, audio, the WebSocket server —
is generated by the code in this repository.
