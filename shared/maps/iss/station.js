/**
 * The station, as data.
 *
 * Every single thing you can see on this map is one entry in PARTS, and every
 * entry in PARTS is a collider. There is no second list. That is deliberate: the
 * previous map grew fences and props that were drawn from one table and collided
 * from another, and they drifted apart into scenery floating in mid-air. Here the
 * renderer walks this array and builds a mesh per part, so a thing cannot be drawn
 * somewhere it does not exist.
 *
 * Shapes are limited to what the collider can represent EXACTLY:
 *
 *   tube - an axis-aligned cylinder with an open bore. This is a station module,
 *          and it is why the hull is round instead of a box that pretends to be.
 *          rIn = 0 degenerates to a solid cylinder: bulkhead discs, masts, cans.
 *   box  - axis-aligned. The truss, the array blankets, the radiators. All of
 *          those really are flat or square, so nothing is being approximated.
 *
 * Nothing is rotated off-axis anywhere on this map, and that is not laziness --
 * an AABB fitted round a rotated object is bigger than the object, and that gap is
 * exactly what an invisible wall is.
 *
 * ---------------------------------------------------------------- orientation
 *   -Z forward (the Harmony end)      +Z aft (the Zvezda end)
 *   -X port                           +X starboard   (the truss runs along X)
 *   +Y zenith, away from Earth        -Y nadir, Earth below you
 */

import { KIND } from '../kinds.js';

/**
 * The pressurised bore is the same all the way through the station, because it is
 * the thing you fly down: a hatch that changed size between modules would be a
 * place you could get wedged. Hull radii vary per module the way the real ones do.
 */
export const BORE = 2.05;
/** Berthing collars. Fat rings, and structural: see `node()` for why. */
export const COLLAR_R = 3.35;
const COLLAR_IN = 2.05;    // collar starts this far from a node's centre
const COLLAR_OUT = 3.30;   // ...and ends here, where the module takes over

const PARTS = [];

/**
 * @param {object} p
 * @param {string} p.name    shown in nothing, but it is how you find a part again
 * @param {string} p.look    render style; see client/js/maps/iss/StationMesh.js
 */
function tube(name, look, axis, u, v, from, to, rIn, rOut, kind = KIND.HULL) {
  PARTS.push({ name, look, s: 'tube', axis, u, v, from, to, rIn, rOut, kind });
  return PARTS[PARTS.length - 1];
}

function box(name, look, min, max, kind = KIND.TRUSS) {
  PARTS.push({ name, look, s: 'box', min, max, kind });
  return PARTS[PARTS.length - 1];
}

// =========================================================================
// Nodes
// =========================================================================

/**
 * A connecting node: Unity, Harmony, Tranquility.
 *
 * Built as six berthing collars meeting at a hub, one on every axis, with nothing
 * in the middle. That is not a stylistic choice, it is the only hollow shape the
 * collider can make: a solid is a union of primitives and a union cannot have a
 * hole punched in it, so the opening has to come from the shape of each piece.
 *
 * The six collars seal the hub completely. Sketch it along the (1,1,1) diagonal:
 * the +X collar becomes solid at 2.05 m along X, which on that diagonal is 3.55 m
 * from the hub centre, well inside the 4.1 m the ring reaches to. Every direction
 * out of the hub is either blocked by a collar or is a port bore, and every port
 * bore continues into a module or into a cap. tools/test-maps.mjs fires several
 * thousand directions at this to prove it, because "probably sealed" is how you
 * end up with a player floating out through the corner of a wall.
 *
 * @param {Record<string, 'open'|'cap'>} ports  what happens at each collar's outer
 *   end. An axis you leave out still gets a collar, capped -- an unlisted port is
 *   a hole, and a hole in a node is a hole in the station.
 */
