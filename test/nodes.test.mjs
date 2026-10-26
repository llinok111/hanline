import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodes, canBreakBetween, segment } from '../engine/nodes.mjs';
import { classify, KIND } from '../engine/chars.mjs';

const g = (text) => ({ text, kind: classify(text) });

test('canBreakBetween: a line may never start with a closer', () => {
  for (const ch of ['，', '。', '、', '；', '：', '？', '！', '）', '」', '】', '”', '%']) {
    assert.equal(canBreakBetween(g('字'), g(ch)), false, `break before ${ch} must be forbidden`);
  }
});

test('canBreakBetween: a line may never end with an opener', () => {
  for (const ch of ['（', '「', '《', '【', '“', '〈']) {
    assert.equal(canBreakBetween(g(ch), g('字')), false, `break after ${ch} must be forbidden`);
  }
});

test('canBreakBetween: ideograph to ideograph always breaks', () => {
  assert.equal(canBreakBetween(g('中'), g('文')), true);
});

test('adjacent glue is merged, never emitted as two nodes', () => {
  // Two glue nodes in a row create a zero-width chunk between two break points,
  // which then breaks every width subtraction downstream.
  const { nodes } = buildNodes('他说：「好的。」', { em: 16 });
  for (let i = 1; i < nodes.length; i += 1) {
    assert.ok(
      !(nodes[i].type === 'glue' && nodes[i - 1].type === 'glue'),
      `nodes ${i - 1} and ${i} are adjacent glue`
    );
  }
});

test('no glue exists at a forbidden break position', () => {
  // This is the invariant that keeps closers off line starts. A glue here would
  // be a break opportunity the solver is free to take.
  const text = '他说：「好的。」然后（真的）离开了，对吧？';
  const { nodes } = buildNodes(text, { em: 16 });
  const lastChar = (s) => [...s].at(-1);
  const firstChar = (s) => [...s][0];

  let prevBox = null;
  let pendingGlue = false;
  for (const n of nodes) {
    if (n.type === 'box') {
      if (pendingGlue && prevBox) {
        const before = lastChar(prevBox);
        const after = firstChar(n.value);
        assert.ok(
          canBreakBetween(g(before), g(after)),
          `glue between ${JSON.stringify(before)} and ${JSON.stringify(after)} is a forbidden break`
        );
      }
      prevBox = n.value;
      pendingGlue = false;
    } else if (n.type === 'glue') {
      pendingGlue = true;
    }
  }
});

test('a Latin run stays one indivisible box', () => {
  const { glyphs } = buildNodes('file name is report-2026-final.pdf end', { em: 16 });
  const run = glyphs.find((x) => x.text.includes('report'));
  assert.ok(run, 'the hyphenated filename must survive as one unit');
  assert.equal(run.width, 'report-2026-final.pdf'.length * 8);
});

test('Han/Latin boundaries carry a quarter-em gap', () => {
  const { nodes } = buildNodes('中文abc中文', { em: 16 });
  const gaps = nodes.filter((n) => n.type === 'glue' && Math.abs(n.width - 4) < 1e-9);
  assert.equal(gaps.length, 2, 'expected one gap on each side of the Latin run');
  assert.ok(gaps.every((n) => n.stretch > 0), 'the gap should absorb some stretch');
});

test('punctuation squeezing can be switched off', () => {
  const on = buildNodes('结束。', { em: 16 });
  const off = buildNodes('结束。', { em: 16, punctuationSqueezing: false });
  const boxOn = on.nodes.filter((n) => n.type === 'box').at(-1);
  const boxOff = off.nodes.filter((n) => n.type === 'box').at(-1);
  assert.equal(boxOn.width, 8, 'squeezed: ink half only');
  assert.equal(boxOff.width, 16, 'unsqueezed: full em box');
});

test('the paragraph always ends with a forced break penalty', () => {
  const { nodes } = buildNodes('任意文本。', { em: 16 });
  const last = nodes[nodes.length - 1];
  assert.equal(last.type, 'penalty');
  assert.equal(last.penalty, -10000);
});

test('a trailing closer tail is dropped rather than left as width', () => {
  const { nodes } = buildNodes('结束。', { em: 16 });
  const fill = nodes[nodes.length - 2];
  assert.equal(fill.type, 'glue');
  assert.equal(fill.width, 0, 'the final paragraph-fill glue must not carry the closer tail');
  assert.equal(fill.stretch, 10000);
});

test('segment keeps emoji and combining marks intact', () => {
  const parts = segment('a👍🏽中');
  assert.deepEqual(parts, ['a', '👍🏽', '中']);
});
