/**
 * Ragdoll: verlet particles + distance constraints.
 *
 * Rather than detaching the mesh parts, this drives the EXISTING bone hierarchy --
 * bone world orientations are solved from particle pairs and converted back into
 * local space. Everything strapped to the rig (helmet, plate carrier, knee pads,
 * the weapon in the right hand) therefore comes along for free.
 *
 * Bodies settle, then sleep, then fade out.
 */

import * as THREE from '../core/three.js';
import { RIG } from '../characters/Soldier.js';
import { collideCapsule, heightAt, mapInfo } from '/shared/maps/active.js';

const GRAVITY = -22;
const DAMPING = 0.986;
const ITERATIONS = 9;
const PARTICLE_RADIUS = 0.11;
const SLEEP_SPEED = 0.012;
const SLEEP_TIME = 0.8;
const LIFETIME = 300;
const FADE_TIME = 3.0;

/**
 * Per-part collision radius. Varying these is what stops a settled body from
 * pancaking perfectly flat -- the torso rides higher than the limbs, the way a
 * real one would.
 */
const PART_RADIUS = {
  head: 0.13, chest: 0.19, pelvis: 0.17,
  shoulderL: 0.12, shoulderR: 0.12,
  elbowL: 0.07, elbowR: 0.07,
  handL: 0.06, handR: 0.06,
  hipL: 0.12, hipR: 0.12,
  kneeL: 0.08, kneeR: 0.08,
  footL: 0.07, footR: 0.07
};

/** name -> which bone we sample the initial world position from */
const PARTICLES = {
  head: 'head',
  chest: 'chest',
  pelvis: 'hips',
  shoulderL: 'shoulderL', shoulderR: 'shoulderR',
  elbowL: 'elbowL', elbowR: 'elbowR',
  handL: 'wristL', handR: 'wristR',
  hipL: 'hipL', hipR: 'hipR',
  kneeL: 'kneeL', kneeR: 'kneeR',
  footL: 'ankleL', footR: 'ankleR'
};

/** [a, b, stiffness] -- rest lengths are measured from the live rig on creation. */
const LINKS = [
  ['chest', 'head', 1.0],
  ['chest', 'pelvis', 1.0],
  ['chest', 'shoulderL', 1.0], ['chest', 'shoulderR', 1.0],
  ['shoulderL', 'elbowL', 1.0], ['elbowL', 'handL', 1.0],
  ['shoulderR', 'elbowR', 1.0], ['elbowR', 'handR', 1.0],
  ['pelvis', 'hipL', 1.0], ['pelvis', 'hipR', 1.0],
  ['hipL', 'kneeL', 1.0], ['kneeL', 'footL', 1.0],
  ['hipR', 'kneeR', 1.0], ['kneeR', 'footR', 1.0],
  // bracing keeps the torso from folding flat and the limbs from hyper-extending
  ['shoulderL', 'shoulderR', 0.85],
  ['hipL', 'hipR', 0.85],
  ['shoulderL', 'pelvis', 0.55], ['shoulderR', 'pelvis', 0.55],
  ['head', 'shoulderL', 0.45], ['head', 'shoulderR', 0.45],
  ['chest', 'hipL', 0.5], ['chest', 'hipR', 0.5],
  ['shoulderL', 'hipL', 0.3], ['shoulderR', 'hipR', 0.3],
  ['hipL', 'footL', 0.12], ['hipR', 'footR', 0.12],
  ['shoulderL', 'handL', 0.10], ['shoulderR', 'handR', 0.10]
];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _xAxis = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _parentQuat = new THREE.Quaternion();
const _tmpPos = [0, 0, 0];

export class Ragdoll {
  /**
   * @param {object} soldier result of createSoldier()
   * @param {THREE.Scene} scene
   * @param {{ impulse?: number[], velocity?: number[], hitY?: number, headshot?: boolean }} opts
   */
  constructor(soldier, scene, opts = {}) {
    this.soldier = soldier;
    this.scene = scene;
    this.bones = soldier.bones;
    this.age = 0;
    this.sleepTimer = 0;
    this.asleep = false;
    this.dead = false;

    // Take ownership of the rig, PRESERVING where it currently is in the world.
    // The rig is normally a child of a player container holding the position, so
    // reparenting without carrying the world transform across would drop every
    // corpse at the origin.
    soldier.group.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    soldier.group.matrixWorld.decompose(worldPos, worldQuat, worldScale);

    scene.add(soldier.group);
    soldier.group.position.copy(worldPos);
    soldier.group.quaternion.copy(worldQuat);
    soldier.group.scale.set(1, 1, 1);
    soldier.group.updateMatrixWorld(true);

    // --- particles from the current pose ---
    this.p = {};
    for (const [name, boneName] of Object.entries(PARTICLES)) {
      const bone = this.bones[boneName];
      const pos = new THREE.Vector3();
      bone.getWorldPosition(pos);
      this.p[name] = { pos, prev: pos.clone(), grounded: false, radius: PART_RADIUS[name] ?? 0.10 };
    }

    // --- constraints, measured from the rig so proportions always match ---
    this.links = LINKS.map(([a, b, stiff]) => ({
      a, b, stiff,
      rest: this.p[a].pos.distanceTo(this.p[b].pos)
    }));

    this.applyImpulse(opts);

    // Root the hierarchy at the pelvis particle; every bone is driven explicitly.
    this.bones.hips.position.set(0, 0, 0);

    this._collectFadeMaterials();
  }

