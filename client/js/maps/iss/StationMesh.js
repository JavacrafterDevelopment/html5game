/**
 * The station, drawn.
 *
 * This file has one rule and it is the reason it exists: the geometry comes from
 * shared/maps/iss/station.js, the same array the collider is built from. Nothing
 * here invents a position. A part is drawn where its collider is, at the size its
 * collider is, or it is not drawn at all -- which is the only way to guarantee
 * there is no such thing on this map as a fence hanging in the air.
 *
 * Decoration is allowed, under one condition: it must sit INSIDE the collision
 * volume it belongs to. Truss bracing, cupola window frames and interior panelling
 * are all drawn inside a solid the player can never get into, so they can be
 * angled, crossed and detailed as much as they like. The only things that break
 * the surface are handrails, hull ribs and the avionics boxes, and none of them by
 * more than about 15 cm -- which is the price of the station looking like the ISS
 * instead of like plumbing.
 *
 * Everything is merged down to one mesh per material, so 130-odd parts and a few
 * thousand fittings cost about a dozen draw calls.
 */

import * as THREE from '../../core/three.js';
import { mergeGeometries } from '../../core/GeoUtils.js';
import { STATION_PARTS } from '/shared/maps/iss/index.js';

const PERP = [[1, 2], [0, 2], [0, 1]];
/** Looks whose bore is part of the pressurised volume, so it gets cabin panelling. */
const PRESSURISED = new Set(['module', 'airlock', 'pma', 'collar', 'cupola']);
const SEG = 22;          // radial segments on a module. 22 is round at 3 m across.

