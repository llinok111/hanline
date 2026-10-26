import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, defaultWidth, isSqueezable, KIND, TABLES } from '../engine/chars.mjs';

test('Han ideographs are full-width and breakable', () => {
  for (const ch of ['中', '文', '字', '。'[0], 'あ', 'ア', '한']) {
    assert.equal(defaultWidth(ch), 1, `${ch} should be 1em`);
  }
});

test('Latin letters are half-width in the fallback measure', () => {
  for (const ch of ['a', 'Z', '0', '-', '.']) {
    assert.equal(defaultWidth(ch), 0.5, `${ch} should be 0.5em`);
  }
});

test('space is a quarter em', () => {
  assert.equal(defaultWidth(' '), 0.25);
});

test('GB/T 15834 punctuation stays full-width despite Unicode Ambiguous width', () => {
  // If these were treated as half-width, every line containing an ellipsis or
  // dash would silently come out short and every ratio would be wrong.
  for (const ch of ['\u2026', '\u2014', '\u2018', '\u2019', '\u201c', '\u201d', '\u00b7']) {
    assert.equal(defaultWidth(ch), 1, `${JSON.stringify(ch)} must be 1em in CJK context`);
  }
});

test('every closing mark is classified CLOSER, never OPENER', () => {
  const all = [...TABLES.SQUEEZABLE_CLOSERS, ...TABLES.RIGID_CLOSERS];
  for (const ch of all) {
    assert.equal(classify(ch), KIND.CLOSER, `${ch} must be a closer`);
  }
});

test('every opening mark is classified OPENER', () => {
  for (const ch of TABLES.OPENERS) {
    assert.equal(classify(ch), KIND.OPENER, `${ch} must be an opener`);
  }
});

test('closer and opener sets are disjoint', () => {
  const closers = new Set([...TABLES.SQUEEZABLE_CLOSERS, ...TABLES.RIGID_CLOSERS]);
  for (const ch of TABLES.OPENERS) {
    assert.ok(!closers.has(ch), `${ch} cannot be both opener and closer`);
  }
});

test('only ink-in-left-half closers are squeezable', () => {
  // ？！ fill the em box; squeezing them would clip the glyph.
  for (const ch of ['，', '。', '、', '；', '：', '）', '」', '】', '”']) {
    assert.ok(isSqueezable(ch), `${ch} should be squeezable`);
  }
  for (const ch of ['？', '！', '…', '—', '%']) {
    assert.ok(!isSqueezable(ch), `${ch} must not be squeezed`);
  }
});

test('classify covers whitespace variants', () => {
  assert.equal(classify(' '), KIND.SPACE);
  assert.equal(classify('\t'), KIND.SPACE);
  assert.equal(classify('\n'), KIND.SPACE);
  assert.equal(classify('\u3000'), KIND.SPACE);
});

test('latin runs and digits classify as LATIN', () => {
  for (const ch of ['a', 'Q', '7', 'é', 'α']) {
    assert.equal(classify(ch), KIND.LATIN, `${ch} should start a latin run`);
  }
});
