/**
 * Game orchestrator: owns the renderer, the scene, the network session and the loop.
 *
 * Frame order matters and is worth stating once:
 *   input -> local movement -> weapons -> send state -> interpolate remotes ->
 *   ragdolls -> effects -> weather/light -> render (-> scope pass) -> HUD
 */

import * as THREE from './three.js';
import { Input } from './Input.js';
import { Settings } from './Settings.js';
import { NetClient } from '../net/NetClient.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { RemotePlayer } from '../player/RemotePlayer.js';
import { RagdollManager } from '../player/Ragdoll.js';
import { createSoldier } from '../characters/Soldier.js';
import { Animator } from '../characters/Animator.js';
import { createWeaponModel } from '../weapons/WeaponModels.js';
import { ViewModel } from '../weapons/ViewModel.js';
import { WeaponController } from '../weapons/WeaponController.js';
import { Scope } from '../weapons/Scope.js';
import { Effects } from '../effects/Impacts.js';
import { BloodSystem } from '../effects/Blood.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { createMap } from '../maps/MapRegistry.js';
import { HUD } from '../ui/HUD.js';
import { Scoreboard } from '../ui/Scoreboard.js';
import { DeathScreen, MatchOverScreen } from '../ui/DeathScreen.js';
import { C, S, STATE_BITS } from '/shared/protocol.js';
import { DEFAULT_MAP } from '/shared/maps/index.js';
import { NET, MATCH, MOVE, WORLD } from '/shared/config.js';
import { getWeapon, isValidPrimary, DEFAULT_SECONDARY } from '/shared/weapons.js';
import { raycastWorld, setActiveMap, getActiveMapId } from '/shared/maps/active.js';
import { clamp, damp } from '/shared/math/num.js';

