/**
 * Syntax check every source file without needing a bundler or a browser.
 *
 * Usage:  runtime\node\node.exe tools\check.mjs
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['client/js', 'shared', 'server', 'tools'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(full);
  }
  return out;
}

let checked = 0;
let failed = 0;

for (const rel of roots) {
  const dir = path.join(root, rel);
  let files = [];
  try { files = walk(dir); } catch { continue; }

  for (const file of files) {
    checked++;
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      failed++;
      console.error(`\nFAIL ${path.relative(root, file)}`);
      console.error(String(err.stderr || err.message).split('\n').slice(0, 6).join('\n'));
    }
  }
}

console.log(`\n${checked - failed}/${checked} files parsed cleanly.`);
process.exit(failed ? 1 : 0);
