/**
 * Keyboard + mouse, pointer-lock aware.
 *
 * Look deltas accumulate between frames and are drained by the player controller,
 * so a 1000 Hz mouse is not throttled by the render rate.
 */

/** True when a text field owns the keyboard. */
function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

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
      // While a text field has focus (chat, the callsign box) the keyboard belongs
      // to that field. Swallowing these here stops "wasd" in a chat message from
      // also queuing movement for the moment the mouse is recaptured.
      if (isTyping()) return;
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

  /**
   * Side thrusters, on maps that have them. E banks right, Q banks left, and the
   * bank holds where you leave it -- hold one long enough and you are upside down.
   *
   * E is NEGATIVE, which looks backwards and is not. The camera looks down its own
   * -Z, so a positive rotation about that axis turns the IMAGE clockwise, which
   * takes the right-hand side of the horizon down -- and a horizon whose right side
   * drops is what banking LEFT looks like from the cockpit.
   */
  rollAxis() {
    let r = 0;
    if (this.isDown('KeyE')) r -= 1;
    if (this.isDown('KeyQ')) r += 1;
    return r;
  }

  /**
   * Translation along your own up axis. On the ground these keys are jump and
   * crouch; in free fall there is nothing to jump off, so they become thrusters.
   */
  liftAxis() {
    let y = 0;
    if (this.isDown('Space')) y += 1;
    if (this.isDown('ControlLeft') || this.isDown('KeyC')) y -= 1;
    return y;
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
