/**
 * The hunting cabin.
 *
 * The walls are drawn by filling the SAME boxes the server uses for collision with
 * stacked logs. That guarantees the thing you can hide behind is exactly the thing
 * that stops a bullet -- including the window bands, which are gaps in the collision
 * list and therefore genuinely shootable.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries, setVertexColor } from '../../core/GeoUtils.js';
import { CABIN, CABIN_BOXES, CABIN_PARTS, WINDOWS } from '/shared/maps/snowy_forest/cabin.js';

const LOG_TOP = 0x6b4a30;
const LOG_BODY = 0x4e3722;
const PLANK = 0x3f2d1d;
const STONE = 0x5c6068;
const SNOW = 0xeef5fa;

function boxGeo(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    g.applyMatrix4(m);
  }
  g.translate(x, y, z);
  setVertexColor(g, color);
  return g;
}

function logGeo(length, radius, x, y, z, alongX, color) {
  const g = new THREE.CylinderGeometry(radius, radius, length, 8);
  g.rotateZ(Math.PI / 2);                 // lie along X
  if (!alongX) g.rotateY(Math.PI / 2);    // ...or along Z
  g.translate(x, y, z);
  setVertexColor(g, color);
  return g;
}

/** Fill one collision box with a stack of horizontal logs. */
function logsForWall(box, out) {
  const w = box.max[0] - box.min[0];
  const h = box.max[1] - box.min[1];
  const d = box.max[2] - box.min[2];
  if (h <= 0.02) return;

  const alongX = w >= d;
  const length = alongX ? w : d;
  const thickness = alongX ? d : w;
  const radius = Math.max(0.07, thickness * 0.5);

  const cx = (box.min[0] + box.max[0]) * 0.5;
  const cz = (box.min[2] + box.max[2]) * 0.5;

  const rows = Math.max(1, Math.round(h / (radius * 2)));
  const step = h / rows;

  for (let i = 0; i < rows; i++) {
    const y = box.min[1] + step * (i + 0.5);
    // alternate the shade slightly so the courses read individually
    const color = i % 2 === 0 ? LOG_BODY : LOG_TOP;
    out.push(logGeo(length, Math.min(radius, step * 0.52), cx, y, cz, alongX, color));
  }
}

