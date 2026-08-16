/**
 * WebSocket client.
 *
 * Also maintains a running estimate of the server clock. Everything about remote
 * player interpolation depends on knowing what time it is on the server, so pongs
 * are used to track the offset and smooth out jitter.
 */

import { C, S, encode, decode } from '/shared/protocol.js';
import { NET } from '/shared/config.js';

export class NetClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.handlers = new Map();
    this.rtt = 60;
    this.serverTimeOffset = 0;
    this._offsetSamples = [];
    this._pingTimer = null;
    this.closedByUs = false;
    this.bytesIn = 0;
    this.bytesOut = 0;
  }

  /** Derive the websocket URL from wherever the page was served. */
  static url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
    return this;
  }

  _emit(type, data) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const fn of list) fn(data);
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.socket = new WebSocket(NetClient.url());
      } catch (err) {
        reject(err);
        return;
      }

      this.socket.addEventListener('open', () => {
        this.connected = true;
        this.closedByUs = false;
        this._startPing();
        settled = true;
        resolve();
      });

      this.socket.addEventListener('message', (ev) => {
        this.bytesIn += ev.data.length || 0;
        const msg = decode(ev.data);
        if (!msg) return;
        if (msg.m === S.PONG) {
          this._onPong(msg);
          return;
        }
        this._emit(msg.m, msg);
      });

      this.socket.addEventListener('close', (ev) => {
        this.connected = false;
        clearInterval(this._pingTimer);
        if (!settled) {
          reject(new Error('Could not reach the server'));
          settled = true;
          return;
        }
        this._emit('__close', { code: ev.code, reason: ev.reason, byUs: this.closedByUs });
      });

      this.socket.addEventListener('error', () => {
        if (!settled) {
          reject(new Error('Could not reach the server'));
          settled = true;
        }
      });
    });
  }

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      this.send(C.PING, { t: Date.now() });
    }, NET.PING_INTERVAL_MS);
    this.send(C.PING, { t: Date.now() });
  }

  _onPong(msg) {
    const now = Date.now();
    const rtt = now - msg.t;
    this.rtt = this.rtt * 0.75 + rtt * 0.25;

    // Server time when the reply was sent, projected to now.
    const offset = msg.s + rtt / 2 - now;
    this._offsetSamples.push(offset);
    if (this._offsetSamples.length > 9) this._offsetSamples.shift();

    // Median is far more robust than a mean when one packet gets delayed.
    const sorted = [...this._offsetSamples].sort((a, b) => a - b);
    this.serverTimeOffset = sorted[Math.floor(sorted.length / 2)];
  }

  /** Best estimate of the server's clock right now. */
  serverNow() {
    return Date.now() + this.serverTimeOffset;
  }

  send(type, data) {
    if (!this.connected || this.socket.readyState !== WebSocket.OPEN) return false;
    const payload = encode(type, data);
    this.bytesOut += payload.length;
    this.socket.send(payload);
    return true;
  }

  close() {
    this.closedByUs = true;
    clearInterval(this._pingTimer);
    this.socket?.close(1000, 'client left');
  }
}
