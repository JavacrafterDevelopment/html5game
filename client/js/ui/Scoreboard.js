/**
 * Scoreboard. Shown on TAB, and automatically for the whole respawn wait.
 *
 * This is the only place the game tells you how you are doing -- there is no live
 * kill counter on the HUD, by design.
 */

export class Scoreboard {
  constructor(root = document) {
    this.el = root.getElementById('scoreboard');
    this.body = root.getElementById('sb-body');
    this.foot = root.getElementById('sb-foot');
    this.targetEl = root.getElementById('sb-target');
    this.visible = false;
    this.selfId = 0;
    this.list = [];
    this.target = 100;
  }

  setSelf(id) { this.selfId = id; }

  setTarget(target) {
    this.target = target;
    this.targetEl.textContent = target;
  }

  update(list, target) {
    this.list = list || [];
    if (target) this.setTarget(target);
    if (this.visible) this.render();
  }

  render() {
    const rows = [];
    const leaderKills = this.list.length ? Math.max(...this.list.map((p) => p.kills)) : 0;

    this.list.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (p.id === this.selfId) tr.classList.add('me');
      if (!p.alive) tr.classList.add('dead');
      if (p.kills === leaderKills && leaderKills > 0) tr.classList.add('leader');

      const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);

      const cells = [
        ['c-rank', String(i + 1)],
        ['c-name', p.name],
        ['c-k', String(p.kills)],
        ['c-d', String(p.deaths)],
        ['c-r', kd],
        ['c-p', String(p.ping)]
      ];
      for (const [cls, text] of cells) {
        const td = document.createElement('td');
        td.className = cls;
        td.textContent = text;      // textContent: names are never parsed as HTML
        tr.appendChild(td);
      }
      rows.push(tr);
    });

    this.body.replaceChildren(...rows);

    const leader = this.list[0];
    if (leader && leader.kills > 0) {
      const left = Math.max(0, this.target - leader.kills);
      this.foot.textContent = `${leader.name} LEADS · ${left} KILL${left === 1 ? '' : 'S'} TO WIN`;
    } else {
      this.foot.textContent = `${this.list.length} OPERATOR${this.list.length === 1 ? '' : 'S'} IN THE VALLEY`;
    }
  }

  show(respawnMode = false) {
    this.visible = true;
    this.el.classList.toggle('respawn-mode', respawnMode);
    this.render();
    this.el.classList.remove('hidden');
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hidden');
  }
}
