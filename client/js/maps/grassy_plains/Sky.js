/**
 * Grassy Plains sky: a bright summer afternoon with clouds that drift downwind.
 *
 * The clouds share the map's wind vector, so the sky, the grass and the airborne
 * motes all visibly agree about which way it is blowing.
 */

import * as THREE from '../../core/three.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform vec2 uWind;
varying vec3 vDir;

// cheap value noise for the cloud band
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main() {
  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.7));

  float d = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += uSunColor * pow(d, 8.0) * 0.30;
  col += uSunColor * pow(d, 350.0) * 2.2;          // the sun itself

  // Clouds, projected onto the dome and drifting with the wind.
  if (vDir.y > 0.02) {
    vec2 uv = vDir.xz / max(vDir.y, 0.02) * 0.35;
    uv += uWind * uTime * 0.004;
    float n = fbm(uv * 1.6);
    float cover = smoothstep(0.52, 0.78, n);
    float bright = smoothstep(0.45, 0.95, fbm(uv * 3.1 + 4.0));
    vec3 cloud = mix(vec3(0.78, 0.80, 0.85), vec3(1.0, 0.99, 0.96), bright);
    // thin out toward the horizon so the band does not form a hard edge
    col = mix(col, cloud, cover * smoothstep(0.02, 0.35, vDir.y) * 0.88);
  }

  float horizon = 1.0 - abs(vDir.y);
  col = mix(col, uBottom * 1.05, pow(horizon, 5.0) * 0.5);

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

export function createSky(env) {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const wind = env.windDirection ?? [1, 0];
  const wl = Math.hypot(wind[0], wind[1]) || 1;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(env.skyTop) },
      uBottom: { value: new THREE.Color(env.skyBottom) },
      uSunColor: { value: new THREE.Color(env.sunColor) },
      uSunDir: { value: sunDirection(env) },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(wind[0] / wl, wind[1] / wl) }
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

export function createLighting(env, { shadows = true, shadowMapSize = 2048 } = {}) {
  const group = new THREE.Group();
  group.name = 'lighting';
  const dir = sunDirection(env);

  const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
  sun.position.copy(dir).multiplyScalar(120);
  sun.castShadow = shadows;
  if (shadows) {
    const extent = 62;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 340;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  group.add(sun, sun.target);

  // Sky above, grass bounce below -- the green fill is what makes it read as summer.
  group.add(new THREE.HemisphereLight(env.ambientSky, env.ambientGround, env.ambientIntensity));

  const fill = new THREE.DirectionalLight(0xcfe4ff, 0.22);
  fill.position.set(-dir.x * 60, 45, -dir.z * 60);
  group.add(fill);

  const target = new THREE.Vector3();
  return {
    group,
    sun,
    update(pos) {
      target.copy(pos);
      sun.target.position.copy(target);
      sun.target.updateMatrixWorld();
      sun.position.copy(dir).multiplyScalar(140).add(target);
      sun.updateMatrixWorld();
    }
  };
}