function node(name, x, y, z, ports = {}) {
  const AXES = [
    ['-x', 0, -1], ['+x', 0, 1],
    ['-y', 1, -1], ['+y', 1, 1],
    ['-z', 2, -1], ['+z', 2, 1]
  ];
  const centre = [x, y, z];
  const hub = { name, x, y, z, ports: {} };

  for (const [key, axis, dir] of AXES) {
    const perp = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const u = centre[perp[0]], v = centre[perp[1]];
    const a0 = centre[axis] + COLLAR_IN * dir;
    const a1 = centre[axis] + COLLAR_OUT * dir;
    tube(`${name}-collar${key}`, 'collar', axis,
      u, v, Math.min(a0, a1), Math.max(a0, a1), BORE, COLLAR_R);

    // A capped port is a dead end you can still float into and look around.
    if ((ports[key] || 'cap') === 'cap') {
      const c0 = a1, c1 = centre[axis] + (COLLAR_OUT + 0.28) * dir;
      tube(`${name}-hatch${key}`, 'hatch', axis,
        u, v, Math.min(c0, c1), Math.max(c0, c1), 0, COLLAR_R * 0.94);
    }
    hub.ports[key] = { axis, dir, u, v, end: a1 };
  }

  // The eight corner blocks between the rings.
  //
  // Six rings alone technically close the hub, but only just: along the (1,1,1)
  // diagonal the wall they form is a couple of hundred millimetres thick, and a
  // body wedged in that corner is being pushed by three rings at once, each of
  // which resolves it somewhere the other two disagree with. The result is a
  // player fired out through the corner at speed. These blocks make the corner a
  // metre and a half of plain box instead, which resolves unambiguously.
  //
  // They cannot foul a hatch: a block needs 1.60 m of clearance on all three axes
  // at once, so the nearest it ever comes to a port axis is 2.26 m, and the bore
  // is 2.05 m. tools/test-maps.mjs holds the seal to zero escapes in 13,200 tries.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lo = [x + sx * 1.60, y + sy * 1.60, z + sz * 1.60];
        const hi = [x + sx * 2.95, y + sy * 2.95, z + sz * 2.95];
        box(`${name}-corner${sx > 0 ? 'p' : 'm'}${sy > 0 ? 'p' : 'm'}${sz > 0 ? 'p' : 'm'}`, 'nodeblock',
          [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2])],
          [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2])],
          KIND.HULL);
      }
    }
  }
  return hub;
}

// =========================================================================
// The pressurised stack, forward to aft
// =========================================================================

export const HARMONY = node('harmony', 0, 0, -22, {
  '-z': 'open',        // out through PMA-2, into open space
  '+z': 'open',        // Destiny
  '-x': 'open',        // Kibo
  '+x': 'open'         // Columbus
});

export const UNITY = node('unity', 0, 0, -2, {
  '-z': 'open',        // Destiny
  '+z': 'open',        // Zarya
  '-x': 'open',        // Tranquility
  '+x': 'open'         // the Quest airlock, and out
});

export const TRANQUILITY = node('tranquility', -6.6, 0, -2, {
  '+x': 'open',        // back to Unity
  '-x': 'open',        // the Leonardo module
  '-y': 'open'         // down into the Cupola
});

/** Pressurised Mating Adapter 2: the forward door, and it stands open. */
tube('pma2', 'pma', 2, 0, 0, -28.6, -25.30, BORE, 2.72);
tube('pma2-lip', 'collar', 2, 0, 0, -28.9, -28.6, BORE, 3.05);

tube('destiny', 'module', 2, 0, 0, -18.70, -5.30, BORE, 2.50);
tube('zarya', 'module', 2, 0, 0, 1.30, 13.60, BORE, 2.30);
tube('zarya-zvezda-collar', 'collar', 2, 0, 0, 13.60, 14.40, BORE, 2.62);
tube('zvezda', 'module', 2, 0, 0, 14.40, 27.00, BORE, 2.35);
/** The aft door. Also open: the stack is a 55 m tunnel with a way out at each end. */
tube('zvezda-lip', 'collar', 2, 0, 0, 27.00, 27.35, BORE, 2.66);

// --- radial modules off Harmony ---
tube('columbus', 'module', 0, 0, -22, 3.30, 11.60, BORE, 2.36);
tube('columbus-cap', 'hatch', 0, 0, -22, 11.60, 11.95, 0, 2.36);
tube('kibo', 'module', 0, 0, -22, -13.40, -3.30, BORE, 2.62);
tube('kibo-cap', 'hatch', 0, 0, -22, -13.75, -13.40, 0, 2.62);

