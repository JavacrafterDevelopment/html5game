/**
 * Regression test for the WebSocket handshake.
 *
 * Worth having as a real test: an incorrect Sec-WebSocket-Accept still produces a
 * valid-looking "HTTP/1.1 101 Switching Protocols" response, and a hand-rolled
 * client will happily talk over it -- but every real browser silently drops the
 * connection with code 1006 and no explanation.
 *
 * Usage:  runtime\node\node.exe tools\test-handshake.mjs
 */

import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert';
import { attachWebSocketServer } from '../server/net/websocket.js';

// RFC 6455 section 1.3 worked example.
const RFC_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const RFC_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

function rawHandshake(port, key) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        'GET /ws HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const text = buf.toString('latin1');
      if (text.includes('\r\n\r\n')) {
        socket.destroy();
        resolve(text.slice(0, text.indexOf('\r\n\r\n') + 4));
      }
    });
    socket.on('error', reject);
    setTimeout(() => { socket.destroy(); reject(new Error('handshake timed out')); }, 3000);
  });
}

/** Frame a client->server text message (browsers always mask). */
function maskedTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

async function run() {
  const server = http.createServer((req, res) => res.end('ok'));
  const received = [];

  attachWebSocketServer(server, {
    path: '/ws',
    onConnection: (conn) => {
      conn.on('message', (msg) => {
        received.push(msg);
        conn.send(JSON.stringify({ echo: msg }));
      });
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // ---- 1. the accept hash must match the RFC vector ----
  const response = await rawHandshake(port, RFC_KEY);
  assert.ok(response.startsWith('HTTP/1.1 101'), 'expected a 101 response');
  const accept = /Sec-WebSocket-Accept: (.+)\r/.exec(response)?.[1];
  assert.strictEqual(accept, RFC_ACCEPT,
    `Sec-WebSocket-Accept mismatch.\n  got:      ${accept}\n  expected: ${RFC_ACCEPT}\n` +
    '  The handshake GUID in server/net/websocket.js is wrong; browsers will refuse to connect.');
  console.log('  ok  handshake accept matches RFC 6455 vector');

  // ---- 2. a masked client frame must round-trip ----
  const echoed = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        'GET /ws HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let phase = 0;
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (phase === 0) {
        const text = buf.toString('latin1');
        const end = text.indexOf('\r\n\r\n');
        if (end < 0) return;
        buf = buf.subarray(end + 4);
        phase = 1;
        socket.write(maskedTextFrame('{"m":"hello"}'));
      }
      if (phase === 1) {
        // skip server pings (0x89) and look for a text frame (0x81)
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          const len = buf[1] & 0x7f;
          if (buf.length < 2 + len) return;
          const payload = buf.subarray(2, 2 + len);
          buf = buf.subarray(2 + len);
          if (opcode === 0x1) {
            socket.destroy();
            resolve(payload.toString('utf8'));
            return;
          }
        }
      }
    });
    socket.on('error', reject);
    setTimeout(() => { socket.destroy(); reject(new Error('no echo received')); }, 3000);
  });

  assert.strictEqual(echoed, JSON.stringify({ echo: '{"m":"hello"}' }), 'echo payload mismatch');
  assert.strictEqual(received[0], '{"m":"hello"}', 'server did not unmask the client frame');
  console.log('  ok  masked client frame unmasked and echoed');

  server.close();
  console.log('\nhandshake tests passed.');
}

run().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
