// Character classification and advance widths for CJK typesetting.
//
// The classification here is deliberately stricter than a generic "is this
// East Asian?" test, because the three decisions that matter downstream are
// different questions:
//
//   1. Is the glyph full-width?          -> advance width
//   2. May a line start with it?         -> 行首禁则 (kinsoku-shori)
//   3. May a line end with it?           -> 行尾禁则
//
// A character can be full-width and still be perfectly legal at a line start
// (a Han ideograph), so width and kinsoku are tracked separately.

/** Full-width (East Asian Width W or F) code point ranges. */
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd], [0x30000, 0x3fffd]
];

// Closing punctuation: must not begin a line. Split in two because only some
// of them carry their ink in the left half of the em box, and only those can
// be squeezed at a line end (CLREQ 3.1.6 / JLReq 3.1).
const SQUEEZABLE_CLOSERS = new Set([
  '\u3001', '\u3002', // 、。
  '\uff0c', '\uff1b', '\uff1a', // ，；：
  '\uff09', '\u3015', '\uff3d', '\uff5d', // ）〕］｝
  '\u3009', '\u300b', '\u300d', '\u300f', '\u3011', '\u3017', '\u3019', '\u301b', // 〉》」』】【〖〙〛
  '\u201d', '\u2019' // ” ’
]);

const RIGID_CLOSERS = new Set([
  '\uff1f', '\uff01', // ？！ — glyph fills the em box, squeezing would clip it
  '\u2026', '\u2014', // …… ——
  '\u00b7', '\u30fb', // ·・
  '%', '\u2030', '\u2103', '\u00b0', '\u2032', '\u2033' // %‰℃°′″
]);

// Opening punctuation: must not end a line.
const OPENERS = new Set([
  '\uff08', '\u3014', '\uff3b', '\uff5b', // （〔［｛
  '\u3008', '\u300a', '\u300c', '\u300e', '\u3010', '\u3016', '\u3018', '\u301a', // 〈《「『【〖〘〚
  '\u201c', '\u2018' // “ ‘
]);

const DASHES = new Set(['\u2014', '\u2015', '\u2026', '\u2500']);

// Punctuation that Unicode classifies as East Asian Width "Ambiguous" but that
// occupies a full em in Chinese typesetting: GB/T 15834 sets the ellipsis at
// two characters (……) and the dash at two (——), and CJK quotation marks are
// full-width. Treating them as half-width silently shrinks every line that
// contains them, which then distorts every ratio the solver reports.
const CJK_FULLWIDTH_PUNCT = new Set([
  '\u2026', '\u2014', '\u2015', '\u00b7', '\u30fb',
  '\u2018', '\u2019', '\u201c', '\u201d'
]);

const isWideCodePoint = (cp) => {
  for (let i = 0; i < WIDE_RANGES.length; i += 1) {
    if (cp >= WIDE_RANGES[i][0] && cp <= WIDE_RANGES[i][1]) return true;
  }
  return false;
};

export const KIND = {
  IDEOGRAPH: 'ideograph', // Han / Kana / Hangul: breakable on both sides
  CLOSER: 'closer',
  OPENER: 'opener',
  LATIN: 'latin', // [A-Za-z0-9] runs and other proportional-script runs
  SPACE: 'space',
  OTHER: 'other'
};

const LATIN_RE = /[A-Za-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff]/;
const PUNCT_RE = /[!-/:-@[-`{-~]/;

/**
 * Classify a single code point.
 * @param {string} ch a single grapheme-ish character
 */
export function classify(ch) {
  if (ch === ' ' || ch === '\t' || ch === '\u3000') return KIND.SPACE;
  if (ch === '\n') return KIND.SPACE;
  if (SQUEEZABLE_CLOSERS.has(ch)) return KIND.CLOSER;
  if (RIGID_CLOSERS.has(ch)) return KIND.CLOSER;
  if (OPENERS.has(ch)) return KIND.OPENER;
  if (LATIN_RE.test(ch)) return KIND.LATIN;
  const cp = ch.codePointAt(0);
  // Anything in the wide ranges that is not punctuation is an ideograph and
  // breaks freely on both sides.
  if (isWideCodePoint(cp)) return KIND.IDEOGRAPH;
  if (PUNCT_RE.test(ch)) return KIND.LATIN;
  return KIND.OTHER;
}

/**
 * Whether a closer may have its trailing whitespace collapsed at a line end.
 * `，。` etc. are drawn in the left half of a full-width em box, so the tail
 * half can be dropped without touching the ink.
 */
export function isSqueezable(ch) {
  return SQUEEZABLE_CLOSERS.has(ch);
}

export function isDash(ch) {
  return DASHES.has(ch);
}

/**
 * Default advance width in em units, used when the caller does not inject a
 * font measurement function. Full-width = 1em, Latin = 0.5em (approximation
 * for average proportional advance), space = 0.25em.
 */
export function defaultWidth(ch) {
  if (ch === ' ') return 0.25;
  if (ch === '\t') return 1;
  if (ch === '\u3000') return 1;
  if (CJK_FULLWIDTH_PUNCT.has(ch)) return 1;
  if (isWideCodePoint(ch.codePointAt(0))) return 1;
  return 0.5;
}

export const TABLES = { SQUEEZABLE_CLOSERS, RIGID_CLOSERS, OPENERS, DASHES, WIDE_RANGES, CJK_FULLWIDTH_PUNCT };
