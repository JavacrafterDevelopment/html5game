/**
 * Procedural animation for the soldier rig. No clips, no keyframes -- poses are
 * computed from movement speed, stance and look pitch every frame.
 *
 * Convention: the soldier is modelled facing +Z, so a NEGATIVE rotation.x on a
 * shoulder or hip swings that limb FORWARD.
 */

import { RIG } from './Soldier.js';
import { damp, lerp, clamp } from '/shared/math/num.js';

const CROUCH_HIP_Y = 0.63;

/** Base weapon-carry pose, radians. */
const POSE = {
  // right hand on the pistol grip
  shoulderR: { x: -1.28, y: 0.30, z: -0.30 },
  elbowR: { x: -0.42, y: 0.55, z: 0 },
  // left hand out on the handguard
  shoulderL: { x: -1.42, y: -0.62, z: 0.30 },
  elbowL: { x: -0.95, y: -0.62, z: 0 },
  // lowered when sprinting
  lowShoulderR: { x: -0.55, y: 0.22, z: -0.22 },
  lowElbowR: { x: -1.15, y: 0.55, z: 0 },
  lowShoulderL: { x: -0.70, y: -0.45, z: 0.26 },
  lowElbowL: { x: -1.35, y: -0.55, z: 0 }
};

export class Animator {
  constructor(soldier) {
    this.s = soldier;
    this.phase = 0;
    this.bob = 0;
    this.aimBlend = 0;
    this.crouchBlend = 0;
    this.sprintBlend = 0;
    this.airBlend = 0;
    this.recoilKick = 0;
    this.breath = Math.random() * 10;
    this.frozen = false;
  }

  /** Called when this player fires, so remote viewers see the shoulder buck. */
  addRecoil(amount = 1) {
    this.recoilKick = Math.min(1.4, this.recoilKick + amount);
  }

