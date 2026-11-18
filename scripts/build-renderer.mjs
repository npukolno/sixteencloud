// Bundles browser-side code that runs in our own windows or the SoundCloud
// page into self-contained IIFE scripts under dist/renderer/.
//
// These sources are real TypeScript (typechecked by tsconfig.renderer.json),
// not template strings inside the main process.

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (...p) => path.join(root, 'dist/renderer', ...p);

const bundles = [
  // Mini-player window: index.html + its script.
  { entry: 'src/renderer/mini-player/mini-player.ts', outfile: out('mini-player/mini-player.js'), copy: ['src/renderer/mini-player/index.html'] },
];

// Page scripts injected into SoundCloud (src/renderer/page/<name>.ts → dist/renderer/page/<name>.js).
const pageDir = path.join(root, 'src/renderer/page');
if (fs.existsSync(pageDir)) {
  for (const file of fs.readdirSync(pageDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    bundles.push({ entry: `src/renderer/page/${file}`, outfile: out('page', file.replace(/\.ts$/, '.js')) });
  }
}

for (const b of bundles) {
  await build({
    entryPoints: [path.join(root, b.entry)],
    outfile: b.outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  for (const file of b.copy || []) {
    fs.copyFileSync(path.join(root, file), path.join(path.dirname(b.outfile), path.basename(file)));
  }
  console.log(`[build-renderer] ${b.entry} -> ${path.relative(root, b.outfile)}`);
}
