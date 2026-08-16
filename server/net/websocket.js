/**
 * Minimal RFC 6455 WebSocket server built directly on node:http.
 *
 * Why hand-rolled: this project ships with its own Node runtime and must run after
 * being unzipped onto a machine with nothing installed and no internet. Pulling in
 * `ws` would mean shipping node_modules and hoping it stays intact. This is ~250
 * lines and has no dependencies at all.
 *
 * Supports: text + binary frames, fragmentation, ping/pong, close handshake.
 * Deliberately omits: permessage-deflate (we never negotiate the extension),
 * and client mode (we only ever act as a server).
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// RFC 6455 handshake magic string. Must be exact -- browsers verify the resulting
// Sec-WebSocket-Accept hash and silently drop the connection if it does not match.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa
};

export class WebSocketConnection extends EventEmitter {
  constructor(socket, options = {}) {
    super();
    this.socket = socket;
    this.maxMessageBytes = options.maxMessageBytes ?? 1024 * 1024;
    this.readyState = 1; // OPEN
    this.remoteAddress = socket.remoteAddress;
    this.isAlive = true;

    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOp = 0;
    this._fragmentSize = 0;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._onClose());
    socket.on('error', (err) => {
      this.emit('error', err);
      this._onClose();
    });
    socket.setNoDelay(true);
  }

  _onData(chunk) {
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    try {
      this._parse();
    } catch (err) {
      this.close(1002, 'protocol error');
    }
  }

  _parse() {
    for (;;) {
      const buf = this._buffer;
      if (buf.length < 2) return;

      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;

      if (rsv !== 0) throw new Error('RSV bits must be clear');
      // Browsers always mask. An unmasked client frame is a protocol violation.
      if (!masked) throw new Error('client frames must be masked');

      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buf.length < offset + 2) return;
        len = buf.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (buf.length < offset + 8) return;
        const big = buf.readBigUInt64BE(offset);
        if (big > BigInt(this.maxMessageBytes)) throw new Error('frame too large');
        len = Number(big);
        offset += 8;
      }

      if (len > this.maxMessageBytes) throw new Error('frame too large');
      if (buf.length < offset + 4) return;
      const mask = buf.subarray(offset, offset + 4);
      offset += 4;
      if (buf.length < offset + len) return;

      const payload = Buffer.allocUnsafe(len);
      const src = buf.subarray(offset, offset + len);
      for (let i = 0; i < len; i++) payload[i] = src[i] ^ mask[i & 3];

      this._buffer = buf.subarray(offset + len);
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP.CONTINUATION: {
        if (!this._fragmentOp) throw new Error('unexpected continuation');
        this._fragmentSize += payload.length;
        if (this._fragmentSize > this.maxMessageBytes) throw new Error('message too large');
        this._fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this._fragments);
          const op = this._fragmentOp;
          this._fragments = [];
          this._fragmentOp = 0;
          this._fragmentSize = 0;
          this._emitMessage(op, full);
        }
        break;
      }
      case OP.TEXT:
      case OP.BINARY: {
        if (this._fragmentOp) throw new Error('interleaved message');
        if (fin) {
          this._emitMessage(opcode, payload);
        } else {
          this._fragmentOp = opcode;
          this._fragments = [payload];
          this._fragmentSize = payload.length;
        }
        break;
      }
      case OP.CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        this._sendFrame(OP.CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : Buffer.alloc(0));
        this.readyState = 3;
        this.socket.end();
        this.emit('close', code);
        break;
      }
      case OP.PING:
        this._sendFrame(OP.PONG, payload);
        break;
      case OP.PONG:
        this.isAlive = true;
        this.emit('pong');
        break;
      default:
        throw new Error('unknown opcode ' + opcode);
    }
  }

  _emitMessage(opcode, payload) {
    this.isAlive = true;
    if (opcode === OP.TEXT) {
      this.emit('message', payload.toString('utf8'), false);
    } else {
      this.emit('message', payload, true);
    }
  }

  _sendFrame(opcode, payload) {
    if (this.readyState !== 1 && opcode !== OP.CLOSE) return false;
    if (this.socket.destroyed) return false;

    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;   // FIN + opcode, server frames are never masked

    try {
      this.socket.write(header);
      if (len) this.socket.write(payload);
      return true;
    } catch {
      return false;
    }
  }

  /** Send a UTF-8 text message. */
  send(data) {
    if (this.readyState !== 1) return false;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    return this._sendFrame(Buffer.isBuffer(data) ? OP.BINARY : OP.TEXT, payload);
  }

  ping() {
    this.isAlive = false;
    this._sendFrame(OP.PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this._sendFrame(OP.CLOSE, payload);
    // Give the close frame a moment to flush, then drop the socket.
    setTimeout(() => this.socket.destroy(), 150).unref?.();
  }

  _onClose() {
    if (this.readyState === 3 && this._closed) return;
    this._closed = true;
    this.readyState = 3;
    this.emit('close', 1006);
  }
}

/**
 * Attach WebSocket upgrade handling to an existing http.Server.
 * @param {import('node:http').Server} httpServer
 * @param {{ path?: string, maxMessageBytes?: number, onConnection: (conn, req) => void }} options
 */
export function attachWebSocketServer(httpServer, options) {
  const path = options.path ?? '/ws';

  httpServer.on('upgrade', (req, socket, head) => {
    if (options.verbose) console.log(`  ws upgrade from ${req.socket.remoteAddress}`);
    if (req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const url = (req.url || '').split('?')[0];
    if (path && url !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', ''
    ].join('\r\n');

    socket.write(headers);

    const conn = new WebSocketConnection(socket, { maxMessageBytes: options.maxMessageBytes });
    if (head && head.length) conn._onData(head);
    options.onConnection(conn, req);
  });
}
