/**
 * Weapon effects: muzzle flash, tracers, impact debris, ejected brass.
 *
 * IMPORTANT (hardcore rules): nothing in this file reacts to hitting a PLAYER.
 * The client traces only against world geometry, so a round that passes through
 * someone still throws its puff against whatever is behind them. There is no visual
 * difference between a hit and a miss, which is exactly the intent.
 */

import * as THREE from '../core/three.js';
import { KIND, heightAt, mapInfo } from '/shared/maps/active.js';

// ------------------------------------------------------------ debris particles
// A ShaderMaterial with `fog: true` MUST also carry the fog uniforms and shader
// chunks. Declaring fog without them makes Three throw inside refreshFogUniforms
// on the first draw, which aborts the rest of the frame -- silently taking out
// everything queued behind it (snowfall, tracers, muzzle flashes, the scope).
const PARTICLE_VERT = /* glsl */`
#include <fog_pars_vertex>
uniform float uPixelScale;
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

  // aSize is a DIAMETER IN METRES. uPixelScale converts metres at one metre of
  // depth into pixels, so a 0.1 m clod is 0.1 m on screen at any distance and any
  // field of view. Sizing particles in arbitrary units is how you end up with
  // snow puffs several metres across.
  gl_PointSize = clamp(aSize * uPixelScale / max(-mvPosition.z, 0.15), 1.0, 220.0);
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

/**
 * Impact behaviour per surface.
 *
 * `chip` is the debris actually kicked loose: small, fast, heavy, thrown up and
 * back along the surface normal in a fairly tight cone -- so a round into the
 * ground throws up a little spray of dirt or snow rather than a ball of fog.
 * `puff` is the slower dust that hangs for a moment behind it.
 *
 * All sizes are DIAMETERS IN METRES. A player's head is about 0.34 m across, which
 * is the upper bound for anything here.
 */
const SURFACE = {
  [KIND.TERRAIN]: { color: [0.93, 0.96, 1.0], chips: 14, speed: 4.2, chip: [0.02, 0.055], puffs: 4, puff: [0.10, 0.20], gravity: -17, life: 0.5, spread: 0.34 },
  [KIND.ROCK]: { color: [0.55, 0.58, 0.62], chips: 12, speed: 5.4, chip: [0.015, 0.04], puffs: 3, puff: [0.07, 0.14], gravity: -20, life: 0.45, spread: 0.3 },
  [KIND.TREE]: { color: [0.36, 0.25, 0.16], chips: 12, speed: 4.4, chip: [0.015, 0.045], puffs: 2, puff: [0.05, 0.11], gravity: -19, life: 0.5, spread: 0.32 },
  [KIND.WOOD]: { color: [0.40, 0.29, 0.19], chips: 12, speed: 4.4, chip: [0.015, 0.045], puffs: 2, puff: [0.05, 0.11], gravity: -19, life: 0.5, spread: 0.32 },
  [KIND.WALL]: { color: [0.42, 0.31, 0.20], chips: 13, speed: 4.6, chip: [0.015, 0.045], puffs: 3, puff: [0.06, 0.13], gravity: -19, life: 0.5, spread: 0.32 },
  [KIND.FLOOR]: { color: [0.42, 0.31, 0.20], chips: 11, speed: 4.0, chip: [0.015, 0.04], puffs: 2, puff: [0.05, 0.11], gravity: -19, life: 0.45, spread: 0.32 },
  [KIND.ROOF]: { color: [0.72, 0.60, 0.32], chips: 13, speed: 4.0, chip: [0.02, 0.05], puffs: 3, puff: [0.07, 0.15], gravity: -16, life: 0.5, spread: 0.35 },
  [KIND.THATCH]: { color: [0.74, 0.60, 0.30], chips: 14, speed: 4.0, chip: [0.02, 0.055], puffs: 3, puff: [0.07, 0.15], gravity: -15, life: 0.55, spread: 0.36 },
  [KIND.HAY]: { color: [0.78, 0.66, 0.34], chips: 15, speed: 3.8, chip: [0.02, 0.06], puffs: 3, puff: [0.08, 0.16], gravity: -13, life: 0.6, spread: 0.38 },
  [KIND.MUD]: { color: [0.46, 0.36, 0.24], chips: 12, speed: 4.2, chip: [0.02, 0.05], puffs: 3, puff: [0.06, 0.13], gravity: -19, life: 0.5, spread: 0.32 },
  [KIND.FENCE]: { color: [0.45, 0.35, 0.22], chips: 10, speed: 4.4, chip: [0.015, 0.04], puffs: 2, puff: [0.05, 0.10], gravity: -19, life: 0.45, spread: 0.3 },
  [KIND.PROP]: { color: [0.5, 0.5, 0.52], chips: 10, speed: 4.2, chip: [0.015, 0.04], puffs: 2, puff: [0.05, 0.11], gravity: -19, life: 0.45, spread: 0.32 }
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
    this.drag = new Float32Array(max);
    this.peak = new Float32Array(max).fill(1);   // ceiling on alpha (smoke is thin)
    this.grow = new Float32Array(max);           // metres of diameter per second

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
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPixelScale: { value: 600 } }]),
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

    // The ground surface takes its colour from the map, so a round into snow throws
    // up white and a round into a meadow throws up green.
    let color = s.color;
    if (kind === KIND.TERRAIN) {
      const tint = mapInfo()?.environment?.impactColor;
      if (tint) color = tint;
    }

    const emit = (count, sizeRange, speedScale, gravity, life, lift, drag) => {
      for (let i = 0; i < count; i++) {
        const idx = this.head;
        this.head = (this.head + 1) % this.max;
        const i3 = idx * 3;

        // Kicked up and back along the surface normal, in a fairly tight cone.
        const rx = (Math.random() - 0.5) * 2 * s.spread;
        const ry = (Math.random() - 0.5) * 2 * s.spread;
        const rz = (Math.random() - 0.5) * 2 * s.spread;
        const speed = s.speed * speedScale * (0.4 + Math.random() * 0.85);

        this.attr.pos.array[i3] = point[0] + nx * 0.03;
        this.attr.pos.array[i3 + 1] = point[1] + ny * 0.03;
        this.attr.pos.array[i3 + 2] = point[2] + nz * 0.03;

        this.vel[i3] = (nx + rx) * speed;
        this.vel[i3 + 1] = (ny + ry) * speed + lift;
        this.vel[i3 + 2] = (nz + rz) * speed;

        const l = life * (0.65 + Math.random() * 0.7);
        this.life[idx] = l;
        this.maxLife[idx] = l;
        this.gravity[idx] = gravity;
        this.drag[idx] = drag;
        this.peak[idx] = 1;
        this.grow[idx] = 0;

        this.attr.size.array[idx] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
        this.attr.alpha.array[idx] = 1;
        const tint = 0.82 + Math.random() * 0.34;
        this.attr.color.array[i3] = color[0] * tint;
        this.attr.color.array[i3 + 1] = color[1] * tint;
        this.attr.color.array[i3 + 2] = color[2] * tint;
      }
    };

    // hard debris: fast, heavy, short-lived
    emit(s.chips, s.chip, 1.0, s.gravity, s.life, 1.4, 1.4);
    // the dust it disturbs: slow, floaty, fades out where it is
    emit(s.puffs, s.puff, 0.22, s.gravity * 0.12, s.life * 1.5, 0.5, 5.0);
  }

  /**
   * Propellant smoke off the muzzle. Thin, slow, growing -- the point is a wisp
   * that drifts off the barrel, not a cloud you have to shoot through.
   */
  smoke(point, dir, scale = 1) {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const idx = this.head;
      this.head = (this.head + 1) % this.max;
      const i3 = idx * 3;

      const spread = 0.55;
      const ahead = 0.04 + Math.random() * 0.11 * scale;
      this.attr.pos.array[i3] = point[0] + dir[0] * ahead;
      this.attr.pos.array[i3 + 1] = point[1] + dir[1] * ahead;
      this.attr.pos.array[i3 + 2] = point[2] + dir[2] * ahead;

      const speed = (0.7 + Math.random() * 1.3) * scale;
      this.vel[i3] = (dir[0] + (Math.random() - 0.5) * spread) * speed;
      this.vel[i3 + 1] = (dir[1] + (Math.random() - 0.5) * spread) * speed + 0.35;
      this.vel[i3 + 2] = (dir[2] + (Math.random() - 0.5) * spread) * speed;

      const l = 0.30 + Math.random() * 0.34;
      this.life[idx] = l;
      this.maxLife[idx] = l;
      this.gravity[idx] = 0.5;                  // warm gas, it rises
      this.drag[idx] = 6.5;
      this.peak[idx] = 0.16 + Math.random() * 0.12;
      this.grow[idx] = (0.16 + Math.random() * 0.14) * scale;

      this.attr.size.array[idx] = (0.035 + Math.random() * 0.03) * scale;
      this.attr.alpha.array[idx] = 0;
      const g = 0.62 + Math.random() * 0.16;
      this.attr.color.array[i3] = g;
      this.attr.color.array[i3 + 1] = g * 0.98;
      this.attr.color.array[i3 + 2] = g * 0.95;
    }
  }

  update(dt) {
    const pos = this.attr.pos.array;
    const alpha = this.attr.alpha.array;
    const size = this.attr.size.array;
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
      const drag = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] *= drag;
      this.vel[i3 + 2] *= drag;

      pos[i3] += this.vel[i3] * dt;
      pos[i3 + 1] += this.vel[i3 + 1] * dt;
      pos[i3 + 2] += this.vel[i3 + 2] * dt;

      if (this.grow[i] !== 0) size[i] += this.grow[i] * dt;

      const t = this.life[i] / this.maxLife[i];
      // Ramp in over the first sliver of life so smoke does not pop into being.
      alpha[i] = Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 14 + 0.001) * this.peak[i];
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
/**
 * A flat untextured quad has hard edges, so at any size worth seeing it reads as
 * a solid rectangle sitting on top of the sights. The flash is a small textured
 * star instead: a tight bright core that falls off to nothing well inside the
 * quad, so the geometry's own edge is never visible.
 */
let flashTexture = null;
function makeFlashTexture() {
  if (flashTexture) return flashTexture;
  const S = 96, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.30);
  core.addColorStop(0.00, 'rgba(255,255,250,1)');
  core.addColorStop(0.22, 'rgba(255,238,190,0.85)');
  core.addColorStop(0.55, 'rgba(255,178,80,0.22)');
  core.addColorStop(1.00, 'rgba(255,140,40,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);

  // a few soft spikes so it flickers like burning gas rather than a dot
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, cy);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const len = S * (i % 2 ? 0.30 : 0.46);
    ctx.save();
    ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255,226,160,0.55)');
    g.addColorStop(1, 'rgba(255,160,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.035);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, S * 0.035);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  flashTexture = tex;
  return tex;
}

// Diameter in metres of the whole quad. The visible core is under half of this.
const FLASH_SIZE = 0.075;
const FLASH_LIFE = 0.038;

class FlashPool {
  constructor(size = 6) {
    this.group = new THREE.Group();
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = makeFlashTexture();
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0xffd8a0, transparent: true, opacity: 0,
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

    // Kept deliberately weak. On a daylight snowfield a bright muzzle light
    // blows out a quarter of the frame every round, which is its own kind of
    // "cannot see what I am shooting at".
    this.light = new THREE.PointLight(0xffc27a, 0, 6, 2);
    this.light.visible = false;
    this.group.add(this.light);
    this.lightLife = 0;
  }

  spawn(position, scale = 1, camera = null) {
    const item = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;

    item.mesh.position.set(position[0], position[1], position[2]);
    item.mesh.scale.setScalar(FLASH_SIZE * scale * (0.82 + Math.random() * 0.45));
    if (camera) item.mesh.quaternion.copy(camera.quaternion);
    item.mesh.rotateZ(Math.random() * Math.PI * 2);
    item.mesh.material.opacity = 1;
    item.mesh.visible = true;
    item.life = FLASH_LIFE;

    this.light.position.set(position[0], position[1], position[2]);
    this.light.intensity = 1.6 * scale;
    this.light.visible = true;
    this.lightLife = 0.05;
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
      item.mesh.material.opacity = Math.max(0, item.life / FLASH_LIFE);
      // Re-facing every frame would undo the random roll, and the flash is gone
      // in two frames anyway.
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity = Math.max(0, this.lightLife / 0.05) * 3.4;
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
    this.bufferHeight = 800;
    this.pixelScale = 600;
    this._fwd = new THREE.Vector3();
  }

  /** Drawing-buffer height in device pixels -- gl_PointSize is in device pixels. */
  setViewport(bufferHeight) {
    this.bufferHeight = bufferHeight || 800;
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

  /**
   * @param {number[]} position muzzle, world space
   * @param {number} scale per-weapon size multiplier
   * @param {THREE.Camera} camera billboards the flare
   * @param {number[]} [dir] where the barrel points; the camera's forward if omitted
   */
  muzzleFlash(position, scale, camera, dir = null) {
    this.flashes.spawn(position, scale, camera);
    let d = dir;
    if (!d && camera) {
      camera.getWorldDirection(this._fwd);
      d = [this._fwd.x, this._fwd.y, this._fwd.z];
    }
    if (d) this.debris.smoke(position, d, scale);
  }

  ejectShell(position, right, up, forward) {
    this.shells.eject(position, right, up, forward);
  }

  update(dt, camera) {
    // Metres -> device pixels. Recomputed every frame because it depends on the
    // camera FOV, which changes as you aim down sights.
    this.pixelScale = this.bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const u = this.debris.points.material.uniforms;
    if (u.uPixelScale) u.uPixelScale.value = this.pixelScale;

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
