/**
 * Entry point.
 *
 * Boot order: build the world first (so Deploy is instant), then ask for a callsign,
 * then open the socket. The Deploy click doubles as the user gesture that lets the
 * browser start audio.
 */

import { Game } from './core/Game.js';
import { JoinScreen } from './ui/JoinScreen.js';

const canvas = document.getElementById('viewport');
const loading = document.getElementById('loading');
const loadFill = document.getElementById('load-fill');
const loadStatus = document.getElementById('load-status');
const disconnectEl = document.getElementById('disconnect');
const disconnectReason = document.getElementById('dc-reason');

function setProgress(fraction, label) {
  loadFill.style.width = Math.round(fraction * 100) + '%';
  if (label) loadStatus.textContent = label;
}

function fatal(message) {
  loading.classList.add('hidden');
  disconnectEl.classList.remove('hidden');
  disconnectReason.textContent = message;
}

async function boot() {
  if (!window.WebGLRenderingContext) {
    fatal('This browser has no WebGL support. Try Chrome, Edge or Firefox.');
    return;
  }

  const join = new JoinScreen();
  const game = new Game(canvas);

  try {
    await game.init(setProgress);
  } catch (err) {
    console.error(err);
    fatal('Could not start the renderer: ' + (err?.message || err));
    return;
  }

  loading.classList.add('hidden');
  join.show();

  join.onDeploy = async ({ name, primary }) => {
    try {
      // Must run inside the click handler for autoplay policies.
      game.audio.init();
      game.audio.resume();

      await game.connect(name, primary);
      join.hide();
    } catch (err) {
      console.error(err);
      join.showError('Could not reach the server. Is it still running?');
    }
  };

  game.onDisconnect = (info) => {
    disconnectReason.textContent = info.code === 1006
      ? 'Lost contact with the server.'
      : 'The server closed the connection.';
    disconnectEl.classList.remove('hidden');
    game.running = false;
    document.exitPointerLock?.();
  };

  game.onFatalError = (message) => {
    disconnectReason.textContent = message;
    disconnectEl.classList.remove('hidden');
    game.running = false;
    document.exitPointerLock?.();
  };

  document.getElementById('dc-retry').addEventListener('click', () => location.reload());

  // Handy for debugging from the console.
  window.__whiteout = game;
}

boot().catch((err) => {
  console.error(err);
  fatal(String(err?.message || err));
});