  applyImpulse({ impulse = [0, 0, 1], velocity = [0, 0, 0], hitY = null, headshot = false }) {
    const dt = 1 / 60;
    const dir = _v1.set(impulse[0], impulse[1], impulse[2]);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    const base = _v2.set(velocity[0] || 0, velocity[1] || 0, velocity[2] || 0);
    const power = headshot ? 2.8 : 1.8;

    for (const [name, part] of Object.entries(this.p)) {
      // Everyone inherits the corpse's momentum...
      const vx = base.x, vy = base.y, vz = base.z;
      part.prev.set(
        part.pos.x - vx * dt,
        part.pos.y - vy * dt,
        part.pos.z - vz * dt
      );
      // ...and the bullet pushes the body naturally in the shot direction.
      let weight = 0.35;
      if (headshot && (name === 'head' || name === 'chest')) weight = 0.9;
      else if (hitY != null) {
        const dy = Math.abs(part.pos.y - hitY);
        weight = Math.max(0.2, 0.9 - dy * 1.1);
      } else if (name === 'chest' || name === 'pelvis') weight = 0.75;

      part.prev.x -= dir.x * power * weight * dt;
      part.prev.y -= (dir.y * power * weight * 0.4) * dt;
      part.prev.z -= dir.z * power * weight * dt;
    }
  }

