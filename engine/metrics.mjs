// Quality metrics for a laid-out paragraph.
//
// Every number here is defined so that it can be recomputed from the line
// list alone — no hidden state, no sampling. That matters because these are
// the numbers the README quotes when it claims Knuth-Plass beats greedy.
import { classify, KIND } from './chars.mjs';

const badnessOf = (ratio) => 100 * Math.pow(Math.abs(ratio), 3);

const stdev = (xs) => {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
};

/**
 * Count lines that begin with closing punctuation or end with opening
 * punctuation. A correct kinsoku implementation reports zero; anything else
 * means the node model let a forbidden break through.
 */
export function countKinsokuViolations(lines) {
  let n = 0;
  const detail = [];
  for (const line of lines) {
    const chars = [...line.text];
    if (chars.length === 0) continue;
    const first = chars[0];
    const last = chars[chars.length - 1];
    if (classify(first) === KIND.CLOSER) {
      n += 1;
      detail.push({ line: line.index, at: 'start', ch: first });
    }
    if (classify(last) === KIND.OPENER) {
      n += 1;
      detail.push({ line: line.index, at: 'end', ch: last });
    }
  }
  return { count: n, detail };
}

/**
 * @param {object[]} lines output of materialise()
 * @param {number} targetEm
 * @param {number} glyphCount
 */
export function computeMetrics(lines, targetEm, glyphCount) {
  if (lines.length === 0) {
    return {
      lineCount: 0, feasible: false, totalBadness: null, worstRatio: null,
      widthSD: null, lastLineFill: null, overflowLines: 0,
      kinsokuViolations: 0, chars: glyphCount, meanFill: null
    };
  }
  const body = lines.slice(0, -1);
  const last = lines[lines.length - 1];
  const ratios = body.map((l) => Math.abs(l.ratio));
  const kinsoku = countKinsokuViolations(lines);
  const overflows = lines.filter((l) => l.width > targetEm * (1 + 1e-6)).length;

  return {
    lineCount: lines.length,
    feasible: true,
    // TeX defines badness per line as 100·|r|³; the paragraph total is what the
    // solver actually minimises (through demerits), so we report the same sum.
    totalBadness: body.reduce((s, l) => s + badnessOf(l.ratio), 0),
    worstRatio: ratios.length ? Math.max(...ratios) : 0,
    widthSD: stdev(body.map((l) => l.width)),
    meanFill: body.length ? body.reduce((s, l) => s + l.fill, 0) / body.length : last.fill,
    lastLineFill: last.fill,
    lastLineChars: [...last.text].length,
    overflowLines: overflows,
    kinsokuViolations: kinsoku.count,
    kinsokuDetail: kinsoku.detail,
    chars: glyphCount
  };
}

export { badnessOf, stdev };
