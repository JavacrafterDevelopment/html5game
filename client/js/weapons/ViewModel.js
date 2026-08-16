/**
 * First-person weapon presentation.
 *
 * Everything is procedural: hip/ADS blending, sway that lags the mouse, walk bob,
 * recoil kick, reload and bolt-cycle motions. The ADS pose is not hand-authored --
 * it is derived from the model's own sight point, so the irons land dead centre on
 * the screen for every weapon automatically.
 */

import * as THREE from '../core/three.js';
import { createWeaponModel, disposeWeaponModel } from './WeaponModels.js';
import { getWeapon } from '/shared/weapons.js';
import { damp, clamp, lerp } from '/shared/math/num.js';

export class ViewModel {
  constructor(camera) {
    this.camera = camera;

    // Container isolates the weapon from the camera's own bob/roll.
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    camera.add(this.root);

    this.holder = new THREE.Group();
    this.root.add(this.holder);

    this.model = null;
    this.weaponId = null;
    this.def = null;

    this.adsBlend = 0;
    this.sprintBlend = 0;
    this.reloadT = 0;
    this.reloadDuration = 0;
    this.boltT = 0;
    this.boltDuration = 0;

    this.kick = 0;
    this.kickRot = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.bobPhase = 0;
    this.bobOffset = new THREE.Vector3();
    this.lowerBlend = 0;

    this._hipPos = new THREE.Vector3();
    this._adsPos = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._targetRot = new THREE.Euler();
    this._muzzleWorld = new THREE.Vector3();
  }

  setWeapon(id, force = false) {
    if (this.weaponId === id && this.model && !force) return;
    if (this.model) {
      this.holder.remove(this.model.group);
      disposeWeaponModel(this.model);
    }
    this.weaponId = id;
    this.def = getWeapon(id);
    this.model = createWeaponModel(id);
    this.holder.add(this.model.group);

    const view = this.def.view;
    this._hipPos.set(view.hip[0], view.hip[1], view.hip[2]);

    // Put the weapon's own sight point exactly on the screen centre.
    const s = this.model.sight;
    this._adsPos.set(-s.x, -s.y, view.ads[2] - s.z);

    // Reset transient animation state so swapping weapons never looks glitchy.
    this.kick = 0;
    this.kickRot = 0;
    this.reloadT = 0;
    this.boltT = 0;
    this.adsBlend = 0;
  }

  /** Trigger the recoil animation for one shot. */
  fire() {
    const feel = this.def.feel;
    this.kick = Math.min(this.kick + feel.kickBack, feel.kickBack * 2.2);
    this.kickRot = Math.min(this.kickRot + feel.kickBack * 2.6, feel.kickBack * 5);
    if (this.def.boltActionMs) {
      this.boltT = 1;
      this.boltDuration = this.def.boltActionMs / 1000;
    }
  }

  startReload(durationMs) {
    this.reloadT = 1;
    this.reloadDuration = durationMs / 1000;
  }

  cancelReload() {
    this.reloadT = 0;
  }

  /**
   * @param {number} dt
   * @param {{ads:boolean, sprint:boolean, speed:number, grounded:boolean,
   *           lookDX:number, lookDY:number, lowered:boolean}} st
   */
  update(dt, st) {
    if (!this.model) return;
    const feel = this.def.feel;

    // ---------------------------------------------------------- blends
    const adsSpeed = 1000 / Math.max(60, feel.adsMs);
    this.adsBlend = damp(this.adsBlend, st.ads && !st.sprint ? 1 : 0, adsSpeed * 2.2, dt);
    this.sprintBlend = damp(this.sprintBlend, st.sprint ? 1 : 0, 9, dt);
    this.lowerBlend = damp(this.lowerBlend, st.lowered ? 1 : 0, 10, dt);

    if (this.reloadT > 0 && this.reloadDuration > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt / this.reloadDuration);
    }
    if (this.boltT > 0 && this.boltDuration > 0) {
      this.boltT = Math.max(0, this.boltT - dt / this.boltDuration);
    }

    this.kick = damp(this.kick, 0, 13, dt);
    this.kickRot = damp(this.kickRot, 0, 11, dt);

