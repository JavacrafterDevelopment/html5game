/**
 * Player settings, persisted to localStorage. Quality defaults are guessed from
 * the device so a laptop on integrated graphics is not handed a 4K shadow map.
 */

const KEY = 'whiteout.settings';

const DEFAULTS = {
  quality: 'auto',        // auto | low | medium | high | ultra
  sensitivity: 1.0,
  invertY: false,
  volume: 0.75,
  fov: 78,
  showFps: false,
  maxPixelRatio: 1.75
};

function detectQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores >= 4 && mem >= 4) return 'medium';
  return 'low';
}

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
    this.resolvedQuality = this.data.quality === 'auto' ? detectQuality() : this.data.quality;
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch {}
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {}
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    if (key === 'quality') {
      this.resolvedQuality = value === 'auto' ? detectQuality() : value;
    }
    this.save();
  }

  /** Renderer settings implied by the resolved quality tier. */
  renderProfile() {
    switch (this.resolvedQuality) {
      case 'ultra':
        return { shadows: true, shadowMap: 4096, antialias: true, pixelRatio: 2, snow: 1.3, scopeRes: 1536 };
      case 'high':
        return { shadows: true, shadowMap: 2048, antialias: true, pixelRatio: 1.75, snow: 1.0, scopeRes: 1024 };
      case 'medium':
        return { shadows: true, shadowMap: 1024, antialias: false, pixelRatio: 1.25, snow: 0.7, scopeRes: 768 };
      default:
        return { shadows: false, shadowMap: 512, antialias: false, pixelRatio: 1, snow: 0.4, scopeRes: 512 };
    }
  }
}
