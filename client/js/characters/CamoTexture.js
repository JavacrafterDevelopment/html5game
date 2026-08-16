/**
 * Procedurally painted winter camouflage.
 *
 * Nothing here is loaded from disk -- the pattern is drawn onto a canvas at runtime,
 * which keeps the project asset-free and portable. The look is layered the way real
 * snow camo is printed: an off-white base, soft grey blotches for terrain break-up,
 * a few cold blue-grey shadows, then small hard-edged flecks on top.
 */

import * as THREE from '../core/three.js';
import { makeRng } from '/shared/math/num.js';

const SIZE = 512;

function blob(ctx, rng, cx, cy, radius, color, points = 9) {
  ctx.fillStyle = color;
  ctx.beginPath();
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = radius * (0.62 + rng() * 0.62);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  ctx.moveTo((pts[0][0] + pts[points - 1][0]) / 2, (pts[0][1] + pts[points - 1][1]) / 2);
  for (let i = 0; i < points; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % points];
    ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

/** Hard-edged digital flecks, drawn in clusters like printed pixel camo. */
function flecks(ctx, rng, count, color, cell) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const cx = rng() * SIZE;
    const cy = rng() * SIZE;
    const n = 3 + Math.floor(rng() * 5);
    for (let j = 0; j < n; j++) {
      const x = cx + (Math.floor(rng() * 5) - 2) * cell;
      const y = cy + (Math.floor(rng() * 5) - 2) * cell;
      ctx.fillRect(Math.floor(x / cell) * cell, Math.floor(y / cell) * cell, cell, cell);
    }
  }
}

function paintCamo(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(seed);

  // base
  ctx.fillStyle = '#e9edf0';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // large soft grey shapes
  for (let i = 0; i < 22; i++) {
    blob(ctx, rng, rng() * SIZE, rng() * SIZE, 44 + rng() * 62, '#ccd5db', 11);
  }
  // cold blue-grey shadow shapes
  for (let i = 0; i < 16; i++) {
    blob(ctx, rng, rng() * SIZE, rng() * SIZE, 30 + rng() * 44, '#aeb9c4', 10);
  }
  // sparse dark accents -- keeps it reading as military, not as a bedsheet
  for (let i = 0; i < 9; i++) {
    blob(ctx, rng, rng() * SIZE, rng() * SIZE, 16 + rng() * 26, '#7f8b96', 9);
  }
  // bright snow highlights
  for (let i = 0; i < 18; i++) {
    blob(ctx, rng, rng() * SIZE, rng() * SIZE, 20 + rng() * 34, '#f4f7fa', 8);
  }

  // printed flecks
  flecks(ctx, rng, 140, '#b9c4cd', 6);
  flecks(ctx, rng, 90, '#f2f5f8', 6);
  flecks(ctx, rng, 40, '#8a97a2', 6);

  // fabric grain
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 16;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  return canvas;
}

/** Roughness variation so the fabric does not read as uniform plastic. */
function paintRoughness(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(seed + 999);
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const v = 170 + Math.floor(rng() * 80);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(rng() * 256, rng() * 256, 3 + rng() * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

let cached = null;

/** Shared across every soldier in the match -- built once. */
export function getCamoMaterials() {
  if (cached) return cached;

  const camoTex = new THREE.CanvasTexture(paintCamo(20260815));
  camoTex.wrapS = camoTex.wrapT = THREE.RepeatWrapping;
  camoTex.repeat.set(1.6, 1.6);
  camoTex.colorSpace = THREE.SRGBColorSpace;
  camoTex.anisotropy = 4;

  const roughTex = new THREE.CanvasTexture(paintRoughness(20260815));
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(2, 2);

  const camo = new THREE.MeshStandardMaterial({
    map: camoTex,
    roughnessMap: roughTex,
    roughness: 0.95,
    metalness: 0.0
  });

  // Slightly tighter pattern for limbs so the scale reads correctly on thin parts.
  const camoLimb = camo.clone();
  const limbTex = camoTex.clone();
  limbTex.needsUpdate = true;
  limbTex.repeat.set(3.2, 3.2);
  camoLimb.map = limbTex;

  cached = {
    camo,
    camoLimb,
    gear: new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.78, metalness: 0.05 }),
    gearLight: new THREE.MeshStandardMaterial({ color: 0xc8d2da, roughness: 0.85, metalness: 0.02 }),
    webbing: new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.9, metalness: 0.0 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.7, metalness: 0.05 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x262b31, roughness: 0.85, metalness: 0.0 }),
    face: new THREE.MeshStandardMaterial({ color: 0xcfa17d, roughness: 0.76, metalness: 0.0 }),
    goggle: new THREE.MeshStandardMaterial({
      color: 0x0d1418, roughness: 0.12, metalness: 0.85, envMapIntensity: 1.2
    }),
    helmet: new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.82, metalness: 0.03 })
  };
  return cached;
}
