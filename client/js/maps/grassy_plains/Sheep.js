/**
 * Sheep.
 *
 * Ambient livestock: they graze, wander around their flock's anchor, and startle
 * when something is shot near them. Purely decorative -- no collider, no hitbox,
 * and no network traffic. Each client simulates its own flock from the shared herd
 * anchors, which is close enough that nobody notices they are not synchronised.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries, setVertexColor } from '../../core/GeoUtils.js';
import { SHEEP_HERDS } from '/shared/maps/grassy_plains/props.js';
import { heightAt } from '/shared/maps/grassy_plains/terrain.js';
import { makeRng, damp, clamp } from '/shared/math/num.js';

const WOOL = 0xe4e0d4;
const WOOL_SHADE = 0xc9c4b4;
const FACE = 0x3b3630;

/** Body + head, built once and shared. Legs are separate so they can swing. */
function buildBody() {
  const parts = [];

  const torso = new THREE.SphereGeometry(0.34, 10, 8);
  torso.scale(1.45, 0.95, 1.0);
  torso.translate(0, 0, 0);
  setVertexColor(torso, WOOL);
  parts.push(torso);

  // a couple of extra lumps so the fleece is not a smooth egg
  for (const [x, y, z, r] of [[-0.2, 0.16, 0.14, 0.2], [0.18, 0.18, -0.12, 0.19], [0.02, 0.2, 0.18, 0.17]]) {
    const lump = new THREE.SphereGeometry(r, 8, 6);
    lump.translate(x, y, z);
    setVertexColor(lump, WOOL_SHADE);
    parts.push(lump);
  }

  return mergeGeometries(parts);
}

function buildHead() {
  const parts = [];
  const skull = new THREE.SphereGeometry(0.15, 9, 7);
  skull.scale(1.25, 1.0, 0.95);
  setVertexColor(skull, FACE);
  parts.push(skull);

  const crown = new THREE.SphereGeometry(0.14, 8, 6);
  crown.translate(-0.05, 0.06, 0);
  setVertexColor(crown, WOOL);
  parts.push(crown);

  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.055, 6, 4);
    ear.scale(1.5, 0.6, 0.9);
    ear.translate(-0.02, 0.04, s * 0.13);
    setVertexColor(ear, FACE);
    parts.push(ear);
  }
  return mergeGeometries(parts);
}

function buildLeg() {
  const g = new THREE.CylinderGeometry(0.032, 0.026, 0.42, 5);
  g.translate(0, -0.21, 0);
  setVertexColor(g, FACE);
  return g;
}

class Sheep {
  constructor(herd, rng, material) {
    this.herd = herd;
    this.group = new THREE.Group();

    this.body = new THREE.Mesh(Sheep.bodyGeo, material);
    this.body.castShadow = true;
    this.body.position.y = 0.52;
    this.group.add(this.body);

    this.head = new THREE.Mesh(Sheep.headGeo, material);
    this.head.position.set(0.48, 0.62, 0);
    this.head.castShadow = true;
    this.group.add(this.head);

    this.legs = [];
    for (const [lx, lz] of [[0.24, 0.16], [0.24, -0.16], [-0.24, 0.16], [-0.24, -0.16]]) {
      const leg = new THREE.Mesh(Sheep.legGeo, material);
      leg.position.set(lx, 0.42, lz);
      this.legs.push(leg);
      this.group.add(leg);
    }

    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * herd.radius;
    this.pos = new THREE.Vector2(herd.x + Math.cos(a) * r, herd.z + Math.sin(a) * r);
    this.heading = rng() * Math.PI * 2;
    this.speed = 0;
    this.phase = rng() * 10;
    this.grazing = rng() < 0.6;
    this.timer = 1 + rng() * 4;
    this.scale = 0.85 + rng() * 0.3;
    this.spooked = 0;
    this.group.scale.setScalar(this.scale);
  }

  update(dt, rng) {
    this.timer -= dt;
    this.phase += dt;

    if (this.spooked > 0) {
      this.spooked -= dt;
      this.grazing = false;
      this.speed = damp(this.speed, 3.4, 6, dt);
    } else if (this.timer <= 0) {
      // flip between grazing and ambling somewhere else
      this.grazing = rng() < 0.55;
      this.timer = this.grazing ? 3 + rng() * 6 : 2 + rng() * 4;
      if (!this.grazing) this.heading += (rng() - 0.5) * 2.2;
    }

    if (!this.spooked) {
      this.speed = damp(this.speed, this.grazing ? 0 : 0.65, 3, dt);
    }

    // steer back toward the flock anchor when they drift too far
    const toHerdX = this.herd.x - this.pos.x;
    const toHerdZ = this.herd.z - this.pos.y;
    const distHerd = Math.hypot(toHerdX, toHerdZ);
    if (distHerd > this.herd.radius) {
      const want = Math.atan2(toHerdZ, toHerdX);
      let diff = want - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * clamp(dt * 1.6, 0, 1);
    }

    this.pos.x += Math.cos(this.heading) * this.speed * dt;
    this.pos.y += Math.sin(this.heading) * this.speed * dt;

    const ground = heightAt(this.pos.x, this.pos.y);
    this.group.position.set(this.pos.x, ground, this.pos.y);
    this.group.rotation.y = -this.heading;

    // --- animation ---
    const moving = this.speed > 0.05;
    const swing = moving ? Math.sin(this.phase * (6 + this.speed * 2)) * (0.25 + this.speed * 0.12) : 0;
    this.legs[0].rotation.z = swing;
    this.legs[3].rotation.z = swing;
    this.legs[1].rotation.z = -swing;
    this.legs[2].rotation.z = -swing;

    // head drops to the grass while grazing, bobs gently otherwise
    const graze = this.grazing && !moving ? 1 : 0;
    this.head.rotation.z = damp(this.head.rotation.z, graze ? 1.15 : 0.05, 4, dt);
    this.head.position.y = damp(this.head.position.y, graze ? 0.3 : 0.62, 4, dt);
    this.body.position.y = 0.52 + (moving ? Math.abs(Math.sin(this.phase * 6)) * 0.02 : 0);
  }

  startle(fromX, fromZ) {
    this.spooked = 1.5 + Math.random() * 1.5;
    this.heading = Math.atan2(this.pos.y - fromZ, this.pos.x - fromX);
  }
}

Sheep.bodyGeo = null;
Sheep.headGeo = null;
Sheep.legGeo = null;

export class SheepFlocks {
  constructor({ enabled = true } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'sheep';
    this.sheep = [];
    if (!enabled) return;

    Sheep.bodyGeo = buildBody();
    Sheep.headGeo = buildHead();
    Sheep.legGeo = buildLeg();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0
    });

    this.rng = makeRng(4242);
    for (const herd of SHEEP_HERDS) {
      for (let i = 0; i < herd.count; i++) {
        const s = new Sheep(herd, this.rng, this.material);
        this.sheep.push(s);
        this.group.add(s.group);
      }
    }
  }

  update(dt) {
    for (const s of this.sheep) s.update(dt, this.rng);
  }

  /** Gunfire nearby sends the flock running. */
  startleNear(x, z, radius = 22) {
    for (const s of this.sheep) {
      if (Math.hypot(s.pos.x - x, s.pos.y - z) < radius) s.startle(x, z);
    }
  }

  dispose() {
    Sheep.bodyGeo?.dispose();
    Sheep.headGeo?.dispose();
    Sheep.legGeo?.dispose();
    this.material?.dispose();
    Sheep.bodyGeo = Sheep.headGeo = Sheep.legGeo = null;
  }
}
