/**
 * Host-side settings. Edit this file, or override any of it on the command line:
 *   node server/index.js --port 9000 --kill-target 50 --max-players 12 --verbose
 */

import { NET, MATCH } from '../../shared/config.js';

export const SERVER_CONFIG = {
  /** Port players connect to. Change if 8080 is taken on your machine. */
  port: NET.DEFAULT_PORT,

  /**
   * Empty = listen on every interface, dual-stack (IPv6 + IPv4).
   * This matters more than it looks: Chrome resolves "localhost" to ::1 first, and
   * an IPv4-only bind makes the page load over IPv4 while the WebSocket upgrade
   * quietly fails. Set '0.0.0.0' to force IPv4-only.
   */
  host: '',

  /** Server name shown on the join screen. */
  name: 'Whiteout Ridge Server',

  maxPlayers: NET.MAX_PLAYERS,

  /** Kills needed to win the Free For All. */
  killTarget: MATCH.KILL_TARGET,

  /** Extra logging: rejected shots, per-request static hits. */
  verbose: false
};

export function applyCliOverrides(config, argv) {
  const out = { ...config };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--port': case '-p': out.port = parseInt(next(), 10) || out.port; break;
      case '--host': out.host = next() || out.host; break;
      case '--max-players': out.maxPlayers = parseInt(next(), 10) || out.maxPlayers; break;
      case '--kill-target': out.killTarget = parseInt(next(), 10) || out.killTarget; break;
      case '--name': out.name = next() || out.name; break;
      case '--verbose': case '-v': out.verbose = true; break;
      default: break;
    }
  }
  if (process.env.PORT) out.port = parseInt(process.env.PORT, 10) || out.port;
  return out;
}
