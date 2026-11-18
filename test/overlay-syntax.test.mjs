// Every overlay/page script is built as a string in the main process and only
// parsed when it reaches the page; a syntax error there silently drops all
// panels. Parse each one here instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getVersion: () => '0.0.0', getPath: () => '/tmp' } };
  return origLoad.call(this, request, ...rest);
};

const dir = path.resolve('dist/renderer/overlays');

test('every overlay script parses as JavaScript', () => {
  let count = 0;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const mod = require(path.join(dir, file));
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== 'function' || !/Script$/.test(name)) continue;
      const src = fn();
      if (Array.isArray(src)) { src.forEach((s, i) => assert.doesNotThrow(() => new Function(typeof s === 'string' ? s : s[1] || s.script), `${file} ${name}[${i}]`)); count++; continue; }
      assert.doesNotThrow(() => new Function(src), `${file} ${name}`);
      count++;
    }
  }
  assert.ok(count >= 20, `expected the overlay scripts, found ${count}`);
});

test('page scripts bundled from src/renderer/page parse too', () => {
  const pageDir = path.resolve('dist/renderer/page');
  for (const file of fs.readdirSync(pageDir).filter(f => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(pageDir, file), 'utf-8')), file);
  }
});
