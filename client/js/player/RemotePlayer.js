/**
 * Another player, as seen from here.
 *
 * Snapshots arrive 20 times a second; we render them ~110 ms in the past and
 * interpolate between the two that bracket that time. That delay is what makes
 * other people move smoothly instead of teleporting, and it is the same delay the
 * server rewinds by when it decides whether your shot connected.
 */

import * as THREE from '../core/three.js';
import { createSoldier } from '../characters/Soldier.js';
import { Animator } from '../characters/Animator.js';
import { createWeaponModel } from '../weapons/WeaponModels.js';
import { STATE_BITS } from '/shared/protocol.js';
import { NET } from '/shared/config.js';
import { lerp, damp } from '/shared/math/num.js';

const NAME_FADE_START = 26;
const NAME_FADE_END = 46;

function makeNameplate(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.font = '600 52px Bahnschrift, "DIN Alternate", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = 'rgba(3, 7, 11, 0.92)';
  ctx.lineWidth = 9;
  ctx.strokeText(name, 256, 50);
  ctx.fillStyle = '#eef6ff';
  ctx.fillText(name, 256, 50);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,      // walls hide it -- a nameplate is not an x-ray
    depthWrite: false,
    fog: false
  }));
  sprite.scale.set(1.5, 0.28, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export class RemotePlayer {
  constructor(id, name, scene, opts = {}) {
    this.id = id;
    this.name = name;
    this.scene = scene;
    this.shadows = opts.shadows !== false;

    this.buffer = [];              // { t, x, y, z, yaw, pitch, state, alive }
    this.renderPos = new THREE.Vector3();
    this.prevRenderPos = new THREE.Vector3();
    this.renderYaw = 0;
    this.renderPitch = 0;
    this.speed = 0;
    this.alive = true;
    this.weaponId = opts.weaponId || 'ak47';
    this.visible = true;

    this.container = new THREE.Group();
    this.container.name = 'player-' + id;
    scene.add(this.container);

    this._buildBody();

    this.nameplate = makeNameplate(name);
    this.nameplate.position.set(0, 2.12, 0);
    this.container.add(this.nameplate);

    this._tmp = new THREE.Vector3();
  }

  _buildBody() {
    this.soldier = createSoldier({ shadows: this.shadows });
    this.animator = new Animator(this.soldier);
    this.animator.reset();
    this.container.add(this.soldier.group);
    this._attachWeapon(this.weaponId);
  }

  _attachWeapon(id) {
    if (this.weaponModel) {
      this.soldier.bones.weaponAnchor.remove(this.weaponModel.group);
      this.weaponModel.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
    }
    this.weaponModel = createWeaponModel(id, { worldModel: true });
    // Models are drawn muzzle-down-Z; the soldier faces +Z, so spin it around.
    this.weaponModel.group.rotation.set(0, Math.PI, 0);
    this.weaponModel.group.position.set(0, 0, 0);
    this.soldier.bones.weaponAnchor.add(this.weaponModel.group);
    this.weaponId = id;
  }

  setWeapon(id) {
    if (id && id !== this.weaponId) this._attachWeapon(id);
  }

  /** Push one server snapshot into the interpolation buffer. */
  applySnapshot(t, s) {
    const isAlive = s.a === 1;
    if (!this.alive && isAlive) {
      this.onRespawn();
    }
    this.buffer.push({
      t,
      x: s.p[0], y: s.p[1], z: s.p[2],
      yaw: s.y, pitch: s.t,
      state: s.s,
      alive: isAlive
    });
    // keep a little over the interpolation window
    const cutoff = t - (NET.INTERP_DELAY_MS + 600);
    while (this.buffer.length > 2 && this.buffer[0].t < cutoff) this.buffer.shift();

    if (s.w) this.setWeapon(s.w);
  }

  /** Called when the server reports this player fired. */
  onFired() {
    this.animator.addRecoil(1);
  }

  /**
   * @param {number} dt
   * @param {number} renderTime server clock, already offset by the interp delay
   * @param {THREE.Camera} camera
   */
  update(dt, renderTime, camera) {
    const buf = this.buffer;
    if (buf.length === 0) return;

    this.prevRenderPos.copy(this.renderPos);

    if (buf.length === 1 || renderTime <= buf[0].t) {
      const s = buf[0];
      this.renderPos.set(s.x, s.y, s.z);
      this.renderYaw = s.yaw;
      this.renderPitch = s.pitch;
      this.state = s.state;
      this.alive = s.alive;
    } else {
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (renderTime >= buf[i].t && renderTime <= buf[i + 1].t) {
          a = buf[i];
          b = buf[i + 1];
          break;
        }
      }
      const span = b.t - a.t;
      const f = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;

      this.renderPos.set(lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f));
      this.renderYaw = lerpAngle(a.yaw, b.yaw, f);
      this.renderPitch = lerp(a.pitch, b.pitch, f);
      this.state = f < 0.5 ? a.state : b.state;
      this.alive = f < 0.5 ? a.alive : b.alive;
    }

    // Ensure soldier mesh visibility matches alive state
    if (this.alive) {
      if (!this.soldier.group.visible) this.soldier.group.visible = true;
    } else {
      if (this.soldier.group.visible) this.soldier.group.visible = false;
    }

    // Speed for the gait, from actual rendered movement -- survives packet loss.
    if (dt > 0) {
      const instant = this.prevRenderPos.distanceTo(this.renderPos) / dt;
      this.speed = damp(this.speed, Math.min(instant, 12), 12, dt);
    }

    this.container.position.copy(this.renderPos);
    // The soldier is modelled facing +Z; network yaw 0 means facing -Z.
    this.container.rotation.y = this.renderYaw + Math.PI;

    const bits = this.state || 0;
    this.animator.update(dt, {
      speed: this.speed,
      grounded: (bits & STATE_BITS.AIRBORNE) === 0,
      crouch: (bits & STATE_BITS.CROUCH) !== 0,
      aim: (bits & STATE_BITS.ADS) !== 0,
      sprint: (bits & STATE_BITS.SPRINT) !== 0,
      pitch: this.renderPitch
    });

    this._updateNameplate(camera);
  }

  _updateNameplate(camera) {
    if (!camera) return;
    const dist = camera.position.distanceTo(this.renderPos);
    let opacity = 1;
    if (dist > NAME_FADE_START) {
      opacity = Math.max(0, 1 - (dist - NAME_FADE_START) / (NAME_FADE_END - NAME_FADE_START));
    }
    this.nameplate.material.opacity = opacity * 0.92;
    this.nameplate.visible = opacity > 0.02 && this.alive;
    // hold the plate at a constant on-screen size out to medium range
    const s = 1 + Math.min(dist, NAME_FADE_END) * 0.028;
    this.nameplate.scale.set(1.5 * s * 0.42, 0.28 * s * 0.42, 1);
    this.nameplate.position.y = ((this.state || 0) & STATE_BITS.CROUCH) ? 1.6 : 2.12;
  }

  /** World position of this player's muzzle, for remote muzzle flashes. */
  muzzleWorldPosition(out = new THREE.Vector3()) {
    if (this.weaponModel?.muzzle) {
      this.weaponModel.muzzle.getWorldPosition(out);
    } else {
      out.copy(this.renderPos).y += 1.4;
    }
    return out;
  }

  setVisible(v) {
    this.visible = v;
    this.soldier.group.visible = v;
    this.nameplate.visible = v && this.alive;
  }

  /**
   * Hand the current body over to the ragdoll system and build a fresh one for the
   * next life. Returns the soldier the caller should ragdoll.
   */
  detachForRagdoll() {
    const soldier = this.soldier;

    // Bake the rig's world transform into its local one before unparenting,
    // otherwise the ragdoll inherits an identity matrix and the corpse spawns at
    // the world origin instead of where the player was standing.
    this.container.updateMatrixWorld(true);
    soldier.group.updateMatrixWorld(true);
    const worldMatrix = soldier.group.matrixWorld.clone();
    this.container.remove(soldier.group);
    worldMatrix.decompose(soldier.group.position, soldier.group.quaternion, soldier.group.scale);
    soldier.group.updateMatrixWorld(true);
    // The weapon goes down with the body -- it is parented to the rig.
    this.weaponModel = null;
    this._buildBody();
    this.soldier.group.visible = false;
    this.nameplate.visible = false;
    return soldier;
  }

  onRespawn() {
    this.soldier.group.visible = true;
    this.animator.reset();
    this.speed = 0;
    this.buffer.length = 0;
  }

  dispose() {
    this.scene.remove(this.container);
    this.soldier.group.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    this.nameplate.material.map?.dispose();
    this.nameplate.material.dispose();
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
