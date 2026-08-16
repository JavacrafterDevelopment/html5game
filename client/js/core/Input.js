/**
 * Keyboard + mouse, pointer-lock aware.
 *
 * Look deltas accumulate between frames and are drained by the player controller,
 * so a 1000 Hz mouse is not throttled by the render rate.
 */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.locked = false;
    this.sensitivity = 1.0;
    this.invertY = false;
    this.enabled = true;
    this.wheel = 0;

    this._listeners = { lockChange: [], keyPress: [] };
    this._bind();
  }

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
  }

  _emit(event, ...args) {
    for (const fn of this._listeners[event] || []) fn(...args);
  }

  _bind() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
      }
      this._emit('lockChange', this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += (e.movementY || 0) * (this.invertY ? -1 : 1);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.buttons.add(e.button);
    });

    document.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
    });

    // The right mouse button is ADS -- never let the context menu steal it.
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });

    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        // still swallow browser shortcuts while playing
        if (this.locked && e.code === 'Tab') e.preventDefault();
        return;
      }
      const code = e.code;
      if (this.locked && (code === 'Tab' || code.startsWith('F') === false)) {
        if (code === 'Tab' || code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
      }
      this.keys.add(code);
      this._emit('keyPress', code, e);
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  isDown(code) { return this.keys.has(code); }
  isMouseDown(button) { return this.buttons.has(button); }

  /** Read and clear accumulated look movement. */
  consumeLook() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Movement intent in local space: x = strafe, z = forward. */
  moveVector() {
    let x = 0, z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z -= 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }
}
