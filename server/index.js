/**
 * Whiteout -- entry point.
 *
 * One person runs this. Everyone else opens http://<that machine's IP>:8080 in a
 * browser. No installs on the client side, no accounts, no internet needed.
 */

import http from 'node:http';
import os from 'node:os';
import { NET } from '../shared/config.js';
import { SERVER_CONFIG, applyCliOverrides } from './config/server.config.js';
import { createStaticHandler, send404 } from './net/static.js';
import { attachWebSocketServer } from './net/websocket.js';
import { GameServer } from './core/GameServer.js';
import { COLLIDER_COUNT, PROPS, MAP_INFO } from '../shared/maps/snowy_forest/index.js';

const config = applyCliOverrides(SERVER_CONFIG, process.argv.slice(2));

const game = new GameServer({
  verbose: config.verbose,
  maxPlayers: config.maxPlayers,
  killTarget: config.killTarget
});

const serveStatic = createStaticHandler({ verbose: config.verbose });

const httpServer = http.createServer(async (req, res) => {
  // Tiny status endpoint -- handy for checking the server is up from a phone.
  if (req.url === '/api/info') {
    const body = JSON.stringify({ server: config.name, ...game.info() });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    res.end(body);
    return;
  }

  const handled = await serveStatic(req, res);
  if (!handled) send404(res);
});

attachWebSocketServer(httpServer, {
  path: '/ws',
  maxMessageBytes: NET.MAX_MESSAGE_BYTES,
  verbose: config.verbose,
  onConnection: (conn) => game.handleConnection(conn)
});

/** Every IPv4 address other machines could reach this host on. */
function localAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

function listen() {
  // No host => Node binds :: with dual-stack, so both ::1 and LAN IPv4 work.
  if (config.host) httpServer.listen(config.port, config.host, onListening);
  else httpServer.listen(config.port, onListening);
}

function onListening() {
  game.start();

  const line = '='.repeat(62);
  console.log('');
  console.log(line);
  console.log('  WHITEOUT  -  hardcore FFA');
  console.log(line);
  console.log(`  Map          : ${MAP_INFO.name} (${PROPS.trees.length} trees, ${COLLIDER_COUNT} colliders)`);
  console.log(`  Mode         : Free For All, first to ${config.killTarget} kills`);
  console.log(`  Max players  : ${config.maxPlayers}`);
  console.log('');
  console.log('  On this computer:');
  console.log(`      http://localhost:${config.port}`);
  const addrs = localAddresses();
  if (addrs.length) {
    console.log('');
    console.log('  Other players on your network open one of these in Chrome:');
    for (const a of addrs) {
      console.log(`      http://${a.address}:${config.port}       (${a.name})`);
    }
  } else {
    console.log('  No network interfaces found - only this computer can connect.');
  }
  console.log('');
  console.log('  Press Ctrl+C to stop the server.');
  console.log(line);
  console.log('');
}

let retriedIPv4 = false;

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${config.port} is already in use.`);
    console.error(`  Start on a different port:  start.bat --port 8081\n`);
  } else if (!retriedIPv4 && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
    // Host has no IPv6 stack: fall back to IPv4 on every interface.
    retriedIPv4 = true;
    config.host = '0.0.0.0';
    listen();
    return;
  } else {
    console.error('\n  Server error:', err.message, '\n');
  }
  process.exit(1);
});

listen();

function shutdown() {
  console.log('\n  Shutting down...');
  game.stop();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