// ============================================================ textures
function canvasTex(draw, size, repeat, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White multi-layer insulation: quilted, seamed, and not quite clean. */
function paintHull(ctx, S) {
  ctx.fillStyle = '#e8e9e6';
  ctx.fillRect(0, 0, S, S);
  // quilting
  ctx.strokeStyle = 'rgba(168,171,168,0.55)';
  ctx.lineWidth = 2;
  const step = S / 8;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(S, i * step); ctx.stroke();
  }
  // soft shading inside each quilted square so it reads as padded, not printed
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const g = ctx.createRadialGradient(
        (i + 0.5) * step, (j + 0.5) * step, step * 0.1,
        (i + 0.5) * step, (j + 0.5) * step, step * 0.62);
      g.addColorStop(0, 'rgba(255,255,255,0.34)');
      g.addColorStop(1, 'rgba(150,153,152,0.16)');
      ctx.fillStyle = g;
      ctx.fillRect(i * step, j * step, step, step);
    }
  }
  // grime and scuffs
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(120,124,126,${0.03 + Math.random() * 0.07})`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * S, Math.random() * S, 4 + Math.random() * 26,
      2 + Math.random() * 10, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Gold foil: the crinkled stuff wrapped round the nodes and the fittings. */
function paintFoil(ctx, S) {
  ctx.fillStyle = '#b98a2c';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const len = 10 + Math.random() * 70;
    ctx.strokeStyle = Math.random() < 0.5
      ? `rgba(255,225,150,${0.10 + Math.random() * 0.30})`
      : `rgba(96,66,16,${0.10 + Math.random() * 0.28})`;
    ctx.lineWidth = 1 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

/** Photovoltaic cells: dark amber squares on an amber backing. */
function paintSolar(ctx, S) {
  ctx.fillStyle = '#4a2f10';
  ctx.fillRect(0, 0, S, S);
  const n = 8, pad = S * 0.012;
  const cell = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = 0.82 + Math.random() * 0.18;
      ctx.fillStyle = `rgb(${Math.floor(150 * v)},${Math.floor(96 * v)},${Math.floor(28 * v)})`;
      ctx.fillRect(i * cell + pad, j * cell + pad, cell - pad * 2, cell - pad * 2);
      // the two collector strips across each cell
      ctx.fillStyle = 'rgba(206,178,120,0.5)';
      ctx.fillRect(i * cell + pad, j * cell + cell * 0.33, cell - pad * 2, 1.5);
      ctx.fillRect(i * cell + pad, j * cell + cell * 0.66, cell - pad * 2, 1.5);
    }
  }
}

/**
 * The inside of a module. There is no rack geometry in here -- racks that stuck
 * out into the bore would be things you fly through -- so the whole interior is
 * this texture on the inner wall: panel joints, stowage bags, cable runs, and the
 * light strips, which are also the emissive map.
 */
function paintInterior(ctx, S) {
  ctx.fillStyle = '#d8d9d4';
  ctx.fillRect(0, 0, S, S);
  const cols = 6, rows = 4;
  const cw = S / cols, ch = S / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * cw, y = j * ch;
      const r = Math.random();
      ctx.fillStyle = r < 0.42 ? '#cfd2cd' : r < 0.62 ? '#b9bdb8' : r < 0.78 ? '#e2e4df' : '#a9aeae';
      ctx.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      // fasteners round the panel edge
      ctx.fillStyle = 'rgba(90,95,98,0.55)';
      for (let k = 0; k < 5; k++) {
        ctx.fillRect(x + 8 + k * (cw - 22) / 4, y + 7, 3, 3);
        ctx.fillRect(x + 8 + k * (cw - 22) / 4, y + ch - 11, 3, 3);
      }
      // a stowage bag or a labelled hatch on some of them
      if (r > 0.62 && r < 0.82) {
        ctx.fillStyle = '#8b9099';
        ctx.fillRect(x + cw * 0.18, y + ch * 0.24, cw * 0.64, ch * 0.5);
        ctx.fillStyle = '#5d636c';
        ctx.fillRect(x + cw * 0.18, y + ch * 0.24, cw * 0.64, ch * 0.09);
      } else if (r >= 0.82) {
        ctx.strokeStyle = 'rgba(70,80,92,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 10, y + ch * 0.5);
        ctx.bezierCurveTo(x + cw * 0.4, y + ch * 0.2, x + cw * 0.6, y + ch * 0.8, x + cw - 10, y + ch * 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(96,100,104,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
    }
  }
  // light strips, which the emissive map picks up
  ctx.fillStyle = '#fbfdff';
  for (let j = 0; j < rows; j++) ctx.fillRect(0, j * ch + ch - 4, S, 4);
}

/**
 * Emissive companion to the interior.
 *
 * Not black-except-the-strips, which is what it physically ought to be: a strip
 * light is emissive but it does not LIGHT anything, so a module lit only that way
 * is a black tube with four glowing lines in it. Painting the panels a dim grey
 * here makes the cabin carry its own soft ambience, which is the cheap stand-in
 * for the bounce a real interior gets for free. The point lamps on top of this are
 * what light the people and the weapons.
 */
function paintInteriorGlow(ctx, S) {
  ctx.fillStyle = '#3f4348';
  ctx.fillRect(0, 0, S, S);
  const cols = 6, rows = 4;
  const cw = S / cols, ch = S / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const v = 46 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      ctx.fillRect(i * cw + 3, j * ch + 3, cw - 6, ch - 6);
    }
  }
  ctx.fillStyle = '#eaf4ff';
  for (let j = 0; j < rows; j++) ctx.fillRect(0, j * ch + ch - 4, S, 4);
}

// ============================================================ materials
function buildMaterials() {
  const hullTex = canvasTex(paintHull, 512, [3, 2]);
  const foilTex = canvasTex(paintFoil, 256, [2, 2]);
  const solarTex = canvasTex(paintSolar, 256, [26, 13]);
  const insideTex = canvasTex(paintInterior, 512, [4, 2]);
  const glowTex = canvasTex(paintInteriorGlow, 512, [4, 2], false);

  return {
    hull: new THREE.MeshStandardMaterial({ map: hullTex, roughness: 0.74, metalness: 0.06 }),
    interior: new THREE.MeshStandardMaterial({
      map: insideTex, emissiveMap: glowTex, emissive: 0xffffff, emissiveIntensity: 1.45,
      roughness: 0.80, metalness: 0.04
    }),
    // ------------------------------------------------------------------
    // Metalness is kept moderate all through here, and that is a decision worth
    // recording. A metalness of 1 has no diffuse response at all -- it is pure
    // reflection -- and this scene has no environment map for it to reflect. Set
    // it physically and every ring, strut and gimbal on the station renders as a
    // black silhouette. Held around 0.4 they keep a specular sheen off the sun
    // while still catching the earthshine, which is what actually reads as metal.
    foil: new THREE.MeshStandardMaterial({ map: foilTex, roughness: 0.38, metalness: 0.46 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xd2d8dd, roughness: 0.32, metalness: 0.40 }),
    truss: new THREE.MeshStandardMaterial({ color: 0xb6bec4, roughness: 0.44, metalness: 0.34 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x69727a, roughness: 0.60, metalness: 0.22 }),
    white: new THREE.MeshStandardMaterial({ color: 0xeef0ee, roughness: 0.52, metalness: 0.08 }),
    radiator: new THREE.MeshStandardMaterial({ color: 0xf6f9fa, roughness: 0.34, metalness: 0.12 }),
    solar: new THREE.MeshStandardMaterial({ map: solarTex, roughness: 0.34, metalness: 0.28 }),
    solarBack: new THREE.MeshStandardMaterial({ color: 0xa08048, roughness: 0.62, metalness: 0.16 }),
    /**
     * Cupola panes. Actually see-through, because the whole point of the Cupola is
     * the view -- opaque glass turns the best window on the station into a dark
     * hole. Safe to make transparent here: the only thing ever behind a pane is
     * the sky dome, which draws first, so there is nothing to sort against.
     */
    glass: new THREE.MeshStandardMaterial({
      color: 0x9fc4e8, roughness: 0.06, metalness: 0.15,
      transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide
    }),
    accent: new THREE.MeshStandardMaterial({ color: 0xb33027, roughness: 0.55, metalness: 0.10 })
  };
}

/** Which material each `look` from the layout is drawn in. */
const LOOK_MATERIAL = {
  module: 'hull', pma: 'hull', airlock: 'hull', cupola: 'white',
  collar: 'metal', hatch: 'foil', nodeblock: 'foil',
  truss: 'truss', rail: 'dark', oru: 'white', gimbal: 'metal',
  mast: 'metal', strut: 'metal', dish: 'white', door: 'white',
  blanket: 'solar', radiator: 'radiator', platform: 'dark', glass: 'glass'
};

// ============================================================ geometry
/** Turn a geometry inside out, so a bore is lit as a wall and not as a hole. */
function flip(geo) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) {
    nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  }
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
  } else {
    // non-indexed: swap the first and third vertex of each triangle
    const p = pos.array;
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const t = p[i * 3 + k];
        p[i * 3 + k] = p[(i + 2) * 3 + k];
        p[(i + 2) * 3 + k] = t;
      }
    }
    pos.needsUpdate = true;
  }
  return geo;
}

/** Rotate a Y-aligned geometry onto the part's axis. */
function orient(geo, axis) {
  if (axis === 0) geo.rotateZ(-Math.PI / 2);
  else if (axis === 2) geo.rotateX(Math.PI / 2);
  return geo;
}

function placeTube(geo, part) {
  orient(geo, part.axis);
  const p = [0, 0, 0];
  const [iu, iv] = PERP[part.axis];
  p[part.axis] = (part.from + part.to) * 0.5;
  p[iu] = part.u;
  p[iv] = part.v;
  geo.translate(p[0], p[1], p[2]);
  return geo;
}

function boxGeo(min, max) {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5);
  return g;
}

/**
 * A box that is allowed to be rotated, because it lives entirely inside a solid
 * the player can never reach: truss bracing, window mullions, interior fittings.
 */
function angledBox(w, h, d, pos, rot) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    g.applyMatrix4(m);
  }
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}

// ============================================================ part builders
function tubeParts(part, out) {
  const len = part.to - part.from;
  const look = part.look;
  const mat = LOOK_MATERIAL[look] || 'hull';
  // Anything with a bore you can fly down is panelled inside, collars included.
  // Leaving the collars bare aluminium put a grey band across the passage at every
  // hatch, which read as the corridor stopping and starting again.
  const inner = PRESSURISED.has(look) ? 'interior' : mat;

  // outer skin
  out(mat, placeTube(new THREE.CylinderGeometry(part.rOut, part.rOut, len, SEG, 1, true), part));

  if (part.rIn > 0) {
    // the bore, turned inside out
    out(inner, placeTube(flip(new THREE.CylinderGeometry(part.rIn, part.rIn, len, SEG, 1, true)), part));
    // annular end faces
    for (const end of [0, 1]) {
      const ring = new THREE.RingGeometry(part.rIn, part.rOut, SEG);
      ring.rotateX(end ? Math.PI / 2 : -Math.PI / 2);
      ring.translate(0, end ? -len / 2 : len / 2, 0);
      orient(ring, part.axis);
      const p = [0, 0, 0];
      const [iu, iv] = PERP[part.axis];
      p[part.axis] = (part.from + part.to) * 0.5;
      p[iu] = part.u; p[iv] = part.v;
      ring.translate(p[0], p[1], p[2]);
      out(mat, ring);
    }
  } else {
    // solid: flat caps top and bottom
    out(mat, placeTube(new THREE.CylinderGeometry(part.rOut, part.rOut, len, SEG, 1, false), part));
  }

  // ---- fittings ----
  if (look === 'module' || look === 'airlock') {
    decorateModule(part, len, out);
  } else if (look === 'cupola') {
    decorateCupola(part, len, out);
  }
}

/**
 * Ribs, handrails and a couple of boxes on the outside of a module.
 *
 * Ribs stand 4 cm off the skin and handrails 7 cm. That is the one place on this
 * map where something is drawn outside its collider, and it is a deliberate
 * trade: a module without handrails does not read as the ISS at all, and 7 cm of
 * overlap is not something anyone will find at flying speed.
 */
function decorateModule(part, len, out) {
  const [iu, iv] = PERP[part.axis];
  const axialCentre = (part.from + part.to) * 0.5;

  // ---- circumferential ribs ----
  // Open-ended, with two annular shoulders back down to the skin. A CLOSED
  // cylinder here would be a 45 mm band round the outside and a solid disc across
  // the inside, and since ribs are spaced every couple of metres that walls the
  // corridor off completely -- from inside a module you would be looking at a
  // bulkhead instead of down the length of the station.
  const ribs = Math.max(2, Math.round(len / 2.6));
  const rr = part.rOut + 0.045;
  for (let i = 1; i < ribs; i++) {
    const a = part.from + (len * i) / ribs;
    const pieces = [new THREE.CylinderGeometry(rr, rr, 0.16, SEG, 1, true)];
    for (const end of [0, 1]) {
      const ring = new THREE.RingGeometry(part.rOut, rr, SEG);
      ring.rotateX(end ? Math.PI / 2 : -Math.PI / 2);
      ring.translate(0, end ? -0.08 : 0.08, 0);
      pieces.push(ring);
    }
    const g = orient(mergeGeometries(pieces), part.axis);
    const p = [0, 0, 0];
    p[part.axis] = a; p[iu] = part.u; p[iv] = part.v;
    g.translate(p[0], p[1], p[2]);
    out('metal', g);
  }

  // ---- handrails ----
  // Built in a local frame with the module axis along +Z and the section in XY,
  // then dropped onto whichever axis the module actually runs along.
  const r0 = part.rOut - 0.02, r1 = part.rOut + 0.085;
  const half = 0.28;
  const rails = Math.max(1, Math.floor(len / 2.0));
  for (let i = 0; i < rails; i++) {
    const a = part.from + len * ((i + 0.5) / rails);
    for (const ang of [Math.PI * 0.5, 0, Math.PI * 1.5]) {
      const cx = Math.cos(ang), cy = Math.sin(ang);
      const pieces = [];

      const bar = new THREE.BoxGeometry(0.055, 0.055, half * 2);
      bar.translate(cx * r1, cy * r1, 0);
      pieces.push(bar);

      for (const s of [-1, 1]) {
        const st = new THREE.BoxGeometry(0.05, r1 - r0, 0.05);
        st.translate(0, (r0 + r1) * 0.5, 0);
        st.rotateZ(ang - Math.PI / 2);
        st.translate(0, 0, s * half);
        pieces.push(st);
      }

      out('metal', placeRadial(mergeGeometries(pieces), part, a));
    }
  }

  // ---- one avionics box per module, sat on the zenith face ----
  // Kept shallow so it stands no further off the skin than a handrail does.
  if (len > 6) {
    const boxLocal = new THREE.BoxGeometry(0.9, 0.18, 1.5);
    boxLocal.translate(0, part.rOut + 0.055, 0);
    out('white', placeRadial(boxLocal, part, axialCentre));
  }
}

/**
 * Take geometry authored with the module's axis along +Z and its section in XY,
 * and drop it onto the real part at axial position `a`.
 */
function placeRadial(geo, part, a) {
  if (part.axis === 0) geo.rotateY(Math.PI / 2);
  else if (part.axis === 1) geo.rotateX(-Math.PI / 2);
  const p = [0, 0, 0];
  const [iu, iv] = PERP[part.axis];
  p[part.axis] = a; p[iu] = part.u; p[iv] = part.v;
  geo.translate(p[0], p[1], p[2]);
  return geo;
}

/** Seven windows and the frames between them. All inside the 29 cm wall. */
function decorateCupola(part, len, out) {
  const rMid = (part.rIn + part.rOut) * 0.5;
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const cx = Math.cos(ang) * rMid, cz = Math.sin(ang) * rMid;
    // window pane, sunk into the wall
    const pane = angledBox(0.94, len * 0.62, 0.16, [part.u + cx, 0, part.v + cz], [0, -ang, 0]);
    pane.translate(0, (part.from + part.to) * 0.5, 0);
    out('glass', pane);
    // mullion between this pane and the next
    const mAng = ang + Math.PI / 6;
    const mx = Math.cos(mAng) * rMid, mz = Math.sin(mAng) * rMid;
    const mull = angledBox(0.26, len * 0.9, 0.30, [part.u + mx, 0, part.v + mz], [0, -mAng, 0]);
    mull.translate(0, (part.from + part.to) * 0.5, 0);
    out('white', mull);
  }
}

/** Truss bays: a solid core, four longerons, and the diagonals between them. */
function trussParts(part, out) {
  const { min, max } = part;
  const len = max[0] - min[0];
  const cy = (min[1] + max[1]) * 0.5, cz = (min[2] + max[2]) * 0.5;
  const hy = (max[1] - min[1]) * 0.5, hz = (max[2] - min[2]) * 0.5;

  out('dark', boxGeo(
    [min[0], cy - hy * 0.52, cz - hz * 0.52],
    [max[0], cy + hy * 0.52, cz + hz * 0.52]));

  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out('truss', boxGeo(
        [min[0], cy + sy * hy - (sy > 0 ? 0.20 : 0), cz + sz * hz - (sz > 0 ? 0.20 : 0)],
        [max[0], cy + sy * hy + (sy > 0 ? 0 : 0.20), cz + sz * hz + (sz > 0 ? 0 : 0.20)]));
    }
  }

  // Diagonals, alternating direction bay to bay. Angled boxes are safe here only
  // because they stay INSIDE the segment: each brace has to lie flat in the face it
  // braces, which means turning it about the axis normal to that face. Turning a
  // 4.4 m strut about the wrong axis stands it on end and leaves nearly two metres
  // of it hanging in space with no collider behind it -- exactly the kind of thing
  // this map is supposed to make impossible.
  const bays = Math.max(2, Math.round(len / 2.6));
  const bay = len / bays;
  for (let i = 0; i < bays; i++) {
    const x = min[0] + bay * (i + 0.5);
    const s = i % 2 === 0 ? 1 : -1;

    // port and starboard faces: brace lies in XY, so it turns about Z
    const dz = Math.hypot(bay, hy * 2) * 0.94;
    for (const sz of [-1, 1]) {
      out('truss', angledBox(0.13, dz, 0.13, [x, cy, cz + sz * hz], [0, 0, s * Math.atan2(bay, hy * 2)]));
    }
    // zenith and nadir faces: brace lies in XZ, so it turns about Y
    const dy = Math.hypot(bay, hz * 2) * 0.94;
    for (const sy of [-1, 1]) {
      out('truss', angledBox(0.13, 0.13, dy, [x, cy + sy * hy, cz], [0, s * Math.atan2(bay, hz * 2), 0]));
    }
    // cross frame at the bay joint
    if (i < bays - 1) {
      out('truss', boxGeo([x + bay * 0.5 - 0.09, cy - hy, cz - hz], [x + bay * 0.5 + 0.09, cy + hy, cz + hz]));
    }
  }
}

/** Blankets get a cell grid on the sunward face and plain backing underneath. */
function blanketParts(part, out) {
  const { min, max } = part;
  const mid = (min[1] + max[1]) * 0.5;
  out('solar', boxGeo([min[0], mid, min[2]], [max[0], max[1], max[2]]));
  out('solarBack', boxGeo([min[0], min[1], min[2]], [max[0], mid, max[2]]));
  // The tensioning battens across the blanket, which is what breaks up the sheet.
  const n = Math.max(3, Math.round((max[2] - min[2]) / 2.4));
  for (let i = 1; i < n; i++) {
    const z = min[2] + ((max[2] - min[2]) * i) / n;
    out('metal', boxGeo([min[0], min[1] - 0.03, z - 0.05], [max[0], max[1] + 0.03, z + 0.05]));
  }
}

/** Radiator panels: white, with the flow tubes running across them. */
function radiatorParts(part, out) {
  const { min, max } = part;
  out('radiator', boxGeo(min, max));
  const vertical = (max[1] - min[1]) > (max[0] - min[0]);
  const n = 7;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (vertical) {
      const y = min[1] + (max[1] - min[1]) * t;
      out('metal', boxGeo([min[0], y - 0.035, min[2] - 0.02], [max[0], y + 0.035, max[2] + 0.02]));
    } else {
      const x = min[0] + (max[0] - min[0]) * t;
      out('metal', boxGeo([x - 0.035, min[1], min[2] - 0.02], [x + 0.035, max[1], max[2] + 0.02]));
    }
  }
}

// ============================================================ assembly
export function createStation({ shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'station';
  const mats = buildMaterials();
  const buckets = new Map();
  const out = (key, geo) => {
    if (!geo) return;
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(geo);
  };

  for (const part of STATION_PARTS) {
    if (part.s === 'tube') {
      tubeParts(part, out);
      continue;
    }
    switch (part.look) {
      case 'truss': trussParts(part, out); break;
      case 'blanket': blanketParts(part, out); break;
      case 'radiator': radiatorParts(part, out); break;
      case 'nodeblock': {
        // White, not gold: these blocks form the corners of a node, and their
        // inner faces are wall you look at from inside the hub. Gold goes on as
        // patches on the outboard faces, where the MLI actually is.
        out('hull', boxGeo(part.min, part.max));
        const c = [(part.min[0] + part.max[0]) / 2, (part.min[1] + part.max[1]) / 2, (part.min[2] + part.max[2]) / 2];
        const sy = part.max[1] - c[1] > 0 ? 1 : 1;
        void sy;
        out('foil', boxGeo(
          [c[0] - 0.46, part.max[1] - 0.05, c[2] - 0.46],
          [c[0] + 0.46, part.max[1] + 0.01, c[2] + 0.46]));
        out('foil', boxGeo(
          [c[0] - 0.46, part.min[1] - 0.01, c[2] - 0.46],
          [c[0] + 0.46, part.min[1] + 0.05, c[2] + 0.46]));
        break;
      }
      default:
        out(LOOK_MATERIAL[part.look] || 'white', boxGeo(part.min, part.max));
    }
  }

  for (const [key, geos] of buckets) {
    const merged = mergeGeometries(geos);
    const mesh = new THREE.Mesh(merged, mats[key] || mats.white);
    mesh.name = 'station-' + key;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
  }

  group.userData.materials = mats;
  return group;
}