/**
 * Kibo's Exposed Facility: the open-air experiment porch on the end of the lab.
 * Bolted to Kibo's end cap, which is why it starts exactly where the cap stops.
 */
box('kibo-ef', 'platform', [-19.60, -1.40, -25.20], [-13.75, 1.40, -18.80]);
box('kibo-ef-rail', 'rail', [-19.60, 1.40, -25.20], [-13.75, 1.75, -24.85]);
box('kibo-ef-rail2', 'rail', [-19.60, 1.40, -19.15], [-13.75, 1.75, -18.80]);

// --- Quest: the airlock you fly out of ---
tube('quest', 'airlock', 0, 0, -2, 3.30, 9.10, BORE, 2.28);
tube('quest-rim', 'collar', 0, 0, -2, 9.10, 9.55, BORE, 2.62);
/**
 * The outer hatch, swung fully back on its hinge and left there.
 *
 * Hung well below the opening on purpose. Anything within 2.05 m of the airlock
 * axis is in the doorway, and a door parked in its own doorway is the sort of
 * detail that reads as broken from the first second you look at it.
 */
box('quest-hatch-hinge', 'rail', [9.20, -2.85, -2.60], [9.80, -2.15, -1.40]);
tube('quest-hatch-door', 'door', 0, -3.90, -2, 9.60, 9.92, 0, 1.35);

// --- Tranquility's neighbours ---
tube('leonardo', 'module', 0, 0, -2, -13.60, -9.90, BORE, 2.44);
tube('leonardo-cap', 'hatch', 0, 0, -2, -13.95, -13.60, 0, 2.44);

/** The Cupola: seven windows and the best view on the map. */
tube('cupola-neck', 'module', 1, -6.6, -2, -5.40, -3.30, BORE, 2.30);
tube('cupola-dome', 'cupola', 1, -6.6, -2, -6.55, -5.40, BORE * 0.86, 2.05);
tube('cupola-glass', 'glass', 1, -6.6, -2, -6.90, -6.55, 0, 1.90, KIND.GLASS);

// =========================================================================
// The truss, and everything hanging off it
// =========================================================================

/** Z1: the column standing on Unity's zenith port that carries the whole truss. */
tube('z1-column', 'strut', 1, 0, -2, 3.30, 6.20, 0, 1.62, KIND.TRUSS);
box('z1-saddle', 'truss', [-2.10, 5.60, -4.10], [2.10, 6.20, 0.10]);

const TRUSS_Y0 = 6.20, TRUSS_Y1 = 9.80;
const TRUSS_Z0 = -3.80, TRUSS_Z1 = -0.20;
export const TRUSS = { y0: TRUSS_Y0, y1: TRUSS_Y1, z0: TRUSS_Z0, z1: TRUSS_Z1, x0: -54, x1: 54 };

/**
 * Eight segments end to end. They are split rather than drawn as one long box so
 * the renderer can put a visible joint between them -- the real thing is a chain of
 * bolted-together bays and it reads wrong as a single extrusion.
 */
const TRUSS_SEGMENTS = [-54, -47, -40, -33, -24, -7, 7, 24, 33, 40, 47, 54];
for (let i = 0; i < TRUSS_SEGMENTS.length - 1; i++) {
  box(`truss-${i}`, 'truss',
    [TRUSS_SEGMENTS[i], TRUSS_Y0, TRUSS_Z0],
    [TRUSS_SEGMENTS[i + 1], TRUSS_Y1, TRUSS_Z1]);
}

/** Crew and equipment translation rails, running the length of the zenith face. */
box('ceta-rail-fwd', 'rail', [-54, TRUSS_Y1, TRUSS_Z0 + 0.30], [54, TRUSS_Y1 + 0.30, TRUSS_Z0 + 0.75]);
box('ceta-rail-aft', 'rail', [-54, TRUSS_Y1, TRUSS_Z1 - 0.75], [54, TRUSS_Y1 + 0.30, TRUSS_Z1 - 0.30]);