export function createCabin() {
  const group = new THREE.Group();
  group.name = 'cabin';

  const P = CABIN_PARTS;
  const CX = CABIN.x, CZ = CABIN.z;
  const { halfW, halfD, floorY, wallT } = CABIN;
  const TOP = P.top;

  const wood = [];
  const stone = [];
  const snow = [];
  const dark = [];

  // ------------------------------------------------------------- walls
  for (const box of CABIN_BOXES) {
    if (box.kind === 'wall') logsForWall(box, wood);
  }

  // corner posts tie the courses together visually
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wood.push(boxGeo(0.30, TOP - floorY, 0.30,
        CX + sx * (halfW + wallT * 0.5), (floorY + TOP) * 0.5, CZ + sz * (halfD + wallT * 0.5), LOG_TOP));
    }
  }

  // ------------------------------------------------------- floor / base
  stone.push(boxGeo(halfW * 2 + 0.8, 0.55, halfD * 2 + 0.8, CX, floorY - 0.28, CZ, STONE));
  // floorboards
  const plankCount = 14;
  const plankW = (halfW * 2) / plankCount;
  for (let i = 0; i < plankCount; i++) {
    wood.push(boxGeo(plankW * 0.94, 0.07, halfD * 2, CX - halfW + plankW * (i + 0.5), floorY - 0.035, CZ,
      i % 2 ? PLANK : 0x4a3524));
  }

  // ------------------------------------------------------------- porch
  const porchW = P.porch.maxX - P.porch.minX;
  const porchD = P.porch.maxZ - P.porch.minZ;
  const porchCX = (P.porch.minX + P.porch.maxX) * 0.5;
  const porchCZ = (P.porch.minZ + P.porch.maxZ) * 0.5;
  for (let i = 0; i < 7; i++) {
    wood.push(boxGeo(porchW, 0.07, porchD / 7 * 0.9, porchCX, floorY - 0.035,
      P.porch.minZ + (porchD / 7) * (i + 0.5), i % 2 ? PLANK : 0x4a3524));
  }
  stone.push(boxGeo(porchW + 0.2, 0.5, porchD + 0.2, porchCX, floorY - 0.30, porchCZ, STONE));
  // posts + rail
  for (const sx of [-1, 1]) {
    wood.push(boxGeo(0.16, 2.7, 0.16, CX + sx * 2.35, floorY + 1.35, P.porch.maxZ - 0.15, LOG_TOP));
    wood.push(boxGeo(0.10, 0.10, porchD - 0.3, CX + sx * 2.35, floorY + 0.95, porchCZ + 0.1, LOG_TOP));
  }
  wood.push(boxGeo(4.9, 0.12, 0.12, porchCX, floorY + 0.95, P.porch.maxZ - 0.15, LOG_TOP));
  // porch roof
  wood.push(boxGeo(5.6, 0.14, porchD + 0.5, porchCX, floorY + 2.75, porchCZ + 0.1, LOG_TOP, -0.18));
  snow.push(boxGeo(5.7, 0.10, porchD + 0.55, porchCX, floorY + 2.86, porchCZ + 0.1, SNOW, -0.18));

  // -------------------------------------------------------------- roof
  const eaveZ = halfD + 0.55;
  const slopeLen = Math.hypot(eaveZ, P.ridgeH);
  const angle = Math.atan2(P.ridgeH, eaveZ);
  const roofW = halfW * 2 + 1.3;

  for (const side of [-1, 1]) {
    const midZ = CZ + side * eaveZ * 0.5;
    const midY = TOP + P.ridgeH * 0.5;
    wood.push(boxGeo(roofW, 0.16, slopeLen, CX, midY, midZ, PLANK, side * angle));
    // snow load, offset up the slope normal
    snow.push(boxGeo(roofW + 0.14, 0.17, slopeLen, CX,
      midY + Math.cos(angle) * 0.16, midZ - side * Math.sin(angle) * 0.16, SNOW, side * angle));
  }
  // ridge beam + rafter ends
  wood.push(boxGeo(roofW + 0.2, 0.20, 0.26, CX, TOP + P.ridgeH + 0.06, CZ, LOG_TOP));
  snow.push(boxGeo(roofW + 0.3, 0.12, 0.34, CX, TOP + P.ridgeH + 0.20, CZ, SNOW));
  for (let i = 0; i < 6; i++) {
    const x = CX - halfW + (halfW * 2 / 5) * i;
    wood.push(boxGeo(0.12, 0.12, halfD * 2 + 0.9, x, TOP + 0.06, CZ, LOG_TOP));
  }

  // ------------------------------------------------------------ chimney
  const ch = P.chimney;
  stone.push(boxGeo(1.15, ch.top - floorY, 0.95, ch.x, (floorY + ch.top) * 0.5, ch.z, STONE));
  stone.push(boxGeo(1.3, 0.22, 1.1, ch.x, ch.top + 0.05, ch.z, 0x4b4f56));
  snow.push(boxGeo(1.24, 0.10, 1.04, ch.x, ch.top + 0.20, ch.z, SNOW));

  // ------------------------------------------------------- openings
  const frame = (x, y, z, w, h, d) => {
    dark.push(boxGeo(w, 0.09, d, x, y + h / 2, z, 0x2b1f15));
    dark.push(boxGeo(w, 0.09, d, x, y - h / 2, z, 0x2b1f15));
    dark.push(boxGeo(0.09, h, d, x - w / 2, y, z, 0x2b1f15));
    dark.push(boxGeo(0.09, h, d, x + w / 2, y, z, 0x2b1f15));
  };

  const winH = P.sillHigh - P.sillLow;
  const winY = floorY + (P.sillLow + P.sillHigh) * 0.5;
  const winW = P.windowHalf * 2;

  for (const wc of WINDOWS.north) {
    frame(CX + wc, winY, CZ - halfD - wallT * 0.5, winW + 0.18, winH + 0.18, 0.42);
    dark.push(boxGeo(0.06, winH, 0.1, CX + wc, winY, CZ - halfD - wallT * 0.5, 0x2b1f15));
  }
  for (const wc of WINDOWS.east) {
    const g = boxGeo(0.42, winH + 0.18, winW + 0.18, CX + halfW + wallT * 0.5, winY, CZ + wc, 0x2b1f15);
    dark.push(g);
    dark.push(boxGeo(0.1, winH, 0.06, CX + halfW + wallT * 0.5, winY, CZ + wc, 0x2b1f15));
  }
  for (const wc of WINDOWS.west) {
    dark.push(boxGeo(0.42, winH + 0.18, winW + 0.18, CX - halfW - wallT * 0.5, winY, CZ + wc, 0x2b1f15));
    dark.push(boxGeo(0.1, winH, 0.06, CX - halfW - wallT * 0.5, winY, CZ + wc, 0x2b1f15));
  }

  // door frame + a door hanging open against the outside wall
  frame(CX, floorY + P.door.height / 2, CZ + halfD + wallT * 0.5,
    P.door.halfWidth * 2 + 0.2, P.door.height + 0.15, 0.42);
  wood.push(boxGeo(0.08, P.door.height - 0.1, P.door.halfWidth * 1.85,
    CX + P.door.halfWidth + 0.12, floorY + P.door.height / 2, CZ + halfD + 0.9, 0x3a2a1c, 0, 0.35, 0));

  // ---------------------------------------------------------- interior
  for (const box of CABIN_BOXES) {
    if (box.kind !== 'prop') continue;
    const w = box.max[0] - box.min[0];
    const h = box.max[1] - box.min[1];
    const d = box.max[2] - box.min[2];
    const cx = (box.min[0] + box.max[0]) * 0.5;
    const cy = (box.min[1] + box.max[1]) * 0.5;
    const cz = (box.min[2] + box.max[2]) * 0.5;
    // skip the chimney and porch posts -- already drawn above
    if (h > 3) continue;
    if (w < 0.4 && d < 0.4) continue;
    wood.push(boxGeo(w, h, d, cx, cy, cz, 0x4a3524));
    wood.push(boxGeo(w * 1.04, 0.05, d * 1.04, cx, box.max[1] + 0.02, cz, 0x5a4230));
  }

  // a cold stove in the corner, under the chimney
  dark.push(boxGeo(0.75, 0.9, 0.6, ch.x - 0.1, floorY + 0.45, CZ - halfD + 0.75, 0x1e2126));
  dark.push(boxGeo(0.28, 1.6, 0.28, ch.x - 0.1, floorY + 1.6, CZ - halfD + 0.75, 0x1e2126));

  // ------------------------------------------------------------ build
  const mkMesh = (geos, roughness, name) => {
    if (!geos.length) return null;
    const geo = mergeGeometries(geos);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  };

  const meshes = [
    mkMesh(wood, 0.85, 'cabin-wood'),
    mkMesh(stone, 0.95, 'cabin-stone'),
    mkMesh(snow, 0.93, 'cabin-snow'),
    mkMesh(dark, 0.8, 'cabin-trim')
  ].filter(Boolean);

  for (const m of meshes) group.add(m);
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