  /**
   * @param {number} dt seconds
   * @param {{speed:number, grounded:boolean, crouch:boolean, aim:boolean, sprint:boolean, pitch:number}} st
   */
  update(dt, st) {
    if (this.frozen) return;
    const b = this.s.bones;

    // --- blends ---
    this.crouchBlend = damp(this.crouchBlend, st.crouch ? 1 : 0, 12, dt);
    this.aimBlend = damp(this.aimBlend, st.aim ? 1 : 0, 14, dt);
    this.sprintBlend = damp(this.sprintBlend, st.sprint && st.speed > 4 && !st.aim ? 1 : 0, 9, dt);
    this.airBlend = damp(this.airBlend, st.grounded ? 0 : 1, 8, dt);
    this.recoilKick = damp(this.recoilKick, 0, 9, dt);
    this.breath += dt;

    const speed = st.speed || 0;
    const moving = speed > 0.35 && st.grounded;

    // --- gait ---
    // Stride frequency scales with speed so walking and sprinting share one cycle.
    const strideRate = clamp(speed * 1.35, 0, 13);
    if (moving) this.phase += dt * strideRate;
    else this.phase = damp(this.phase % (Math.PI * 2), Math.PI * 0.5, 6, dt);

    const gait = clamp(speed / 7.4, 0, 1);
    const swing = moving ? lerp(0.30, 0.72, gait) * (1 - this.crouchBlend * 0.45) : 0;
    const kneeAmp = moving ? lerp(0.55, 1.15, gait) : 0;

    const sinL = Math.sin(this.phase);
    const sinR = Math.sin(this.phase + Math.PI);

    // hips / vertical bob
    const bobAmt = moving ? lerp(0.012, 0.045, gait) : 0;
    this.bob = damp(this.bob, Math.abs(Math.sin(this.phase)) * bobAmt, 16, dt);
    const idleBreath = Math.sin(this.breath * 1.7) * 0.006;
    b.hips.position.y = lerp(RIG.hipY, CROUCH_HIP_Y, this.crouchBlend) - this.bob + idleBreath;

    // --- legs ---
    const crouchHip = this.crouchBlend * -0.95;
    const crouchKnee = this.crouchBlend * 1.75;
    const airHip = this.airBlend * -0.42;
    const airKnee = this.airBlend * 0.85;

    b.hipL.rotation.x = sinL * swing + crouchHip + airHip;
    b.hipR.rotation.x = sinR * swing + crouchHip + airHip;
    b.hipL.rotation.z = this.crouchBlend * -0.14;
    b.hipR.rotation.z = this.crouchBlend * 0.14;

    // Knees only bend backwards: clamp the cycle to positive rotation.
    b.kneeL.rotation.x = Math.max(0, -Math.sin(this.phase - 0.75)) * kneeAmp + crouchKnee + airKnee;
    b.kneeR.rotation.x = Math.max(0, -Math.sin(this.phase + Math.PI - 0.75)) * kneeAmp + crouchKnee + airKnee;

    b.ankleL.rotation.x = -b.kneeL.rotation.x * 0.35 + (moving ? sinL * 0.16 : 0.05);
    b.ankleR.rotation.x = -b.kneeR.rotation.x * 0.35 + (moving ? sinR * 0.16 : 0.05);

    // --- torso ---
    const pitch = clamp(st.pitch || 0, -1.4, 1.4);
    const leanForward = lerp(0, -0.22, this.sprintBlend) + this.crouchBlend * -0.18;
    const swayZ = moving ? Math.sin(this.phase) * 0.035 * gait : Math.sin(this.breath * 1.3) * 0.008;

    b.spine.rotation.x = pitch * 0.16 + leanForward * 0.5;
    b.spine.rotation.z = swayZ;
    b.chest.rotation.x = pitch * 0.30 + leanForward * 0.5 - this.recoilKick * 0.06;
    b.chest.rotation.y = moving ? -Math.sin(this.phase) * 0.09 * gait : 0;

    // The head keeps looking where the player looks, whatever the torso is doing.
    b.neck.rotation.x = pitch * 0.5 - b.chest.rotation.x - b.spine.rotation.x + pitch * 0.54;
    b.neck.rotation.y = -b.chest.rotation.y;

    // --- arms ---
    // Shoulders absorb whatever pitch the torso did not, so the muzzle tracks the
    // player's actual aim direction instead of drifting off it.
    const armPitch = pitch - (b.chest.rotation.x + b.spine.rotation.x);
    const sp = this.sprintBlend;

    const srx = lerp(POSE.shoulderR.x, POSE.lowShoulderR.x, sp);
    const sry = lerp(POSE.shoulderR.y, POSE.lowShoulderR.y, sp);
    const srz = lerp(POSE.shoulderR.z, POSE.lowShoulderR.z, sp);
    const slx = lerp(POSE.shoulderL.x, POSE.lowShoulderL.x, sp);
    const sly = lerp(POSE.shoulderL.y, POSE.lowShoulderL.y, sp);
    const slz = lerp(POSE.shoulderL.z, POSE.lowShoulderL.z, sp);

    // Aiming tucks the elbows in and brings the weapon up to the eyeline.
    const aimTuck = this.aimBlend;
    const armSwing = moving && sp > 0.4 ? Math.sin(this.phase) * 0.22 * gait : 0;

    b.shoulderR.rotation.set(
      srx + armPitch * (1 - sp * 0.6) - aimTuck * 0.10 + armSwing,
      sry - aimTuck * 0.12,
      srz + aimTuck * 0.10 + this.recoilKick * 0.12
    );
    b.elbowR.rotation.set(
      lerp(POSE.elbowR.x, POSE.lowElbowR.x, sp) - this.recoilKick * 0.20,
      lerp(POSE.elbowR.y, POSE.lowElbowR.y, sp) - aimTuck * 0.18,
      0
    );
    b.shoulderL.rotation.set(
      slx + armPitch * (1 - sp * 0.6) - aimTuck * 0.06 - armSwing,
      sly + aimTuck * 0.16,
      slz - aimTuck * 0.06
    );
    b.elbowL.rotation.set(
      lerp(POSE.elbowL.x, POSE.lowElbowL.x, sp),
      lerp(POSE.elbowL.y, POSE.lowElbowL.y, sp) + aimTuck * 0.10,
      0
    );

    // --- weapon ---
    // Cancel out whatever the torso already did so the muzzle ends up on the
    // player's true aim line, then drop it while sprinting.
    if (b.weaponAnchor) {
      b.weaponAnchor.rotation.x = armPitch - this.recoilKick * 0.28 + sp * 0.55;
      b.weaponAnchor.rotation.y = sp * 0.5;
      b.weaponAnchor.rotation.z = sp * -0.35;
      b.weaponAnchor.position.set(
        lerp(0.155, 0.10, aimTuck),
        lerp(-0.02, 0.055, aimTuck) - sp * 0.06,
        lerp(0.26, 0.30, aimTuck) - this.recoilKick * 0.04
      );
    }
  }

  /** Snap to a neutral standing pose (used before the first update). */
  reset() {
    this.phase = 0;
    this.bob = 0;
    this.aimBlend = 0;
    this.crouchBlend = 0;
    this.sprintBlend = 0;
    this.airBlend = 0;
    this.recoilKick = 0;
    this.frozen = false;
    this.update(0.016, { speed: 0, grounded: true, crouch: false, aim: false, sprint: false, pitch: 0 });
  }
}
