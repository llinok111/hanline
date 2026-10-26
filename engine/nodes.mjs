// Map CJK text onto the box/glue/penalty model that Knuth-Plass expects.
//
// The whole trick of this module is one observation: a Chinese paragraph has
// no inter-word spaces, so TeX's model has nothing to stretch. The spaces that
// *do* exist in real Chinese typesetting are:
//
//   * the blank tail half of a full-width comma/period (CLREQ 3.1.6 lets it be
//     collapsed at a line end)              -> carries shrink
//   * the optional quarter-em gap between Han and Latin (盘古之白)  -> carries width
//   * whatever letter-spacing the typesetter is willing to distribute
//     (JIS X 4051 行の調整処理)             -> carries stretch
//
// One rule dominates the implementation: **only a legal break point may become
// a glue node**. The upstream solver treats every glue as a break opportunity,
// so a glue at a forbidden position is exactly how you get a line starting with
// `。` or ending with `（`. Width that must exist without allowing a break is
// therefore folded into the adjacent box instead.
import { Typeset } from './_upstream.generated.mjs';
import { classify, isSqueezable, defaultWidth, KIND } from './chars.mjs';

const { linebreak } = Typeset;

const graphemeSegmenter = (() => {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return new Intl.Segmenter('zh', { granularity: 'grapheme' });
    }
  } catch { /* older runtimes: fall through */ }
  return null;
})();

/** Split into grapheme clusters so emoji and combining marks stay intact. */
export function segment(text) {
  if (graphemeSegmenter) {
    const out = [];
    for (const { segment: s } of graphemeSegmenter.segment(text)) out.push(s);
    return out;
  }
  return [...text];
}

function makeGlue(width, stretch, shrink, value) {
  const g = linebreak.glue(width, stretch, shrink);
  g.value = value;
  return g;
}

/**
 * Decide whether a line may break between two adjacent glyphs.
 * Exported because it is the single most testable rule in the library.
 */
export function canBreakBetween(prev, cur) {
  if (prev.kind === KIND.OPENER) return false; // 行尾禁则: 「（ never ends a line
  if (cur.kind === KIND.CLOSER) return false; // 行首禁则: 。， never starts a line
  if (prev.kind === KIND.SPACE || cur.kind === KIND.SPACE) return true;
  return true;
}

/** A Han/Latin boundary wants a quarter-em gap whether or not it breaks. */
function wantsLatinGap(prev, cur) {
  const a = prev.kind === KIND.IDEOGRAPH || prev.kind === KIND.CLOSER || prev.kind === KIND.OPENER;
  const b = cur.kind === KIND.LATIN;
  const c = prev.kind === KIND.LATIN;
  const d = cur.kind === KIND.IDEOGRAPH || cur.kind === KIND.OPENER;
  return (a && b) || (c && d);
}

/**
 * Build the node list for one paragraph.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {(ch: string) => number} [options.measure] advance width in px
 * @param {number} [options.em=16] px per em, used when `measure` is absent
 * @param {number} [options.stretch=0.04] em of stretch per break opportunity
 * @param {number} [options.shrink=0.04] em of shrink per break opportunity
 * @param {number} [options.squeeze=0.5] fraction of a closer that survives at line end
 * @param {number} [options.latinGap=0.25] em gap between Han and Latin
 * @param {boolean} [options.punctuationSqueezing=true]
 * @returns {{nodes: object[], glyphs: object[], em: number}}
 */
export function buildNodes(text, options = {}) {
  const em = options.em ?? 16;
  const stretch = options.stretch ?? 0.04;
  const shrink = options.shrink ?? 0.04;
  const squeeze = options.squeeze ?? 0.5;
  const latinGap = options.latinGap ?? 0.25;
  const doSqueeze = options.punctuationSqueezing !== false;
  // `defaultWidth` answers for one code point. Latin runs arrive here as a
  // whole string, so sum per code point — measuring only the first character
  // would make a 21-character filename weigh as much as a single letter.
  const measure = options.measure ?? ((s) => {
    let w = 0;
    for (const ch of s) w += defaultWidth(ch) * em;
    return w;
  });

  const units = segment(text);
  const glyphs = [];
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    const kind = classify(u);
    if (kind === KIND.LATIN) {
      // Merge a whole Latin/number run: `report-2026-final.pdf` is one unit.
      let run = u;
      while (i + 1 < units.length && classify(units[i + 1]) === KIND.LATIN) {
        run += units[++i];
      }
      glyphs.push({ text: run, kind, width: measure(run) });
    } else {
      glyphs.push({ text: u, kind, width: measure(u) });
    }
  }

  const nodes = [];
  // Width that must be present but must NOT become a break opportunity.
  let carry = 0;
  // The droppable tail of the previous closer, not yet assigned to a node.
  let pendingTail = 0;

  const pushGlue = (width, st, sh, value) => {
    const prev = nodes[nodes.length - 1];
    if (prev && prev.type === 'glue') {
      // TeX merges adjacent glue; unmerged pairs create zero-width chunks
      // between two break points and break width bookkeeping downstream.
      prev.width += width;
      prev.stretch += st;
      prev.shrink += sh;
      if (value) prev.value = (prev.value ?? '') + value;
      return;
    }
    nodes.push(makeGlue(width, st, sh, value));
  };

  for (let i = 0; i < glyphs.length; i += 1) {
    const g = glyphs[i];
    const prev = i > 0 ? glyphs[i - 1] : null;

    if (g.kind === KIND.SPACE) {
      // A literal space is its own stretchy glue and its own break point.
      pushGlue(g.width + carry + pendingTail, em * stretch * 4, em * shrink * 4, g.text);
      carry = 0;
      pendingTail = 0;
      continue;
    }

    if (prev) {
      const breakable = canBreakBetween(prev, g);
      const gap = wantsLatinGap(prev, g) ? latinGap * em : 0;
      if (breakable) {
        // Exactly one glue per break point, carrying every gap that belongs here.
        const width = pendingTail + gap + carry;
        if (gap > 0) pushGlue(width, gap / 3, 0, '');
        else pushGlue(width, stretch * em, shrink * em, '');
        carry = 0;
        pendingTail = 0;
      } else {
        carry += pendingTail + gap;
        pendingTail = 0;
      }
    }

    const baseWidth = g.width + carry;
    carry = 0;

    if (g.kind === KIND.CLOSER && doSqueeze && isSqueezable(g.text)) {
      // Ink sits in the left half of the em box; the right half becomes a
      // droppable tail that collapses only when this closer ends a line.
      const tail = g.width * (1 - squeeze);
      nodes.push(linebreak.box(baseWidth - tail, g.text));
      pendingTail = tail;
    } else {
      nodes.push(linebreak.box(baseWidth, g.text));
      pendingTail = 0;
    }
  }

  // Paragraph fill: infinite stretch so the last line is never justified.
  // A trailing closer's tail is deliberately dropped — that is the same
  // punctuation-squeezing rule applied to the final line.
  pushGlue(carry, linebreak.infinity, 0, '');
  nodes.push(linebreak.penalty(0, -linebreak.infinity, 1));

  return { nodes, glyphs, em };
}

export { linebreak };
