import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('engines declares the floor actually used', () => {
  assert.equal(pkg.engines.node, '>=18.17.0');
});

test('no source file uses APIs that do not exist on the declared floor', () => {
  // These have all burned this project family before: each one works on the
  // development Node (22) and fails only in CI on 18/20.
  const banned = [
    { re: /import\.meta\.dirname/, why: 'Node 20.11+ only' },
    { re: /fs\.promises\.glob|fsp\.glob\b|promises\.glob\(/, why: 'Node 22+ only' },
    { re: /structuredClone\s*\(/, why: 'fine on 17+, listed for visibility', ok: true }
  ];
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'engine'));
  walk(path.join(ROOT, 'bin'));
  walk(path.join(ROOT, 'scripts'));
  assert.ok(files.length > 0);

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const { re, why, ok } of banned) {
      if (ok) continue;
      assert.ok(!re.test(src), `${path.relative(ROOT, f)} uses ${why}`);
    }
  }
});

test('the test runner invocation does not depend on a shell-expanded glob', () => {
  // `node --test "test/*.test.mjs"` only works on Node 21+; bare `node --test`
  // discovers the directory on 18 through 22.
  assert.equal(pkg.scripts.test, 'node --test');
  assert.ok(!pkg.scripts.test.includes('*'));
});

test('files field ships everything needed to run without a build step', () => {
  for (const entry of ['engine', 'bin', 'src', 'lib', 'LICENSE', 'NOTICE', 'README.md']) {
    assert.ok(pkg.files.includes(entry), `${entry} must be published`);
  }
});

test('the generated upstream wrapper is committed, so the ZIP runs as-is', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'engine/_upstream.generated.mjs')));
  const size = fs.statSync(path.join(ROOT, 'engine/_upstream.generated.mjs')).size;
  assert.ok(size > 40000, 'wrapper looks truncated');
});

test('license and attribution files are present', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'LICENSE')));
  assert.ok(fs.existsSync(path.join(ROOT, 'NOTICE')));
  const notice = fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8');
  assert.match(notice, /bramstein\/typeset/);
  assert.match(notice, /BSD-2-Clause/);
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /Bram Stein/);
});
