/**
 * Blood: hit mist, bleed trails, and pools under the dead.
 *
 * A note on the hardcore rules. Everything else in this game refuses to tell the
 * shooter anything -- no hitmarker, no kill confirmation. Blood is the deliberate
 * exception, and it is implemented as a WORLD effect rather than a UI one: it
 * appears on the victim, in the world, visible to everyone including bystanders,
 * exactly like a real wound. There is still no marker on your screen, no sound cue
 * and no kill notification. You can see that someone is bleeding; you still cannot
 * tell whether they are about to drop.
 *
 * Decals are one InstancedMesh with a per-instance alpha attribute, so a match's
 * worth of blood costs a single draw call.
 */

import * as THREE from '../core/three.js';
import { heightAt, normalAt } from '/shared/maps/active.js';

const MAX_DECALS = 220;
const DECAL_FADE_START = 26;   // seconds before a stain starts soaking away
const DECAL_LIFE = 34;

// ---------------------------------------------------------------- textures
function makeSplatTexture(seed = 1) {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);

  // main blob
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  const pts = 14;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = S * (0.26 + rnd() * 0.14);
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // satellite droplets
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const d = S * (0.28 + rnd() * 0.2);
    const r = S * (0.015 + rnd() * 0.05);
    ctx.beginPath();
    ctx.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // soften the rim so stains do not read as hard discs
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % S, py = Math.floor((i / 4) / S);
    const dist = Math.hypot(px - S / 2, py - S / 2) / (S / 2);
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
    d[i + 3] *= Math.max(0, 1 - Math.pow(dist, 3));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------ decal field
