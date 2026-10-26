// Proves two things that a fork is easy to get wrong:
//   1. the vendored upstream sources are byte-identical to the commit we forked
//   2. English layout still behaves exactly as it did before we touched anything
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Typeset, SOURCE_SHA256 } from '../engine/_upstream.generated.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vendored upstream sources match the recorded sha256', () => {
  for (const [rel, expected] of Object.entries(SOURCE_SHA256)) {
    // Compare LF-normalised text: the Windows working tree uses CRLF while the
    // repository stores LF, and a fresh clone must verify the same hash.
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    const actual = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    assert.equal(actual, expected, `${rel} changed — upstream must stay byte-identical`);
  }
});

test('the generated wrapper contains all five upstream files verbatim', () => {
  const gen = fs.readFileSync(path.join(ROOT, 'engine/_upstream.generated.mjs'), 'utf8');
  for (const rel of Object.keys(SOURCE_SHA256)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(gen.includes(src), `${rel} body missing from generated wrapper`);
  }
});

test('upstream Git history is still reachable (fork keeps provenance)', () => {
  // Not a git command: just assert the files that upstream owns still exist at
  // their original paths, so `git log -- src/linebreak.js` keeps working.
  for (const rel of ['src/linebreak.js', 'src/linked-list.js', 'src/formatter.js', 'lib/hypher.js', 'lib/en-us.js', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} must stay at its upstream path`);
  }
});

// --- English regression -----------------------------------------------------
// These numbers were measured on the untouched upstream commit before any of
// our code existed. If they move, we broke the original capability.
const EM = 16;
const isWide = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6);
};
const measureText = (s) => [...s].reduce((w, ch) => w + (isWide(ch) ? EM : ch === ' ' ? EM * 0.25 : EM * 0.5), 0);

const EN = 'In olden times when wishing still helped one, there lived a king whose daughters were all beautiful; and the youngest was so beautiful that the sun itself, which has seen so much, was astonished whenever it shone in her face.';

test('upstream English justification still yields 5 lines at 384px', () => {
  const nodes = Typeset.formatter(measureText).justify(EN);
  const breaks = Typeset.linebreak(nodes, [384], { tolerance: 3 });
  assert.equal(breaks.length - 1, 5, 'english line count regressed');
});

test('upstream formatter still emits box/glue/penalty triples', () => {
  const nodes = Typeset.formatter(measureText).justify(EN);
  const kinds = new Set(nodes.map((n) => n.type));
  assert.deepEqual([...kinds].sort(), ['box', 'glue', 'penalty']);
  assert.equal(nodes.filter((n) => n.type === 'box').length, 52);
});

test('the solver still refuses a CJK paragraph without our node model', () => {
  // This is the gap hanline exists to close: upstream splits on /\S+/ so a
  // Chinese paragraph is one indivisible word and cannot be set at all.
  const zh = '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽。';
  const nodes = Typeset.formatter(measureText).justify(zh);
  assert.equal(nodes.filter((n) => n.type === 'box').length, 1, 'upstream must treat the paragraph as one box');
  const breaks = Typeset.linebreak(nodes, [384], { tolerance: 3 });
  assert.equal(breaks.length, 0, 'upstream cannot break Chinese');
});