const LEFT_MOUSE = 0, RIGHT_MOUSE = 2;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = new Settings();
    this.profile = this.settings.renderProfile();

    this.selfId = 0;
    this.selfName = '';
    this.remotes = new Map();
    this.alive = true;
    this.running = false;
    this.paused = false;
    this.matchOver = false;
    this.scoreboardHeld = false;

    this.inputSeq = 0;
    this.lastInputSent = 0;
    this.lastFrame = performance.now();
    this.accumTime = 0;
    this.deathCam = null;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
  }

  // ============================================================ boot
  async init(onProgress) {
    onProgress?.(0.02, 'Starting renderer');
    this._initRenderer();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.settings.get('fov'), window.innerWidth / window.innerHeight, 0.02, 1200
    );
    // The view model is parented to the camera, so the camera must be in the graph.
    this.scene.add(this.camera);

    this.mapId = DEFAULT_MAP;
    this.map = createMap(this.mapId, this.scene, { quality: this.settings.resolvedQuality });
    await this.map.build((f, label) => onProgress?.(0.05 + f * 0.8, label));

    onProgress?.(0.88, 'Assembling weapons');
    this.player = new LocalPlayer(this.camera);
    this.player.sensitivity = MOVE.MOUSE_SENS * this.settings.get('sensitivity');

    this.viewModel = new ViewModel(this.camera);
    this.weapons = new WeaponController(this.player, this.viewModel, { fov: this.settings.get('fov') });
    this.viewModel.setWeapon(this.weapons.weaponId);

    this.scope = new Scope(this.renderer, {
      resolution: this.profile.scopeRes,
      antialias: this.profile.antialias
    });
    this.scope.setSize(window.innerWidth, window.innerHeight);

    this.effects = new Effects(this.scene);
    this.blood = new BloodSystem(this.scene);
    this.effects.setViewport(this.renderer.domElement.height);
    this.blood.setViewport(this.renderer.domElement.height);
    this.ragdolls = new RagdollManager(this.scene, 20);
    this.audio = new AudioEngine();

    onProgress?.(0.94, 'Wiring controls');
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.get('sensitivity');

    this.hud = new HUD();
    this.scoreboard = new Scoreboard();
    this.deathScreen = new DeathScreen();
    this.matchOverScreen = new MatchOverScreen();

    this._bindCallbacks();
    this._bindDom();

    onProgress?.(1, 'Ready');
    return this;
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.profile.antialias,
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
  }

  _bindCallbacks() {
    this.weapons.onFire = (shot) => this._onLocalFire(shot);
    this.weapons.onReloadStart = (id, ms) => {
      this.audio.reloadSequence(id, ms);
      this.net?.send(C.RELOAD, { wp: id });
    };
    this.weapons.onSwitch = (id) => {
      this.audio.click(1900, 0.13, 0.06);
      this.hud.setWeapon(id);
      this.hud.setActiveSlot(this.weapons.slot);
      this.net?.send(C.SWITCH, { wp: id });
    };
    this.weapons.onDryFire = () => this.audio.dryFire();

    this.player.onFootstep = (speed, crouch) => this.audio.footstep(speed, crouch);
    this.player.onLand = (impact) => {
      if (impact > 6) this.audio.footstep(impact * 0.7, false);
    };

    this.deathScreen.onLoadoutChange = (primary) => {
      this.net?.send(C.LOADOUT, { primary });
    };
  }

  _bindDom() {
    window.addEventListener('resize', () => this._onResize());

    this.canvas.addEventListener('click', () => {
      if (this.running && !this.input.locked && !this.matchOver) this.input.requestLock();
    });

    this.pauseHint = document.getElementById('pause-hint');
    this.pauseHint.addEventListener('click', () => this.input.requestLock());

    this.input.on('lockChange', (locked) => {
      this.paused = !locked;
      // Typing in chat, waiting to respawn and the post-match screen all release the
      // mouse on purpose -- none of them are "paused", so none should show the hint.
      const intentional = this.chatOpen || this.matchOver || !this.alive;
      this.pauseHint.classList.toggle('hidden', locked || !this.running || intentional);
      if (locked) this.audio.resume();
    });

    this.input.on('keyPress', (code, ev) => this._onKeyPress(code, ev));

    this._buildChatInput();
  }

  _buildChatInput() {
    const wrap = document.createElement('div');
    wrap.id = 'chat-input-wrap';
    wrap.style.cssText =
      'position:fixed;left:34px;bottom:130px;z-index:45;display:none;';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 90;
    input.placeholder = 'Say something…';
    input.style.cssText =
      'width:360px;padding:8px 11px;background:rgba(8,13,18,.92);border:1px solid #2a3a48;' +
      'color:#eef6ff;font-family:var(--font);font-size:13px;outline:none;';
    wrap.appendChild(input);
    document.body.appendChild(wrap);

    this.chatWrap = wrap;
    this.chatInput = input;

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = input.value.trim();
        if (text) this.net?.send(C.CHAT, { text });
        input.value = '';
        this._closeChat();
      } else if (e.code === 'Escape') {
        input.value = '';
        this._closeChat();
      }
    });
  }

  _openChat() {
    if (!this.running || this.chatOpen) return;
    // chatOpen must be set BEFORE releasing the mouse: dropping pointer lock fires
    // lockChange, and that handler decides whether to show the pause overlay.
    // Without this ordering, opening chat pops up "PAUSED / click to resume" too.
    this.chatOpen = true;
    this.chatWrap.style.display = 'block';
    this.pauseHint.classList.add('hidden');
    this.input.releaseLock();
    this.input.keys.clear();
    setTimeout(() => this.chatInput.focus(), 20);
  }

  _closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatWrap.style.display = 'none';
    this.chatInput.blur();
    // Anything typed must not leak into movement when the mouse is recaptured.
    this.input.keys.clear();
    if (!this.matchOver) this.input.requestLock();
  }

  _onKeyPress(code, ev) {
    if (this.chatOpen) return;
    if (!this.running) return;

    switch (code) {
      case 'Digit1': this.weapons.switchTo(0); break;
      case 'Digit2': this.weapons.switchTo(1); break;
      case 'Tab':
        ev.preventDefault();
        this.scoreboardHeld = true;
        if (this.alive) this.scoreboard.show(false);
        break;
      case 'KeyT':
      case 'Enter':
        ev.preventDefault();
        this._openChat();
        break;
      case 'Escape':
        this.input.releaseLock();
        break;
      default: break;
    }
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.profile.pixelRatio));
    this.renderer.setSize(w, h);
    this.scope.setSize(w, h);
    this.effects?.setViewport(this.renderer.domElement.height);
    this.blood?.setViewport(this.renderer.domElement.height);
  }

  // ============================================================ session
  async connect(name, primary) {
    this.net = new NetClient();
    this._bindNet();
    await this.net.connect();
    this.net.send(C.JOIN, { name, primary });
    this.weapons.setLoadout(primary);
  }

  _bindNet() {
    const net = this.net;

    net.on(S.WELCOME, (msg) => this._onWelcome(msg));
    net.on(S.SNAPSHOT, (msg) => this._onSnapshot(msg));
    net.on(S.PLAYER_JOIN, (msg) => this._onPlayerJoin(msg));
    net.on(S.PLAYER_LEAVE, (msg) => this._onPlayerLeave(msg));
    net.on(S.PLAYER_DIED, (msg) => this._onPlayerDied(msg));
    net.on(S.YOU_DIED, (msg) => this._onYouDied(msg));
    net.on(S.RESPAWN, (msg) => this._onRespawn(msg));
    net.on(S.SCORES, (msg) => this._onScores(msg));
    net.on(S.SHOT_FIRED, (msg) => this._onRemoteShot(msg));
    net.on(S.MATCH_OVER, (msg) => this._onMatchOver(msg));
    net.on(S.MATCH_RESET, () => this._onMatchReset());
    net.on(S.CHAT, (msg) => this.hud.addChat(msg.name, msg.text));
    net.on(S.NOTICE, (msg) => this.hud.addChat('SERVER', msg.text));
    net.on(S.BLOOD, (msg) => this.blood.mist(msg.p, msg.d, msg.a ?? 1));
    net.on(S.MAP_CHANGE, (msg) => this._onMapChange(msg));
    net.on(S.ERROR, (msg) => this.onFatalError?.(msg.message || 'Server error'));
    net.on('__close', (info) => {
      if (!info.byUs) this.onDisconnect?.(info);
    });
  }

  _onWelcome(msg) {
    this.selfId = msg.id;
    this.selfName = msg.name;
    this.killTarget = msg.config?.killTarget ?? MATCH.KILL_TARGET;

    // The server may already be playing something other than the default map.
    if (msg.map && msg.map.id !== this.mapId) {
      this._loadMap(msg.map, `Now playing ${msg.map.name}`);
    }

    this.scoreboard.setSelf(this.selfId);
    this.scoreboard.setTarget(this.killTarget);
    this.hud.setTarget(this.killTarget);
    this.hud.setLoadout(msg.loadout.primary, msg.loadout.secondary);
    this.hud.setActiveSlot(0);
    this.hud.setWeapon(msg.loadout.primary);
    this.deathScreen.setPrimary(msg.loadout.primary);

    this.player.reset(msg.spawn.pos, msg.spawn.yaw);
    this.weapons.respawn();

    for (const p of msg.players || []) {
      this._addRemote(p.id, p.name);
    }

    this.start();
  }

  _addRemote(id, name) {
    if (this.remotes.has(id) || id === this.selfId) return;
    const rp = new RemotePlayer(id, name, this.scene, { shadows: this.profile.shadows });
    this.remotes.set(id, rp);
    return rp;
  }

  _onPlayerJoin(msg) {
    this._addRemote(msg.id, msg.name);
    this.hud.addChat('•', `${msg.name} joined`);
  }

  _onPlayerLeave(msg) {
    const rp = this.remotes.get(msg.id);
    if (rp) {
      rp.dispose();
      this.remotes.delete(msg.id);
    }
  }

  _onSnapshot(msg) {
    const t = msg.t;
    for (const s of msg.ps) {
      let rp = this.remotes.get(s.i);
      if (!rp) rp = this._addRemote(s.i, 'Operator');
      if (!rp) continue;
      rp.applySnapshot(t, s);

      // Wounded players leave a trail. The bleeding flag is set by the server, so a
      // modified client cannot stop itself dripping.
      if (s.a === 1 && (s.s & STATE_BITS.BLEEDING) && (s.s & STATE_BITS.MOVING)) {
        this.blood.dripFrom(s.i, s.p);
      }
    }

    const self = msg.self;
    if (self) {
      this.hud.setHealth(self.hp);
      if (self.hp < this._lastSelfHp && self.hp > 0) {
        this.audio.hurt(clamp((this._lastSelfHp - self.hp) / 50, 0.25, 1));
      }
      this._lastSelfHp = self.hp;
      this.weapons.syncAmmo(self.mag, self.reserve, self.reloading);

      // ...and so do you, under your own feet.
      if (self.alive && self.hp < 62 && this.player.speed > 1.2) {
        this.blood.dripFrom(this.selfId, this.player.pos);
      }
    }
  }

  /**
   * The server moved everyone to another map. Tear the world down, build the new
   * one, and report back so play can resume.
   */
  async _onMapChange(msg) {
    await this._loadMap(msg.map, `${msg.by} changed the map to ${msg.map.name}`);
  }

  /**
   * Swap the whole world to another map.
   *
   * Used both when somebody types /map AND when joining a server that is already
   * playing something other than the default -- without the second case, a late
   * joiner would render the snowy map while standing on the grassy one.
   */
  async _loadMap(mapInfo, announcement = null) {
    if (this.rebuilding) return;
    if (mapInfo.id === this.mapId) return;
    this.rebuilding = true;
    this.mapId = mapInfo.id;
    const msg = { map: mapInfo };

    const loading = document.getElementById('loading');
    const fill = document.getElementById('load-fill');
    const status = document.getElementById('load-status');

    try {
      this.alive = false;
      this.weapons.enabled = false;
      this.viewModel.setVisible(false);
      this.deathCam = null;
      this.deathScreen.hide();
      this.input.releaseLock();
      this.pauseHint.classList.add('hidden');

      // everything that belonged to the old world
      this.ragdolls.clear();
      this.blood.clear();
      for (const rp of this.remotes.values()) rp.setVisible(false);

      if (announcement) this.hud.addChat('SERVER', announcement);

      loading.classList.remove('hidden');
      fill.style.width = '0%';
      status.textContent = 'Loading ' + msg.map.name;

      // Physics first: the shared collision layer must agree with what we draw.
      setActiveMap(msg.map.id);
      this.map.dispose();
      this.map = createMap(msg.map.id, this.scene, { quality: this.settings.resolvedQuality });
      await this.map.build((f, label) => {
        fill.style.width = Math.round(f * 100) + '%';
        if (label) status.textContent = label;
      });
    } catch (err) {
      console.error('map rebuild failed', err);
      status.textContent = 'Map failed to load: ' + (err?.message || err);
    } finally {
      // Always report back, even after a failure. A client that stays silent holds
      // the whole server on the switch deadline, which punishes everybody else.
      loading.classList.add('hidden');
      this.rebuilding = false;
      this.net.send(C.MAP_READY, {});
    }
  }

  _onScores(msg) {
    this.scoreboard.update(msg.list, msg.target);
  }

  // ------------------------------------------------------------ combat
  _onLocalFire(shot) {
    const w = getWeapon(shot.weaponId);

    this.net.send(C.FIRE, {
      wp: shot.weaponId,
      o: [round3(shot.origin[0]), round3(shot.origin[1]), round3(shot.origin[2])],
      d: [round4(shot.dir[0]), round4(shot.dir[1]), round4(shot.dir[2])],
      seq: this.inputSeq
    });

    this.audio.gunshot(w.audio, null);
    this.map.onGunshot?.(shot.origin);

    // muzzle flash + small yellow bullet + world impact on arrival
    const muzzle = shot.muzzle;
    this.effects.muzzleFlash(muzzle, w.id === 'm700' ? 1.5 : w.id === 'glock17' ? 0.8 : 1.15, this.camera);

    const end = shot.hit
      ? shot.hit.point
      : [
        shot.origin[0] + shot.dir[0] * 280,
        shot.origin[1] + shot.dir[1] * 280,
        shot.origin[2] + shot.dir[2] * 280
      ];

    const bulletSpeed = w.id === 'm700' ? 620 : w.id === 'glock17' ? 380 : 490;
    this.effects.shootBullet(muzzle, end, {
      speed: bulletSpeed,
      hit: shot.hit,
      onImpact: (hit) => {
        if (hit) this.effects.impact(hit.point, hit.normal, hit.kind);
      }
    });

    if (w.feel.shellEject) {
      this._v1.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this._v2.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this._v3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.effects.ejectShell(shot.eject, this._v1.toArray(), this._v2.toArray(), this._v3.toArray());
    } else if (w.boltActionMs) {
      this.audio.boltCycle();
      setTimeout(() => {
        if (!this.alive) return;
        this._v1.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        this._v2.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        this._v3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.effects.ejectShell(
          this.viewModel.ejectWorldPosition().toArray(),
          this._v1.toArray(), this._v2.toArray(), this._v3.toArray()
        );
      }, w.boltActionMs * 0.35);
    }
  }

  /** Someone else fired: sound, flash, small yellow bullet, impact, and a crack if it was close. */
  _onRemoteShot(msg) {
    const rp = this.remotes.get(msg.id);
    const w = getWeapon(msg.wp);
    const origin = msg.o;
    const dir = msg.d;

    if (rp) rp.onFired();

    const muzzlePos = rp ? rp.muzzleWorldPosition(this._v1).toArray() : origin;
    this.audio.gunshot(w.audio, muzzlePos);
    this.map.onGunshot?.(muzzlePos);
    this.effects.muzzleFlash(muzzlePos, w.id === 'm700' ? 1.4 : 1.05, this.camera);

    const hit = raycastWorld(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], WORLD.MAX_BULLET_RANGE);
    const end = hit ? hit.point : [
      origin[0] + dir[0] * 280, origin[1] + dir[1] * 280, origin[2] + dir[2] * 280
    ];
    const bulletSpeed = w.id === 'm700' ? 620 : w.id === 'glock17' ? 380 : 490;
    this.effects.shootBullet(muzzlePos, end, {
      speed: bulletSpeed,
      hit: hit,
      onImpact: (h) => {
        if (h) this.effects.impact(h.point, h.normal, h.kind);
      }
    });

    // Supersonic crack: how close did that round pass to my head?
    const cam = this.camera.position;
    const toX = cam.x - origin[0], toY = cam.y - origin[1], toZ = cam.z - origin[2];
    const along = toX * dir[0] + toY * dir[1] + toZ * dir[2];
    if (along > 1.5) {
      const perp = Math.sqrt(Math.max(0, (toX * toX + toY * toY + toZ * toZ) - along * along));
      if (perp < 3.2) {
        const closeness = 1 - perp / 3.2;
        const px = origin[0] + dir[0] * along;
        const py = origin[1] + dir[1] * along;
        const pz = origin[2] + dir[2] * along;
        this.audio.bulletWhiz([px, py, pz], 0.35 + closeness * 0.75);
      }
    }
  }

  /** A body dropped somewhere. We are told nothing about who did it. */
  _onPlayerDied(msg) {
    const rp = this.remotes.get(msg.id);
    if (!rp) return;
    const soldier = rp.detachForRagdoll();
    this.blood.pool([rp.renderPos.x, rp.renderPos.y, rp.renderPos.z], 1.1 + Math.random() * 0.5);
    this.blood.forget(msg.id);
    this.ragdolls.spawn(soldier, {
      impulse: msg.dir,
      hitY: msg.hitY,
      headshot: msg.headshot,
      velocity: [0, 0, 0]
    });
  }

  _onYouDied(msg) {
    this.alive = false;
    this.player.alive = false;
    this.weapons.enabled = false;
    this.audio.death();
    this.audio.setScoped(false);

    // Your own corpse, built from the pose you died in.
    const soldier = createSoldier({ shadows: this.profile.shadows });
    const animator = new Animator(soldier);
    animator.update(0.016, {
      speed: this.player.speed,
      grounded: this.player.grounded,
      crouch: this.player.crouching,
      aim: this.weapons.ads,
      sprint: this.player.sprinting,
      pitch: this.player.pitch
    });
    const weapon = createWeaponModel(this.weapons.weaponId, { worldModel: true });
    weapon.group.rotation.set(0, Math.PI, 0);
    soldier.bones.weaponAnchor.add(weapon.group);

    soldier.group.position.set(this.player.pos[0], this.player.pos[1], this.player.pos[2]);
    soldier.group.rotation.y = this.player.yaw + Math.PI;
    soldier.group.updateMatrixWorld(true);

    this.blood.pool([this.player.pos[0], this.player.pos[1], this.player.pos[2]], 1.2 + Math.random() * 0.5);
    const rag = this.ragdolls.spawn(soldier, {
      impulse: msg.dir,
      hitY: msg.hitY,
      headshot: msg.headshot,
      velocity: [this.player.vel.x, this.player.vel.y, this.player.vel.z]
    });

    // Third-person death camera, anchored behind the falling body.
    this.deathCam = {
      ragdoll: rag,
      angle: this.player.yaw + Math.PI + (Math.random() - 0.5) * 0.8,
      blend: 0,
      from: this.camera.position.clone()
    };

    this.viewModel.setVisible(false);
    this.hud.setCrosshair(0, true);
    this.hud.setScoped(false);

    const respawnAt = performance.now() + (msg.respawnMs ?? MATCH.RESPAWN_MS);
    this.deathScreen.show(msg, respawnAt);
    this.scoreboard.show(true);
    this.input.releaseLock();
    this.pauseHint.classList.add('hidden');
  }

  _onRespawn(msg) {
    this.alive = true;
    this.player.reset(msg.pos, msg.yaw);
    this.player.alive = true;
    this.weapons.enabled = true;

    // A loadout change made on the death screen is applied by the server at spawn
    // time, so adopt whatever it says we are holding. Without this the client keeps
    // the old rifle and the server rejects every shot as 'wrong-weapon'.
    if (msg.weapon && isValidPrimary(msg.weapon)) this.weapons.setLoadout(msg.weapon);
    this.weapons.respawn();
    this.viewModel.setVisible(true);
    this.deathCam = null;
    this._lastSelfHp = 100;
    this.rebuilding = false;
    for (const rp of this.remotes.values()) rp.setVisible(true);
    this.blood.forget(this.selfId);

    this.hud.clearDamage();
    this.hud.setHealth(msg.hp ?? 100);
    this.hud.setWeapon(this.weapons.weaponId);
    this.hud.setLoadout(this.weapons.primary, this.weapons.secondary);
    this.hud.setActiveSlot(0);

    this.deathScreen.hide();
    if (!this.scoreboardHeld) this.scoreboard.hide();
    if (!this.matchOver) this.input.requestLock();
  }

  _onMatchOver(msg) {
    this.matchOver = true;
    const winner = (msg.list || []).find((p) => p.id === msg.winnerId);
    this.matchOverScreen.show(msg.winnerName, winner ? winner.kills : this.killTarget, msg.resetIn ?? 20000);
    this.scoreboard.update(msg.list);
    this.scoreboard.show(true);
    this.input.releaseLock();
    this.pauseHint.classList.add('hidden');
  }

  _onMatchReset() {
    this.matchOver = false;
    this.matchOverScreen.hide();
    if (!this.scoreboardHeld) this.scoreboard.hide();
    this.ragdolls.clear();
    this.hud.clearDamage();
    this.input.requestLock();
  }

  // ============================================================ loop
  start() {
    if (this.running) return;
    this.running = true;
    this.audio.init();
    this.hud.show();
    this.lastFrame = performance.now();
    this._lastSelfHp = 100;
    this.input.requestLock();
    requestAnimationFrame(() => this._frame());
  }

  _frame() {
    if (!this.running) return;
    requestAnimationFrame(() => this._frame());

    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // A tab that was backgrounded should not teleport anyone.
    dt = Math.min(dt, 0.1);

    this._update(dt, now);
    this._render();
  }

  _update(dt, now) {
    const canPlay = this.running && !this.paused && !this.chatOpen && this.alive && !this.matchOver;

    // ---------------------------------------------------------- look
    const look = this.input.consumeLook();
    if (canPlay && this.input.locked) {
      this.player.look(look.dx, look.dy, this.weapons.sensitivityScale());
    }

    // ---------------------------------------------------------- move
    const move = canPlay && this.input.locked ? this.input.moveVector() : { x: 0, z: 0 };
    const wantAds = canPlay && this.input.isMouseDown(RIGHT_MOUSE);
    const wantFire = canPlay && this.input.isMouseDown(LEFT_MOUSE);

    this.player.update(dt, {
      move,
      jump: canPlay && this.input.isDown('Space'),
      crouch: canPlay && (this.input.isDown('ControlLeft') || this.input.isDown('KeyC')),
      sprint: canPlay && this.input.isDown('ShiftLeft'),
      ads: wantAds,
      speedMult: this.weapons.weapon.feel.moveMult,
      recoilRecover: this.weapons.weapon.feel.recoilRecover,
      frozen: !canPlay
    });

    // ---------------------------------------------------------- weapons
    this.weapons.update(dt, {
      fire: wantFire,
      ads: wantAds,
      reload: canPlay && this.input.isDown('KeyR'),
      frozen: !canPlay
    });

    this.viewModel.update(dt, {
      ads: wantAds,
      sprint: this.player.sprinting,
      speed: this.player.speed,
      grounded: this.player.grounded,
      lookDX: look.dx,
      lookDY: look.dy,
      lowered: !this.alive || this.matchOver
    });

    // camera FOV follows the sights
    const targetFov = this.weapons.currentFov();
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, targetFov, 18, dt);
      this.camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------- scope
    const w = this.weapons.weapon;
    const scopeAmount = w.scope ? clamp((this.viewModel.adsBlend - 0.55) / 0.4, 0, 1) : 0;
    this.scope.update(dt, scopeAmount, {
      steady: this.player.crouching && this.player.speed < 0.4,
      moving: clamp(this.player.speed / MOVE.WALK, 0, 1)
    });
    this.hud.setScoped(scopeAmount > 0.5);
    this.audio.setScoped(scopeAmount > 0.5);

    // ---------------------------------------------------------- network
    if (now - this.lastInputSent > 1000 / NET.INPUT_RATE) {
      this.lastInputSent = now;
      this._sendInput();
    }

    // ---------------------------------------------------------- remotes
    const renderTime = this.net.serverNow() - NET.INTERP_DELAY_MS;
    for (const rp of this.remotes.values()) {
      rp.update(dt, renderTime, this.camera);
    }

    this.ragdolls.update(dt);
    this.effects.update(dt, this.camera);
    this.blood.update(dt, this.camera);
    if (!this.rebuilding) this.map.update(dt, this.camera);
    this.audio.updateListener(this.camera);

    // ---------------------------------------------------------- death cam
    if (this.deathCam) this._updateDeathCam(dt);

    // ---------------------------------------------------------- hud
    this._updateHud(dt, scopeAmount);
  }

  _updateDeathCam(dt) {
    const cam = this.deathCam;
    const chest = cam.ragdoll?.p?.chest?.pos;
    if (!chest) return;

    cam.blend = Math.min(1, cam.blend + dt * 1.5);
    cam.angle += dt * 0.14;

    const dist = 3.2;
    const target = this._v1.set(
      chest.x + Math.sin(cam.angle) * dist,
      chest.y + 1.9,
      chest.z + Math.cos(cam.angle) * dist
    );

    // Do not let the death camera end up inside the terrain or the cabin.
    const dirToCam = this._v2.copy(target).sub(this._v3.set(chest.x, chest.y, chest.z));
    const len = dirToCam.length();
    dirToCam.normalize();
    const blocked = raycastWorld(chest.x, chest.y, chest.z, dirToCam.x, dirToCam.y, dirToCam.z, len);
    if (blocked) {
      target.set(
        chest.x + dirToCam.x * Math.max(0.6, blocked.dist - 0.4),
        chest.y + dirToCam.y * Math.max(0.6, blocked.dist - 0.4),
        chest.z + dirToCam.z * Math.max(0.6, blocked.dist - 0.4)
      );
    }

    this.camera.position.lerpVectors(cam.from, target, easeOut(cam.blend));
    this.camera.lookAt(chest.x, chest.y + 0.15, chest.z);
  }

  _updateHud(dt, scopeAmount) {
    const ammo = this.weapons.currentAmmo;
    const w = this.weapons.weapon;
    this.hud.setAmmo(ammo.mag, ammo.reserve, w.magSize);
    this.hud.setReloading(this.weapons.reloading);
    this.hud.setPing(this.net.rtt);

    if (this.alive && !this.matchOver) {
      const gap = this.weapons.crosshairSpread(window.innerHeight, this.camera.fov);
      this.hud.setCrosshair(gap, this.viewModel.adsBlend > 0.55 || scopeAmount > 0.1);
    }

    if (this.deathScreen.visible) this.deathScreen.update();
    if (this.matchOverScreen.visible) this.matchOverScreen.update();

    // TAB released?
    if (this.scoreboardHeld && !this.input.isDown('Tab')) {
      this.scoreboardHeld = false;
      if (this.alive && !this.matchOver) this.scoreboard.hide();
    }
  }

  _sendInput() {
    const p = this.player;
    this.inputSeq++;
    this.net.send(C.INPUT, {
      seq: this.inputSeq,
      p: [round2(p.pos[0]), round2(p.pos[1]), round2(p.pos[2])],
      y: round3(p.yaw + p.recoilYaw),
      t: round3(p.pitch + p.recoilPitch),
      st: p.stateBits(STATE_BITS, {
        ads: this.weapons.ads,
        firing: this.input.isMouseDown(LEFT_MOUSE),
        reloading: this.weapons.reloading
      }),
      wp: this.weapons.weaponId
    });
  }

  _render() {
    // The magnified pass has to happen before the frame is drawn, and must not
    // include the first-person weapon.
    this.scope.render(this.scene, this.camera, [this.viewModel.root]);
    this.renderer.render(this.scene, this.camera);
    this.scope.composite();
  }

  stop() {
    this.running = false;
    this.net?.close();
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
