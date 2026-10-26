import test from 'node:test';
import assert from 'node:assert/strict';
import { badnessOf, stdev, computeMetrics, countKinsokuViolations } from '../engine/metrics.mjs';

test('badness follows TeX: 100·|r|³', () => {
  assert.equal(badnessOf(0), 0);
  assert.equal(badnessOf(1), 100);
  assert.equal(badnessOf(-1), 100);
  assert.ok(Math.abs(badnessOf(0.5) - 12.5) < 1e-9);
});

test('stdev of a constant list is zero', () => {
  assert.equal(stdev([20, 20, 20]), 0);
});

test('stdev matches the population formula', () => {
  // values 2,4,4,4,5,5,7,9 -> mean 5, population sd 2
  assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2) < 1e-9);
});

const line = (text, ratio, width, fill) => ({
  index: 0, text, ratio, width, contentWidth: width, naturalWidth: width, target: 20, fill
});

test('the last line is excluded from badness and width spread', () => {
  const lines = [
    { ...line('第一行文字', 0.5, 20, 1), index: 0 },
    { ...line('第二行文字', -0.5, 20, 1), index: 1 },
    { ...line('尾', 0, 1, 0.05), index: 2 }
  ];
  const m = computeMetrics(lines, 20, 20);
  assert.ok(Math.abs(m.totalBadness - 25) < 1e-9, 'two body lines of |0.5| => 12.5 each');
  assert.equal(m.worstRatio, 0.5);
  assert.equal(m.widthSD, 0, 'body widths are identical');
  assert.ok(Math.abs(m.lastLineFill - 0.05) < 1e-9);
});

test('kinsoku counter catches a closer at line start', () => {
  const lines = [line('这样不对', 0, 20, 1), { ...line('，然后继续', 0, 20, 1), index: 1 }];
  const v = countKinsokuViolations(lines);
  assert.equal(v.count, 1);
  assert.deepEqual(v.detail[0], { line: 1, at: 'start', ch: '，' });
});

test('kinsoku counter catches an opener at line end', () => {
  const lines = [line('他说（', 0, 20, 1), { ...line('真的', 0, 20, 1), index: 1 }];
  const v = countKinsokuViolations(lines);
  assert.equal(v.count, 1);
  assert.deepEqual(v.detail[0], { line: 0, at: 'end', ch: '（' });
});

test('clean lines report zero violations', () => {
  const lines = [line('第一行正常结束。', 0, 20, 1), { ...line('第二行也很正常。', 0, 20, 1), index: 1 }];
  assert.equal(countKinsokuViolations(lines).count, 0);
});

test('overflow is counted against the measure, ignoring float noise', () => {
  const clean = [line('刚好', 0, 20, 1), { ...line('尾', 0, 5, 1), index: 1 }];
  assert.equal(computeMetrics(clean, 20, 10).overflowLines, 0);
  const noisy = [line('刚好', 0, 20 + 1e-9, 1), { ...line('尾', 0, 5, 1), index: 1 }];
  assert.equal(computeMetrics(noisy, 20, 10).overflowLines, 0, 'rounding noise is not overflow');
  const overfull = [line('溢出', 0, 20.5, 1), { ...line('尾', 0, 5, 1), index: 1 }];
  assert.equal(computeMetrics(overfull, 20, 10).overflowLines, 1);
});
