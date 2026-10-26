// Batch correctness harness. Every layout claim in the README has to survive
// this: no dropped glyphs, no forbidden breaks, no line over the target width.
import { layout } from '../engine/index.mjs';
import { greedyLayout } from '../engine/greedy.mjs';
import { countKinsokuViolations, computeMetrics } from '../engine/metrics.mjs';

const CORPUS = [
  ['narrative', '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽；最小的那个美得连太阳见了都惊讶。国王的城堡旁边有一片幽暗的大森林，森林里有一棵老椴树，树下有一口井。天气很热的时候，国王的孩子就走到森林里去，坐在泉水边；她觉得无聊时，就拿出一个金球，把它抛到空中再接住。'],
  ['technical', '本产品支持批量导出图片并自动压缩20%大小，导出后的文件名为report-2026-final.pdf。如果你需要更高分辨率，请在设置面板中把DPI调整为300，然后重新生成。注意：该功能仅在专业版中可用，试用期为14天。'],
  ['dialogue', '他说：「好的。」然后头也不回地离开了。我问：“真的吗？”他没有回答，只是摆了摆手——那意思大概是“别问了”。'],
  ['long-word', '在微服务架构中，Kubernetes 的 HorizontalPodAutoscaler 会根据 CPU 使用率自动扩缩容；与之配套的 PodDisruptionBudget 则保证滚动更新期间的服务可用性。'],
  ['numbers', '2026 年第三季度营收为 1,284,730.55 元，同比增长 12.7%，环比下降 3.2%；毛利率 41.3%，净利率 8.9%，研发投入占比 15.6%。'],
  ['punctuation-heavy', '等等……你确定吗？！这不是——不是我们说好的方案。《实施细则》（2026 修订版）第 3.2 条明确规定：不得「先斩后奏」。'],
  ['mixed-latin', 'Use `npm install` 安装依赖，然后执行 `npm test` 运行测试。如果 CI 报错，请检查 Node 版本（要求 >=18.17.0）以及 package.json 中的 engines 字段。'],
  ['digits-units', '厚度 3.5mm，宽度 120mm，高度 80mm，重量约 250g；工作温度 −20℃~60℃，湿度 ≤85%RH，防护等级 IP67。']
];

const WIDTHS = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40];
const strip = (s) => s.replace(/\s+/g, '');

let checked = 0, kpFail = 0, fallbacks = 0, wins = 0, ties = 0, overfull = 0;
const problems = [];

for (const [name, text] of CORPUS) {
  const original = strip(text);
  for (const widthEm of WIDTHS) {
    checked += 1;
    const kp = layout(text, { widthEm, em: 16 });
    if (!kp.feasible) fallbacks += 1;

    const joined = strip(kp.lines.map((l) => l.text).join(''));
    if (joined !== original) {
      kpFail += 1;
      problems.push(`${name}@${widthEm}: glyph loss (orig=${original.length} got=${joined.length})`);
      continue;
    }
    const kv = countKinsokuViolations(kp.lines);
    if (kv.count > 0) {
      kpFail += 1;
      problems.push(`${name}@${widthEm}: kinsoku ${JSON.stringify(kv.detail)}`);
    }
    // A single unbreakable run wider than the measure cannot be laid out
    // legally. TeX reports it as an overfull box and carries on; so do we, but
    // it must be counted, and no *other* line may exceed the measure.
    let maxUnit = 0, runW = 0;
    for (const n of kp.nodes) {
      if (n.type === 'box') runW += n.width;
      else if (n.type === 'glue') { maxUnit = Math.max(maxUnit, runW); runW = 0; }
    }
    maxUnit = Math.max(maxUnit, runW) / 16;
    const over = kp.lines.filter((l) => l.width > widthEm + 1e-6);
    if (over.length) {
      if (widthEm < maxUnit - 1e-6) {
        overfull += over.length;
        if (kp.metrics.overflowLines < over.length) {
          kpFail += 1;
          problems.push(`${name}@${widthEm}: overfull lines not reported by metrics`);
        }
      } else {
        kpFail += 1;
        problems.push(`${name}@${widthEm}: ${over.length} line(s) over width, worst=${Math.max(...over.map((l) => l.width)).toFixed(3)}, maxUnit=${maxUnit.toFixed(2)}`);
      }
    }
    // greedy comparison on the identical node list
    const gr = greedyLayout(kp.nodes, [widthEm * 16], 16);
    const gm = computeMetrics(gr.lines, widthEm, 0);
    const kb = kp.metrics.totalBadness ?? Infinity;
    if (!kp.feasible) continue;
    if (kb < gm.totalBadness - 1e-9) wins += 1;
    else ties += 1;
  }
}

console.log(`checked ${checked} (text,width) combinations`);
console.log(`hard failures (glyph loss / forbidden break / over-width): ${kpFail}`);
console.log(`KP fallback to greedy: ${fallbacks}`);
console.log(`overfull boxes (unbreakable run wider than measure): ${overfull}`);
console.log(`badness vs greedy — KP better: ${wins}, tie-or-worse: ${ties}`);
if (problems.length) {
  console.log('\n--- problems ---');
  problems.slice(0, 20).forEach((p) => console.log('  ' + p));
  process.exitCode = 1;
} else {
  console.log('OK');
}