/** Battery and pump boxes, sitting on the truss where the real ORUs sit. */
for (const x of [-43, -37, -29, -12, 12, 29, 37, 43]) {
  box(`oru-${x}`, 'oru', [x - 1.6, TRUSS_Y0 - 1.15, TRUSS_Z0 + 0.40], [x + 1.6, TRUSS_Y0, TRUSS_Z1 - 0.40]);
}

// --- solar array wings ---
/**
 * Four wings, two blankets each, exactly as the real station carries them. The
 * blankets lie in the XZ plane with the beta gimbals at zero, which points them at
 * a sun that is high overhead -- and, not by accident, makes every blanket an exact
 * axis-aligned box instead of a rotated one.
 */
export const WINGS = [-47, -33, 33, 47];
for (const x of WINGS) {
  const side = x < 0 ? 'p' : 's';
  const tag = `${side}${Math.abs(x)}`;
  // The gimbal can straddles the truss, so the wing is unambiguously bolted on.
  box(`bga-${tag}`, 'gimbal', [x - 1.35, TRUSS_Y0 - 1.9, TRUSS_Z0 - 0.25], [x + 1.35, TRUSS_Y1 + 1.9, TRUSS_Z1 + 0.25]);
  // Masts run the full length of their blanket: nothing is cantilevered off air.
  box(`mast-${tag}-f`, 'mast', [x - 0.38, 7.62, -26.40], [x + 0.38, 8.38, -1.40]);
  box(`mast-${tag}-a`, 'mast', [x - 0.38, 7.62, -2.60], [x + 0.38, 8.38, 22.40]);
  // 22 cm thick, not the 12 cm the panel is drawn at. The tensioning battens have
  // to stand proud of the blanket to read as battens, and the only way they can do
  // that without standing proud of the collider is if the collider has room for
  // them -- see blanketParts() in StationMesh.js.
  box(`saw-${tag}-f`, 'blanket', [x - 5.60, 7.89, -26.40], [x + 5.60, 8.11, -4.20], KIND.SOLAR);
  box(`saw-${tag}-a`, 'blanket', [x - 5.60, 7.89, 0.20], [x + 5.60, 8.11, 22.40], KIND.SOLAR);
  // Photovoltaic radiator, hung off the nadir face beside the gimbal.
  box(`pvr-${tag}`, 'radiator', [x - 3.40, 1.80, TRUSS_Z0 + 0.55], [x + 3.40, TRUSS_Y0, TRUSS_Z0 + 0.75], KIND.RADIATOR);
}

/** The two big heat-rejection radiators, hinged off the nadir face of the truss. */
for (const dir of [-1, 1]) {
  const tag = dir < 0 ? 'port' : 'stbd';
  const xa = dir * 16, xb = dir * 26;
  box(`hrs-hinge-${tag}`, 'gimbal', [Math.min(xa, xb) + 0.8, TRUSS_Y0 - 0.9, TRUSS_Z0 + 1.2],
    [Math.max(xa, xb) - 0.8, TRUSS_Y0, TRUSS_Z1 - 1.2]);
  box(`hrs-${tag}`, 'radiator', [Math.min(xa, xb), -3.60, TRUSS_Z0 + 1.55],
    [Math.max(xa, xb), TRUSS_Y0 - 0.85, TRUSS_Z0 + 1.80], KIND.RADIATOR);
}

/**
 * Canadarm2, parked. Two booms and an elbow, both axis-aligned -- an arm folded
 * into a right angle is a pose the real one holds all the time, and it is the only
 * pose that collides honestly.
 */
box('mbs', 'oru', [-3.20, TRUSS_Y1, TRUSS_Z0 + 0.9], [3.20, TRUSS_Y1 + 1.30, TRUSS_Z1 - 0.9]);
box('ssrms-base', 'gimbal', [1.40, TRUSS_Y1 + 1.30, -2.90], [3.60, TRUSS_Y1 + 2.60, -0.90]);
box('ssrms-boom-a', 'mast', [2.20, TRUSS_Y1 + 1.75, -2.60], [16.40, TRUSS_Y1 + 2.55, -1.20]);
box('ssrms-elbow', 'gimbal', [15.20, TRUSS_Y1 + 1.45, -2.90], [17.20, TRUSS_Y1 + 2.85, -0.90]);
box('ssrms-boom-b', 'mast', [15.60, TRUSS_Y1 + 1.75, -16.80], [16.80, TRUSS_Y1 + 2.55, -2.20]);
box('ssrms-hand', 'gimbal', [15.20, TRUSS_Y1 + 1.45, -18.20], [17.20, TRUSS_Y1 + 2.85, -16.40]);

