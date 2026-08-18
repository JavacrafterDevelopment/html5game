/**
 * Orbital sky: stars everywhere, one white sun, and Earth underneath you.
 *
 * All three are drawn in the dome shader rather than as objects in the scene, and
 * that is the important decision. Anything real would have to sit somewhere, and
 * a 6000 km planet placed 90 m away is a thing you can fly into. Painted on the
 * dome they stay exactly where they belong -- infinitely far -- however far across
 * the map you thrust, and none of them can be collided with, lit, or shadowed by
 * the station.
 *
 * The lighting rig is the other half of the look. Vacuum has one light source and
 * no atmosphere to soften it, so shadows go to absolute black, which is truthful
 * and unplayable. Earth does the softening instead: a broad blue bounce from below,
 * which is genuinely where the fill light comes from up here.
 */

import * as THREE from '../../core/three.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunRadius;
uniform vec3 uEarthDir;
uniform vec3 uEarthAxis;
uniform float uEarthRadius;
uniform vec3 uMilkyAxis;
uniform float uStarDensity;
uniform float uTime;
varying vec3 vDir;

// ------------------------------------------------------------------ noise
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = 0.0;
  n += mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
               mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
           mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
               mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
float fbm3(vec3 p, int octaves) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * noise3(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

// ------------------------------------------------------------------ stars
/**
 * One layer of stars. Space is diced into cubes, each cube gets at most one star
 * at a random spot inside it, and the falloff radius is kept well under the cube
 * so neighbours never have to be sampled. Three layers at different scales is what
 * turns a regular lattice into a sky.
 */
vec3 starLayer(vec3 dir, float scale, float thresh, float size, float bright) {
  vec3 p = dir * scale;
  vec3 id = floor(p);
  vec3 f = fract(p);
  vec3 h = hash33(id);
  if (h.z > thresh) return vec3(0.0);

  vec3 centre = vec3(h.x, h.y, fract(h.z * 41.7)) * 0.7 + 0.15;
  float d = length(f - centre);
  float core = smoothstep(size, 0.0, d);
  core = pow(core, 3.0);

  // Colour by spectral class, roughly: most are white, some blue, a few orange.
  float t = fract(h.x * 71.3);
  vec3 tint = t < 0.18 ? vec3(0.70, 0.80, 1.00)
            : t < 0.72 ? vec3(1.00, 0.99, 0.97)
                       : vec3(1.00, 0.86, 0.70);
  float mag = 0.25 + fract(h.y * 53.1) * 0.75;
  return tint * core * bright * mag * mag;
}

vec3 starfield(vec3 dir, float milky) {
  float boost = 1.0 + milky * 1.6;      // the band is where the stars pile up
  vec3 c = vec3(0.0);
  c += starLayer(dir, 130.0, 0.070 * uStarDensity * boost, 0.17, 2.8);
  c += starLayer(dir, 260.0, 0.095 * uStarDensity * boost, 0.14, 1.6);
  c += starLayer(dir, 520.0, 0.130 * uStarDensity * boost, 0.115, 0.85);
  c += starLayer(dir, 900.0, 0.165 * uStarDensity * boost, 0.10, 0.42);
  c += starLayer(dir, 1500.0, 0.190 * uStarDensity * boost, 0.095, 0.20);
  return c;
}

// ------------------------------------------------------------------ earth
vec3 earthSurface(vec3 n, float limb, float lambert) {
  // Frequencies here are higher than they look like they need to be, and that is
  // not decoration. The normal barely turns per pixel at the middle of the disc
  // and swings hard at the limb, so a feature that is a sensible size out at the
  // edge gets magnified enormously in the centre -- at half these numbers a single
  // cloud cell covers most of the planet and reads as a white hole.
  //
  // The land threshold also sits well above the noise mean on purpose: at 0.5 the
  // planet comes out half land, and what makes Earth read as Earth is the water.
  float land = fbm3(n * 5.0 + 11.0, 5);
  float detail = fbm3(n * 17.0 + 3.0, 4);
  float shelf = land + detail * 0.09;
  float mask = smoothstep(0.578, 0.616, shelf);

  vec3 deep = vec3(0.012, 0.055, 0.165);
  vec3 shallow = vec3(0.055, 0.215, 0.365);
  // Shelf water round the coasts, which is most of the colour people remember.
  vec3 ocean = mix(deep, shallow, smoothstep(0.46, 0.55, shelf));

  vec3 green = mix(vec3(0.075, 0.165, 0.058), vec3(0.185, 0.255, 0.095), detail);
  vec3 sand  = mix(vec3(0.44, 0.355, 0.195), vec3(0.58, 0.48, 0.285), detail);
  float arid = smoothstep(0.44, 0.70, fbm3(n * 6.0 + 40.0, 3));
  vec3 ground = mix(green, sand, arid);
  vec3 col = mix(ocean, ground, mask);

  // Ice, at the poles -- measured against the planet's OWN axis, not the world's.
  // Using world Y here puts a pole wherever the planet happens to sit, and since
  // Earth hangs directly below the station that meant staring down at an ice cap
  // the size of the visible disc. Its axis is set nearly side-on instead, so what
  // faces you is the equator and the caps sit round toward the limb.
  float lat = dot(n, uEarthAxis);
  float ice = smoothstep(0.78, 0.93, abs(lat));
  col = mix(col, vec3(0.84, 0.89, 0.94), ice);

  // Sun glint off the water, which is the one specular the planet really has.
  col += vec3(0.35, 0.45, 0.55) * (1.0 - mask) * pow(lambert, 26.0) * 0.55;

  // Cloud deck, on its own noise field and drifting slowly against the surface.
  // Thinner and patchier than a straight threshold gives: solid cloud everywhere
  // the sun is overhead turns the middle of the disc into a white hole.
  float cl = fbm3(n * 10.0 + vec3(uTime * 0.0035, 0.0, uTime * 0.0021) + 70.0, 5);
  float swirl = fbm3(n * 26.0 + 90.0, 4);
  float cloud = smoothstep(0.50, 0.80, cl * 0.72 + swirl * 0.36);
  col = mix(col, vec3(0.93, 0.95, 0.98), cloud * 0.58);

  // Air thickens toward the limb: everything there goes blue and washes out.
  col = mix(col, vec3(0.32, 0.50, 0.80), pow(limb, 2.6) * 0.78);
  return col;
}

void main() {
  vec3 dir = normalize(vDir);

  // --- the band, and the dust lanes cut into it ---
  float off = abs(dot(dir, uMilkyAxis));
  float band = pow(1.0 - smoothstep(0.0, 0.30, off), 2.6);
  // Two scales of dust: the wide lanes that split the band, and fine mottling on
  // top. Without the fine layer the galaxy reads as one soft grey smear.
  float dust = fbm3(dir * 11.0 + 5.0, 4);
  float fine = fbm3(dir * 34.0 + 19.0, 3);
  float lanes = smoothstep(0.30, 0.72, dust * 0.72 + fine * 0.38);
  float milky = band * mix(0.06, 1.0, lanes);

  vec3 col = vec3(0.004, 0.005, 0.011);
  col += vec3(0.036, 0.038, 0.058) * milky;
  col += starfield(dir, milky);

  // --- the sun ---
  float sd = dot(dir, uSunDir);
  float ang = acos(clamp(sd, -1.0, 1.0));
  // A hard-edged white disc. No atmosphere means no glare to speak of, but a
  // little bloom sells it as a light source rather than a sticker.
  col += uSunColor * smoothstep(uSunRadius * 1.25, uSunRadius * 0.72, ang) * 12.0;
  col += uSunColor * pow(max(sd, 0.0), 2200.0) * 3.0;
  col += uSunColor * pow(max(sd, 0.0), 90.0) * 0.10;

  // --- earth ---
  float ed = dot(dir, uEarthDir);
  float ea = acos(clamp(ed, -1.0, 1.0));
  float R = uEarthRadius;
  if (ea < R * 1.10) {
    // Surface normal for a point on a sphere of angular radius R, seen from
    // outside. This is what puts a real terminator on it instead of a gradient.
    // uEarthDir points from the observer toward the planet, so the OUTWARD surface
    // normal at the middle of the disc is its negative. Getting this backwards
    // lights the far side and leaves the face you are looking at in darkness.
    float s = clamp(sin(ea) / sin(R), 0.0, 1.0);
    float beta = asin(s);
    // Straight at the middle of the disc this tangent cancels to zero, and
    // normalising it there would hand every downstream term a NaN.
    vec3 tangent = dir - uEarthDir * ed;
    float tl = length(tangent);
    vec3 perp = tl > 1e-5 ? tangent / tl : vec3(0.0);
    vec3 n = normalize(-uEarthDir * cos(beta) + perp * sin(beta));

    float limb = s;
    float lambert = max(dot(n, uSunDir), 0.0);
    vec3 surf = earthSurface(n, limb, lambert);
    // Rolled off rather than boosted: the sub-solar point is where a planet blows
    // out, and once it clips there is no cloud structure left to look at.
    float day = pow(lambert, 0.62) * 0.92;

    // Night side: not black, because Earth never is. Cities, faintly.
    float cityMask = smoothstep(0.50, 0.56, fbm3(n * 5.0 + 11.0, 4));
    float cities = cityMask * smoothstep(0.62, 0.86, fbm3(n * 52.0, 3));
    vec3 night = vec3(0.008, 0.012, 0.026) + vec3(1.00, 0.76, 0.42) * cities * 0.30;

    // A warm ring right on the terminator, where the light is grazing.
    float dusk = smoothstep(0.0, 0.22, lambert) * (1.0 - smoothstep(0.10, 0.42, lambert));
    vec3 lit = surf * day + vec3(0.55, 0.30, 0.16) * dusk * 0.30;
    vec3 earth = mix(night, lit, smoothstep(-0.03, 0.14, dot(n, uSunDir)));

    float disc = smoothstep(R, R * 0.995, ea);
    col = mix(col, earth, disc);

    // The atmosphere, which reads both as a bright edge on the disc and as a
    // halo just outside it. Only lit where the sun is actually hitting it.
    float rim = smoothstep(R * 0.93, R, ea) * smoothstep(R * 1.08, R * 0.995, ea);
    // Only the sunlit part of the limb glows. On the night side it fades to a
    // thin blue thread, which is what it actually looks like from up here.
    float sunlitRim = smoothstep(-0.15, 0.55, dot(n, uSunDir));
    col += vec3(0.26, 0.48, 0.90) * rim * (0.10 + sunlitRim * 0.95);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function sunDirection(env) {
  const az = env.sunAzimuth, el = env.sunElevation;
  return new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).normalize();
}

export function earthDirection(env) {
  const d = env.earthDirection || [0, -1, 0];
  return new THREE.Vector3(d[0], d[1], d[2]).normalize();
}

/**
 * The planet's spin axis: nearly perpendicular to the direction it lies in, then
 * leaned a little so one pole shows near the limb rather than neither.
 */
export function earthAxis(env) {
  const dir = earthDirection(env);
  const ref = Math.abs(dir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(dir, ref).normalize()
    .addScaledVector(dir, -0.34).normalize();
}

export function createSky(env) {
  const geo = new THREE.SphereGeometry(900, 48, 32);
  const tilt = env.milkyWayTilt ?? 0.55;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDirection(env) },
      uSunColor: { value: new THREE.Color(env.sunColor) },
      uSunRadius: { value: env.sunAngularRadius ?? 0.019 },
      uEarthDir: { value: earthDirection(env) },
      uEarthAxis: { value: earthAxis(env) },
      uEarthRadius: { value: env.earthAngularRadius ?? 0.74 },
      // The plane of the galaxy, tilted across the sky so it is not just a stripe
      // along one of the map axes.
      uMilkyAxis: {
        value: new THREE.Vector3(Math.sin(tilt), Math.cos(tilt) * 0.82, Math.cos(tilt) * 0.55).normalize()
      },
      uStarDensity: { value: env.starDensity ?? 1.0 },
      uTime: { value: 0 }
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

/**
 * Cabin lighting.
 *
 * The modules were pitch black before this: the only light on the map came from the
 * sun and from Earth, and neither of them gets inside a hull. Emissive light strips
 * make the strips glow but light nothing, so the inside of the station needs actual
 * lamps -- and they earn their cost twice over, because they are also what lights an
 * astronaut who is inside a module rather than silhouetted against space.
 *
 * One per compartment, taken straight from the layout's own list of compartment
 * centres, so a module cannot be added later and left dark.
 */
export function createInteriorLights(probes) {
  const group = new THREE.Group();
  group.name = 'cabin-lights';
  for (const [x, y, z] of probes) {
    const lamp = new THREE.PointLight(0xf4f7ff, 6.5, 16, 2);
    lamp.position.set(x, y, z);
    group.add(lamp);
  }
  return group;
}

export function createLighting(env, { shadows = true, shadowMapSize = 2048 } = {}) {
  const group = new THREE.Group();
  group.name = 'lighting';
  const dir = sunDirection(env);
  const earth = earthDirection(env);

  const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
  sun.position.copy(dir).multiplyScalar(160);
  sun.castShadow = shadows;
  if (shadows) {
    // Tighter than the ground maps run it. The station is 100 m across but the
    // interesting shadows are the ones a few metres from you, and a frustum that
    // tried to hold a solar array would waste its whole resolution on a flat panel.
    const extent = 46;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.028;
  }
  group.add(sun, sun.target);

  // Sky is near-black, ground is Earth. Rolling over genuinely changes the light
  // on your hands, which is a thing you notice the first time you do it.
  group.add(new THREE.HemisphereLight(env.ambientSky, env.ambientGround, env.ambientIntensity));

  const fill = new THREE.DirectionalLight(env.earthFill ?? 0x4f8fd0, env.earthFillIntensity ?? 0.55);
  fill.position.copy(earth).multiplyScalar(-140);
  group.add(fill);

  const target = new THREE.Vector3();
  return {
    group,
    sun,
    update(pos) {
      target.copy(pos);
      sun.target.position.copy(target);
      sun.target.updateMatrixWorld();
      sun.position.copy(dir).multiplyScalar(180).add(target);
      sun.updateMatrixWorld();
    }
  };
}
