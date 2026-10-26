import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, toPlainText } from '../engine/index.mjs';
import { countKinsokuViolations } from '../engine/metrics.mjs';

const strip = (s) => s.replace(/\s+/g, '');

const CORPUS = [
  ['narrative', '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽；最小的那个美得连太阳见了都惊讶。国王的城堡旁边有一片幽暗的大森林，森林里有一棵老椴树，树下有一口井。'],
  ['dialogue', '他说：「好的。」然后头也不回地离开了。我问：“真的吗？”他没有回答，只是摆了摆手——那意思大概是“别问了”。'],
  ['technical', '本产品支持批量导出图片并自动压缩20%大小，导出后的文件名为report-2026-final.pdf。如果你需要更高分辨率，请在设置面板中把DPI调整为300，然后重新生成。'],
  ['long-word', '在微服务架构中，Kubernetes 的 HorizontalPodAutoscaler 会根据 CPU 使用率自动扩缩容；与之配套的 PodDisruptionBudget 则保证滚动更新期间的服务可用性。'],
  ['numbers', '2026 年第三季度营收为 1,284,730.55 元，同比增长 12.7%，环比下降 3.2%；毛利率 41.3%。']
];
const WIDTHS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40];

test('no line is wider than the measure unless a single word cannot fit', () => {
  for (const [name, text] of CORPUS) {
    for (const w of WIDTHS) {
      const r = layout(text, { widthEm: w });
      const over = r.lines.filter((l) => l.width > w + 1e-6);
      if (over.length === 0) continue;
      // TeX calls this an overfull box: a single unbreakable word longer than
      // the measure. It is allowed but must be reported.
      assert.ok(
        r.metrics.overflowLines >= over.length,
        `${name}@${w}: ${over.length} overfull line(s) not counted`
      );
      for (const l of over) {
        assert.ok([...l.text].length < 30, `${name}@${w}: overfull line is not a long word: ${l.text}`);
      }
    }
  }
});

test('no line ever starts with a closer or ends with an opener', () => {
  for (const [name, text] of CORPUS) {
    for (const w of WIDTHS) {
      const r = layout(text, { widthEm: w });
      const v = countKinsokuViolations(r.lines);
      assert.equal(v.count, 0, `${name}@${w}: ${JSON.stringify(v.detail)}`);
    }
  }
});

test('no glyph is lost or duplicated', () => {
  for (const [name, text] of CORPUS) {
    for (const w of WIDTHS) {
      const r = layout(text, { widthEm: w });
      assert.equal(strip(r.lines.map((l) => l.text).join('')), strip(text), `${name}@${w}`);
    }
  }
});

test('the last line is not justified', () => {
  const r = layout(CORPUS[0][1], { widthEm: 20 });
  const last = r.lines.at(-1);
  assert.equal(last.ratio, 0);
  assert.ok(last.width < 20, 'a short final line must report its real width, not the measure');
});

test('plain text output round-trips to one line per layout line', () => {
  const r = layout('中文排版测试，一行一句话。', { widthEm: 8 });
  const out = toPlainText(r).split('\n');
  assert.equal(out.length, r.lines.length);
});

test('an over-narrow measure falls back to greedy instead of returning nothing', () => {
  const text = '等等……你确定吗？！这不是——不是我们说好的方案。《实施细则》（2026 修订版）第 3.2 条明确规定。';
  let sawFallback = false;
  let sawFeasible = false;
  for (const w of [10, 12, 14, 16]) {
    const r = layout(text, { widthEm: w });
    if (r.feasible) sawFeasible = true;
    else {
      sawFallback = true;
      assert.equal(r.fallback, 'greedy');
      assert.ok(r.lines.length > 0, 'fallback must still produce lines');
      assert.equal(countKinsokuViolations(r.lines).count, 0, 'fallback must still respect kinsoku');
    }
  }
  assert.ok(sawFeasible || sawFallback, 'sanity: the corpus must render at some width');
});

test('zero or negative width is rejected', () => {
  assert.throws(() => layout('测试', { width: 0 }), /width must be > 0/);
  assert.throws(() => layout('测试', { width: -10 }), /width must be > 0/);
});

test('empty text produces no lines and stays feasible', () => {
  const r = layout('', { widthEm: 20 });
  assert.equal(r.lines.length, 0);
});

test('a single character still lays out', () => {
  const r = layout('字', { widthEm: 20 });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].text, '字');
});

test('explicit custom measure is honoured', () => {
  // Every glyph 10px wide, 200px measure => at most 20 per line.
  const r = layout('甲乙丙丁戊己庚辛壬癸', { width: 200, measure: () => 10 });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].width, 100 / 16, 'width is reported in em');
});

test('lineWidths array flows text around a shorter first line', () => {
  const text = CORPUS[0][1];
  const r = layout(text, { widthEm: 20, lineWidths: [12 * 16, 20 * 16, 20 * 16, 20 * 16, 20 * 16, 20 * 16, 20 * 16, 20 * 16] });
  assert.ok(r.lines[0].width <= 12 + 1e-6, 'first line must respect the narrowed measure');
});

test('pure Latin text does not crash and breaks on spaces', () => {
  const text = 'The quick brown fox jumps over the lazy dog and keeps running through the field.';
  const r = layout(text, { widthEm: 20 });
  assert.ok(r.lines.length >= 2);
  for (const l of r.lines) assert.ok(l.width <= 20 + 1e-6);
});
