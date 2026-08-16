/**
 * Run every server-side check.
 *
 * Usage:  runtime\node\node.exe tools\test-all.mjs
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ['check.mjs', 'test-handshake.mjs', 'test-combat.mjs'];

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  try {
    const out = execFileSync(process.execPath, [path.join(here, suite)], { encoding: 'utf8' });
    process.stdout.write(out.split('\n').filter((l) => !l.includes('joined')).join('\n'));
  } catch (err) {
    failed++;
    process.stdout.write(String(err.stdout || ''));
    process.stderr.write(String(err.stderr || ''));
  }
}

console.log(failed ? `\n${failed} suite(s) FAILED.` : '\nAll suites passed.');
process.exit(failed ? 1 : 0);
