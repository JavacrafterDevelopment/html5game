/**
 * Grassy Plains -- ground mesh.
 *
 * Painted with vertex colours: lush green in the hollows where water collects,
 * drier yellow-green on the exposed swells, bare earth on anything steep, and a
 * worn dirt tone around the hut pads where the village has trampled it.
 */

import * as THREE from '../../core/three.js';
import { TERRAIN, heightAt, normalAt, HUT_SITES } from '/shared/maps/grassy_plains/terrain.js';
import { fbm, clamp, smoothstep } from '/shared/math/num.js';

const GRASS_LUSH = new THREE.Color(0x4e7f33);
const GRASS_MID = new THREE.Color(0x6b9440);
const GRASS_DRY = new THREE.Color(0x9aa554);
const DIRT = new THREE.Color(0x6b573c);
const ROCKY = new THREE.Color(0x7d7364);

function makeGroundNormalMap(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] = fbm(x * 0.09, y * 0.09, 3, 21) * 0.7 + fbm(x * 0.3, y * 0.3, 2, 44) * 0.3;
    }
  }

  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const dn = h[((y + 1) % size) * size + x];
      const nx = (l - r) * 1.1, ny = (u - dn) * 1.1, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      d[i] = ((nx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(110, 110);
  return tex;
}

export function createTerrain() {
  const res = TERRAIN.meshResolution;
  const size = TERRAIN.extent * 2;

  const geo = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);

    const n = normalAt(x, z, 1.2);
    const slope = clamp(1 - n[1], 0, 1);
    const patch = fbm(x * 0.045, z * 0.045, 3, 808) * 0.5 + 0.5;
    const broad = fbm(x * 0.012, z * 0.012, 2, 1717) * 0.5 + 0.5;

    // hollows stay green, swells dry out
    const around = (heightAt(x + 5, z) + heightAt(x - 5, z) + heightAt(x, z + 5) + heightAt(x, z - 5)) * 0.25;
    const damp = clamp((around - y) * 0.22, 0, 1);

    c.copy(GRASS_MID).lerp(GRASS_LUSH, damp * 0.85);
    c.lerp(GRASS_DRY, clamp(broad * 0.85 - damp, 0, 1) * 0.55);
    c.lerp(GRASS_LUSH, patch * 0.22);

    // steep ground shows soil and stone
    c.lerp(DIRT, smoothstep(0.16, 0.42, slope) * 0.8);
    c.lerp(ROCKY, smoothstep(0.4, 0.75, slope) * 0.7);

    // trampled earth around the huts
    for (const s of HUT_SITES) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.pad + 6) c.lerp(DIRT, smoothstep(s.pad + 6, s.pad * 0.6, d) * 0.75);
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    normalMap: makeGroundNormalMap(),
    normalScale: new THREE.Vector2(0.5, 0.5)
  }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