class DecalField {
  constructor(texture) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);      // lie flat

    const alpha = new Float32Array(MAX_DECALS);
    const instGeo = geo;
    this.alphaAttr = new THREE.InstancedBufferAttribute(alpha, 1);
    instGeo.setAttribute('aAlpha', this.alphaAttr);

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x6b0f0c,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: true
    });

    // per-instance opacity: Three has no built-in for this
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = aAlpha;');
      shader.fragmentShader = 'varying float vAlpha;\n' +
        shader.fragmentShader.replace('#include <dithering_fragment>',
          '#include <dithering_fragment>\n  gl_FragColor.a *= vAlpha;');
    };
    mat.customProgramCacheKey = () => 'blood-decal';

    this.mesh = new THREE.InstancedMesh(instGeo, mat, MAX_DECALS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = MAX_DECALS;
    this.mesh.name = 'blood-decals';

    this.items = [];
    const dummy = new THREE.Object3D();
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_DECALS; i++) {
      this.mesh.setMatrixAt(i, dummy.matrix);
      // Every slot gets a full, valid record up front. clear() rewrites all of them,
      // and a half-initialised slot would blow up on quaternion.copy(undefined).
      this.items.push({
        life: 0, maxLife: 0, size: 0, target: 0, grow: 0,
        x: 0, y: 0, z: 0, rot: 0, quat: new THREE.Quaternion()
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.head = 0;
    this._dummy = new THREE.Object3D();
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  /**
   * @param {number[]} point world position
   * @param {number} size final radius in metres
   * @param {number} growRate metres/sec (0 = appear instantly)
   */
  add(point, size, growRate = 0, life = DECAL_LIFE) {
    const idx = this.head;
    this.head = (this.head + 1) % MAX_DECALS;

    const gy = heightAt(point[0], point[2]);
    const n = normalAt(point[0], point[2]);
    this._n.set(n[0], n[1], n[2]);
    this._q.setFromUnitVectors(this._up, this._n);

    const item = this.items[idx];
    item.life = life;
    item.maxLife = life;
    item.target = size;
    item.size = growRate > 0 ? size * 0.18 : size;
    item.grow = growRate;
    item.x = point[0];
    item.y = gy + 0.025;
    item.z = point[2];
    item.rot = Math.random() * Math.PI * 2;
    item.quat.copy(this._q);
    this._writeMatrix(idx, item);
    this.alphaAttr.array[idx] = 0.92;
    this.alphaAttr.needsUpdate = true;
  }

  _writeMatrix(idx, item) {
    const d = this._dummy;
    d.position.set(item.x, item.y, item.z);
    d.quaternion.copy(item.quat);
    d.rotateY(item.rot);
    d.scale.set(item.size * 2, 1, item.size * 2);
    d.updateMatrix();
    this.mesh.setMatrixAt(idx, d.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    const alpha = this.alphaAttr.array;
    let dirty = false;
    for (let i = 0; i < MAX_DECALS; i++) {
      const item = this.items[i];
      if (item.life <= 0) continue;
      item.life -= dt;

      if (item.grow > 0 && item.size < item.target) {
        item.size = Math.min(item.target, item.size + item.grow * dt);
        this._writeMatrix(i, item);
      }
      if (item.life <= 0) {
        alpha[i] = 0;
        item.size = 0;
        this._writeMatrix(i, item);
        dirty = true;
        continue;
      }
      const fadeAt = Math.min(DECAL_FADE_START, item.maxLife * 0.7);
      alpha[i] = item.life < item.maxLife - fadeAt
        ? 0.92 * Math.max(0, item.life / (item.maxLife - fadeAt))
        : 0.92;
      dirty = true;
    }
    if (dirty) this.alphaAttr.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < MAX_DECALS; i++) {
      this.items[i].life = 0;
      this.items[i].size = 0;
      this.alphaAttr.array[i] = 0;
      this._writeMatrix(i, this.items[i]);
    }
    this.alphaAttr.needsUpdate = true;
  }
}

// ------------------------------------------------------------- droplets
const DROP_VERT = /* glsl */`
#include <fog_pars_vertex>
uniform float uPixelScale;
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // aSize is a DIAMETER IN METRES -- a head is about 0.34 m across.
  gl_PointSize = clamp(aSize * uPixelScale / max(-mvPosition.z, 0.15), 1.0, 200.0);
  #include <fog_vertex>
}
`;

const DROP_FRAG = /* glsl */`
#include <fog_pars_fragment>
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.002) discard;
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.12, d) * vAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class Droplets {
  constructor(max = 700) {
    this.max = max;
    this.head = 0;
    const pos = new Float32Array(max * 3);
    const size = new Float32Array(max);
    const alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.mist = new Uint8Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    this.attr = {
      pos: geo.getAttribute('position'),
      size: geo.getAttribute('aSize'),
      alpha: geo.getAttribute('aAlpha')
    };

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    uniforms.uColor = { value: new THREE.Color(0x8e1410) };
    uniforms.uPixelScale = { value: 600 };

    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DROP_VERT,
      fragmentShader: DROP_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.activeCount = 0;
  }

  spawn(point, vel, size, life, isMist) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.attr.pos.array[i * 3] = point[0];
    this.attr.pos.array[i * 3 + 1] = point[1];
    this.attr.pos.array[i * 3 + 2] = point[2];
    this.vel[i * 3] = vel[0];
    this.vel[i * 3 + 1] = vel[1];
    this.vel[i * 3 + 2] = vel[2];
    this.life[i] = life;
    this.maxLife[i] = life;
    this.attr.size.array[i] = size;
    this.attr.alpha.array[i] = 1;
    this.mist[i] = isMist ? 1 : 0;
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
      if (this.life[i] <= 0) { alpha[i] = 0; continue; }
      const i3 = i * 3;
      if (this.mist[i]) {
        // airborne mist: hangs, expands, thins out fast
        const drag = Math.exp(-3.4 * dt);
        this.vel[i3] *= drag; this.vel[i3 + 1] *= drag; this.vel[i3 + 2] *= drag;
        this.vel[i3 + 1] += 0.6 * dt;
        size[i] += 0.32 * dt;
        alpha[i] = Math.pow(Math.max(0, this.life[i] / this.maxLife[i]), 1.7) * 0.5;
      } else {
        this.vel[i3 + 1] -= 19 * dt;
        alpha[i] = Math.min(1, this.life[i] / this.maxLife[i] * 2.2);
      }
      pos[i3] += this.vel[i3] * dt;
      pos[i3 + 1] += this.vel[i3 + 1] * dt;
      pos[i3 + 2] += this.vel[i3 + 2] * dt;
    }
    this.activeCount = active;
    this.attr.pos.needsUpdate = true;
    this.attr.alpha.needsUpdate = true;
    this.attr.size.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ facade
export class BloodSystem {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'blood';

    this.textures = [makeSplatTexture(1), makeSplatTexture(7)];
    this.decals = new DecalField(this.textures[0]);
    this.droplets = new Droplets(700);

    this.group.add(this.decals.mesh, this.droplets.points);
    scene.add(this.group);

    this._lastDrip = new Map();   // playerId -> last drip position
  }

  /**
   * Spray from a bullet wound.
   * @param {number[]} point impact point
   * @param {number[]} dir bullet travel direction
   * @param {number} amount 0..1, scales with damage
   */
  mist(point, dir, amount = 1) {
    const n = Math.round(9 + amount * 16);
    // exit-side spray follows the round, with a wide cone
    for (let i = 0; i < n; i++) {
      const spread = 0.42;
      const vx = dir[0] * (1.8 + Math.random() * 2.6) + (Math.random() - 0.5) * spread * 4;
      const vy = dir[1] * 1.6 + 0.9 + (Math.random() - 0.5) * spread * 3.4;
      const vz = dir[2] * (1.8 + Math.random() * 2.6) + (Math.random() - 0.5) * spread * 4;
      this.droplets.spawn(point, [vx, vy, vz], 0.012 + Math.random() * 0.022, 0.45 + Math.random() * 0.5, false);
    }
    // the hanging mist cloud
    const mistCount = Math.round(5 + amount * 8);
    for (let i = 0; i < mistCount; i++) {
      this.droplets.spawn(
        [point[0] + (Math.random() - 0.5) * 0.22,
         point[1] + (Math.random() - 0.5) * 0.22,
         point[2] + (Math.random() - 0.5) * 0.22],
        [dir[0] * 1.1 + (Math.random() - 0.5) * 1.2,
         0.35 + Math.random() * 0.5,
         dir[2] * 1.1 + (Math.random() - 0.5) * 1.2],
        0.07 + Math.random() * 0.09, 0.42 + Math.random() * 0.3, true
      );
    }
    // a little cast-off on the ground behind the hit
    if (amount > 0.35) {
      this.decals.add(
        [point[0] + dir[0] * 1.1, point[1], point[2] + dir[2] * 1.1],
        0.14 + Math.random() * 0.14, 0, DECAL_LIFE * 0.7
      );
    }
  }

  /** A wounded player leaves a trail. Rate-limited by distance travelled. */
  dripFrom(playerId, position) {
    const last = this._lastDrip.get(playerId);
    if (last) {
      const moved = Math.hypot(position[0] - last[0], position[2] - last[2]);
      if (moved < 1.1) return;
    }
    this._lastDrip.set(playerId, [position[0], position[2]]);
    this.decals.add(
      [position[0] + (Math.random() - 0.5) * 0.3, position[1], position[2] + (Math.random() - 0.5) * 0.3],
      0.05 + Math.random() * 0.06, 0, DECAL_LIFE * 0.6
    );
    // an occasional falling drop, so bleeding reads in the air too
    if (Math.random() < 0.4) {
      this.droplets.spawn(
        [position[0], position[1] + 0.9, position[2]],
        [(Math.random() - 0.5) * 0.4, -0.4, (Math.random() - 0.5) * 0.4],
        0.016, 0.5, false
      );
    }
  }

  /** Growing pool under a corpse. */
  pool(position, size = 1.25) {
    this.decals.add(position, size, 0.34, 120);
    // a couple of smaller stains around it so the edge is not a perfect circle
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = size * (0.5 + Math.random() * 0.6);
      this.decals.add(
        [position[0] + Math.cos(a) * d, position[1], position[2] + Math.sin(a) * d],
        size * (0.25 + Math.random() * 0.3), 0.16, 120
      );
    }
  }

  forget(playerId) {
    this._lastDrip.delete(playerId);
  }

  /** Drawing-buffer height in device pixels, for world-unit particle sizing. */
  setViewport(bufferHeight) {
    this.bufferHeight = bufferHeight || 800;
  }

  update(dt, camera) {
    if (camera) {
      const scale = (this.bufferHeight || 800) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const u = this.droplets.points.material.uniforms;
      if (u.uPixelScale) u.uPixelScale.value = scale;
    }
    this.decals.update(dt);
    this.droplets.update(dt);
  }

  clear() {
    this.decals.clear();
    this._lastDrip.clear();
  }

  dispose() {
    this.scene.remove(this.group);
    this.decals.mesh.geometry.dispose();
    this.decals.mesh.material.dispose();
    this.droplets.geo.dispose();
    this.droplets.points.material.dispose();
    for (const t of this.textures) t.dispose();
  }
}
