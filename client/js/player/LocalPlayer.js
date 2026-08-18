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
import { collideCapsule, heightAt, slopeAt, normalAt, movement, terrainConfig } from '/shared/maps/active.js';
import { clamp, damp, lerp } from '/shared/math/num.js';

const SLIDE_SLOPE = MOVE.SLIDE_SLOPE;   // above this the ground gives way under you

// Scratch, so flight does not allocate a vector per frame.
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _terrain = () => terrainConfig();

export class LocalPlayer {
  constructor(camera) {
    this.camera = camera;
    this.pos = [0, 0, 0];
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    /**
     * Bank angle. On the ground this is only ever the few thousandths of a radian
     * the strafe lean puts in; in orbit it is a real control axis, it holds
     * wherever you leave it, and it is how you end up upside down.
     */
    this.roll = 0;
    this.rollVel = 0;
    this.flying = false;

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
    this.roll = 0;
    this.rollVel = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.recoilTargetPitch = this.recoilTargetYaw = 0;
    this.crouching = false;
    this.sprinting = false;
    this.grounded = true;
    this.landDip = 0;
    this.landDipVel = 0;
    this.alive = true;
  }

  get height() {
    if (this.flying) return PLAYER.FLIGHT_HEIGHT;
    return this.crouching ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;
  }

  get radius() { return this.flying ? PLAYER.FLIGHT_RADIUS : PLAYER.RADIUS; }
  /**
   * Speed as the rest of the game means it: how fast you are travelling over the
   * ground. In flight there is no ground, so all three axes count.
   */
  get speed() {
    return this.flying
      ? this.vel.length()
      : Math.hypot(this.vel.x, this.vel.z);
  }

