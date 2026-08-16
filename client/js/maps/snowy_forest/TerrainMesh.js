/**
 * Terrain mesh for the Snowy Forest.
 *
 * The heightfield itself lives in shared/ so the server agrees with us about where
 * the ground is. This file only turns that function into triangles and paints it:
 * snow on the flats, wind-scoured rock on anything steep, cold blue in the hollows.
 */

import * as THREE from '../../core/three.js';
import { TERRAIN, heightAt, normalAt } from '/shared/maps/snowy_forest/terrain.js';
import { fbm, clamp, smoothstep, lerp } from '/shared/math/num.js';

const SNOW = new THREE.Color(0xeff5fa);
const SNOW_DEEP = new THREE.Color(0xd6e2ee);
const SNOW_BLUE = new THREE.Color(0xb9cbdd);
const ROCK = new THREE.Color(0x6d7681);
const ROCK_LIGHT = new THREE.Color(0x8e979f);

/** Fine snow surface detail so the ground is not a flat shade of white. */
function makeSnowNormalMap(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // height field first
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] =
        fbm(x * 0.06, y * 0.06, 3, 7) * 0.6 +
        fbm(x * 0.22, y * 0.22, 2, 19) * 0.4;
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
      const nx = (l - r) * 0.9;
      const ny = (u - dn) * 0.9;
      const nz = 1;
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
  tex.repeat.set(90, 90);
  return tex;
}

export function createTerrain() {
  const res = TERRAIN.meshResolution;
  const extent = TERRAIN.extent;
  const size = extent * 2;

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

    // --- paint ---
    const n = normalAt(x, z, 1.2);
    const slope = clamp(1 - n[1], 0, 1);
    const rockAmount = smoothstep(0.22, 0.62, slope);
    const grain = fbm(x * 0.09, z * 0.09, 3, 4242) * 0.5 + 0.5;

    c.copy(SNOW).lerp(SNOW_DEEP, grain * 0.55);

    // Hollows and the creek bed collect cold blue shade. Concavity is measured
    // against the four neighbours -- comparing against two diagonal samples flips
    // sign abruptly and paints visible angular blotches across the triangles.
    const around = (heightAt(x + 5, z) + heightAt(x - 5, z) + heightAt(x, z + 5) + heightAt(x, z - 5)) * 0.25;
    const concavity = clamp((around - y) * 0.16, 0, 1);
    c.lerp(SNOW_BLUE, concavity * 0.30);

    // wind-scoured rock
    if (rockAmount > 0) {
      const rockShade = ROCK.clone().lerp(ROCK_LIGHT, grain);
      c.lerp(rockShade, rockAmount * 0.92);
    }

    // high peaks stay bright
    const alt = smoothstep(28, 64, y);
    c.lerp(SNOW, alt * 0.55);

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.0,
    normalMap: makeSnowNormalMap(),
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 0.4
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/**
 * A ring of low-poly peaks well outside the play area. Purely scenic -- it gives the
 * horizon some shape behind the fog without adding to the collision world.
 */
export function createDistantMountains() {
  const geo = new THREE.BufferGeometry();
  const verts = [];
  const colors = [];
  const peakCount = 46;
  const radius = 190;
  const col = new THREE.Color();

  for (let i = 0; i < peakCount; i++) {
    const a = (i / peakCount) * Math.PI * 2;
    const jitter = fbm(Math.cos(a) * 3, Math.sin(a) * 3, 2, 91);
    const r = radius + jitter * 40;
    const h = 70 + fbm(Math.cos(a) * 5, Math.sin(a) * 5, 3, 17) * 70;
    const w = 55 + jitter * 26;

    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const px = -Math.sin(a);
    const pz = Math.cos(a);

    // one triangle per peak, facing the middle of the map
    verts.push(cx - px * w, -10, cz - pz * w);
    verts.push(cx + px * w, -10, cz + pz * w);
    verts.push(cx, h, cz);

    const base = new THREE.Color(0x8fa4b8);
    const top = new THREE.Color(0xdfe9f2);
    col.copy(base);
    colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    col.copy(top);
    colors.push(col.r, col.g, col.b);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: true,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'distant-mountains';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
