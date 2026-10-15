# WHITEOUT

A hardcore browser FPS. One person hosts, everyone else joins from Chrome with an
IP and a port.

**Fully portable** — Node is bundled in this folder and there are zero npm
dependencies. Zip it, unzip it on a PC with nothing installed, and run it.

## Start the server

Double-click **`start.bat`**, or:

```bash
start.bat
```

It prints the addresses to share:

```
  On this computer:
      http://localhost:8080

  Other players on your network open one of these in Chrome:
      http://192.168.1.136:8080       (Ethernet)
```

## Join

Open that address in Chrome, type a callsign, pick a rifle, hit **DEPLOY**.

If nobody else can connect, it's almost certainly Windows Firewall — allow Node on
private networks when prompted.

## The rules

Free For All, first to 100 kills. Two rifle rounds kill. Headshots kill.

You get **no hitmarkers and no kill notifications**. You find out how the fight went
when you die — then the game tells you who killed you, with what, from how far, and
how much health they had left. You will see blood when you hit someone, but never a
marker, a number or a confirmed kill.

## Maps

Two maps, switchable mid-match by anyone, from chat:

```
/map snow      Whiteout Ridge — frozen pine basin, mountains, a hunting cabin
/map grass     Hollowmere — summer farmland, huts, hedgerows, sheep
```

The whole server moves together: everyone rebuilds and respawns.

## Controls

`WASD` move · `Shift` sprint · `Ctrl` crouch · `Space` jump · `LMB` fire ·
**`RMB` aim down sights** · `R` reload · `1`/`2` weapons · `Tab` scoreboard ·
`T` chat · `Esc` release mouse

---

Full documentation — architecture, netcode, tuning, tests, how to add maps and
weapons — is in **[project.md](project.md)**.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or https://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or https://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.

### Third-party components

These bundled pieces aren't covered by the license above and keep their own:

| Path | What | License |
|---|---|---|
| `runtime/node/` | Node.js | MIT, plus the licenses of what Node bundles ([runtime/node/LICENSE](runtime/node/LICENSE)) |
| `client/vendor/three.module.js`, `client/vendor/GLTFLoader.js` | [three.js](https://github.com/mrdoob/three.js) | MIT |
| `assets/*.glb`, `client/assets/*.glb` | Weapon models | Their own terms, from wherever they came from |
