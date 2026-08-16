/**
 * Visible wind.
 *
 * Small, deliberately subtle: pollen, seed fluff and dust caught in the moving air,
 * plus occasional faint streaks along the wind vector. It reads as "the air is
 * moving that way" without ever becoming weather you have to look through.
 *
 * Same tiling trick as the snowfall -- everything moves in the vertex shader and the
 * particle box is re-wrapped around the camera each frame, so motes stay world-
 * locked while always surrounding the player, at zero CPU cost.
 */

import * as THREE from '../core/three.js';

const VERT = /* glsl */`
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCamPos;
uniform vec2 uWind;
uniform float uSpeed;

attribute float aSize;
attribute float aPhase;
attribute float aDrift;

varying float vAlpha;

void main() {
  vec3 p = position;

  // carried along the wind vector, bobbing on the way
  p.x += uWind.x * uSpeed * uTime * aDrift;
  p.z += uWind.y * uSpeed * uTime * aDrift;
  p.y += sin(uTime * 0.7 + aPhase) * 0.8 + sin(uTime * 0.23 + aPhase * 2.1) * 1.4;
  p.x += sin(uTime * 1.1 + aPhase * 1.7) * 0.35;

  vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCamPos + rel;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (150.0 / max(dist, 0.6));

  // fade in past arm's reach and out again before the box edge shows
  vAlpha = smoothstep(1.2, 5.0, dist) * (1.0 - smoothstep(uBox.x * 0.28, uBox.x * 0.46, dist));
}
`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class WindMotes {
  /**
   * @param {{ wind?: number[], strength?: number, density?: number, color?: number }} opts
   */
  constructor(opts = {}) {
    const wind = opts.wind ?? [0.82, 0.57];
    const wl = Math.hypot(wind[0], wind[1]) || 1;
    this.wind = new THREE.Vector2(wind[0] / wl, wind[1] / wl);
    this.strength = opts.strength ?? 1;
    this.time = 0;

    this.group = new THREE.Group();
    this.group.name = 'wind';

    const density = opts.density ?? 1;
    const box = new THREE.Vector3(60, 22, 60);

    // ---------------------------------------------------------- motes
    const count = Math.round(900 * density);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box.x;
      pos[i * 3 + 1] = Math.random() * box.y;
      pos[i * 3 + 2] = Math.random() * box.z;
      size[i] = 0.5 + Math.random() * 1.5;
      phase[i] = Math.random() * 100;
      drift[i] = 0.7 + Math.random() * 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.moteMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box.clone() },
        uCamPos: { value: new THREE.Vector3() },
        uWind: { value: this.wind.clone() },
        uSpeed: { value: 2.6 * this.strength },
        uColor: { value: new THREE.Color(opts.color ?? 0xfff4d8) },
        uOpacity: { value: 0.42 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false
    });
    const points = new THREE.Points(geo, this.moteMat);
    points.frustumCulled = false;
    points.renderOrder = 8;
    this.group.add(points);

    this.group.visible = true;
  }

  update(dt, cameraPosition) {
    this.time += dt;
    for (const m of [this.moteMat]) {
      if (!m) continue;
      m.uniforms.uTime.value = this.time;
      m.uniforms.uCamPos.value.copy(cameraPosition);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
