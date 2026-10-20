// Compiles native/pulse-sixteencloud.c into dist/native/pulse-sixteencloud.so.
// Linux only, and never fatal: without a compiler the app still runs, it just
// keeps Chromium's PulseAudio identity in the volume mixer.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'native', 'pulse-sixteencloud.c');
const outputDir = path.join(root, 'dist', 'native');
const output = path.join(outputDir, 'pulse-sixteencloud.so');

if (process.platform !== 'linux') {
  console.log('[build-pulse-shim] skipped (linux only)');
  process.exit(0);
}

if (!fs.existsSync(source)) {
  console.log('[build-pulse-shim] skipped (source missing)');
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync('gcc', ['-shared', '-fPIC', '-O2', '-o', output, source, '-ldl'], {
  stdio: 'inherit',
});

if (result.error || result.status !== 0) {
  console.warn('[build-pulse-shim] gcc unavailable or failed — skipping identity shim');
  process.exit(0);
}

console.log(`[build-pulse-shim] ${path.relative(root, output)}`);
