/**
 * Procedural audio. Every sound is synthesised at runtime from noise and
 * oscillators -- there is not a single audio file in this project, which is a large
 * part of why the whole thing unzips and runs anywhere.
 *
 * Gunshots are built the way a real report is shaped: a very short high-pressure
 * crack, a body thump with weapon-specific resonance, and a tail that gets fed
 * through a synthesised valley reverb.
 *
 * There are, deliberately, no hit or kill sounds anywhere in this file.
 */

import * as THREE from '../core/three.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.masterVolume = 0.75;
    this._noiseBuffer = null;
    this._listenerPos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  /** Must be called from a user gesture (the Deploy button). */
  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);

    // Gentle limiter so a burst of automatic fire cannot clip.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 9;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;
    this.limiter.connect(this.master);

    this.dry = this.ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.limiter);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeValleyImpulse(2.1);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.42;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.limiter);

    this._noiseBuffer = this._makeNoise(2.0);
    this._startWind();
    this.ready = true;
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ------------------------------------------------------------- buffers
  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Two channels of decaying noise with a few slap-back reflections. */
  _makeValleyImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // snow deadens the high end quickly, so decay hard
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.1) * 0.55;
      }
      // discrete echoes off the treeline and the valley walls
      for (const [delay, gain] of [[0.085, 0.34], [0.16, 0.22], [0.29, 0.14], [0.47, 0.08]]) {
        const off = Math.floor(delay * rate * (ch ? 1.07 : 1));
        for (let i = off; i < len; i++) {
          d[i] += d[i - off] * gain * 0.5;
        }
      }
    }
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  /** 3D panner, or a plain gain when the sound is on the player. */
  _spatial(position, refDistance = 6, maxDistance = 320) {
    if (!position) {
      const g = this.ctx.createGain();
      return { input: g, output: g };
    }
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'exponential';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1.05;
    panner.positionX.value = position[0];
    panner.positionY.value = position[1];
    panner.positionZ.value = position[2];
    return { input: panner, output: panner };
  }

  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this._listenerPos);
    this._fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(this._listenerPos.x, t, 0.01);
      l.positionY.setTargetAtTime(this._listenerPos.y, t, 0.01);
      l.positionZ.setTargetAtTime(this._listenerPos.z, t, 0.01);
      l.forwardX.setTargetAtTime(this._fwd.x, t, 0.01);
      l.forwardY.setTargetAtTime(this._fwd.y, t, 0.01);
      l.forwardZ.setTargetAtTime(this._fwd.z, t, 0.01);
      l.upX.setTargetAtTime(this._up.x, t, 0.01);
      l.upY.setTargetAtTime(this._up.y, t, 0.01);
      l.upZ.setTargetAtTime(this._up.z, t, 0.01);
    } else {
      l.setPosition(this._listenerPos.x, this._listenerPos.y, this._listenerPos.z);
      l.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }
  }

  // ------------------------------------------------------------- gunshot
  /**
   * @param {object} audioCfg weapon.audio from shared/weapons.js
   * @param {number[]|null} position null = fired by the local player
   */
  gunshot(audioCfg, position = null, distance = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const cfg = audioCfg || { pitch: 1, body: 140, crack: 1, tail: 0.5 };
    const local = !position;

    const out = this._spatial(position, 8, 400);
    const bus = ctx.createGain();
    bus.gain.value = local ? 0.62 : 0.85;
    bus.connect(out.input);
    out.output.connect(this.dry);

    // send to reverb
    const send = ctx.createGain();
    send.gain.value = cfg.tail * (local ? 0.75 : 1.05);
    out.output.connect(send);
    send.connect(this.reverb);

    // --- crack: very short, very bright ---
    const crack = this._noiseSource();
    const crackHP = ctx.createBiquadFilter();
    crackHP.type = 'highpass';
    crackHP.frequency.value = 1900 * cfg.pitch;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.9 * cfg.crack, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.045);
    crack.connect(crackHP).connect(crackGain).connect(bus);
    crack.start(t);
    crack.stop(t + 0.08);

    // --- body: the weight of the round ---
    const body = this._noiseSource();
    const bodyLP = ctx.createBiquadFilter();
    bodyLP.type = 'lowpass';
    bodyLP.frequency.setValueAtTime(4200 * cfg.pitch, t);
    bodyLP.frequency.exponentialRampToValueAtTime(340, t + 0.16);
    bodyLP.Q.value = 1.1;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(1.0, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    body.connect(bodyLP).connect(bodyGain).connect(bus);
    body.start(t);
    body.stop(t + 0.26);

    // --- thump: the low-frequency punch you feel ---
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.body * 1.7, t);
    osc.frequency.exponentialRampToValueAtTime(cfg.body * 0.55, t + 0.12);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.55, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    osc.connect(oscGain).connect(bus);
    osc.start(t);
    osc.stop(t + 0.2);

    // --- mechanical clack of the action, local only ---
    if (local) {
      const clack = this._noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0006, t + 0.075);
      clack.connect(bp).connect(g).connect(bus);
      clack.start(t + 0.012);
      clack.stop(t + 0.1);
    }
  }

  /**
   * Supersonic crack of a round passing close by. Called when someone else's shot
   * misses you narrowly -- one of the few cues this game gives you.
   */
  bulletWhiz(position, closeness = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._spatial(position, 3, 60);
    out.output.connect(this.dry);

    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.13);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30 * closeness, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp).connect(g).connect(out.input);
    src.start(t);
    src.stop(t + 0.2);
  }

  footstep(speed = 3, crouch = false, position = null) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._spatial(position, 4, 46);
    out.output.connect(this.dry);

    // Snow: a soft compressed crunch, not a hard slap.
    const src = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1500 + Math.random() * 900, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.11);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 190;
    const g = ctx.createGain();
    const vol = (crouch ? 0.045 : 0.10) * Math.min(1.4, 0.5 + speed / 7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(hp).connect(lp).connect(g).connect(out.input);
    src.start(t);
    src.stop(t + 0.18);
  }

  /** Short mechanical tick, used for reload steps and weapon swaps. */
  click(frequency = 2400, volume = 0.16, duration = 0.05, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = frequency;
    bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + duration);
    src.connect(bp).connect(g).connect(this.dry);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  reloadSequence(weaponId, durationMs) {
    if (!this.ready) return;
    const d = durationMs / 1000;
    this.click(1500, 0.14, 0.06, d * 0.10);            // mag release
    this.click(900, 0.12, 0.09, d * 0.32);             // mag out
    this.click(1800, 0.18, 0.07, d * 0.66);            // fresh mag in
    this.click(3000, 0.15, 0.05, d * 0.86);            // bolt / slide
    if (weaponId === 'm700') this.click(1200, 0.13, 0.10, d * 0.94);
  }

  boltCycle() {
    this.click(1700, 0.16, 0.07, 0.10);
    this.click(2500, 0.14, 0.06, 0.42);
  }

  dryFire() {
    this.click(2800, 0.12, 0.035, 0);
  }

  /** Taking a hit: a dull impact plus a short ring. No directional information. */
  hurt(severity = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.30 * severity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this.dry);
    osc.start(t);
    osc.stop(t + 0.34);

    if (severity > 0.6) {
      const ring = ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.value = 3100;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.exponentialRampToValueAtTime(0.05, t + 0.03);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      ring.connect(rg).connect(this.master);
      ring.start(t);
      ring.stop(t + 1.6);
    }
  }

  death() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.2);

    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.value = 2600;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.075, t + 0.05);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    ring.connect(rg).connect(this.master);
    ring.start(t);
    ring.stop(t + 3.3);
  }

  /** Continuous wind bed, gusting slowly. */
  _startWind() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    src.connect(hp).connect(lp).connect(g).connect(this.master);
    src.start();

    // slow gusting
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.021;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 260;
    lfo2.connect(lfo2Gain).connect(lp.frequency);
    lfo2.start();

    this.wind = { src, gain: g, lp };
  }

  /** Muffle everything while the scope is up -- cheek welded, ear covered. */
  setScoped(scoped) {
    if (!this.ready || !this.wind) return;
    const target = scoped ? 0.022 : 0.045;
    this.wind.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }
}