/** S-band and Ku-band dishes, on masts off the truss. Antennas, not litter. */
for (const [x, z] of [[-36, TRUSS_Z0], [36, TRUSS_Z1]]) {
  const out = z < -2 ? -1 : 1;
  box(`comm-mast-${x}`, 'mast', [x - 0.30, TRUSS_Y1, Math.min(z, z + out * 2.6)], [x + 0.30, TRUSS_Y1 + 0.30, Math.max(z, z + out * 2.6)]);
  tube(`comm-dish-${x}`, 'dish', 2, x, TRUSS_Y1 + 0.15, Math.min(z + out * 2.6, z + out * 3.2), Math.max(z + out * 2.6, z + out * 3.2), 0, 1.55, KIND.TRUSS);
}

export const NODES = [HARMONY, UNITY, TRANQUILITY];

/**
 * The three ways in and out, as plugs.
 *
 * tools/test-maps.mjs builds a second copy of the station with these filled in and
 * demands that nothing escapes it -- so a leak anywhere in the hull cannot hide
 * behind "well, it probably went out of a hatch". The doorways are then proved
 * open by flying through them on the real map.
 */
export const DOORWAYS = [
  { name: 'forward', axis: 2, u: 0, v: 0, from: -29.20, to: -28.90, r: 3.05 },
  { name: 'aft', axis: 2, u: 0, v: 0, from: 27.35, to: 27.65, r: 2.66 },
  { name: 'quest', axis: 0, u: 0, v: -2, from: 9.55, to: 9.85, r: 2.62 }
];

/** One point in the middle of every pressurised compartment on the station. */
export const INTERIOR_PROBES = [
  [0, 0, -22], [0, 0, -2], [-6.6, 0, -2],          // the three nodes
  [0, 0, -27], [0, 0, -12], [0, 0, 7], [0, 0, 20], // PMA, Destiny, Zarya, Zvezda
  [7, 0, -22], [-8, 0, -22],                       // Columbus, Kibo
  [6, 0, -2], [-11.5, 0, -2], [-6.6, -4.4, -2]     // Quest, Leonardo, Cupola
];

export const STATION_PARTS = PARTS;

/** Everything the station occupies, for framing the camera and seeding spawns. */
export const STATION_BOUNDS = (() => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of PARTS) {
    let lo, hi;
    if (p.s === 'box') { lo = p.min; hi = p.max; }
    else {
      lo = [0, 0, 0]; hi = [0, 0, 0];
      const perp = p.axis === 0 ? [1, 2] : p.axis === 1 ? [0, 2] : [0, 1];
      lo[p.axis] = p.from; hi[p.axis] = p.to;
      lo[perp[0]] = p.u - p.rOut; hi[perp[0]] = p.u + p.rOut;
      lo[perp[1]] = p.v - p.rOut; hi[perp[1]] = p.v + p.rOut;
    }
    for (let i = 0; i < 3; i++) {
      if (lo[i] < min[i]) min[i] = lo[i];
      if (hi[i] > max[i]) max[i] = hi[i];
    }
  }
  return { min, max };
})();

/** Axis-aligned bounds of one part. Used by the connectivity test and the renderer. */
export function partBounds(p) {
  if (p.s === 'box') return { min: p.min.slice(), max: p.max.slice() };
  const min = [0, 0, 0], max = [0, 0, 0];
  const perp = p.axis === 0 ? [1, 2] : p.axis === 1 ? [0, 2] : [0, 1];
  min[p.axis] = p.from; max[p.axis] = p.to;
  min[perp[0]] = p.u - p.rOut; max[perp[0]] = p.u + p.rOut;
  min[perp[1]] = p.v - p.rOut; max[perp[1]] = p.v + p.rOut;
  return { min, max };
}
