/**
 * Visible wind — long flowing streak lines in the air.
 *
 * The Ghost of Tsushima look: thin bright ribbons that stream along the wind vector,
 * fading in and out so the air feels alive without becoming weather you have to see
 * through. A handful of dust motes ride along with them for grain.
 *
 * Each streak is an instanced quad stretched along the wind direction and rolled to
 * face the camera, so it stays a clean line from any angle. All motion happens in
 * the vertex shader, and the whole field is re-tiled around the camera every frame,
 * so streaks are world-locked while always surrounding the player at zero CPU cost.
 */

import * as THREE from '../core/three.js';

// ------------------------------------------------------------------ streaks
const STREAK_VERT = /* glsl */`
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCamPos;
uniform vec2 uWind;
uniform float uSpeed;

attribute vec3 aOffset;   // home position inside the tiling box
attribute float aPhase;
attribute float aLength;
attribute float aWidth;

varying float vAlpha;
varying vec2 vUv;

void main() {
  vUv = uv;

  // travel downwind, with a slow vertical wander
  vec3 p = aOffset;
  float t = uTime * uSpeed * (0.75 + fract(aPhase) * 0.6);
  p.x += uWind.x * t;
  p.z += uWind.y * t;
  p.y += sin(uTime * 0.35 + aPhase) * 1.6;

  // tile around the camera so streaks are world-locked but always present
  vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 centre = uCamPos + rel;

  // Build the ribbon: along = wind direction, across = whatever is perpendicular
  // to both the wind and the view, so the line always presents its face to us.
  vec3 along = normalize(vec3(uWind.x, 0.0, uWind.y));
  vec3 toCam = normalize(cameraPosition - centre);
  vec3 across = normalize(cross(along, toCam));

  // uv.x runs 0..1 down the ribbon, uv.y across it
  float head = uv.x - 0.5;
  vec3 world = centre + along * head * aLength + across * (uv.y - 0.5) * aWidth;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = -mv.z;

  // Gusts: each streak breathes on its own cycle, so they arrive in drifts.
  float gust = smoothstep(0.35, 0.9, sin(uTime * 0.5 + aPhase * 2.3) * 0.5 + 0.5);

  // fade in past arm's reach, out again before the tiling seam could show
  float near = smoothstep(2.5, 9.0, dist);
  float far = 1.0 - smoothstep(uBox.x * 0.22, uBox.x * 0.42, dist);

  // A streak seen end-on is a dot; hide those rather than draw a smear.
  float facing = 1.0 - abs(dot(along, toCam));

  vAlpha = gust * near * far * smoothstep(0.15, 0.55, facing);
}
`;

const STREAK_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vUv;

void main() {
  if (vAlpha <= 0.002) discard;

  // taper to nothing at both ends and soften across the width
  float head = smoothstep(0.0, 0.28, vUv.x) * (1.0 - smoothstep(0.62, 1.0, vUv.x));
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  across = smoothstep(0.0, 0.9, across);

  float a = head * across * vAlpha * uOpacity;
  if (a <= 0.002) discard;

  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// -------------------------------------------------------------------- motes
const MOTE_VERT = /* glsl */`
uniform float uTime;
uniform vec3 uBox;
uniform vec3 uCamPos;
uniform vec2 uWind;
uniform float uSpeed;
uniform float uPixelScale;

attribute float aSize;
attribute float aPhase;
attribute float aDrift;

varying float vAlpha;

void main() {
  vec3 p = position;
  p.x += uWind.x * uSpeed * uTime * aDrift;
  p.z += uWind.y * uSpeed * uTime * aDrift;
  p.y += sin(uTime * 0.7 + aPhase) * 0.8 + sin(uTime * 0.23 + aPhase * 2.1) * 1.4;

  vec3 rel = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCamPos + rel;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;

  // aSize is a diameter in metres
  gl_PointSize = clamp(aSize * uPixelScale / max(dist, 0.2), 1.0, 40.0);
  vAlpha = smoothstep(1.2, 5.0, dist) * (1.0 - smoothstep(uBox.x * 0.28, uBox.x * 0.46, dist));
}
`;

const MOTE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, smoothstep(0.5, 0.05, d) * vAlpha * uOpacity);
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
    this.bufferHeight = 800;

    this.group = new THREE.Group();
    this.group.name = 'wind';

    const density = opts.density ?? 1;
    const box = new THREE.Vector3(90, 26, 90);
    this.box = box;

    // ------------------------------------------------------------ streaks
    const streakCount = Math.round(260 * density);
    const quad = new THREE.PlaneGeometry(1, 1);
    const sgeo = new THREE.InstancedBufferGeometry();
    sgeo.index = quad.index;
    sgeo.setAttribute('position', quad.attributes.position);
    sgeo.setAttribute('uv', quad.attributes.uv);
    sgeo.instanceCount = streakCount;

    const off = new Float32Array(streakCount * 3);
    const phase = new Float32Array(streakCount);
    const length = new Float32Array(streakCount);
    const width = new Float32Array(streakCount);
    for (let i = 0; i < streakCount; i++) {
      off[i * 3] = Math.random() * box.x;
      off[i * 3 + 1] = 0.6 + Math.random() * box.y;
      off[i * 3 + 2] = Math.random() * box.z;
      phase[i] = Math.random() * 100;
      length[i] = 3.5 + Math.random() * 9;
      width[i] = 0.035 + Math.random() * 0.055;
    }
    sgeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    sgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    sgeo.setAttribute('aLength', new THREE.InstancedBufferAttribute(length, 1));
    sgeo.setAttribute('aWidth', new THREE.InstancedBufferAttribute(width, 1));
    sgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.streakMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box.clone() },
        uCamPos: { value: new THREE.Vector3() },
        uWind: { value: this.wind.clone() },
        uSpeed: { value: 7.5 * this.strength },
        uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
        uOpacity: { value: 0.30 }
      },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });

    const streaks = new THREE.Mesh(sgeo, this.streakMat);
    streaks.frustumCulled = false;
    streaks.renderOrder = 9;
    streaks.name = 'wind-streaks';
    this.group.add(streaks);

    // -------------------------------------------------------------- motes
    const count = Math.round(500 * density);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const mphase = new Float32Array(count);
    const drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box.x;
      pos[i * 3 + 1] = Math.random() * box.y;
      pos[i * 3 + 2] = Math.random() * box.z;
      size[i] = 0.012 + Math.random() * 0.03;   // metres
      mphase[i] = Math.random() * 100;
      drift[i] = 0.7 + Math.random() * 0.7;
    }
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mgeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    mgeo.setAttribute('aPhase', new THREE.BufferAttribute(mphase, 1));
    mgeo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
    mgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.moteMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box.clone() },
        uCamPos: { value: new THREE.Vector3() },
        uWind: { value: this.wind.clone() },
        uSpeed: { value: 3.2 * this.strength },
        uPixelScale: { value: 600 },
        uColor: { value: new THREE.Color(0xfff4d8) },
        uOpacity: { value: 0.45 }
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false
    });
    const points = new THREE.Points(mgeo, this.moteMat);
    points.frustumCulled = false;
    points.renderOrder = 8;
    this.group.add(points);
  }

  setViewport(bufferHeight) {
    this.bufferHeight = bufferHeight || 800;
  }

  update(dt, cameraPosition, camera) {
    this.time += dt;
    for (const m of [this.streakMat, this.moteMat]) {
      m.uniforms.uTime.value = this.time;
      m.uniforms.uCamPos.value.copy(cameraPosition);
    }
    if (camera) {
      this.moteMat.uniforms.uPixelScale.value =
        this.bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
