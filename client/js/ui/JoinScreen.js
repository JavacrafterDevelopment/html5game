/**
 * The first thing anyone sees: pick a callsign, pick a rifle, deploy.
 * The callsign is what every other player will see above your head and on the
 * scoreboard, so it is required before the Deploy button does anything.
 */

import { WEAPONS, PRIMARY_CHOICES } from '/shared/weapons.js';

/** Normalised 0..1 bars for the weapon cards. */
function statBars(w) {
  const rpmScore = w.boltActionMs ? 0.12 : Math.min(1, w.rpm / 900);
  return [
    ['DMG', Math.min(1, w.damage / 150)],
    ['RATE', rpmScore],
    ['RANGE', Math.min(1, w.range.end / 400)],
    ['MOBIL', Math.min(1, (w.feel.moveMult - 0.8) / 0.25)]
  ];
}

export class JoinScreen {
  constructor(root = document) {
    this.el = root.getElementById('join-screen');
    this.form = root.getElementById('join-form');
    this.input = root.getElementById('username');
    this.hint = root.getElementById('name-hint');
    this.picker = root.getElementById('weapon-picker');
    this.button = root.getElementById('deploy-btn');
    this.dot = root.getElementById('conn-dot');
    this.mapEl = root.getElementById('server-map');
    this.modeEl = root.getElementById('server-mode');
    this.playersEl = root.getElementById('server-players');

    this.selected = PRIMARY_CHOICES[0];
    this.onDeploy = null;
    this._infoTimer = null;

    this._buildWeapons();
    this._bind();
    this._restore();
  }

  _buildWeapons() {
    this.picker.innerHTML = '';
    for (const id of PRIMARY_CHOICES) {
      const w = WEAPONS[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'wep-card' + (id === this.selected ? ' active' : '');
      card.dataset.weapon = id;

      const name = document.createElement('div');
      name.className = 'wc-name';
      name.textContent = w.name;
      card.appendChild(name);

      const cls = document.createElement('div');
      cls.className = 'wc-class';
      cls.textContent = w.class;
      card.appendChild(cls);

      const stats = document.createElement('div');
      stats.className = 'wc-stats';
      for (const [label, value] of statBars(w)) {
        const row = document.createElement('div');
        row.className = 'wc-stat';
        const l = document.createElement('span');
        l.textContent = label;
        const track = document.createElement('div');
        track.className = 'wc-track';
        const val = document.createElement('div');
        val.className = 'wc-val';
        val.style.width = Math.round(value * 100) + '%';
        track.appendChild(val);
        row.append(l, track);
        stats.appendChild(row);
      }
      card.appendChild(stats);

      card.addEventListener('click', () => this.select(id));
      this.picker.appendChild(card);
    }
  }

  select(id) {
    this.selected = id;
    for (const card of this.picker.children) {
      card.classList.toggle('active', card.dataset.weapon === id);
    }
    try { localStorage.setItem('whiteout.primary', id); } catch {}
  }

  _restore() {
    try {
      const name = localStorage.getItem('whiteout.name');
      if (name) this.input.value = name;
      const primary = localStorage.getItem('whiteout.primary');
      if (primary && PRIMARY_CHOICES.includes(primary)) this.select(primary);
    } catch {}
  }

  _bind() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.input.value.trim();
      if (name.length < 1) {
        this.input.classList.add('invalid');
        this.hint.textContent = 'Enter a callsign to deploy.';
        this.hint.classList.add('error');
        this.input.focus();
        return;
      }
      this.input.classList.remove('invalid');
      this.hint.classList.remove('error');
      try { localStorage.setItem('whiteout.name', name); } catch {}
      this.button.disabled = true;
      this.button.textContent = 'DEPLOYING…';
      this.onDeploy?.({ name, primary: this.selected });
    });

    this.input.addEventListener('input', () => {
      this.input.classList.remove('invalid');
      this.hint.classList.remove('error');
      this.hint.textContent = 'Other players will see this name.';
    });

    // number keys pick a weapon while the name field is not focused
    document.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (document.activeElement === this.input) return;
      const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (idx >= 0 && PRIMARY_CHOICES[idx]) this.select(PRIMARY_CHOICES[idx]);
    });
  }

  /** Poll the little status endpoint so the join screen shows live info. */
  startPollingInfo() {
    const poll = async () => {
      try {
        const res = await fetch('/api/info', { cache: 'no-store' });
        const info = await res.json();
        this.dot.className = 'dot online';
        this.mapEl.textContent = info.map || '—';
        this.modeEl.textContent = info.mode || '—';
        this.playersEl.textContent = `${info.players}/${info.maxPlayers} online`;
      } catch {
        this.dot.className = 'dot offline';
        this.playersEl.textContent = 'server unreachable';
      }
    };
    poll();
    this._infoTimer = setInterval(poll, 3000);
  }

  stopPollingInfo() {
    clearInterval(this._infoTimer);
  }

  show() {
    this.el.classList.remove('hidden');
    this.button.disabled = false;
    this.button.textContent = 'DEPLOY';
    this.startPollingInfo();
    setTimeout(() => this.input.focus(), 60);
  }

  hide() {
    this.el.classList.add('hidden');
    this.stopPollingInfo();
  }

  showError(message) {
    this.button.disabled = false;
    this.button.textContent = 'DEPLOY';
    this.hint.textContent = message;
    this.hint.classList.add('error');
  }
}
