/**
 * Firing, ammo, spread, recoil and weapon switching.
 *
 * The client predicts everything so the gun feels instant, and the server
 * independently re-checks fire rate and ammo before it will resolve a shot. Where
 * the two disagree, the server wins -- snapshots quietly correct the local counts.
 *
 * Hardcore note: nothing in here reacts to whether a bullet found a player. The
 * only raycast performed locally is against world geometry, purely to decide where
 * to throw a puff of snow.
 */

import * as THREE from '../core/three.js';
import { getWeapon, fireIntervalMs, PRIMARY_CHOICES, DEFAULT_SECONDARY } from '/shared/weapons.js';
import { WORLD, MOVE } from '/shared/config.js';
import { raycastWorld } from '/shared/maps/snowy_forest/collision.js';
import { clamp, damp } from '/shared/math/num.js';

const LEFT = 0, RIGHT = 2;

export class WeaponController {
  constructor(player, viewModel, opts = {}) {
    this.player = player;
    this.view = viewModel;

    this.primary = opts.primary || PRIMARY_CHOICES[0];
    this.secondary = DEFAULT_SECONDARY;
    this.slot = 0;

    this.ammo = {};
    this._initAmmo();

    this.lastShotAt = 0;
    this.lastFireInputAt = 0;
    this.triggerHeld = false;
    this.reloadEndsAt = 0;
    this.reloading = false;
    this.boltUntil = 0;
    this.switchUntil = 0;

    this.spread = 0;
    this.ads = false;
    this.adsBlend = 0;

    this.baseFov = opts.fov ?? MOVE.FOV;
    this.enabled = true;

    // callbacks wired up by Game
    this.onFire = null;
    this.onReloadStart = null;
    this.onSwitch = null;
    this.onDryFire = null;

    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._origin = new THREE.Vector3();
  }

  _initAmmo() {
    for (const id of [this.primary, this.secondary]) {
      const w = getWeapon(id);
      this.ammo[id] = { mag: w.magSize, reserve: w.magSize * w.reserveMags };
    }
  }

  get weaponId() { return this.slot === 0 ? this.primary : this.secondary; }
  get weapon() { return getWeapon(this.weaponId); }
  get currentAmmo() { return this.ammo[this.weaponId] || { mag: 0, reserve: 0 }; }
  get isScoped() { return !!this.weapon.scope && this.view.isAimed; }

  setLoadout(primary) {
    if (primary === this.primary) return;
    this.primary = primary;
    this.slot = 0;
    this._initAmmo();
    this.view.setWeapon(this.weaponId);
    this.reloading = false;
  }

  /** Server is authoritative -- accept its counts unless we just fired. */
  syncAmmo(mag, reserve, reloadingMs) {
    const now = performance.now();
    if (now - this.lastShotAt < 260) return;
    const a = this.currentAmmo;
    a.mag = mag;
    a.reserve = reserve;
    if (reloadingMs > 0 && !this.reloading) {
      this.reloading = true;
      this.reloadEndsAt = now + reloadingMs;
      this.view.startReload(reloadingMs);
    }
  }

  respawn() {
    this.slot = 0;
    this._initAmmo();
    this.reloading = false;
    this.reloadEndsAt = 0;
    this.boltUntil = 0;
    this.spread = 0;
    this.view.setWeapon(this.weaponId);
  }

  switchTo(slot) {
    if (slot === this.slot) return;
    const now = performance.now();
    if (now < this.switchUntil) return;
    this.slot = slot;
    this.reloading = false;
    this.view.cancelReload();
    this.switchUntil = now + 380;
    this.view.setWeapon(this.weaponId);
    this.onSwitch?.(this.weaponId);
  }

  nextWeapon() {
    this.switchTo(this.slot === 0 ? 1 : 0);
  }

  startReload() {
    const now = performance.now();
    const w = this.weapon;
    const a = this.currentAmmo;
    if (this.reloading || a.mag >= w.magSize || a.reserve <= 0) return;
    if (now < this.switchUntil) return;

    const duration = a.mag === 0 ? w.reloadEmptyMs : w.reloadMs;
    this.reloading = true;
    this.reloadEndsAt = now + duration;
    this.view.startReload(duration);
    this.onReloadStart?.(this.weaponId, duration);
  }

  _finishReload() {
    const w = this.weapon;
    const a = this.currentAmmo;
    const need = w.magSize - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    this.reloading = false;
  }

  /** Current cone half-angle in radians. */
  computeSpread() {
    const feel = this.weapon.feel;
    const p = this.player;
    const base = feel.spreadHip + (feel.spreadAds - feel.spreadHip) * this.view.adsBlend;
    let s = base + this.spread;
    const moveFrac = clamp(p.speed / MOVE.WALK, 0, 1.6);
    s += feel.spreadMoveAdd * moveFrac;
    if (!p.grounded) s += feel.spreadAirAdd;
    if (p.crouching) s *= 0.72;
    return Math.min(s, feel.spreadMax * 1.6);
  }

