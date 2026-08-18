/**
 * The EMU: what everybody is wearing in orbit.
 *
 * Same trick as the winter camo -- the fabric is painted onto a canvas at runtime
 * so the project stays asset-free. What is being painted is different, though. A
 * suit is not printed with a pattern; it is white ortho-fabric that has been worn,
 * scuffed on handrails and grubbied around the joints, so the texture is almost
 * flat white with soft grey wear and a faint woven grid, and the interest comes
 * from the hardware bolted on top rather than from the cloth.
 *
 * The keys here deliberately mirror getCamoMaterials(). Soldier.js looks up the
 * same names either way, so the rig, the animator and the ragdoll never learn that
 * there are two kinds of person in this game.
 */

import * as THREE from '../core/three.js';
import { makeRng } from '/shared/math/num.js';

const SIZE = 512;

function paintSuit(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(seed);

  ctx.fillStyle = '#f2f3f2';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // The woven grid of the outer layer. Very faint -- it should only show up when
  // you are close enough to touch somebody.
  ctx.strokeStyle = 'rgba(196, 200, 202, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < SIZE; i += 11) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(SIZE, i); ctx.stroke();
  }

  // Soft grey shadowing, so the white does not read as a flat sheet of paper.
  for (let i = 0; i < 26; i++) {
    const r = 40 + rng() * 90;
    const g = ctx.createRadialGradient(rng() * SIZE, rng() * SIZE, 0, 0, 0, 1);
    void g;
    ctx.fillStyle = `rgba(${196 + Math.floor(rng() * 24)}, ${200 + Math.floor(rng() * 22)}, ${206 + Math.floor(rng() * 20)}, 0.30)`;
    ctx.beginPath();
    ctx.ellipse(rng() * SIZE, rng() * SIZE, r, r * (0.5 + rng() * 0.7), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Scuffs. A suit that has been outside has grey streaks where it has dragged
  // along handrails, and they all run the same way.
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    const len = 14 + rng() * 60;
    ctx.strokeStyle = `rgba(150, 154, 158, ${0.06 + rng() * 0.13})`;
    ctx.lineWidth = 1 + rng() * 3.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * 0.9, y + (rng() - 0.5) * 10);
    ctx.stroke();
  }

  // A few darker smudges around where the joints crease.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(126, 130, 136, ${0.05 + rng() * 0.09})`;
    ctx.beginPath();
    ctx.ellipse(rng() * SIZE, rng() * SIZE, 12 + rng() * 34, 8 + rng() * 20, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // fabric grain
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 13;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let cached = null;

/** Shared across every astronaut in the match -- built once. */
export function getSuitMaterials() {
  if (cached) return cached;

  const tex = new THREE.CanvasTexture(paintSuit(20260817));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 1.4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const suit = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.92,
    metalness: 0.0
  });

  const suitLimb = suit.clone();
  const limbTex = tex.clone();
  limbTex.needsUpdate = true;
  limbTex.repeat.set(2.6, 2.6);
  suitLimb.map = limbTex;

  cached = {
    // --- the names Soldier.js shares with the camo set ---
    camo: suit,
    camoLimb: suitLimb,
    /** Hard hardware: the torso shell, the pack, the joint rings. */
    gear: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.42, metalness: 0.16 }),
    gearLight: new THREE.MeshStandardMaterial({ color: 0xf4f6f7, roughness: 0.48, metalness: 0.08 }),
    /** Straps, tether points, the dark rubber at the joints. */
    webbing: new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.82, metalness: 0.05 }),
    boot: new THREE.MeshStandardMaterial({ color: 0xe4e7e9, roughness: 0.66, metalness: 0.04 }),
    glove: new THREE.MeshStandardMaterial({ color: 0xdcdfe2, roughness: 0.74, metalness: 0.03 }),
    face: new THREE.MeshStandardMaterial({ color: 0xcfa17d, roughness: 0.76, metalness: 0.0 }),
    goggle: new THREE.MeshStandardMaterial({ color: 0x0d1418, roughness: 0.12, metalness: 0.85 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0xf6f8f8, roughness: 0.36, metalness: 0.06 }),

    // --- suit-only ---
    /**
     * The gold sun visor. Heavily metallic and almost mirror-smooth, which in a
     * scene lit by one hard white sun is what makes a head read as a helmet from
     * fifty metres away.
     */
    visor: new THREE.MeshStandardMaterial({
      // Not metalness 1: with no environment map to reflect, a pure metal visor
      // is a black hole where the face should be. See StationMesh for the same note.
      color: 0xe0a832, roughness: 0.16, metalness: 0.55
    }),
    /** Anodised aluminium: joint bearings, the pack frame, the hatch fittings. */
    metal: new THREE.MeshStandardMaterial({ color: 0xc8ced4, roughness: 0.34, metalness: 0.42 }),
    /** The commander's stripes, so two astronauts are not the same white blob. */
    stripe: new THREE.MeshStandardMaterial({ color: 0xb32a24, roughness: 0.60, metalness: 0.02 }),
    /** Warning placards and the small lit panel on the chest module. */
    trim: new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.55, metalness: 0.20 }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xfff3d0, roughness: 0.3, metalness: 0.1, emissive: 0xffe9b0, emissiveIntensity: 0.8
    })
  };
  return cached;
}
