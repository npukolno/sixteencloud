// Bundles preload scripts into self-contained CommonJS files.
//
// Why: the main window runs with sandbox: true. Sandboxed preload scripts
// cannot require relative modules (../shared/constants) — only a small
// allowlist of built-ins plus 'electron'. Unbundled preload output from tsc
// therefore fails to load, taking the whole IPC bridge down with it.
//
// esbuild inlines our own modules and leaves require('electron') external,
// which is exactly what the sandboxed require supports.

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entries = ['src/preload/preload.ts', 'src/preload/mini-preload.ts'];

for (const entry of entries) {
  const outfile = path.join(root, 'dist/preload', path.basename(entry).replace(/\.ts$/, '.js'));
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'warning',
  });
  console.log(`[build-preload] bundled ${entry} -> dist/preload/${path.basename(outfile)}`);
}