  /**
   * @param {number} dt
   * @param {{ fire:boolean, ads:boolean, reload:boolean, frozen:boolean }} cmd
   */
  update(dt, cmd) {
    const now = performance.now();
    const w = this.weapon;
    const feel = w.feel;

    // spread recovery
    this.spread = damp(this.spread, 0, 1 / Math.max(0.02, feel.spreadRecover), dt);

    if (this.reloading && now >= this.reloadEndsAt) this._finishReload();

    // ---------------------------------------------------------- ADS
    this.ads = !!cmd.ads && !cmd.frozen && this.enabled && !this.player.sprinting;
    this.adsBlend = this.view.adsBlend;

    if (cmd.frozen || !this.enabled) {
      this.triggerHeld = false;
      return;
    }

    // ---------------------------------------------------------- reload
    if (cmd.reload) this.startReload();
    // auto-reload on a dry trigger pull
    if (cmd.fire && this.currentAmmo.mag <= 0 && !this.reloading) {
      if (!this.triggerHeld) this.onDryFire?.(this.weaponId);
      this.startReload();
    }

    // ---------------------------------------------------------- fire
    const wantFire = !!cmd.fire;
    const canRepeat = w.auto || !this.triggerHeld;
    const interval = fireIntervalMs(w);
    const ready =
      now - this.lastShotAt >= interval &&
      now >= this.boltUntil &&
      now >= this.switchUntil &&
      !this.reloading &&
      this.currentAmmo.mag > 0;

    if (wantFire && canRepeat && ready) this._shoot(now);

    this.triggerHeld = wantFire;
  }

  _shoot(now) {
    const w = this.weapon;
    const feel = w.feel;
    const camera = this.player.camera;

    this.lastShotAt = now;
    this.currentAmmo.mag--;
    if (w.boltActionMs) this.boltUntil = now + w.boltActionMs;

    // ---------------------------------------------------------- direction
    camera.getWorldDirection(this._dir);
    const spread = this.computeSpread();
    if (spread > 0) {
      // uniform disc inside the cone, then rotate into the camera basis
      this._right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      this._dir.addScaledVector(this._right, Math.cos(a) * r);
      this._dir.addScaledVector(this._up, Math.sin(a) * r);
      this._dir.normalize();
    }

    camera.getWorldPosition(this._origin);
    const origin = [this._origin.x, this._origin.y, this._origin.z];
    const dir = [this._dir.x, this._dir.y, this._dir.z];

    // ---------------------------------------------------------- world trace
    // Effects only. Players are deliberately NOT tested here.
    const hit = raycastWorld(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], WORLD.MAX_BULLET_RANGE);

    // ---------------------------------------------------------- feedback
    this.spread = Math.min(this.spread + feel.spreadPerShot, feel.spreadMax);
    const kickScale = this.view.adsBlend > 0.7 ? 0.72 : 1.0;
    this.player.addRecoil(
      feel.recoilV * kickScale * (0.82 + Math.random() * 0.36),
      feel.recoilH * kickScale * (Math.random() - 0.5) * 2
    );
    this.view.fire();

    this.onFire?.({
      weaponId: this.weaponId,
      origin,
      dir,
      hit,
      muzzle: this.view.muzzleWorldPosition().toArray(),
      eject: this.view.ejectWorldPosition().toArray(),
      recoilRecover: feel.recoilRecover,
      ammo: this.currentAmmo.mag
    });
  }

  /** FOV for the main camera this frame. */
  currentFov() {
    const w = this.weapon;
    const target = w.feel.adsFov;
    return this.baseFov + (target - this.baseFov) * this.view.adsBlend;
  }

  /** Mouse sensitivity multiplier -- slower the more zoomed you are. */
  sensitivityScale() {
    const w = this.weapon;
    if (w.scope && this.view.adsBlend > 0.5) {
      const scopeScale = w.scope.zoomedFov / this.baseFov;
      // blend from the outer ADS scale into the true scope scale
      const t = (this.view.adsBlend - 0.5) / 0.5;
      const outer = w.feel.adsFov / this.baseFov;
      return outer + (scopeScale - outer) * t;
    }
    const fovScale = this.currentFov() / this.baseFov;
    return 1 - (1 - fovScale) * 0.75;
  }

  /** Crosshair gap in pixels, driven by real spread. */
  crosshairSpread(viewportHeight, fov) {
    const spread = this.computeSpread();
    const fovRad = fov * Math.PI / 180;
    return clamp((spread / Math.tan(fovRad / 2)) * (viewportHeight / 2) * 0.5, 3, 90);
  }

  reloadProgress() {
    if (!this.reloading) return 0;
    const w = this.weapon;
    const total = this.currentAmmo.mag === 0 ? w.reloadEmptyMs : w.reloadMs;
    return clamp(1 - (this.reloadEndsAt - performance.now()) / total, 0, 1);
  }
}
