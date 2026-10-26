import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkify, greedyLayout } from '../engine/greedy.mjs';
import { buildNodes } from '../engine/nodes.mjs';
import { layout } from '../engine/index.mjs';
import { countKinsokuViolations } from '../engine/metrics.mjs';

const strip = (s) => s.replace(/\s+/g, '');

test('chunks tile the node list without gaps or overlaps', () => {
  const { nodes } = buildNodes('中文排版，测试。abc 混合。', { em: 16 });
  const chunks = chunkify(nodes);
  assert.ok(chunks.length > 5);
  let expectNext = 0;
  for (const c of chunks) {
    assert.equal(c.from, expectNext, 'chunk start must follow the previous chunk end');
    assert.ok(c.to >= c.from);
    expectNext = c.to + 1;
  }
  assert.ok(expectNext >= nodes.length - 1, 'chunks must reach the end of the paragraph');
});

test('chunk text concatenation equals the source text (ignoring whitespace)', () => {
  const text = '他说：「好的。」然后离开了，对吧？';
  const { nodes } = buildNodes(text, { em: 16 });
  const all = chunkify(nodes).map((c) => c.text).join('');
  assert.equal(strip(all), strip(text));
});

test('greedy never exceeds the measure unless a single chunk does', () => {
  const text = '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽；最小的那个美得连太阳见了都惊讶。';
  for (const w of [12, 16, 20, 24]) {
    const kp = layout(text, { widthEm: w });
    const gr = greedyLayout(kp.nodes, [w * 16], 16);
    for (const l of gr.lines.slice(0, -1)) {
      assert.ok(l.contentWidth <= w + 1e-6, `greedy line ${l.index} is ${l.contentWidth}em wide at ${w}em`);
    }
  }
});

test('greedy is deterministic and monotone in line count', () => {
  const text = '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽。';
  const kp = layout(text, { widthEm: 20 });
  const a = greedyLayout(kp.nodes, [20 * 16], 16);
  const b = greedyLayout(kp.nodes, [20 * 16], 16);
  assert.deepEqual(a.lines.map((l) => l.text), b.lines.map((l) => l.text));
  const wider = greedyLayout(kp.nodes, [40 * 16], 16);
  assert.ok(wider.lines.length <= a.lines.length, 'a wider measure cannot need more lines');
});

test('greedy shares the node list with the optimal solver', () => {
  // Same nodes in, only the policy differs — this is what makes the comparison
  // in the README honest.
  const text = '本产品支持批量导出图片并自动压缩20%大小。';
  const kp = layout(text, { widthEm: 17.5 });
  const gr = greedyLayout(kp.nodes, [17.5 * 16], 16);
  assert.equal(strip(gr.lines.map((l) => l.text).join('')), strip(text));
});

test('greedy also respects kinsoku, because it uses the same node model', () => {
  const text = '他说：「好的。」然后头也不回地离开了。我问：“真的吗？”';
  for (const w of [10, 12, 14, 16]) {
    const kp = layout(text, { widthEm: w });
    const gr = greedyLayout(kp.nodes, [w * 16], 16);
    assert.equal(countKinsokuViolations(gr.lines).count, 0, `greedy broke kinsoku at ${w}em`);
  }
});
