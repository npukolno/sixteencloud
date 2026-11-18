// Remove dist/ before a build. tsc never deletes outputs of removed sources,
// and a stale dist/main/ipc.js would shadow dist/main/ipc/index.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
