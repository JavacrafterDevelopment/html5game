/**
 * In-game HUD.
 *
 * What is deliberately NOT here: hitmarkers, hit sounds, kill notifications, a kill
 * feed, a live personal score, damage numbers. The only feedback this game gives
 * about a fight you are winning is that the other person stopped shooting back.
 */

import { getWeapon } from '/shared/weapons.js';

export class HUD {
  constructor(root = document) {
    this.el = root.getElementById('hud');
    this.crosshair = root.getElementById('crosshair');
    this.hpFill = root.getElementById('hp-fill');
    this.hpNum = root.getElementById('hp-num');
    this.wepName = root.getElementById('wep-name');
    this.ammoMag = root.getElementById('ammo-mag');
    this.ammoRes = root.getElementById('ammo-res');
    this.reloadHint = root.getElementById('reload-hint');
    this.slotRow = root.getElementById('slot-row');
    this.matchTarget = root.getElementById('match-target');
    this.pingVal = root.getElementById('ping-val');
    this.vignette = root.getElementById('hit-vignette');
    this.damageDir = root.getElementById('damage-dir');
    this.chatLog = root.getElementById('chat-log');
    this.scopeShade = root.getElementById('scope-shade');

    this._lastHp = 100;
    this._slots = [];
    this._vignetteTimer = null;
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  setTarget(target) {
    this.matchTarget.textContent = target;
  }

  setLoadout(primary, secondary) {
    this._slots = [primary, secondary];
    this.slotRow.replaceChildren(...this._slots.map((id, i) => {
      const div = document.createElement('div');
      div.className = 'slot';
      div.dataset.slot = String(i);
      div.textContent = `${i + 1} ${getWeapon(id).name}`;
      return div;
    }));
  }

  setActiveSlot(slot) {
    for (const el of this.slotRow.children) {
      el.classList.toggle('active', Number(el.dataset.slot) === slot);
    }
  }

  setWeapon(id) {
    this.wepName.textContent = getWeapon(id).name;
  }

  setAmmo(mag, reserve, magSize) {
    this.ammoMag.textContent = mag;
    this.ammoRes.textContent = reserve;
    this.ammoMag.classList.toggle('low', mag <= Math.max(1, Math.ceil(magSize * 0.25)));
  }

  setReloading(on) {
    this.reloadHint.classList.toggle('hidden', !on);
  }

  setHealth(hp) {
    const clamped = Math.max(0, Math.min(100, Math.round(hp)));
    this.hpNum.textContent = clamped;
    this.hpFill.style.width = clamped + '%';
    this.hpFill.classList.toggle('hurt', clamped <= 60 && clamped > 30);
    this.hpFill.classList.toggle('critical', clamped <= 30);

    // A hit you take is the one thing that DOES get loud feedback.
    if (clamped < this._lastHp) {
      const severity = Math.min(1, (this._lastHp - clamped) / 45);
      this.flashDamage(severity, clamped);
    }
    this._lastHp = clamped;
  }

  flashDamage(severity, hpLeft) {
    this.vignette.style.transition = 'opacity 0.05s ease-in';
    this.vignette.style.opacity = String(Math.min(0.95, 0.35 + severity * 0.65));
    clearTimeout(this._vignetteTimer);
    this._vignetteTimer = setTimeout(() => {
      this.vignette.style.transition = 'opacity 0.5s ease-out';
      // Low health leaves a permanent red edge until you heal or die.
      this.vignette.style.opacity = hpLeft <= 35 ? String(0.30 + (35 - hpLeft) / 100) : '0';
    }, 90);
  }

  /**
   * Directional damage arc.
   * @param {number} relativeAngle radians, 0 = straight ahead
   */
  showDamageDirection(relativeAngle) {
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${relativeAngle}rad)`;
    this.damageDir.appendChild(arc);
    setTimeout(() => arc.remove(), 1200);
  }

  clearDamage() {
    this.vignette.style.transition = 'opacity 0.4s ease-out';
    this.vignette.style.opacity = '0';
    this._lastHp = 100;
    this.damageDir.replaceChildren();
  }

  /** Crosshair gap tracks the real bullet cone. */
  setCrosshair(gapPx, hidden) {
    this.crosshair.style.setProperty('--gap', gapPx.toFixed(1) + 'px');
    this.crosshair.classList.toggle('hidden-ads', hidden);
  }

  setScoped(on) {
    this.scopeShade.classList.toggle('on', on);
  }

  setPing(ms) {
    this.pingVal.textContent = Math.round(ms);
  }

  addChat(name, text) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const b = document.createElement('b');
    b.textContent = name + ': ';
    line.appendChild(b);
    line.appendChild(document.createTextNode(text));
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 6) this.chatLog.firstChild.remove();
    setTimeout(() => line.remove(), 9500);
  }
}
