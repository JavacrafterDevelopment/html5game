/**
 * Overcast winter sky and the light rig that sells it.
 *
 * A flat fog colour alone reads as "grey soup", so the dome carries a vertical
 * gradient plus a diffuse bright patch where the sun is hiding behind the cloud.
 */

import * as THREE from '../../core/three.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
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

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.85));

  // broad glow where the sun sits behind the overcast
  float d = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += uSunColor * pow(d, 5.0) * 0.34;
  col += uSunColor * pow(d, 48.0) * 0.55;

  // dynamic moving cloud layer across the upper sky dome
  if (vDir.y > 0.01) {
    vec2 cloudUV = (vDir.xz / (vDir.y + 0.2)) * 0.65;
    cloudUV += uWind * (uTime * 0.018);
    float c1 = fbm(cloudUV * 2.2);
    float c2 = fbm(cloudUV * 4.6 + vec2(uTime * 0.009, 0.0));
    float cloud = smoothstep(0.36, 0.72, c1 * 0.65 + c2 * 0.35);
    float cloudMask = smoothstep(0.01, 0.32, vDir.y);
    vec3 cloudCol = mix(vec3(0.93, 0.96, 0.99), uSunColor * 1.1, pow(d, 5.0) * 0.55);
    col = mix(col, cloudCol, cloud * cloudMask * 0.48);
  }

  // haze thickening toward the horizon
  float horizon = 1.0 - abs(vDir.y);
  col = mix(col, uBottom * 1.04, pow(horizon, 3.5) * 0.65);

  gl_FragColor = vec4(col, 1.0);

  // Colour uniforms are in linear working space; custom shaders have to encode
  // for the canvas themselves or they render noticeably too dark.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function sunDirection(env) {
  const az = env.sunAzimuth;
  const el = env.sunElevation;
  return new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az)
  ).normalize();
}

export function createSky(env) {
  const geo = new THREE.SphereGeometry(900, 24, 16);
  const windDir = env.windDirection || [0.55, -0.28];
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(env.skyTop) },
      uBottom: { value: new THREE.Color(env.skyBottom) },
      uSunColor: { value: new THREE.Color(env.sunColor) },
      uSunDir: { value: sunDirection(env) },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(windDir[0], windDir[1]) }
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

/** 3D drifting fluffy cloud clusters over the snowy mountains */
export class CloudField {
  constructor(env, count = 24) {
    this.group = new THREE.Group();
    this.group.name = 'cloud-field';
    this.clouds = [];
    const wind = env.windDirection || [0.55, -0.28];
    this.wind = new THREE.Vector2(wind[0], wind[1]);
    this.speed = (env.windStrength || 1.4) * 3.5;

    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xeef5fa,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
      fog: true
    });

    const puffGeo = new THREE.DodecahedronGeometry(1, 1);

    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Group();
      const puffCount = 6 + Math.floor(Math.random() * 6);
      const rx = 18 + Math.random() * 26;
      const rz = 12 + Math.random() * 20;
      const ry = 4.5 + Math.random() * 7;

      for (let p = 0; p < puffCount; p++) {
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        const px = (Math.random() - 0.5) * rx;
        const pz = (Math.random() - 0.5) * rz;
        const py = (Math.random() - 0.5) * ry * 0.6;
        const pr = 5.5 + Math.random() * 8.5;
        puff.position.set(px, py, pz);
        puff.scale.set(pr * (0.8 + Math.random() * 0.4), pr * (0.55 + Math.random() * 0.35), pr * (0.8 + Math.random() * 0.4));
        puff.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        cloud.add(puff);
      }

      const x = (Math.random() - 0.5) * 380;
      const z = (Math.random() - 0.5) * 380;
      const y = 88 + Math.random() * 48;
      cloud.position.set(x, y, z);
      this.group.add(cloud);
      this.clouds.push(cloud);
    }
  }

  update(dt) {
    const moveX = this.wind.x * this.speed * dt;
    const moveZ = this.wind.y * this.speed * dt;
    const BOUND = 200;

    for (const c of this.clouds) {
      c.position.x += moveX;
      c.position.z += moveZ;

      if (c.position.x > BOUND) c.position.x -= BOUND * 2;
      else if (c.position.x < -BOUND) c.position.x += BOUND * 2;

      if (c.position.z > BOUND) c.position.z -= BOUND * 2;
      else if (c.position.z < -BOUND) c.position.z += BOUND * 2;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
  }
}

/**
 * @returns {{ group: THREE.Group, sun: THREE.DirectionalLight, update: (pos:THREE.Vector3)=>void }}
 */
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
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
  }
  group.add(sun);
  group.add(sun.target);

  // Sky/ground bounce -- snow throws a lot of light back up under the trees.
  const hemi = new THREE.HemisphereLight(env.ambientSky, env.ambientGround, env.ambientIntensity);
  group.add(hemi);

  // A weak fill from the opposite side keeps shadowed faces from going black.
  const fill = new THREE.DirectionalLight(0xbcd2e6, 0.28);
  fill.position.set(-dir.x * 60, 40, -dir.z * 60);
  group.add(fill);

  const shadowTarget = new THREE.Vector3();

  return {
    group,
    sun,
    hemi,
    /** Keep the shadow frustum centred slightly ahead of the player. */
    update(pos) {
      shadowTarget.copy(pos);
      sun.target.position.copy(shadowTarget);
      sun.target.updateMatrixWorld();
      sun.position.copy(dir).multiplyScalar(140).add(shadowTarget);
      sun.updateMatrixWorld();
    }
  };
}
