/**
 * Geometry helpers. Three's BufferGeometryUtils lives in the examples folder,
 * which we do not vendor, so the two functions actually needed are implemented here.
 */

import * as THREE from './three.js';

/**
 * Merge non-indexed or indexed geometries that share the same attribute layout.
 * Only position / normal / uv / color are carried across -- that covers everything
 * this project builds.
 */
export function mergeGeometries(geometries) {
  const list = geometries.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  if (list.length === 0) return new THREE.BufferGeometry();

  const wantColor = list.some((g) => g.getAttribute('color'));
  const wantUv = list.every((g) => g.getAttribute('uv'));

  let total = 0;
  for (const g of list) total += g.getAttribute('position').count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = wantUv ? new Float32Array(total * 2) : null;
  const color = wantColor ? new Float32Array(total * 3) : null;

  let offset = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    const c = g.getAttribute('color');

    position.set(p.array, offset * 3);
    if (n) normal.set(n.array, offset * 3);
    if (uv && t) uv.set(t.array, offset * 2);
    if (color) {
      if (c) {
        color.set(c.array, offset * 3);
      } else {
        for (let i = 0; i < p.count; i++) {
          color[(offset + i) * 3] = 1;
          color[(offset + i) * 3 + 1] = 1;
          color[(offset + i) * 3 + 2] = 1;
        }
      }
    }
    offset += p.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) out.setAttribute('color', new THREE.BufferAttribute(color, 3));

  for (const g of list) g.dispose?.();
  return out;
}

/** Paint a solid vertex colour onto a geometry. */
export function setVertexColor(geometry, color) {
  const count = geometry.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/**
 * Blend two colours across a geometry's local Y range -- used to fade pine needles
 * into snow-loaded tips without needing a texture.
 */
export function gradientVertexColor(geometry, bottomColor, topColor, power = 1) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const minY = bb.min.y, maxY = bb.max.y;
  const span = Math.max(1e-5, maxY - minY);

  const pos = geometry.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const a = new THREE.Color(bottomColor);
  const b = new THREE.Color(topColor);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const t = Math.pow((pos.getY(i) - minY) / span, power);
    tmp.copy(a).lerp(b, t);
    arr[i * 3] = tmp.r;
    arr[i * 3 + 1] = tmp.g;
    arr[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Push vertices along their normals by a noise amount -- turns spheres into rocks. */
export function roughenGeometry(geometry, amount, rng) {
  const pos = geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const scale = 1 + (rng() - 0.5) * amount;
    v.multiplyScalar(scale);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
