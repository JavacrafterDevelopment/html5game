/**
 * The player you actually control.
 *
 * Movement is simulated here and reported to the server -- the server owns health,
 * ammo and hit registration, but it trusts (within generous limits) where you say
 * you are. That keeps movement perfectly responsive on a home LAN, which matters far
 * more for feel than the small amount of trust it costs.
 *
 * Collision uses the shared collider, so the ground you walk on and the wall the
 * server stops bullets with are the same geometry.
 */

import * as THREE from '../core/three.js';
import { PLAYER, MOVE, WORLD } from '/shared/config.js';
import { collideCapsule } from '/shared/maps/snowy_forest/collision.js';
import { heightAt, slopeAt, normalAt } from '/shared/maps/snowy_forest/terrain.js';
import { clamp, damp, lerp } from '/shared/math/num.js';

const SLIDE_SLOPE = 0.44;   // above this the snow gives way under you

export class LocalPlayer {
  constructor(camera) {
    this.camera = camera;
    this.pos = [0, 0, 0];
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.grounded = true;
    this.crouching = false;
    this.sprinting = false;
    this.wasGrounded = true;
    this.alive = true;

    this.eyeHeight = PLAYER.EYE_HEIGHT;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepDistance = 0;
    this.landDip = 0;
    this.landDipVel = 0;
    this.viewRoll = 0;
    this.sway = new THREE.Vector2();

    // Recoil is applied on top of the look angles and decays back toward zero.
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.recoilTargetPitch = 0;
    this.recoilTargetYaw = 0;

    this.sensitivity = MOVE.MOUSE_SENS;
    this.onFootstep = null;
    this.onLand = null;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  reset(pos, yaw) {
    this.pos = [pos[0], pos[1], pos[2]];
    this.vel.set(0, 0, 0);
    this.yaw = yaw ?? 0;
    this.pitch = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.recoilTargetPitch = this.recoilTargetYaw = 0;
    this.crouching = false;
    this.sprinting = false;
    this.grounded = true;
    this.landDip = 0;
    this.landDipVel = 0;
    this.alive = true;
  }

  get height() { return this.crouching ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  get eyePosition() {
    return [this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]];
  }

  /** Weapon recoil pushes the view; recovery pulls most of it back down. */
  addRecoil(vertical, horizontal) {
    this.recoilTargetPitch += vertical;
    this.recoilTargetYaw += horizontal;
  }

  look(dx, dy, sensScale = 1) {
    const s = this.sensitivity * sensScale;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    // keep yaw bounded so it never loses float precision in a long match
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /**
   * @param {number} dt
   * @param {{ move:{x:number,z:number}, jump:boolean, crouch:boolean, sprint:boolean,
   *           ads:boolean, speedMult:number, frozen:boolean }} cmd
   */
  update(dt, cmd) {
    const wasGrounded = this.grounded;

    if (cmd.frozen || !this.alive) {
      this._updateCamera(dt, cmd);
      return;
    }

    // ---------------------------------------------------------- stance
    this.crouching = cmd.crouch;
    const canSprint = cmd.sprint && cmd.move.z > 0.2 && !cmd.ads && !this.crouching;
    this.sprinting = canSprint && this.grounded;

    const targetEye = this.crouching ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT;
    this.eyeHeight = damp(this.eyeHeight, targetEye, 13, dt);

    // ---------------------------------------------------------- wish dir
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos) with yaw 0 looking down -Z
    const wishX = -sin * cmd.move.z + cos * cmd.move.x;
    const wishZ = -cos * cmd.move.z - sin * cmd.move.x;

    let maxSpeed = this.crouching ? MOVE.CROUCH : this.sprinting ? MOVE.SPRINT : MOVE.WALK;
    maxSpeed *= cmd.speedMult ?? 1;
    if (cmd.ads) maxSpeed *= (1 - (1 - MOVE.ADS_MULT) * 0.75);

    // ---------------------------------------------------------- accelerate
    const wishLen = Math.hypot(wishX, wishZ);
    if (this.grounded) {
      // friction first, so releasing the keys actually stops you
      const sp = this.speed;
      if (sp > 0.001) {
        const drop = Math.max(sp, 1.2) * MOVE.FRICTION * dt;
        const scale = Math.max(0, sp - drop) / sp;
        this.vel.x *= scale;
        this.vel.z *= scale;
      }
      if (wishLen > 0.001) {
        const accel = MOVE.ACCEL * dt;
        const current = this.vel.x * (wishX / wishLen) + this.vel.z * (wishZ / wishLen);
        const add = clamp(maxSpeed - current, 0, accel * maxSpeed / MOVE.WALK);
        this.vel.x += (wishX / wishLen) * add;
        this.vel.z += (wishZ / wishLen) * add;
      }
    } else if (wishLen > 0.001) {
      const accel = MOVE.AIR_ACCEL * dt;
      const current = this.vel.x * (wishX / wishLen) + this.vel.z * (wishZ / wishLen);
      const add = clamp(maxSpeed - current, 0, accel);
      this.vel.x += (wishX / wishLen) * add;
      this.vel.z += (wishZ / wishLen) * add;
    }

    // ---------------------------------------------------------- jump
    if (cmd.jump && this.grounded && !this.crouching) {
      this.vel.y = MOVE.JUMP_VELOCITY;
      this.grounded = false;
    }

    // ---------------------------------------------------------- steep ground
    // The mountain ring is impassable because you slide off it, not because of a
    // fence. Nice side effect: the tops of boulders are genuinely awkward.
    if (this.grounded) {
      const slope = slopeAt(this.pos[0], this.pos[2], 0.9);
      if (slope > SLIDE_SLOPE) {
        const n = normalAt(this.pos[0], this.pos[2], 0.9);
        const push = (slope - SLIDE_SLOPE) * 46 * dt;
        this.vel.x += n[0] * push;
        this.vel.z += n[2] * push;
      }
    }

    // ---------------------------------------------------------- integrate
    this.vel.y -= MOVE.GRAVITY * dt;
    if (this.vel.y < -70) this.vel.y = -70;

    this.pos[0] += this.vel.x * dt;
    this.pos[1] += this.vel.y * dt;
    this.pos[2] += this.vel.z * dt;

    // ---------------------------------------------------------- collide
    const res = collideCapsule(this.pos, PLAYER.RADIUS, this.height, PLAYER.STEP_HEIGHT);

    if (res.grounded) {
      if (!wasGrounded && this.vel.y < -3) {
        const impact = Math.min(1, -this.vel.y / 18);
        this.landDipVel -= impact * 3.4;
        this.onLand?.(-this.vel.y);
      }
      this.grounded = true;
      if (this.vel.y < 0) this.vel.y = 0;
    } else {
      this.grounded = false;
    }
    if (res.ceiling && this.vel.y > 0) this.vel.y = 0;
    if (res.hitWall) {
      // Bleed a little speed into the wall so sliding along it feels solid.
      this.vel.x *= 0.86;
      this.vel.z *= 0.86;
    }

    // Absolute backstop: never leave the playable bowl.
    const r = Math.hypot(this.pos[0], this.pos[2]);
    if (r > WORLD.PLAY_RADIUS + 12) {
      const s = (WORLD.PLAY_RADIUS + 12) / r;
      this.pos[0] *= s;
      this.pos[2] *= s;
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }

    // ---------------------------------------------------------- footsteps
    if (this.grounded) {
      const moved = Math.hypot(this.vel.x, this.vel.z) * dt;
      this.stepDistance += moved;
      const strideLength = this.crouching ? 1.15 : this.sprinting ? 1.9 : 1.5;
      if (this.stepDistance > strideLength) {
        this.stepDistance = 0;
        if (this.speed > 0.8) this.onFootstep?.(this.speed, this.crouching);
      }
    }

    this.wasGrounded = wasGrounded;
    this._updateCamera(dt, cmd);
  }

  _updateCamera(dt, cmd) {
    // ---------------------------------------------------------- recoil
    // Kick is instant, recovery is smooth and only claws back ~70% (the rest is
    // the drift you have to correct yourself).
    this.recoilPitch = damp(this.recoilPitch, this.recoilTargetPitch, 26, dt);
    this.recoilYaw = damp(this.recoilYaw, this.recoilTargetYaw, 26, dt);
    const recover = cmd.recoilRecover ?? 7;
    this.recoilTargetPitch = damp(this.recoilTargetPitch, 0, recover, dt);
    this.recoilTargetYaw = damp(this.recoilTargetYaw, 0, recover, dt);

    // ---------------------------------------------------------- view bob
    const speed = this.speed;
    const moving = this.grounded && speed > 0.4;
    if (moving) {
      this.bobPhase += dt * clamp(speed * 1.9, 2, 15);
    } else {
      this.bobPhase += dt * 1.1;
    }
    const adsDamp = cmd.ads ? 0.22 : 1;
    const targetBob = moving ? clamp(speed / MOVE.SPRINT, 0, 1) * 0.045 * adsDamp : 0.004 * adsDamp;
    this.bobAmount = damp(this.bobAmount, targetBob, 8, dt);

    const bobX = Math.cos(this.bobPhase * 0.5) * this.bobAmount * 1.1;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * this.bobAmount;

    // landing dip: a spring, so heavy landings compress and rebound
    this.landDipVel += -this.landDip * 120 * dt;
    this.landDipVel *= Math.exp(-11 * dt);
    this.landDip += this.landDipVel * dt;
    this.landDip = clamp(this.landDip, -0.35, 0.12);

    // slight roll when strafing
    const strafeRoll = -(cmd.move?.x ?? 0) * (cmd.ads ? 0.006 : 0.017);
    this.viewRoll = damp(this.viewRoll, strafeRoll, 7, dt);

    // ---------------------------------------------------------- apply
    this.camera.position.set(
      this.pos[0] + bobX,
      this.pos[1] + this.eyeHeight + bobY + this.landDip,
      this.pos[2]
    );

    this._euler.set(
      this.pitch + this.recoilPitch,
      this.yaw + this.recoilYaw,
      this.viewRoll,
      'YXZ'
    );
    this.camera.quaternion.setFromEuler(this._euler);
  }

  /** Unit vector the camera is looking along. */
  getAimDirection(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
  }

  /** Ground height directly under the player (used for audio and spawn checks). */
  groundHeight() {
    return heightAt(this.pos[0], this.pos[2]);
  }

  /** Packed movement state bits for the network layer. */
  stateBits(bits, extra = {}) {
    let s = 0;
    if (this.crouching) s |= bits.CROUCH;
    if (this.sprinting) s |= bits.SPRINT;
    if (extra.ads) s |= bits.ADS;
    if (!this.grounded) s |= bits.AIRBORNE;
    if (this.speed > 0.5) s |= bits.MOVING;
    if (extra.firing) s |= bits.FIRING;
    if (extra.reloading) s |= bits.RELOADING;
    return s;
  }
}
