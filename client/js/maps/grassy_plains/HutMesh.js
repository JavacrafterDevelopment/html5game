/**
 * Village huts.
 *
 * Walls are drawn by filling the SAME boxes the collider uses, so cover and
 * geometry can never drift apart -- and the window bands, which are gaps in the
 * collision list, end up as real openings you can shoot through.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries, setVertexColor } from '../../core/GeoUtils.js';
import { HUTS } from '/shared/maps/grassy_plains/huts.js';

const MUD_A = 0x9c7f5c;
const MUD_B = 0x8a6e4d;
const TIMBER = 0x53412c;
const THATCH_A = 0xa88c46;
const THATCH_B = 0xc0a558;
const DARK = 0x2c2318;

function boxGeo(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  setVertexColor(g, color);
  return g;
}

function postGeo(r, h, x, y, z, color, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r * 1.12, h, seg);
  g.translate(x, y + h / 2, z);
  setVertexColor(g, color);
  return g;
}

export function createHuts() {
  const group = new THREE.Group();
  group.name = 'huts';

  const mud = [];
  const thatch = [];
  const timber = [];
  const dark = [];

  for (const hut of HUTS) {
    const { x, z, halfW, halfD, floorY, wallH, wallT, roofRise, eave } = hut;
    const top = floorY + wallH;

    // --- walls: fill each collision box, alternating shade by course ---
    let course = 0;
    for (const b of hut.boxes) {
      if (b.kind !== 'wall') continue;
      const w = b.max[0] - b.min[0];
      const h = b.max[1] - b.min[1];
      const d = b.max[2] - b.min[2];
      mud.push(boxGeo(w, h, d,
        (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2,
        course++ % 2 ? MUD_A : MUD_B));
    }

    // --- floor pad + threshold ---
    mud.push(boxGeo(halfW * 2 + 0.7, 0.5, halfD * 2 + 0.7, x, floorY - 0.24, z, 0x7c6549));

    // --- corner posts ---
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        timber.push(postGeo(0.11, wallH + 0.1,
          x + sx * (halfW + wallT * 0.5), floorY, z + sz * (halfD + wallT * 0.5), TIMBER));
      }
    }

    // --- thatched hip roof: shrinking slabs, matching the collider steps ---
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const w0 = (halfW + eave) * (1 - t0 * 0.82);
      const d0 = (halfD + eave) * (1 - t0 * 0.82);
      const w1 = (halfW + eave) * (1 - t1 * 0.82);
      const d1 = (halfD + eave) * (1 - t1 * 0.82);
      const y0 = top + t0 * roofRise;
      const y1 = top + t1 * roofRise;

      // a tapered slab reads as a pitched surface far better than a plain box
      const g = new THREE.CylinderGeometry(1, 1, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(Math.max(w1, d1) * 1.42, y1 - y0 + 0.06, Math.max(w1, d1) * 1.42);
      g.translate(x, (y0 + y1) / 2, z);
      setVertexColor(g, i % 2 ? THATCH_A : THATCH_B);
      thatch.push(g);

      // overhanging eave lip on the lowest course
      if (i === 0) {
        const lip = new THREE.CylinderGeometry(1, 1, 1, 4, 1);
        lip.rotateY(Math.PI / 4);
        lip.scale(Math.max(w0, d0) * 1.5, 0.14, Math.max(w0, d0) * 1.5);
        lip.translate(x, y0 + 0.02, z);
        setVertexColor(lip, THATCH_B);
        thatch.push(lip);
      }
    }
    // ridge cap
    thatch.push(boxGeo(0.5, 0.28, 0.5, x, top + roofRise + 0.08, z, THATCH_A, 0, Math.PI / 4, 0));

    // --- doorway frame + dark interior mouth ---
    const dh = hut.doorH ?? (hut.sillHigh + 0.35);
    const dhalf = hut.doorHalf;
    if (hut.door === 'plusZ' || hut.door === 'minusZ') {
      const zz = hut.door === 'plusZ' ? z + halfD + wallT * 0.5 : z - halfD - wallT * 0.5;
      timber.push(boxGeo(dhalf * 2 + 0.24, 0.12, 0.42, x, floorY + dh, zz, TIMBER));
      timber.push(boxGeo(0.12, dh, 0.42, x - dhalf - 0.06, floorY + dh / 2, zz, TIMBER));
      timber.push(boxGeo(0.12, dh, 0.42, x + dhalf + 0.06, floorY + dh / 2, zz, TIMBER));
      dark.push(boxGeo(dhalf * 2, dh, 0.06, x, floorY + dh / 2, zz, DARK));
    } else {
      const xx = hut.door === 'plusX' ? x + halfW + wallT * 0.5 : x - halfW - wallT * 0.5;
      timber.push(boxGeo(0.42, 0.12, dhalf * 2 + 0.24, xx, floorY + dh, z, TIMBER));
      timber.push(boxGeo(0.42, dh, 0.12, xx, floorY + dh / 2, z - dhalf - 0.06, TIMBER));
      timber.push(boxGeo(0.42, dh, 0.12, xx, floorY + dh / 2, z + dhalf + 0.06, TIMBER));
      dark.push(boxGeo(0.06, dh, dhalf * 2, xx, floorY + dh / 2, z, DARK));
    }

    // --- window frames on the sill band ---
    const winY = floorY + (hut.sillLow + hut.sillHigh) / 2;
    const winH = hut.sillHigh - hut.sillLow;
    for (const wc of hut.windowsX) {
      for (const sz of [-1, 1]) {
        const zz = z + sz * (halfD + wallT * 0.5);
        if ((sz > 0 && hut.door === 'plusZ') || (sz < 0 && hut.door === 'minusZ')) continue;
        timber.push(boxGeo(hut.winHalf * 2 + 0.14, 0.08, 0.42, x + wc, winY + winH / 2, zz, TIMBER));
        timber.push(boxGeo(hut.winHalf * 2 + 0.14, 0.08, 0.42, x + wc, winY - winH / 2, zz, TIMBER));
      }
    }
  }

  const mk = (geos, roughness, name) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 }));
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    m.matrixAutoUpdate = false;
    return m;
  };

  for (const m of [
    mk(mud, 0.95, 'hut-mud'),
    mk(thatch, 0.9, 'hut-thatch'),
    mk(timber, 0.85, 'hut-timber'),
    mk(dark, 1.0, 'hut-dark')
  ]) if (m) group.add(m);

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
