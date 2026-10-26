// Reproducible benchmark. Every number this prints is a number the README is
// allowed to quote. Timing is reported as a median over repeated runs because
// a single measurement on a loaded machine can invert the comparison.
import { layout } from '../engine/index.mjs';
import { greedyLayout } from '../engine/greedy.mjs';
import { computeMetrics } from '../engine/metrics.mjs';
import { linebreak } from '../engine/nodes.mjs';

const CORPUS = [
  ['narrative', '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽；最小的那个美得连太阳见了都惊讶。国王的城堡旁边有一片幽暗的大森林，森林里有一棵老椴树，树下有一口井。天气很热的时候，国王的孩子就走到森林里去，坐在泉水边；她觉得无聊时，就拿出一个金球，把它抛到空中再接住。'],
  ['technical', '本产品支持批量导出图片并自动压缩20%大小，导出后的文件名为report-2026-final.pdf。如果你需要更高分辨率，请在设置面板中把DPI调整为300，然后重新生成。注意：该功能仅在专业版中可用，试用期为14天。'],
  ['dialogue', '他说：「好的。」然后头也不回地离开了。我问：“真的吗？”他没有回答，只是摆了摆手——那意思大概是“别问了”。'],
  ['long-word', '在微服务架构中，Kubernetes 的 HorizontalPodAutoscaler 会根据 CPU 使用率自动扩缩容；与之配套的 PodDisruptionBudget 则保证滚动更新期间的服务可用性。'],
  ['numbers', '2026 年第三季度营收为 1,284,730.55 元，同比增长 12.7%，环比下降 3.2%；毛利率 41.3%，净利率 8.9%，研发投入占比 15.6%。'],
  ['punctuation', '等等……你确定吗？！这不是——不是我们说好的方案。《实施细则》（2026 修订版）第 3.2 条明确规定：不得「先斩后奏」。'],
  ['mixed', 'Use `npm install` 安装依赖，然后执行 `npm test` 运行测试。如果 CI 报错，请检查 Node 版本（要求 >=18.17.0）以及 package.json 中的 engines 字段。'],
  ['units', '厚度 3.5mm，宽度 120mm，高度 80mm，重量约 250g；工作温度 −20℃~60℃，湿度 ≤85%RH，防护等级 IP67。']
];
const WIDTHS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

let better = 0, tie = 0, worse = 0, feasible = 0, fallback = 0;
let sumKpBad = 0, sumGrBad = 0, kpWinsBad = 0, grWinsBad = 0;
const kpBads = [], grBads = [];
const worseCases = [];
let totalLines = 0;

for (const [name, text] of CORPUS) {
  for (const w of WIDTHS) {
    const kp = layout(text, { widthEm: w });
    if (!kp.feasible) { fallback += 1; continue; }
    feasible += 1;
    const gr = greedyLayout(kp.nodes, [w * 16], 16);
    const gm = computeMetrics(gr.lines, w, 0);
    const kb = kp.metrics.totalBadness;
    const gb = gm.totalBadness;
    sumKpBad += kb;
    sumGrBad += gb;
    kpBads.push(kb);
    grBads.push(gb);
    totalLines += kp.lines.length;
    if (kb < gb - 1e-9) { better += 1; kpWinsBad += gb - kb; }
    else if (Math.abs(kb - gb) <= 1e-9) tie += 1;
    else { worse += 1; grWinsBad += kb - gb; worseCases.push({ name, w, kb, gb, kpLines: kp.lines.length, grLines: gr.lines.length }); }
  }
}

console.log('=== quality (same node list, only break policy differs) ===');
console.log(`cases: ${feasible} feasible, ${fallback} fallback`);
console.log(`KP better: ${better}   tie: ${tie}   greedy better: ${worse}`);
console.log(`mean badness  KP ${(sumKpBad / feasible).toFixed(2)}   greedy ${(sumGrBad / feasible).toFixed(2)}`);
console.log(`aggregate badness reduction: ${(((sumGrBad - sumKpBad) / sumGrBad) * 100).toFixed(1)}%  (mean-driven, sensitive to outliers)`);
console.log(`median badness  KP ${median(kpBads).toFixed(2)}   greedy ${median(grBads).toFixed(2)}`);
console.log(`cases with badness 0 (perfect fit): KP ${kpBads.filter((x) => x === 0).length}  greedy ${grBads.filter((x) => x === 0).length}`);
if (worse) {
  console.log('cases where greedy had lower badness:');
  for (const c of worseCases) {
    console.log(`  ${c.name}@${c.w}em  KP ${c.kb.toFixed(2)} (${c.kpLines} lines) vs greedy ${c.gb.toFixed(2)} (${c.grLines} lines)`);
  }
}

// --- timing -----------------------------------------------------------------
const LONG = CORPUS.map(([, t]) => t).join('');
const REPS = 9;
const timeIt = (fn) => {
  const samples = [];
  for (let i = 0; i < REPS; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  return { median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
};

const chars = [...LONG].length;
const built = layout(LONG, { widthEm: 24 });
const nodes = built.nodes;
const solvedKp = layout(LONG, { widthEm: 24 });

// Split the two costs so the comparison is like-for-like: node construction is
// shared by both policies and must not be charged to the optimal solver alone.
const buildTime = timeIt(() => layout(LONG, { widthEm: 24 }));
const solveTimeKp = timeIt(() => linebreak(nodes, [24 * 16], { tolerance: 3 }));
const solveTimeGr = timeIt(() => greedyLayout(nodes, [24 * 16], 16));

console.log(`\n=== timing (median of ${REPS} runs, same machine) ===`);
console.log(`corpus: ${chars} chars, ${totalLines} lines over ${feasible} cases, ${nodes.length} nodes`);
console.log(`buildNodes + solve (layout)  ${buildTime.median.toFixed(2)} ms`);
console.log(`solve only, Knuth-Plass     ${solveTimeKp.median.toFixed(2)} ms  (min ${solveTimeKp.min.toFixed(2)}, max ${solveTimeKp.max.toFixed(2)})`);
console.log(`solve only, greedy          ${solveTimeGr.median.toFixed(2)} ms  (min ${solveTimeGr.min.toFixed(2)}, max ${solveTimeGr.max.toFixed(2)})`);
console.log(`solver ratio                ${(solveTimeKp.median / solveTimeGr.median).toFixed(2)}x slower than greedy`);
console.log(`per-character cost          ${(buildTime.median / chars * 1000).toFixed(1)} µs/char (build+solve)`);
void solvedKp;