  get eyePosition() {
    return [this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]];
  }

  /** Weapon recoil pushes the view; recovery pulls most of it back down. */
  addRecoil(vertical, horizontal) {
    this.recoilTargetPitch += vertical;
    this.recoilTargetYaw += horizontal;
  }

  /**
   * Recoil as actual momentum, down the barrel and backwards.
   *
   * Only in flight. On the ground the recoil of a rifle goes into the planet
   * through your boots, and a player who slid backwards every time they fired
   * would be wrong as well as miserable.
   *
   * @param {THREE.Vector3} dir where the round went
   * @param {number} speed metres per second of shove
   */
  pushBack(dir, speed) {
    if (!this.flying) return;
    this.vel.addScaledVector(dir, -speed);
  }

  look(dx, dy, sensScale = 1) {
    const s = this.sensitivity * sensScale;
    // Banked over, the yaw axis is no longer the one that runs across the screen.
    // Rotating the mouse delta by the bank angle keeps "mouse right" meaning right
    // as you see it -- without this, flying upside down inverts both axes and the
    // controls feel broken rather than inverted.
    if (this.flying && this.roll !== 0) {
      const c = Math.cos(this.roll), sn = Math.sin(this.roll);
      const rx = dx * c + dy * sn;
      const ry = -dx * sn + dy * c;
      dx = rx; dy = ry;
    }
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
    const mv = movement();
    this.flying = mv.mode === 'zerog';

    if (cmd.frozen || !this.alive) {
      this._updateCamera(dt, cmd);
      return;
    }

    if (this.flying) {
      this._updateFlight(dt, cmd, mv);
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
        // The surface normal's horizontal part points downhill.
        const dl = Math.hypot(n[0], n[2]) || 1;
        const ux = -n[0] / dl, uz = -n[2] / dl;      // uphill

        // Kill the uphill component of your velocity: on ground this steep there is
        // simply no traction. Merely adding a downhill push is not enough -- the
        // movement code drives velocity back to full speed every frame and you walk
        // up the mountain anyway, straight into the numeric clamp.
        const along = this.vel.x * ux + this.vel.z * uz;
        if (along > 0) {
          this.vel.x -= ux * along;
          this.vel.z -= uz * along;
        }

        const push = (slope - SLIDE_SLOPE) * MOVE.SLIDE_ACCEL * dt;
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

  /**
   * Free flight, on cold gas.
   *
   * The controls are the ordinary ones pointed somewhere new. W and S still mean
   * forward and back, they just follow where you are looking rather than the
   * ground; A and D still strafe; space and crouch translate up and down relative
   * to your own body. Q and E fire the side thrusters, and the bank they put in
   * stays put -- there is no horizon to level against and nothing to level you.
   *
   * Velocity approaches the commanded speed exponentially rather than being set
   * outright, which gives thrusters a spool-up, and coasts back down on a much
   * slower constant so letting go leaves you drifting instead of stopping dead.
   */
  _updateFlight(dt, cmd, mv) {
    this.crouching = false;
    this.sprinting = false;
    this.grounded = false;
    this.eyeHeight = damp(this.eyeHeight, PLAYER.FLIGHT_HEIGHT * 0.5, 12, dt);

    // ---------------------------------------------------------- attitude
    const rollIn = clamp(cmd.roll ?? 0, -1, 1);
    this.rollVel = damp(this.rollVel, rollIn * mv.rollRate, mv.rollDamp, dt);
    this.roll += this.rollVel * dt;
    if (this.roll > Math.PI) this.roll -= Math.PI * 2;
    if (this.roll < -Math.PI) this.roll += Math.PI * 2;

    // ---------------------------------------------------------- thrust
    // Off the camera basis, so the bank comes along: rolled over, "up" on the
    // thrusters is up as far as you are concerned, which is the whole point.
    this._euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    _q.setFromEuler(this._euler);
    this._forward.set(0, 0, -1).applyQuaternion(_q);
    this._right.set(1, 0, 0).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);

    _wish.set(0, 0, 0)
      .addScaledVector(this._forward, cmd.move.z)
      .addScaledVector(this._right, cmd.move.x)
      .addScaledVector(_up, clamp(cmd.lift ?? 0, -1, 1));

    const wishLen = _wish.length();
    const maxSpeed = (cmd.sprint ? mv.boostSpeed : mv.speed) * (cmd.speedMult ?? 1);
    if (wishLen > 0.001) {
      _wish.multiplyScalar(Math.min(1, wishLen) / wishLen * maxSpeed);
      this.vel.x = damp(this.vel.x, _wish.x, mv.thrust, dt);
      this.vel.y = damp(this.vel.y, _wish.y, mv.thrust, dt);
      this.vel.z = damp(this.vel.z, _wish.z, mv.thrust, dt);
    } else {
      const k = Math.exp(-mv.drift * dt);
      this.vel.multiplyScalar(k);
    }

    // ---------------------------------------------------------- boundary
    // There is no geometry out here to stop anyone with, so the edge of the map
    // is your own thrusters turning you around: a push that grows with how far out
    // you are. You feel it well before you reach the numeric clamp, which is the
    // difference between a boundary and an invisible wall.
    const r = Math.hypot(this.pos[0], this.pos[1], this.pos[2]);
    const play = _terrain().playRadius;
    if (r > play) {
      const over = Math.min(1, (r - play) / 24);
      const push = over * 26 * dt;
      this.vel.x -= (this.pos[0] / r) * push;
      this.vel.y -= (this.pos[1] / r) * push;
      this.vel.z -= (this.pos[2] / r) * push;
    }

    // ---------------------------------------------------------- integrate
    this.pos[0] += this.vel.x * dt;
    this.pos[1] += this.vel.y * dt;
    this.pos[2] += this.vel.z * dt;

    const res = collideCapsule(this.pos, PLAYER.FLIGHT_RADIUS, PLAYER.FLIGHT_HEIGHT, 0);
    if (res.hitWall || res.ceiling) {
      // Station structure does not bounce. You stop against it and stay stopped.
      this.vel.multiplyScalar(0.38);
    }

    const hard = _terrain().hardRadius;
    const rr = Math.hypot(this.pos[0], this.pos[1], this.pos[2]);
    if (rr > hard) {
      const k = hard / rr;
      this.pos[0] *= k; this.pos[1] *= k; this.pos[2] *= k;
      this.vel.multiplyScalar(0.2);
    }

    this.wasGrounded = false;
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
    // In free fall your feet are not hitting anything, so none of the walking
    // flourishes apply. What is left is the bank, which is a control input rather
    // than a flourish and must not be damped toward level.
    if (this.flying) {
      this.bobAmount = damp(this.bobAmount, 0, 9, dt);
      this.landDip = damp(this.landDip, 0, 9, dt);
      this.viewRoll = damp(this.viewRoll, -(cmd.move?.x ?? 0) * 0.010, 6, dt);
      this.camera.position.set(this.pos[0], this.pos[1] + this.eyeHeight, this.pos[2]);
      this._euler.set(
        this.pitch + this.recoilPitch,
        this.yaw + this.recoilYaw,
        this.roll + this.viewRoll,
        'YXZ'
      );
      this.camera.quaternion.setFromEuler(this._euler);
      return;
    }

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
