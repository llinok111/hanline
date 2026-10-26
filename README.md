# hanline

**Knuth–Plass optimal line breaking for Chinese, Japanese and Korean text.**

`hanline` takes the paragraph-breaking solver from [bramstein/typeset](https://github.com/bramstein/typeset) — a faithful JavaScript port of the Knuth–Plass algorithm that TeX uses — and gives it what it never had: a CJK line model. Chinese has no inter-word spaces, so TeX's glue has nothing to stretch and the upstream solver cannot set a Chinese paragraph at all.

```
在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽。
├─ upstream typeset ─────────────►  0 lines (paragraph is one indivisible box)
└─ hanline ──────────────────────►  3 lines, badness 0.0, kinsoku violations 0
```

## Why this exists

The gap is not a matter of taste; it is measurable at the forked commit `48ebb55`:

| Check | Result |
|---|---|
| `grep -rniE "cjk\|chinese\|japanese\|korean\|kinsoku" src/ lib/` | no matches |
| `src/formatter.js` word split | `text.match(/\S+/g)` — a Chinese paragraph yields **one** token |
| Upstream `linebreak()` on a 136-character Chinese paragraph | **`breaks.length === 0`** — the demo prints "Paragraph can not be set with the given tolerance." |
| Upstream test suite | **none** (`test/` does not exist) |

Meanwhile every off-the-shelf CJK wrapper in the ecosystem — Fabric.js `_wrapLine`, `canvas-textbox`, the common `measureText` accumulation loop — uses **greedy** first-fit: walk characters until the width overflows, then break. Greedy is locally reasonable and globally poor: it cannot see that breaking one character earlier would have let the next three lines fit evenly.

`hanline` does two things:

1. **Gives the solver a CJK node model.** Every legal break becomes a zero-width glue carrying a little stretch and shrink; full-width commas and periods shed their blank right half at a line end; Han/Latin boundaries get an optical quarter-em.
2. **Keeps greedy around as a baseline**, on the *same node list*, so the quality claim is falsifiable rather than asserted.

## Install and run

No build step, no dependencies. Node ≥ 18.17.

```bash
git clone https://github.com/llinok111/hanline.git
cd hanline
node bin/hanline.mjs --text "在古老的时代，当许愿还能实现的时候，有一位国王。" --width 18
```

```
width 18.00em (288px), 2 lines
  1 +  0.83  18.00/18.00em │ 在古老的时代，当许愿还能实现的时候，
  2    0.00   5.50/18.00em │ 有一位国王。

  lines=2  badness=57.9  worstRatio=0.83  widthSD=0.000  lastFill=0.31
  kinsokuViolations=0  overflowLines=0
```

Compare against greedy on the identical nodes:

```bash
node bin/hanline.mjs --file article.txt --width 17.5 --compare
```

Machine-readable, and usable as a CI gate:

```bash
node bin/hanline.mjs --file article.txt --width 400px --json
node bin/hanline.mjs --file article.txt --width 24 --check   # exits 1 on any rule violation
```

### As a library

```js
import { layout } from './engine/index.mjs';

const result = layout(text, {
  widthEm: 24,       // or width: 384 (px)
  em: 16,
  measure: (s) => ctx.measureText(s).width,  // optional: real font metrics
});

result.lines.forEach(l => {
  console.log(l.text, l.ratio, l.width, l.fill);
});
// result.metrics: { totalBadness, worstRatio, widthSD, lastLineFill,
//                   kinsokuViolations, overflowLines, lineCount }
```

Pass `measure` when you have a real font (canvas, `opentype.js`, a PDF engine). Omit it and the module uses a Unicode-based fallback: full-width 1em, Latin 0.5em, space 0.25em.

### Browser

`demo/index.html` is fully self-contained (92 KiB, zero network requests). Open it from `file://` — no server needed. It renders the same paragraph twice, once through the optimal solver and once through greedy, with per-line ratios in the gutter.

## What the numbers actually are

Measured by `npm run bench` on the eight-paragraph corpus in `scripts/bench.mjs`, fourteen widths from 10em to 40em, Node 22 on Windows. **Both engines consume the same node list** — only the break policy differs.

| | Knuth–Plass | greedy |
|---|---|---|
| cases evaluated | 99 feasible (+13 fallback) | 99 |
| strictly lower badness | **42** | 1 |
| identical badness | 56 | 56 |
| **median badness** | **21.09** | **123.00** |
| mean badness | 1 390.92 | 250 439.16 |
| perfect fits (badness 0) | 20 | 20 |

The mean is dominated by a handful of cases where greedy's line lands far short of the measure and has almost no stretch left to absorb the gap; the median (83% lower) is the honest summary. The single case where greedy wins is reported below rather than hidden.

Solver cost, median of 9 runs on the same machine, 932 nodes / 726 characters:

```
buildNodes + solve (layout)   0.94 ms
solve only, Knuth-Plass       0.18 ms   (min 0.16, max 0.72)
solve only, greedy            0.20 ms   (min 0.09, max 0.34)
```

The optimal solver is **not** meaningfully slower than greedy at this scale. Knuth–Plass is O(n·|active|) with the active list bounded by tolerance, and the greedy path pays for chunk construction.

## Correctness

```
$ npm test
# tests 68   # pass 68   # fail 0

$ node scripts/verify.mjs
checked 120 (text,width) combinations
hard failures (glyph loss / forbidden break / over-width): 0
KP fallback to greedy: 16
overfull boxes (unbreakable run wider than measure): 5
badness vs greedy — KP better: 44, tie-or-worse: 60
```

`verify.mjs` asserts, for 8 corpus paragraphs × 15 widths: no glyph lost or duplicated, no line starting with `，。、；：？！）〕］｝〉》」』】”’` and no line ending with `（〔［｛〈《「『【“‘`, and no line wider than the measure except an overfull box.

## How it works

The whole design rests on one rule that the upstream solver makes unavoidable: **`linebreak()` treats every glue node as a break opportunity**. There is no "glue but don't break here" node. So:

- A place that may break gets exactly **one** glue, carrying every gap that belongs there (closer tail + Han/Latin gap + paragraph elasticity).
- A place that must not break gets **no glue at all**; its width is folded into the adjacent box.
- Adjacent glue is **merged**, because TeX merges it and because two glue nodes in a row create a zero-width chunk between two break points that then breaks every width subtraction downstream.

Widths come from three places, all of them real typographic quantities rather than tuning knobs:

| Source | Model | Reference |
|---|---|---|
| Break opportunity | glue 0 width, ±0.04em | JIS X 4051 行の調整処理 |
| Full-width `，。、；：` at line end | ink at 0.5em, tail 0.5em of shrink | CLREQ 3.1.6 punctuation squeezing |
| Han ↔ Latin boundary | glue 0.25em, ±1/12em | 盘古之白 / `text-spacing` |

`？` `！` `…` `—` are closers but deliberately **not** squeezable: their glyphs fill the em box, and dropping half of it would clip them. `…` and `—` are also forced to 1em despite Unicode marking them East Asian Width "Ambiguous" — GB/T 15834 sets the ellipsis and dash at two full characters, and treating them as half-width silently shortens every line containing them.

## Known limitations

These are measured, not hedged.

1. **Narrow measures can be infeasible.** A 21-character filename inside a 10em column leaves no legal break sequence. `layout()` falls back to greedy and says so (`feasible: false`, `fallback: 'greedy'`); `--check` exits 1. 16 of 120 verify combinations hit this. Raising `stretch` past 0.04em reduces it at the cost of looser tracking.
2. **`maxTolerance` bounds the search.** Ratio must stay ≤ tolerance (default 3, escalated to 7). Beyond that the solver refuses rather than emitting 0.8em letter-spacing.
3. **The upstream solver is not strictly globally optimal.** In `long-word@28em` it returns badness 18.34 while greedy — on the *same nodes*, at *every* tolerance from 1 to 20 — returns 16.99. The lower-demerits solution exists in the search space and is never found. This points at the active-node bookkeeping around the `TODO` in `src/linebreak.js:209`; it is upstream's issue, not something this fork changed.
4. **No hyphenation for Latin inside CJK.** Upstream ships Hypher with en-US patterns and `formatter.js` uses it, but the CJK node builder does not — a long Latin token is indivisible. This is why limitation 1 exists.
5. **No vertical writing**, and no character-grid justification (均等割) beyond uniform glue.

## What changed relative to upstream

`src/`, `lib/` and `examples/` are **byte-identical** to `bramstein/typeset@48ebb55`. Their sha256 is recorded in `engine/_upstream.generated.mjs` and re-checked by `test/upstream.test.mjs`, so `git log -- src/linebreak.js` still shows only upstream commits.

New in `engine/`: `chars.mjs` (classification + widths), `nodes.mjs` (the CJK model — the actual work), `index.mjs` (API), `metrics.mjs`, `greedy.mjs` (baseline). Plus `bin/`, `demo/`, `test/`, `scripts/`.

Upstream English behaviour is pinned by regression tests: the same paragraph still lays out in 5 lines at 384px, still produces 52 boxes, and still produces the English line count it did before any of this code existed. The original upstream README is preserved as `README.upstream.md`.

## License

BSD-2-Clause, same as upstream. `LICENSE` is upstream's text, unmodified. `NOTICE` records the fork point, which files are verbatim, and which are new. The upstream copyright notice (Bram Stein) is retained.

## Reproducing everything above

```bash
npm test                 # 68 assertions
node scripts/verify.mjs  # 120-combination correctness sweep
node scripts/bench.mjs   # the quality and timing tables
npm run build            # regenerate the ESM wrapper from src/ + lib/
node scripts/build-demo.mjs   # rebuild demo/index.html
```