    // ---------------------------------------------------------- sway
    // The weapon lags behind the mouse, much less so when aiming.
    const swayScale = lerp(0.055, 0.011, this.adsBlend);
    this.swayTarget.x = clamp(-st.lookDX * swayScale, -0.09, 0.09);
    this.swayTarget.y = clamp(st.lookDY * swayScale, -0.07, 0.07);
    this.sway.x = damp(this.sway.x, this.swayTarget.x, 9, dt);
    this.sway.y = damp(this.sway.y, this.swayTarget.y, 9, dt);
    this.swayTarget.multiplyScalar(Math.exp(-8 * dt));

    // ---------------------------------------------------------- bob
    const moving = st.grounded && st.speed > 0.4;
    this.bobPhase += dt * (moving ? clamp(st.speed * 1.9, 2, 15) : 1.2);
    const bobScale = lerp(1, 0.18, this.adsBlend) * (moving ? clamp(st.speed / 7.4, 0.15, 1) : 0.12);
    this.bobOffset.set(
      Math.cos(this.bobPhase * 0.5) * 0.019 * bobScale,
      Math.abs(Math.sin(this.bobPhase)) * 0.016 * bobScale - 0.004,
      Math.sin(this.bobPhase * 0.5) * 0.008 * bobScale
    );

    // ---------------------------------------------------------- pose
    this._targetPos.lerpVectors(this._hipPos, this._adsPos, smooth(this.adsBlend));
    this._targetPos.add(this.bobOffset);
    this._targetPos.x += this.sway.x;
    this._targetPos.y += this.sway.y;

    const hipRot = this.def.view.hipRot;
    let rx = lerp(hipRot[0], 0, this.adsBlend);
    let ry = lerp(hipRot[1], 0, this.adsBlend);
    let rz = 0;

    // sprint: weapon swings down and across
    const sp = this.sprintBlend * (1 - this.adsBlend);
    this._targetPos.x += sp * 0.10;
    this._targetPos.y -= sp * 0.075;
    this._targetPos.z += sp * 0.07;
    rx += sp * 0.30;
    ry += sp * 0.55;
    rz += sp * 0.42;
    // running bounce
    if (sp > 0.05) {
      rz += Math.sin(this.bobPhase) * 0.05 * sp;
      this._targetPos.y += Math.abs(Math.sin(this.bobPhase)) * 0.02 * sp;
    }

    // lowered (dead / menus)
    this._targetPos.y -= this.lowerBlend * 0.34;
    rx += this.lowerBlend * 0.85;

    // reload: drop the weapon, tilt it toward the mag well, bring it back
    if (this.reloadT > 0) {
      const t = 1 - this.reloadT;                 // 0 -> 1 across the reload
      const arc = Math.sin(t * Math.PI);          // peaks in the middle
      this._targetPos.y -= arc * 0.13;
      this._targetPos.x += arc * 0.045;
      this._targetPos.z += arc * 0.05;
      rx += arc * 0.52;
      rz += arc * 0.40;
      // a shake as the fresh magazine seats
      if (t > 0.55 && t < 0.72) {
        const s = Math.sin((t - 0.55) * 42) * 0.012;
        this._targetPos.y += s;
      }
    }

    // bolt cycle (M700): hand comes off the grip, rifle rolls
    if (this.boltT > 0) {
      const t = 1 - this.boltT;
      const arc = Math.sin(t * Math.PI);
      rz += arc * 0.22;
      rx += arc * 0.10;
      this._targetPos.y -= arc * 0.03;
      this._targetPos.z += arc * 0.02;
    }

    // recoil
    this._targetPos.z += this.kick;
    this._targetPos.y += this.kick * 0.28;
    rx -= this.kickRot;
    rz += this.kickRot * 0.24;

    // ---------------------------------------------------------- apply
    this.holder.position.copy(this._targetPos);
    this.holder.rotation.set(rx, ry, rz);
  }

  /** True once the sights are close enough to count as aimed. */
  get isAimed() { return this.adsBlend > 0.86; }

  muzzleWorldPosition(out = this._muzzleWorld) {
    if (!this.model) return out.set(0, 0, 0);
    this.model.muzzle.getWorldPosition(out);
    return out;
  }

  ejectWorldPosition(out = new THREE.Vector3()) {
    if (!this.model) return out.set(0, 0, 0);
    this.model.eject.getWorldPosition(out);
    return out;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    if (this.model) disposeWeaponModel(this.model);
    this.camera.remove(this.root);
  }
}

/** Ease the ADS blend so the transition starts fast and settles gently. */
function smooth(t) {
  return t * t * (3 - 2 * t);
}
