/**
 * Sun glare: what an unfiltered star does to a visor and to a camera.
 *
 * Drawn as a full-screen additive quad rather than through a post-processing chain,
 * because this project deliberately has no post chain and adding one for a single
 * effect would cost every frame on every map. The vertex shader writes clip space
 * straight out, so the quad covers the screen no matter what the camera is doing --
 * which also means it must be kept out of the scope's second pass, where the sun is
 * somewhere else entirely.
 *
 * Two things make it read as glare rather than as a white blob:
 *
 *  - It is OCCLUDED. One ray per frame through the shared collider: put a solar
 *    array between yourself and the sun and the glare goes out, which is what makes
 *    it feel like light rather than a sticker on the lens.
 *  - It grows as you turn INTO it. The bloom, the streak and the veiling wash all
 *    scale with how close the sun is to the middle of your view, so the sun sweeping
 *    across the frame builds and fades instead of switching on.
 */

import * as THREE from '../../core/three.js';
import { damp } from '/shared/math/num.js';

const VERT = /* glsl */`
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // Straight to clip space. The camera is irrelevant: this is a screen effect and
  // going through the projection matrix would only let the FOV change its size.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
uniform vec2 uSun;        // sun position, NDC
uniform float uAmount;    // master, already faded for occlusion and angle
uniform float uAspect;
uniform vec3 uColor;
varying vec2 vNdc;

/**
 * One lens ghost. t slides it along the line that runs from the sun through the
 * middle of the screen and out the far side, which is where a real lens puts them.
 */
vec3 ghost(vec2 p, vec2 s, float t, float size, float bright, vec3 tint) {
  vec2 c = mix(s, -s, t);
  float d = length(p - c) / size;
  // a soft annulus, brighter at its rim like an aperture image
  float ring = smoothstep(1.0, 0.72, d) * (0.30 + 0.70 * smoothstep(0.30, 0.80, d));
  return tint * ring * bright;
}

void main() {
  vec2 p = vec2(vNdc.x * uAspect, vNdc.y);
  vec2 s = vec2(uSun.x * uAspect, uSun.y);
  float d = length(p - s);

  vec3 col = vec3(0.0);

  // The bloom around the disc itself: a tight core inside a much wider falloff.
  col += uColor * exp(-d * 11.0) * 2.10;
  col += uColor * exp(-d * 2.60) * 0.34;

  // Anamorphic streak. Squashing the distance on one axis is all it takes -- but
  // it is very easy to overdo, and a bar across the whole frame stops reading as
  // a lens and starts reading as a bug.
  vec2 q = (p - s) * vec2(0.20, 4.4);
  col += uColor * exp(-length(q) * 2.6) * 0.34;

  // Six-point starburst, from the iris rather than the lens.
  float a = atan(p.y - s.y, p.x - s.x);
  float spike = pow(abs(cos(a * 3.0)), 24.0);
  col += uColor * spike * exp(-d * 3.4) * 0.34;

  // Ghosts, warm and cool alternately, as a real stack of elements throws them.
  col += ghost(p, s, 0.34, 0.085, 0.16, vec3(0.55, 0.75, 1.00));
  col += ghost(p, s, 0.62, 0.150, 0.11, vec3(1.00, 0.82, 0.52));
  col += ghost(p, s, 1.00, 0.062, 0.20, vec3(0.72, 1.00, 0.86));
  col += ghost(p, s, 1.36, 0.230, 0.075, vec3(1.00, 0.66, 0.44));
  col += ghost(p, s, 1.72, 0.110, 0.10, vec3(0.62, 0.80, 1.00));

  // Veiling glare: scattered light lifting the whole frame, strongest when the sun
  // is nearly dead ahead. This is the part that actually costs you your target.
  float centred = 1.0 - smoothstep(0.15, 1.10, length(s));
  col += uColor * centred * 0.065;

  gl_FragColor = vec4(col * uAmount, 1.0);
}
`;

export class SunGlare {
  /**
   * @param {THREE.Vector3} sunDir unit vector toward the sun
   * @param {number} color
   */
  constructor(sunDir, color = 0xffffff) {
    this.sunDir = sunDir.clone();
    this.amount = 0;

    const geo = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: new THREE.Vector2(0, 0) },
        uAmount: { value: 0 },
        uAspect: { value: 1 },
        uColor: { value: new THREE.Color(color) }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'sun-glare';
    this.mesh.frustumCulled = false;
    // After everything, including the weapon in your hands.
    this.mesh.renderOrder = 5000;
    this.mesh.visible = false;

    this._p = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,max:number)=>any} raycast
   *   the shared world trace, for working out whether anything is in the way
   */
  update(dt, camera, raycast) {
    camera.getWorldDirection(this._fwd);
    const facing = this._fwd.dot(this.sunDir);

    let target = 0;
    if (facing > 0.05) {
      // Ramps in from about 75 degrees off axis and is full when you look at it.
      const angle = Math.acos(Math.min(1, facing));
      target = 1 - Math.min(1, Math.max(0, (angle - 0.06) / 1.24));
      target *= target;

      // One ray. If the station is between you and the sun there is no glare, and
      // that is the whole reason a solar array is worth hiding behind out here.
      const o = camera.getWorldPosition(this._p);
      if (raycast(o.x, o.y, o.z, this.sunDir.x, this.sunDir.y, this.sunDir.z, 400)) target = 0;
    }

    // Fast to appear, slower to clear, so a strut flickering past does not strobe.
    this.amount = damp(this.amount, target, target > this.amount ? 16 : 9, dt);
    this.mesh.visible = this.amount > 0.004;
    if (!this.mesh.visible) return;

    const u = this.material.uniforms;
    u.uAmount.value = this.amount;
    u.uAspect.value = camera.aspect || 1;
    this._p.copy(camera.position).addScaledVector(this.sunDir, 5000).project(camera);
    u.uSun.value.set(this._p.x, this._p.y);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
