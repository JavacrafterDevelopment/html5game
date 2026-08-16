/**
 * Weapon effects: muzzle flash, tracers, impact debris, ejected brass.
 *
 * IMPORTANT (hardcore rules): nothing in this file reacts to hitting a PLAYER.
 * The client traces only against world geometry, so a round that passes through
 * someone still throws its puff against whatever is behind them. There is no visual
 * difference between a hit and a miss, which is exactly the intent.
 */

import * as THREE from '../core/three.js';
import { KIND } from '/shared/maps/snowy_forest/collision.js';
import { heightAt } from '/shared/maps/snowy_forest/terrain.js';

// ------------------------------------------------------------ debris particles
// A ShaderMaterial with `fog: true` MUST also carry the fog uniforms and shader
// chunks. Declaring fog without them makes Three throw inside refreshFogUniforms
// on the first draw, which aborts the rest of the frame -- silently taking out
// everything queued behind it (snowfall, tracers, muzzle flashes, the scope).
const PARTICLE_VERT = /* glsl */`
#include <fog_pars_vertex>
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * (300.0 / max(-mvPosition.z, 0.5));
  #include <fog_vertex>
}
`;

const PARTICLE_FRAG = /* glsl */`
#include <fog_pars_fragment>
varying float vAlpha;
varying vec3 vColor;
void main() {
  if (vAlpha <= 0.001) discard;
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SURFACE = {
  [KIND.TERRAIN]: { color: [0.93, 0.96, 1.0], count: 16, speed: 3.4, size: 9, gravity: -7, life: 0.75, spread: 0.85 },
  [KIND.ROCK]: { color: [0.55, 0.58, 0.62], count: 11, speed: 4.4, size: 6, gravity: -14, life: 0.55, spread: 0.6 },
  [KIND.TREE]: { color: [0.36, 0.25, 0.16], count: 12, speed: 3.6, size: 6, gravity: -12, life: 0.6, spread: 0.7 },
  [KIND.WOOD]: { color: [0.40, 0.29, 0.19], count: 12, speed: 3.6, size: 6, gravity: -12, life: 0.6, spread: 0.7 },
  [KIND.WALL]: { color: [0.42, 0.31, 0.20], count: 13, speed: 3.8, size: 6, gravity: -12, life: 0.6, spread: 0.7 },
  [KIND.FLOOR]: { color: [0.42, 0.31, 0.20], count: 11, speed: 3.4, size: 6, gravity: -12, life: 0.6, spread: 0.7 },
  [KIND.ROOF]: { color: [0.85, 0.90, 0.95], count: 14, speed: 3.4, size: 8, gravity: -9, life: 0.7, spread: 0.8 },
  [KIND.PROP]: { color: [0.5, 0.5, 0.52], count: 10, speed: 3.6, size: 6, gravity: -12, life: 0.55, spread: 0.7 }
};

class DebrisSystem {
  constructor(max = 900) {
    this.max = max;
    this.head = 0;

    const pos = new Float32Array(max * 3);
    const size = new Float32Array(max);
    const alpha = new Float32Array(max);
    const color = new Float32Array(max * 3);

    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geo = geo;
    this.attr = {
      pos: geo.getAttribute('position'),
      size: geo.getAttribute('aSize'),
      alpha: geo.getAttribute('aAlpha'),
      color: geo.getAttribute('aColor')
    };

    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.activeCount = 0;
  }

  burst(point, normal, kind) {
    const s = SURFACE[kind] || SURFACE[KIND.TERRAIN];
    const nx = normal[0], ny = normal[1], nz = normal[2];

    for (let i = 0; i < s.count; i++) {
      const idx = this.head;
      this.head = (this.head + 1) % this.max;

      // Debris sprays back along the surface normal with a wide cone.
      const rx = (Math.random() - 0.5) * 2 * s.spread;
      const ry = (Math.random() - 0.5) * 2 * s.spread;
      const rz = (Math.random() - 0.5) * 2 * s.spread;
      const speed = s.speed * (0.35 + Math.random() * 0.9);

      this.attr.pos.array[idx * 3] = point[0] + nx * 0.04;
      this.attr.pos.array[idx * 3 + 1] = point[1] + ny * 0.04;
      this.attr.pos.array[idx * 3 + 2] = point[2] + nz * 0.04;

      this.vel[idx * 3] = (nx + rx) * speed;
      this.vel[idx * 3 + 1] = (ny + ry) * speed + 0.9;
      this.vel[idx * 3 + 2] = (nz + rz) * speed;

      const life = s.life * (0.6 + Math.random() * 0.8);
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.gravity[idx] = s.gravity;

      this.attr.size.array[idx] = s.size * (0.5 + Math.random());
      this.attr.alpha.array[idx] = 1;
      const tint = 0.85 + Math.random() * 0.3;
      this.attr.color.array[idx * 3] = s.color[0] * tint;
      this.attr.color.array[idx * 3 + 1] = s.color[1] * tint;
      this.attr.color.array[idx * 3 + 2] = s.color[2] * tint;
    }
  }

  update(dt) {
    const pos = this.attr.pos.array;
    const alpha = this.attr.alpha.array;
    let active = 0;

    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      active++;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] += this.gravity[i] * dt;
      // air drag so puffs hang rather than flying like bullets
      const drag = Math.exp(-2.6 * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] *= drag;
      this.vel[i3 + 2] *= drag;

      pos[i3] += this.vel[i3] * dt;
      pos[i3 + 1] += this.vel[i3 + 1] * dt;
      pos[i3 + 2] += this.vel[i3 + 2] * dt;

      alpha[i] = Math.min(1, this.life[i] / this.maxLife[i] * 1.6);
    }

    this.activeCount = active;
    this.attr.pos.needsUpdate = true;
    this.attr.alpha.needsUpdate = true;
    this.attr.size.needsUpdate = true;
    this.attr.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- bullets
class BulletPool {
  constructor(size = 48) {
    this.group = new THREE.Group();
    this.group.name = 'bullets';
    this.items = [];

    // Small yellow bullet geometry: sleek, small glowing capsule/cylinder
    const bulletGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.28, 6);
    bulletGeo.rotateX(Math.PI / 2); // align along -Z

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe21a,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });

    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(bulletGeo, mat.clone());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.items.push({
        mesh,
        active: false,
        pos: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        target: new THREE.Vector3(),
        speed: 480,
        distTraveled: 0,
        maxDist: 300,
        hit: null,
        onImpact: null
      });
    }
    this.head = 0;
  }

  spawn(from, to, opts = {}) {
    const item = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;

    const fromV = new THREE.Vector3(from[0], from[1], from[2]);
    const toV = new THREE.Vector3(to[0], to[1], to[2]);
    const dir = new THREE.Vector3().subVectors(toV, fromV);
    const totalDist = dir.length();
    if (totalDist < 0.1) return;
    dir.normalize();

    item.active = true;
    item.pos.copy(fromV);
    item.dir.copy(dir);
    item.target.copy(toV);
    item.speed = opts.speed ?? 480;
    item.distTraveled = 0;
    item.maxDist = totalDist;
    item.hit = opts.hit || null;
    item.onImpact = opts.onImpact || null;

    item.mesh.position.copy(item.pos);
    item.mesh.lookAt(toV);
    const scale = opts.scale ?? 1.0;
    item.mesh.scale.set(scale, scale, scale * 1.3);
    item.mesh.material.opacity = 0.98;
    item.mesh.material.color.setHex(opts.color ?? 0xffe21a);
    item.mesh.visible = true;
  }

  update(dt) {
    for (const item of this.items) {
      if (!item.active) continue;

      const step = item.speed * dt;
      item.distTraveled += step;
      item.pos.addScaledVector(item.dir, step);
      item.mesh.position.copy(item.pos);

      if (item.distTraveled >= item.maxDist) {
        item.active = false;
        item.mesh.visible = false;
        if (item.onImpact) {
          item.onImpact(item.hit);
        }
      }
    }
  }
}

// ------------------------------------------------------------------- tracers
class TracerPool {
  constructor(size = 28) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, -0.5);      // origin at the muzzle end
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffea33, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    this.group = new THREE.Group();
    this.items = [];
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.items.push({ mesh: m, life: 0, maxLife: 0 });
    }
    this.head = 0;
    this._dir = new THREE.Vector3();
  }

  spawn(from, to, { thickness = 0.022, intensity = 1, duration = 0.055 } = {}) {
    const item = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;

    this._dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const len = this._dir.length();
    if (len < 0.05) return;

    item.mesh.position.set(from[0], from[1], from[2]);
    item.mesh.lookAt(to[0], to[1], to[2]);
    item.mesh.scale.set(thickness, thickness, len);
    item.mesh.material.opacity = 0.9 * intensity;
    item.mesh.visible = true;
    item.life = duration;
    item.maxLife = duration;
    item.intensity = intensity;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.mesh.visible = false;
        continue;
      }
      const t = item.life / item.maxLife;
      item.mesh.material.opacity = 0.9 * t * (item.intensity ?? 1);
      // the streak thins as it fades
      item.mesh.scale.x = item.mesh.scale.y = 0.022 * (0.4 + t * 0.6);
    }
  }
}

// -------------------------------------------------------------- muzzle flash
class FlashPool {
  constructor(size = 6) {
    this.group = new THREE.Group();
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd08a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.items.push({ mesh: m, life: 0 });
    }
    this.head = 0;

    this.light = new THREE.PointLight(0xffc27a, 0, 14, 2);
    this.light.visible = false;
    this.group.add(this.light);
    this.lightLife = 0;
  }

  spawn(position, scale = 1, camera = null) {
    const item = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;

    item.mesh.position.set(position[0], position[1], position[2]);
    item.mesh.scale.setScalar(0.34 * scale * (0.85 + Math.random() * 0.4));
    item.mesh.rotation.z = Math.random() * Math.PI;
    if (camera) item.mesh.quaternion.copy(camera.quaternion);
    item.mesh.material.opacity = 0.95;
    item.mesh.visible = true;
    item.life = 0.045;

    this.light.position.set(position[0], position[1], position[2]);
    this.light.intensity = 5.5 * scale;
    this.light.visible = true;
    this.lightLife = 0.055;
  }

  update(dt, camera) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.mesh.visible = false;
        item.mesh.material.opacity = 0;
        continue;
      }
      item.mesh.material.opacity = Math.max(0, item.life / 0.045) * 0.95;
      if (camera) item.mesh.quaternion.copy(camera.quaternion);
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity = Math.max(0, this.lightLife / 0.055) * 5.5;
      if (this.lightLife <= 0) this.light.visible = false;
    }
  }
}

// ---------------------------------------------------------------- brass
class ShellPool {
  constructor(size = 24) {
    this.group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.0045, 0.005, 0.019, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb0883a, roughness: 0.35, metalness: 0.9 });
    this.items = [];
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = false;
      this.group.add(m);
      this.items.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), landed: false });
    }
    this.head = 0;
  }

  eject(position, right, up, forward) {
    const item = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;

    item.mesh.position.set(position[0], position[1], position[2]);
    item.mesh.visible = true;
    item.life = 4.5;
    item.landed = false;
    item.vel.set(
      right[0] * 2.4 + up[0] * 1.5 + (Math.random() - 0.5) * 0.6,
      right[1] * 2.4 + up[1] * 1.5 + 1.2 + (Math.random() - 0.5) * 0.4,
      right[2] * 2.4 + up[2] * 1.5 + (Math.random() - 0.5) * 0.6
    );
    item.spin.set(Math.random() * 22 - 11, Math.random() * 22 - 11, Math.random() * 22 - 11);
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) { item.mesh.visible = false; continue; }
      if (item.landed) continue;

      item.vel.y -= 20 * dt;
      item.mesh.position.addScaledVector(item.vel, dt);
      item.mesh.rotation.x += item.spin.x * dt;
      item.mesh.rotation.y += item.spin.y * dt;
      item.mesh.rotation.z += item.spin.z * dt;

      const gh = heightAt(item.mesh.position.x, item.mesh.position.z);
      if (item.mesh.position.y <= gh + 0.008) {
        item.mesh.position.y = gh + 0.008;
        // one small bounce, then it stays put in the snow
        if (Math.abs(item.vel.y) > 1.1) {
          item.vel.y = -item.vel.y * 0.28;
          item.vel.x *= 0.4;
          item.vel.z *= 0.4;
          item.spin.multiplyScalar(0.4);
        } else {
          item.landed = true;
          item.life = Math.min(item.life, 3.0);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ facade
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.debris = new DebrisSystem(900);
    this.bullets = new BulletPool(48);
    this.tracers = new TracerPool(28);
    this.flashes = new FlashPool(6);
    this.shells = new ShellPool(24);

    this.group = new THREE.Group();
    this.group.name = 'effects';
    this.group.add(this.debris.points, this.bullets.group, this.tracers.group, this.flashes.group, this.shells.group);
    scene.add(this.group);
  }

  impact(point, normal, kind) {
    this.debris.burst(point, normal, kind);
  }

  shootBullet(from, to, opts = {}) {
    this.bullets.spawn(from, to, opts);
  }

  bullet(from, to, opts = {}) {
    this.bullets.spawn(from, to, opts);
  }

  tracer(from, to, opts) {
    this.bullets.spawn(from, to, opts);
  }

  muzzleFlash(position, scale, camera) {
    this.flashes.spawn(position, scale, camera);
  }

  ejectShell(position, right, up, forward) {
    this.shells.eject(position, right, up, forward);
  }

  update(dt, camera) {
    this.debris.update(dt);
    this.bullets.update(dt);
    this.tracers.update(dt);
    this.flashes.update(dt, camera);
    this.shells.update(dt);
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
