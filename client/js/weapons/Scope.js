/**
 * True optical scope for the M700.
 *
 * Rather than faking magnification by yanking the main camera's FOV, the scene is
 * rendered a second time through a narrow-FOV camera into a texture, and that
 * texture is shown inside the lens circle. The world outside the scope stays at
 * normal FOV, which is what looking through a real optic actually looks like.
 *
 * The shader adds the details that sell it: eye-relief shadow, edge distortion,
 * a little chromatic fringing, and a mil-dot reticle drawn at true scale.
 */

import * as THREE from '../core/three.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uScope;
uniform vec2 uResolution;
uniform float uAmount;      // 0 = not scoped, 1 = fully scoped
uniform float uRadius;      // lens radius in aspect-corrected screen units
uniform float uTime;
uniform vec2 uSway;
uniform float uBreath;      // 0 = steady, 1 = out of breath

varying vec2 vUv;

float reticle(vec2 p, float pixel) {
  // p is in lens space: -1..1 across the lens diameter
  float ink = 0.0;

  float lineW = pixel * 1.4;
  float thickW = pixel * 3.4;

  // fine crosshair through the middle
  if (abs(p.x) < 0.62) ink = max(ink, smoothstep(lineW, 0.0, abs(p.y)));
  if (abs(p.y) < 0.62) ink = max(ink, smoothstep(lineW, 0.0, abs(p.x)));

  // heavy duplex posts from the edge inward
  if (abs(p.x) > 0.62) ink = max(ink, smoothstep(thickW, 0.0, abs(p.y)));
  if (abs(p.y) > 0.62) ink = max(ink, smoothstep(thickW, 0.0, abs(p.x)));

  // mil dots along both axes
  for (int i = 1; i <= 4; i++) {
    float d = float(i) * 0.145;
    ink = max(ink, smoothstep(pixel * 2.6, 0.0, length(p - vec2(d, 0.0))));
    ink = max(ink, smoothstep(pixel * 2.6, 0.0, length(p - vec2(-d, 0.0))));
    ink = max(ink, smoothstep(pixel * 2.6, 0.0, length(p - vec2(0.0, d))));
    ink = max(ink, smoothstep(pixel * 2.6, 0.0, length(p - vec2(0.0, -d))));
  }

  // holdover hashes below centre
  for (int i = 1; i <= 3; i++) {
    float y = -float(i) * 0.145;
    float w = 0.030 - float(i) * 0.004;
    if (abs(p.x) < w) ink = max(ink, smoothstep(lineW, 0.0, abs(p.y - y)));
  }

  return ink;
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uResolution.x / uResolution.y;

  float d = length(p);
  float R = uRadius;

  // Outside the lens: darkness, fading in as the rifle comes up.
  if (d > R) {
    float edge = smoothstep(R, R * 1.03, d);
    gl_FragColor = vec4(0.0, 0.0, 0.0, edge * uAmount);
    return;
  }

  vec2 lens = p / R;                       // -1..1 inside the lens

  // Barrel distortion toward the edge of the glass.
  float r2 = dot(lens, lens);
  vec2 warped = lens * (1.0 + 0.055 * r2 + 0.02 * r2 * r2);

  // Sway shifts the image, not the reticle -- that is what a wobbling rifle does.
  vec2 suv = warped * 0.5 + 0.5 + uSway;

  vec3 col;
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
    col = vec3(0.02, 0.03, 0.04);
  } else {
    // chromatic fringing grows toward the lens edge
    float ca = 0.0022 * r2;
    col.r = texture2D(uScope, suv + warped * ca).r;
    col.g = texture2D(uScope, suv).g;
    col.b = texture2D(uScope, suv - warped * ca).b;
  }

  // eye-relief shadow ring
  float shade = 1.0 - smoothstep(0.72, 1.0, length(lens)) * 0.92;
  col *= shade;

  // a cold tint and a touch of bloom lift from the coated glass
  col = mix(col, col * vec3(0.94, 0.98, 1.06), 0.5);
  col += vec3(0.03, 0.05, 0.07) * (1.0 - r2) * 0.5;

  // reticle
  float pixel = 2.0 / (R * uResolution.y);
  float ink = reticle(lens, pixel);
  col = mix(col, vec3(0.02, 0.02, 0.025), ink * 0.95);

  // hairline lens rim
  float rim = smoothstep(0.965, 1.0, length(lens));
  col = mix(col, vec3(0.0), rim);

  gl_FragColor = vec4(col, uAmount);

  // The render target holds LINEAR values (Three only applies the output color
  // space when drawing to the canvas), and this overlay IS drawn to the canvas.
  // Without these two chunks the magnified image comes out almost black.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Scope {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.magnification = options.magnification ?? 6;
    this.fov = options.zoomedFov ?? 13;
    this.enabled = false;
    this.amount = 0;

    const size = options.resolution ?? 1024;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      samples: options.antialias ? 4 : 0
    });
    // Leave the target in LINEAR space. Three only applies the output colour space
    // when drawing to the canvas, so the texture genuinely holds linear values --
    // the overlay shader tone-maps and encodes them itself.
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.05, 1200);

    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScope: { value: this.target.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uAmount: { value: 0 },
        uRadius: { value: 0.34 },
        uTime: { value: 0 },
        uSway: { value: new THREE.Vector2() },
        uBreath: { value: 0 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.overlayScene.add(quad);

    this.swayTime = 0;
    this._swayOffset = new THREE.Vector2();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  setSize(width, height) {
    this.material.uniforms.uResolution.value.set(width, height);
    // Lens fills a comfortable portion of the screen height.
    this.material.uniforms.uRadius.value = 0.345;
  }

  /**
   * @param {number} dt
   * @param {number} amount 0..1 how far into the aim animation we are
   * @param {{ steady?: boolean, moving?: number }} state
   */
  update(dt, amount, state = {}) {
    this.amount = amount;
    this.enabled = amount > 0.001;
    this.swayTime += dt;

    const u = this.material.uniforms;
    u.uAmount.value = amount;
    u.uTime.value = this.swayTime;

    // Breathing wobble: slow figure-eight, amplified while moving.
    const moveFactor = 1 + (state.moving ?? 0) * 2.4;
    const amp = 0.0016 * moveFactor * (state.steady ? 0.25 : 1);
    this._swayOffset.set(
      Math.sin(this.swayTime * 0.9) * amp + Math.sin(this.swayTime * 2.3) * amp * 0.35,
      Math.cos(this.swayTime * 0.62) * amp * 1.3 + Math.cos(this.swayTime * 1.9) * amp * 0.3
    );
    u.uSway.value.copy(this._swayOffset);
  }

  /**
   * Render the magnified view, then composite the lens over the frame.
   * Must be called AFTER the main scene render, with autoClear disabled.
   */
  render(scene, mainCamera, hideDuringPass) {
    if (!this.enabled) return;

    // Match the shooter's eye exactly, just with a much longer lens.
    this.camera.position.copy(mainCamera.position);
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    const hidden = [];
    for (const obj of hideDuringPass || []) {
      if (obj && obj.visible) { obj.visible = false; hidden.push(obj); }
    }

    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;

    for (const obj of hidden) obj.visible = true;
  }

  /** Draw the lens on top of the already-rendered frame. */
  composite() {
    if (!this.enabled) return;
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.render(this.overlayScene, this.overlayCamera);
    this.renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
