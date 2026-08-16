/**
 * Falling snow.
 *
 * All motion happens on the GPU. Particles live in a box that is re-tiled around the
 * camera every frame in the vertex shader, so flakes look like they are standing
 * still in the world while you run through them -- and nothing is ever uploaded
 * after creation.
 *
 * Two layers: fine distant flakes for density, fewer fat near flakes for depth.
 */

import * as THREE from '../core/three.js';

const VERT = /* glsl */`
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCamPos;
uniform vec2 uWind;
uniform float uSizeScale;

attribute float aSpeed;
attribute float aSize;
attribute float aPhase;

varying float vAlpha;
varying float vSpin;

void main() {
  vec3 p = position;

  // fall + flutter + wind drift
  p.y -= uTime * aSpeed;
  p.x += sin(uTime * 0.9 + aPhase) * 0.85 + uWind.x * uTime;
  p.z += cos(uTime * 0.75 + aPhase * 1.37) * 0.85 + uWind.y * uTime;

  // Tile the box around the camera: keeps flakes world-locked while always
  // surrounding the viewer, with no CPU work and no popping.
  vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCamPos + rel;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  float dist = -mv.z;

  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uSizeScale * (260.0 / max(dist, 0.6));

  // Fade very close flakes (they would smear across the screen) and very far ones.
  vAlpha = smoothstep(0.35, 1.6, dist) * (1.0 - smoothstep(uBox.x * 0.34, uBox.x * 0.52, dist));
  vSpin = aPhase;
}
`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vSpin;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  // soft flake with a slightly denser core
  float a = smoothstep(0.5, 0.12, d);
  a *= mix(0.75, 1.0, smoothstep(0.32, 0.0, d));

  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function buildLayer({ count, box, speedRange, sizeRange, opacity, color, sizeScale }) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3] = Math.random() * box.x;
    pos[i * 3 + 1] = Math.random() * box.y;
    pos[i * 3 + 2] = Math.random() * box.z;
    speed[i] = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
    size[i] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    phase[i] = Math.random() * 100;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  // The shader repositions everything; a fixed huge sphere stops Three culling it.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBox: { value: new THREE.Vector3(box.x, box.y, box.z) },
      uCamPos: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(0.55, -0.28) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uSizeScale: { value: sizeScale }
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  return points;
}

export class Snowfall {
  /**
   * @param {{ density?: number, wind?: number[], strength?: number }} opts
   */
  constructor(opts = {}) {
    const density = opts.density ?? 1;
    const wind = opts.wind ?? [0.55, -0.28];
    const strength = opts.strength ?? 1.4;

    this.group = new THREE.Group();
    this.group.name = 'snowfall';
    this.time = 0;

    // The distant layer is tinted a touch cooler than the ground. Pure white flakes
    // are invisible against a snowfield -- this is what makes the weather read.
    this.far = buildLayer({
      count: Math.round(7000 * density),
      box: { x: 90, y: 46, z: 90 },
      speedRange: [1.7, 3.6],
      sizeRange: [0.6, 1.4],
      opacity: 0.8,
      color: 0xdcebfa,
      sizeScale: 1.0
    });

    this.near = buildLayer({
      count: Math.round(900 * density),
      box: { x: 26, y: 24, z: 26 },
      speedRange: [1.1, 2.4],
      sizeRange: [1.8, 4.0],
      opacity: 0.62,
      color: 0xf8fcff,
      sizeScale: 1.0
    });

    for (const layer of [this.far, this.near]) {
      layer.material.uniforms.uWind.value.set(wind[0] * strength, wind[1] * strength);
    }

    this.group.add(this.far, this.near);
    this.layers = [this.far, this.near];
  }

  /** Gusts make the wind breathe instead of blowing at one constant rate. */
  update(dt, cameraPosition) {
    this.time += dt;
    const gust = 1 + Math.sin(this.time * 0.23) * 0.35 + Math.sin(this.time * 0.07) * 0.2;
    for (const layer of this.layers) {
      const u = layer.material.uniforms;
      u.uTime.value = this.time;
      u.uCamPos.value.copy(cameraPosition);
      u.uWind.value.x = 0.55 * 1.4 * gust;
      u.uWind.value.y = -0.28 * 1.4 * gust;
    }
  }

  setDensity(scale) {
    this.far.material.uniforms.uOpacity.value = 0.72 * scale;
    this.near.material.uniforms.uOpacity.value = 0.5 * scale;
  }

  dispose() {
    for (const layer of this.layers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
  }
}
