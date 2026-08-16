/**
 * Wind-swayed grass.
 *
 * Built on MeshStandardMaterial + onBeforeCompile rather than a raw ShaderMaterial,
 * so the grass gets the scene's lighting, fog and shadows for free and Three handles
 * instancing. The wind is injected into `begin_vertex`.
 *
 * Two things make the wind readable rather than a generic wobble:
 *   1. a constant lean downwind, so you can see which way it is blowing at a glance
 *   2. a phase that advances with position ALONG the wind vector, so gusts travel
 *      across the field as visible waves instead of every blade moving in unison
 *
 * Clumps are never rotated per instance. The wind offset is applied in the
 * instance's local space, and a Y rotation there would spin the wind direction with
 * the clump -- so blade variety comes from several baked geometries instead.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries } from '../../core/GeoUtils.js';
import { TERRAIN, heightAt, slopeAt, HUT_SITES } from '/shared/maps/grassy_plains/terrain.js';
import { nearCave } from '/shared/maps/grassy_plains/cave.js';
import { makeRng } from '/shared/math/num.js';

const BLADE_H = 1.0;   // geometry is authored 1 unit tall; instance scale sets real height

/** One tapered, slightly curved blade, 2 vertical segments. */
function bladeGeometry(rng, lean) {
  const w = 0.030 + rng() * 0.022;
  const curve = (rng() - 0.5) * 0.12 + lean;
  const yaw = rng() * Math.PI;

  const positions = [];
  const normals = [];
  const uvs = [];

  const seg = [0, 0.5, 1.0];
  const widths = [w, w * 0.62, 0.004];
  const offs = seg.map((t) => curve * t * t);

  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const rot = (x, z) => [x * cos - z * sin, x * sin + z * cos];

  for (let i = 0; i < 2; i++) {
    const y0 = seg[i], y1 = seg[i + 1];
    const w0 = widths[i], w1 = widths[i + 1];
    const o0 = offs[i], o1 = offs[i + 1];

    const [ax, az] = rot(-w0, o0);
    const [bx, bz] = rot(w0, o0);
    const [cx, cz] = rot(-w1, o1);
    const [dx, dz] = rot(w1, o1);

    positions.push(ax, y0, az, bx, y0, bz, dx, y1, dz);
    positions.push(ax, y0, az, dx, y1, dz, cx, y1, cz);
    for (let k = 0; k < 6; k++) {
      normals.push(-sin, 0.35, cos);
      uvs.push(0, k < 3 ? y0 : y1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** A tuft of a few blades, used as one instanced unit. */
function clumpGeometry(seed, bladeCount) {
  const rng = makeRng(seed);
  const parts = [];
  for (let i = 0; i < bladeCount; i++) {
    const g = bladeGeometry(rng, (rng() - 0.5) * 0.25);
    g.translate((rng() - 0.5) * 0.52, 0, (rng() - 0.5) * 0.52);
    parts.push(g);
  }
  const merged = mergeGeometries(parts);

  // Shaded at the root, sunlit at the tip -- but keyed to the painted terrain
  // colour underneath. Blades much darker than the ground read as spikes stuck in
  // a lawn instead of as the lawn itself.
  const pos = merged.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, pos.getY(i) / BLADE_H);
    colors[i * 3] = 0.30 + t * 0.28;
    colors[i * 3 + 1] = 0.50 + t * 0.26;
    colors[i * 3 + 2] = 0.19 + t * 0.15;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

function nearHut(x, z) {
  for (const s of HUT_SITES) if (Math.hypot(s.x - x, s.z - z) < s.pad + 1.5) return true;
  return false;
}

export class GrassField {
  /**
   * @param {{ count?: number, wind?: number[], strength?: number, viewDistance?: number }} opts
   */
  constructor(opts = {}) {
    const count = opts.count ?? 38000;
    const wind = opts.wind ?? [0.82, 0.57];
    const strength = opts.strength ?? 1.0;
    const viewDistance = opts.viewDistance ?? 58;

    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.time = 0;
    this.materials = [];

    const wl = Math.hypot(wind[0], wind[1]) || 1;
    this.windDir = new THREE.Vector2(wind[0] / wl, wind[1] / wl);
    this.strength = strength;

    // More blades per clump beats more clumps: a tuft that covers real ground
    // reads as a field, where sparse single blades read as isolated spikes.
    const variants = [clumpGeometry(11, 7), clumpGeometry(23, 8), clumpGeometry(37, 6)];
    const buckets = [[], [], []];

    const rng = makeRng(TERRAIN.seed ^ 0x6a55);
    const R = TERRAIN.playRadius + 4;
    let placed = 0;
    for (let attempt = 0; attempt < count * 4 && placed < count; attempt++) {
      const a = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * R;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (nearHut(x, z) || nearCave(x, z, 1)) continue;
      if (slopeAt(x, z) > 0.5) continue;
      buckets[attempt % 3].push({ x, z, y: heightAt(x, z), s: 0.26 + rng() * 0.30, t: rng() });
      placed++;
    }

    const dummy = new THREE.Object3D();
    variants.forEach((geo, vi) => {
      const items = buckets[vi];
      if (!items.length) return;

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0,
        side: THREE.DoubleSide
      });
      this._injectWind(mat, viewDistance);
      this.materials.push(mat);

      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = 'grass-' + vi;

      items.forEach((it, i) => {
        dummy.position.set(it.x, it.y - 0.03, it.z);
        dummy.rotation.set(0, 0, 0);          // never rotate: wind is applied in local space
        dummy.scale.set(0.85 + it.t * 0.4, it.s, 0.85 + it.t * 0.4);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    });
  }

  _injectWind(material, viewDistance) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWindDir = { value: this.windDir };
      shader.uniforms.uWindPower = { value: this.strength };
      shader.uniforms.uViewDist = { value: viewDistance };

      shader.vertexShader = `
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindPower;
        uniform float uViewDist;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */`
        #include <begin_vertex>
        {
          // instance origin in world space -- the whole tuft shares one phase
          vec2 instPos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);

          // Gusts travel ALONG the wind vector, so waves visibly roll across the field.
          float phase = dot(instPos, uWindDir) * 0.30 - uTime * 2.4;
          float gust  = 0.62 + 0.38 * sin(dot(instPos, uWindDir) * 0.045 - uTime * 0.55);
          float sway  = sin(phase) + 0.42 * sin(phase * 2.7 + 1.3);

          // Only the upper part of the blade bends; the root stays planted.
          float bend = clamp(position.y / ${BLADE_H.toFixed(2)}, 0.0, 1.0);
          bend *= bend;

          // constant lean downwind + oscillation
          float amp = (0.30 + sway * 0.22) * bend * uWindPower * gust;
          transformed.x += uWindDir.x * amp;
          transformed.z += uWindDir.y * amp;
          transformed.y -= abs(amp) * 0.18;   // bending shortens the blade

          // Fade distant blades into the painted ground rather than popping them.
          vec4 wp = instanceMatrix * vec4(transformed, 1.0);
          float dist = distance(cameraPosition, wp.xyz);
          transformed *= 1.0 - smoothstep(uViewDist * 0.72, uViewDist, dist);
        }
        `
      );

      material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => 'grass-wind';
  }

  update(dt) {
    this.time += dt;
    for (const m of this.materials) {
      const s = m.userData.shader;
      if (s) s.uniforms.uTime.value = this.time;
    }
  }

  /** Wind vector currently driving the grass (used by motes, clouds and audio). */
  windVector() {
    return this.windDir;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isInstancedMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
}
