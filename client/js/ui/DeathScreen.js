/**
 * Death screen.
 *
 * This is the payoff for the whole hardcore feedback model: you get told nothing
 * during a fight, and everything the moment you lose one. Who shot you, with what,
 * from how far, and -- the part that stings -- how much health they had left.
 */

import { PRIMARY_CHOICES, WEAPONS } from '/shared/weapons.js';
import { MATCH } from '/shared/config.js';

export class DeathScreen {
  constructor(root = document) {
    this.el = root.getElementById('death-screen');
    this.killerEl = root.getElementById('death-killer');
    this.weaponEl = root.getElementById('death-weapon');
    this.distEl = root.getElementById('death-dist');
    this.hpEl = root.getElementById('death-hp');
    this.hsEl = root.getElementById('death-hs');
    this.numEl = root.getElementById('respawn-num');
    this.fillEl = root.getElementById('respawn-fill');
    this.swapRow = root.getElementById('swap-row');

    this.visible = false;
    this.respawnAt = 0;
    this.duration = MATCH.RESPAWN_MS;
    this.onLoadoutChange = null;
    this.currentPrimary = PRIMARY_CHOICES[0];

    this._buildSwap();
  }

  _buildSwap() {
    this.swapRow.replaceChildren(...PRIMARY_CHOICES.map((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swap-btn';
      btn.dataset.weapon = id;
      btn.textContent = WEAPONS[id].name;
      btn.addEventListener('click', () => this.selectPrimary(id));
      return btn;
    }));
  }

  selectPrimary(id) {
    this.currentPrimary = id;
    for (const btn of this.swapRow.children) {
      btn.classList.toggle('active', btn.dataset.weapon === id);
    }
    this.onLoadoutChange?.(id);
  }

  setPrimary(id) {
    this.currentPrimary = id;
    for (const btn of this.swapRow.children) {
      btn.classList.toggle('active', btn.dataset.weapon === id);
    }
  }

  /**
   * @param {{byName:string, weaponName:string, dist:number, killerHp:number,
   *          headshot:boolean, respawnMs:number}} info
   * @param {number} respawnAtClientTime performance.now() based deadline
   */
  show(info, respawnAtClientTime) {
    this.visible = true;
    this.respawnAt = respawnAtClientTime;
    this.duration = info.respawnMs || MATCH.RESPAWN_MS;

    this.killerEl.textContent = info.byName || 'The cold';
    this.weaponEl.textContent = info.weaponName || '—';
    this.distEl.textContent = info.dist != null ? `${info.dist.toFixed(1)} m` : '—';
    this.hpEl.textContent = info.by
      ? `${Math.round(info.killerHp)} HP LEFT`
      : '';
    this.hsEl.classList.toggle('hidden', !info.headshot);

    this.el.classList.remove('hidden');
    this.el.classList.add('with-board');
  }

  /** @returns {number} seconds remaining */
  update() {
    if (!this.visible) return 0;
    const remainingMs = Math.max(0, this.respawnAt - performance.now());
    const seconds = Math.ceil(remainingMs / 1000);
    this.numEl.textContent = String(seconds);
    this.fillEl.style.width = (remainingMs / this.duration * 100).toFixed(1) + '%';
    return remainingMs / 1000;
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
  }
}

export class MatchOverScreen {
  constructor(root = document) {
    this.el = root.getElementById('match-over');
    this.winnerEl = root.getElementById('mo-winner');
    this.subEl = root.getElementById('mo-sub');
    this.countEl = root.getElementById('mo-countdown');
    this.resetAt = 0;
    this.visible = false;
  }

  show(winnerName, kills, resetInMs) {
    this.visible = true;
    this.winnerEl.textContent = winnerName;
    this.subEl.textContent = `${kills} KILLS`;
    this.resetAt = performance.now() + resetInMs;
    this.el.classList.remove('hidden');
  }

  update() {
    if (!this.visible) return;
    const left = Math.max(0, Math.ceil((this.resetAt - performance.now()) / 1000));
    this.countEl.textContent = String(left);
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
  }
}