  _collectFadeMaterials() {
    // Materials are shared between soldiers, so fading has to clone them first.
    this.fadeMaterials = new Set();
    this.soldier.group.traverse((o) => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => m.clone());
        o.material.forEach((m) => this.fadeMaterials.add(m));
      } else {
        o.material = o.material.clone();
        this.fadeMaterials.add(o.material);
      }
    });
  }

  update(dt) {
    if (this.dead) return;
    this.age += dt;

    if (!this.asleep) {
      this._integrate(dt);
      for (let i = 0; i < ITERATIONS; i++) this._solve();
      this._collide();
      this._checkSleep(dt);
    }

    this._driveBones();

    if (this.age > LIFETIME - FADE_TIME) {
      const t = Math.max(0, 1 - (this.age - (LIFETIME - FADE_TIME)) / FADE_TIME);
      for (const m of this.fadeMaterials) {
        m.transparent = true;
        m.opacity = t;
        m.depthWrite = t > 0.6;
      }
    }
    if (this.age > LIFETIME) this.dispose();
  }

  _integrate(dt) {
    // Maps can turn the pull off. In orbit a body keeps whatever motion the round
    // that killed it gave it, so the extra drag below is the only thing that ever
    // brings it to rest -- otherwise it drifts until it is culled.
    const scale = mapInfo()?.environment?.gravityScale ?? 1;
    const g = GRAVITY * scale * dt * dt;
    const drag = scale === 0 ? Math.exp(-0.55 * dt) : 1;
    for (const part of Object.values(this.p)) {
      const px = part.pos.x, py = part.pos.y, pz = part.pos.z;
      let vx = (px - part.prev.x) * DAMPING;
      let vy = (py - part.prev.y) * DAMPING;
      let vz = (pz - part.prev.z) * DAMPING;

      // Ground friction, applied to whatever is actually touching the snow.
      if (part.grounded) {
        vx *= 0.72;
        vz *= 0.72;
      }

      if (drag !== 1) { vx *= drag; vy *= drag; vz *= drag; }
      part.pos.set(px + vx, py + vy + g, pz + vz);
      part.prev.set(px, py, pz);
    }
  }

  _solve() {
    for (const link of this.links) {
      const a = this.p[link.a];
      const b = this.p[link.b];
      _v1.subVectors(b.pos, a.pos);
      const d = _v1.length();
      if (d < 1e-6) continue;
      const diff = ((d - link.rest) / d) * 0.5 * link.stiff;
      _v1.multiplyScalar(diff);
      a.pos.add(_v1);
      b.pos.sub(_v1);
    }
  }

  _collide() {
    for (const part of Object.values(this.p)) {
      part.grounded = false;
      const r = part.radius;

      // Cheap terrain test first -- it catches the overwhelming majority of contacts.
      const gh = heightAt(part.pos.x, part.pos.z);
      if (part.pos.y - r < gh) {
        part.pos.y = gh + r;
        part.grounded = true;
        continue;
      }

      // Only pay for full world collision near solids (the cabin, rocks, logs).
      _tmpPos[0] = part.pos.x;
      _tmpPos[1] = part.pos.y - r;
      _tmpPos[2] = part.pos.z;
      const res = collideCapsule(_tmpPos, r, r * 2, 0);
      part.pos.set(_tmpPos[0], _tmpPos[1] + r, _tmpPos[2]);
      if (res.grounded) part.grounded = true;
    }
  }

  _checkSleep(dt) {
    let moved = 0;
    for (const part of Object.values(this.p)) {
      moved += part.pos.distanceTo(part.prev);
    }
    if (moved < SLEEP_SPEED) {
      this.sleepTimer += dt;
      if (this.sleepTimer > SLEEP_TIME) this.asleep = true;
    } else {
      this.sleepTimer = 0;
    }
  }

  /** Convert particle geometry back into bone rotations. */
  _driveBones() {
    const p = this.p;
    const b = this.bones;

    // Root at the pelvis.
    this.soldier.group.position.copy(p.pelvis.pos);
    this.soldier.group.quaternion.identity();
    this.soldier.group.updateMatrixWorld(true);

    // Torso: -Y runs from chest down to pelvis, +X from left shoulder to right.
    _v1.subVectors(p.pelvis.pos, p.chest.pos);
    _v2.subVectors(p.shoulderR.pos, p.shoulderL.pos);
    this._setWorldQuat(b.hips, _v1, _v2);

    b.spine.quaternion.identity();
    b.chest.quaternion.identity();

    // Head
    _v1.subVectors(p.chest.pos, p.head.pos);
    _v2.subVectors(p.shoulderR.pos, p.shoulderL.pos);
    this._setWorldQuat(b.neck, _v1, _v2);
    b.head.quaternion.identity();

    // Limbs
    this._segment(b.shoulderL, p.shoulderL, p.elbowL);
    this._segment(b.elbowL, p.elbowL, p.handL);
    this._segment(b.shoulderR, p.shoulderR, p.elbowR);
    this._segment(b.elbowR, p.elbowR, p.handR);
    this._segment(b.hipL, p.hipL, p.kneeL);
    this._segment(b.kneeL, p.kneeL, p.footL);
    this._segment(b.hipR, p.hipR, p.kneeR);
    this._segment(b.kneeR, p.kneeR, p.footR);

    b.wristL.quaternion.identity();
    b.wristR.quaternion.identity();
    b.ankleL.rotation.set(0.35, 0, 0);
    b.ankleR.rotation.set(0.35, 0, 0);
  }

  _segment(bone, from, to) {
    _v1.subVectors(to.pos, from.pos);
    // Any stable perpendicular works: limbs are cylinders, twist is invisible.
    _v2.set(_v1.z, 0.15, -_v1.x);
    if (_v2.lengthSq() < 1e-6) _v2.set(1, 0, 0);
    this._setWorldQuat(bone, _v1, _v2);
  }

  /**
   * Point a bone's local -Y along `down`, with local +X biased toward `right`,
   * expressed in the parent's frame.
   */
  _setWorldQuat(bone, down, right) {
    _yAxis.copy(down).normalize().negate();                 // local +Y
    _xAxis.copy(right).projectOnPlane(_yAxis);
    if (_xAxis.lengthSq() < 1e-8) {
      _xAxis.set(1, 0, 0).projectOnPlane(_yAxis);
      if (_xAxis.lengthSq() < 1e-8) _xAxis.set(0, 0, 1).projectOnPlane(_yAxis);
    }
    _xAxis.normalize();
    _zAxis.crossVectors(_xAxis, _yAxis).normalize();

    _mat.makeBasis(_xAxis, _yAxis, _zAxis);
    _quat.setFromRotationMatrix(_mat);

    if (bone.parent) {
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(_parentQuat);
      bone.quaternion.copy(_parentQuat.invert()).multiply(_quat);
    } else {
      bone.quaternion.copy(_quat);
    }
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.scene.remove(this.soldier.group);
    this.soldier.group.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    for (const m of this.fadeMaterials) m.dispose();
    this.fadeMaterials.clear();
  }
}

/** Keeps the corpse count bounded so a long match cannot bleed performance. */
export class RagdollManager {
  constructor(scene, maxBodies = 20) {
    this.scene = scene;
    this.max = maxBodies;
    this.bodies = [];
  }

  spawn(soldier, opts) {
    const rag = new Ragdoll(soldier, this.scene, opts);
    this.bodies.push(rag);
    while (this.bodies.length > this.max) {
      this.bodies.shift().dispose();
    }
    return rag;
  }

  update(dt) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const r = this.bodies[i];
      r.update(dt);
      if (r.dead) this.bodies.splice(i, 1);
    }
  }

  clear() {
    for (const r of this.bodies) r.dispose();
    this.bodies.length = 0;
  }
}
