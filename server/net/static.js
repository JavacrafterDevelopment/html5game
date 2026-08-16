/**
 * Static file serving for the game client. No framework, just node:http + node:fs.
 *
 * Only the directories in ALLOWED_ROOTS are reachable, and every resolved path is
 * re-checked against the project root so `..` traversal cannot escape.
 * Text assets are gzipped once and cached in memory -- three.module.js drops from
 * 1.2 MB to ~300 KB, which matters on a phone-hotspot LAN.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const ALLOWED_ROOTS = ['client', 'shared', 'assets'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.md']);

/** path -> { mtimeMs, size, raw, gz, type, etag } */
const cache = new Map();

function contentType(ext) {
  return MIME[ext] || 'application/octet-stream';
}

async function loadFile(abs, ext) {
  const stat = await fsp.stat(abs);
  const cached = cache.get(abs);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;

  const raw = await fsp.readFile(abs);
  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    raw,
    gz: COMPRESSIBLE.has(ext) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 6 }) : null,
    type: contentType(ext),
    etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  };
  cache.set(abs, entry);
  return entry;
}

/** Resolve a URL path to a real file inside an allowed root, or null. */
function resolveSafe(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/client/index.html';
  if (rel === '/favicon.ico') rel = '/client/favicon.svg';

  // Normalise and strip any leading separators so path.join cannot be tricked.
  const normalized = path.normalize(rel).replace(/^([/\\])+/, '');
  const abs = path.resolve(PROJECT_ROOT, normalized);

  if (abs !== PROJECT_ROOT && !abs.startsWith(PROJECT_ROOT + path.sep)) return null;

  const relFromRoot = path.relative(PROJECT_ROOT, abs);
  const top = relFromRoot.split(path.sep)[0];
  if (!ALLOWED_ROOTS.includes(top)) return null;

  return abs;
}

export function createStaticHandler({ verbose = false } = {}) {
  return async function handleStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const abs = resolveSafe(req.url || '/');
    if (!abs) return false;

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return false;
    }
    if (stat.isDirectory()) return false;

    const ext = path.extname(abs).toLowerCase();
    let entry;
    try {
      entry = await loadFile(abs, ext);
    } catch {
      return false;
    }

    // Conditional request: let the browser reuse what it already has.
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, { ETag: entry.etag });
      res.end();
      return true;
    }

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = entry.gz && acceptsGzip ? entry.gz : entry.raw;

    const headers = {
      'Content-Type': entry.type,
      'Content-Length': body.length,
      ETag: entry.etag,
      // Always revalidate: during development you want an edit to show up on reload.
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    };
    if (entry.gz && acceptsGzip) headers['Content-Encoding'] = 'gzip';

    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(body);

    if (verbose) console.log(`  200 ${req.url} (${(body.length / 1024).toFixed(1)} KB)`);
    return true;
  };
}

export function send404(res) {
  const body = 'Not found';
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
