// Public API: lay out a CJK paragraph with Knuth-Plass optimal breaking.
import { buildNodes, linebreak } from './nodes.mjs';
import { computeMetrics } from './metrics.mjs';
import { greedyLayout } from './greedy.mjs';
import { KIND } from './chars.mjs';

const DEFAULT = {
  em: 16,
  widthEm: 24,
  // Per-break elasticity in em. 0.04em ≈ 4% of a character: enough to absorb
  // the ragged edge that 1/4-em punctuation tails leave behind, small enough
  // that a stretched line still reads as normal tracking.
  stretch: 0.04,
  shrink: 0.04,
  squeeze: 0.5,
  latinGap: 0.25,
  tolerance: 3,
  maxTolerance: 7,
  punctuationSqueezing: true
};

/**
 * Walk a solved break list and materialise line contents.
 * Mirrors examples/article/index.html so the numbers match what the upstream
 * demo would draw, but computes width from the actual glue model instead of
 * re-measuring text.
 */
function materialise(nodes, breaks, lineWidths, em) {
  const lines = [];
  let lineStart = 0;
  const lastBreakIndex = breaks.length - 1;
  for (let i = 1; i < breaks.length; i += 1) {
    const end = breaks[i].position;
    const isLast = i === lastBreakIndex;
    // The paragraph-fill glue has effectively infinite stretch, so its ratio is
    // a vanishing number that would still multiply out to the full measure.
    // The last line is never *stretched*, but it must still be allowed to
    // shrink: if its content is wider than the measure, refusing to compress
    // would emit an overfull line that the solver had already accounted for.
    const rawRatio = breaks[i].ratio;
    const ratio = isLast ? Math.min(rawRatio, 0) : rawRatio;

    for (let j = lineStart; j < nodes.length; j += 1) {
      const n = nodes[j];
      if (n.type === 'box' || (n.type === 'penalty' && n.penalty === -linebreak.infinity)) {
        lineStart = j;
        break;
      }
    }

    let width = 0;
    let natural = 0;
    const parts = [];
    for (let j = lineStart; j < end; j += 1) {
      const n = nodes[j];
      if (n.type === 'box') {
        width += n.width;
        natural += n.width;
        parts.push(n.value ?? '');
      } else if (n.type === 'glue') {
        natural += n.width;
        width += n.width + ratio * (ratio < 0 ? n.shrink : n.stretch);
        if (n.value) parts.push(n.value);
      }
    }
    // A break at a penalty keeps the penalty's width (usually 0); a break at a
    // glue discards that glue entirely, which is exactly how a trailing 全角
    // comma sheds its blank half.
    let discardedGlue = 0;
    if (nodes[end] && nodes[end].type === 'penalty') width += nodes[end].width;
    if (nodes[end] && nodes[end].type === 'glue') discardedGlue = nodes[end].width;

    const target = lineWidths[i - 1] ?? lineWidths[lineWidths.length - 1];
    lines.push({
      index: i - 1,
      text: parts.join(''),
      // `width` is the geometric result after glue adjustment. For the last
      // line the paragraph-fill glue has effectively infinite stretch, so
      // `width` equals the target even though the line is visually ragged.
      // `contentWidth` is what the glyphs actually occupy — that is the number
      // to judge fill and overflow by.
      width: width / em,
      contentWidth: natural / em,
      naturalWidth: natural / em,
      target: target / em,
      ratio,
      fill: target > 0 ? natural / target : 1,
      discardedGlue: discardedGlue / em
    });
    lineStart = end;
  }
  return lines;
}

/**
 * Lay out one paragraph.
 *
 * @param {string} text
 * @param {object} [options] see DEFAULT above plus:
 * @param {number} [options.width] line width in px (overrides widthEm)
 * @param {(ch: string) => number} [options.measure] advance width of a run, in px
 * @returns {{lines: object[], metrics: object, feasible: boolean, nodes: object[]}}
 */
export function layout(text, options = {}) {
  const opts = { ...DEFAULT, ...options };
  const em = opts.em;
  const widthPx = options.width != null ? options.width : opts.widthEm * em;
  if (!(widthPx > 0)) throw new Error('width must be > 0');

  const { nodes, glyphs } = buildNodes(text, {
    em,
    stretch: opts.stretch,
    shrink: opts.shrink,
    squeeze: opts.squeeze,
    latinGap: opts.latinGap,
    measure: opts.measure,
    punctuationSqueezing: opts.punctuationSqueezing
  });

  const lineWidths = Array.isArray(opts.lineWidths) ? opts.lineWidths : [widthPx];

  // A blank paragraph has no material to break; the solver would happily return
  // one zero-width line for it, which then shows up as an empty entry in
  // callers' line arrays.
  if (glyphs.length === 0) {
    return {
      lines: [],
      metrics: {
        lineCount: 0, feasible: true, totalBadness: 0, worstRatio: 0,
        widthSD: 0, lastLineFill: 0, overflowLines: 0,
        kinsokuViolations: 0, chars: 0
      },
      feasible: true,
      nodes,
      breaks: []
    };
  }

  const breaks = linebreak(nodes, lineWidths, {
    tolerance: opts.tolerance,
    maxTolerance: opts.maxTolerance
  });

  if (breaks.length === 0) {
    // No break sequence satisfies the tolerance ladder. That is a real limit,
    // not a bug: a 3em unbreakable run inside a 14em measure leaves the line
    // 2em short with only a handful of 0.04em glue slots to absorb it.
    // Returning nothing would force every caller to write a fallback, so fall
    // back here and say so.
    const gr = greedyLayout(nodes, lineWidths, em);
    return {
      lines: gr.lines,
      metrics: { ...computeMetrics(gr.lines, widthPx / em, glyphs.length), feasible: false, fallback: 'greedy' },
      feasible: false,
      fallback: 'greedy',
      reason: 'no-feasible-break-sequence',
      nodes,
      breaks: []
    };
  }

  const raw = materialise(nodes, breaks, lineWidths, em);
  // If the paragraph happens to end on a closable punctuation mark, that mark's
  // trailing glue is itself a legal break point and the solver may take it —
  // which leaves the paragraph-fill glue to form a trailing zero-width "line".
  // TeX does the same thing internally; renderers just never draw it. Drop it
  // rather than let it skew lineCount / lastLineFill.
  const lines = raw.length > 1 && raw[raw.length - 1].text === '' ? raw.slice(0, -1) : raw;
  const metrics = computeMetrics(lines, widthPx / em, glyphs.length);
  return { lines, metrics, feasible: true, nodes, breaks, droppedTrailingLine: raw.length !== lines.length };
}

/** Human-readable rendering, one line per output line. */
export function toPlainText(result) {
  return result.lines.map((l) => l.text).join('\n');
}

export { buildNodes, KIND };
export { canBreakBetween } from './nodes.mjs';
