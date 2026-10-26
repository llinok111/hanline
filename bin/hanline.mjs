#!/usr/bin/env node
// CLI. Two jobs: lay out a paragraph for a human, and serve as a CI gate that
// fails when a layout breaks a rule we claim to enforce.
import fs from 'node:fs';
import path from 'node:path';
import { layout } from '../engine/index.mjs';
import { greedyLayout } from '../engine/greedy.mjs';
import { computeMetrics } from '../engine/metrics.mjs';

const HELP = `hanline — Knuth-Plass line breaking for CJK

Usage
  hanline --text "文本" --width 24
  hanline --file article.txt --width 400px
  cat article.txt | hanline --width 20

Width
  --width <n>        line width; em units by default (24 ≈ 24 Han characters)
  --px               treat --width as pixels instead
  --em <n>           1em in pixels (default 16)
  --widths <a,b,c>   sweep several widths and print a comparison table

Typography
  --stretch <em>     per-break stretch (default 0.04)
  --shrink <em>      per-break shrink (default 0.04)
  --squeeze <0..1>   surviving fraction of a full-width closer at line end (default 0.5)
  --latin-gap <em>   Han/Latin optical gap (default 0.25)
  --no-squeeze       disable punctuation squeezing
  --tolerance <n>    initial tolerance (default 3)

Output
  --json             machine-readable result
  --compare          also run greedy on the same nodes and diff the metrics
  --quiet            only print the laid-out text
  --check            exit 1 if any kinsoku violation, over-width line, or fallback

Exit codes
  0 ok   1 rule violation   2 usage error
`;

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const key = a.slice(2);
    const takesValue = ['text', 'file', 'width', 'widths', 'em', 'stretch', 'shrink', 'squeeze', 'latin-gap', 'tolerance'];
    if (takesValue.includes(key)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`--${key} needs a value`);
      o[key === 'latin-gap' ? 'latinGap' : key] = v;
      i += 1;
    } else {
      o[key] = true;
    }
  }
  return o;
}

function readInput(args) {
  if (args.text != null) return args.text;
  if (args.file) return fs.readFileSync(path.resolve(args.file), 'utf8');
  if (!process.stdin.isTTY) {
    try { return fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  }
  return null;
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

function printHuman(result, opts, label) {
  const { lines, metrics } = result;
  if (label) console.log(label);
  const w = opts.em;
  lines.forEach((l, i) => {
    const bar = l.ratio < -0.02 ? '−' : l.ratio > 0.02 ? '+' : ' ';
    console.log(
      `${String(i + 1).padStart(3)} ${bar}${fmt(l.ratio).padStart(6)} ` +
      `${fmt(l.width).padStart(6)}/${fmt(l.target)}em │ ${l.text}`
    );
  });
  const m = metrics;
  console.log(
    `\n  lines=${m.lineCount}  badness=${fmt(m.totalBadness, 1)}  ` +
    `worstRatio=${fmt(m.worstRatio)}  widthSD=${fmt(m.widthSD, 3)}  ` +
    `lastFill=${fmt(m.lastLineFill)}`
  );
  console.log(
    `  kinsokuViolations=${m.kinsokuViolations}  overflowLines=${m.overflowLines}` +
    (result.feasible ? '' : `  FALLBACK=${result.fallback}`)
  );
  void w;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }
  if (args.help || args.h) { process.stdout.write(HELP); return; }

  const text = readInput(args);
  if (text == null) {
    console.error('no input: use --text, --file, or pipe text on stdin');
    process.exit(2);
  }

  const em = args.em ? Number(args.em) : 16;
  const px = Boolean(args.px);
  const base = {
    em,
    stretch: args.stretch != null ? Number(args.stretch) : undefined,
    shrink: args.shrink != null ? Number(args.shrink) : undefined,
    squeeze: args.squeeze != null ? Number(args.squeeze) : undefined,
    latinGap: args.latinGap != null ? Number(args.latinGap) : undefined,
    tolerance: args.tolerance != null ? Number(args.tolerance) : undefined,
    punctuationSqueezing: !args['no-squeeze']
  };
  Object.keys(base).forEach((k) => base[k] === undefined && delete base[k]);

  // `--width 320px` is a common slip; accept a px suffix without needing --px.
  const widthOf = (n) => {
    const s = String(n).trim();
    const suffixed = /px$/i.test(s);
    const num = Number(suffixed ? s.replace(/px$/i, '') : s);
    if (!Number.isFinite(num) || num <= 0) {
      console.error(`invalid width: ${s}`);
      process.exit(2);
    }
    return suffixed || px ? num : num * em;
  };

  // Width sweep mode: a table of width vs. quality.
  if (args.widths) {
    const widths = String(args.widths).split(',').map(Number);
    console.log('width  lines  badness  worst  widthSD  kinsoku  fallback');
    for (const w of widths) {
      const r = layout(text, { ...base, width: widthOf(w) });
      const m = r.metrics;
      console.log(
        `${String(w).padEnd(6)} ${String(m.lineCount).padEnd(6)} ` +
        `${fmt(m.totalBadness, 1).padStart(7)}  ${fmt(m.worstRatio).padStart(5)}  ` +
        `${fmt(m.widthSD, 3).padStart(7)}  ${String(m.kinsokuViolations).padStart(7)}  ` +
        `${r.feasible ? '-' : 'yes'}`
      );
    }
    return;
  }

  const width = args.width != null ? widthOf(args.width) : 24 * em;
  const result = layout(text, { ...base, width });

  if (args.json) {
    const payload = {
      feasible: result.feasible,
      fallback: result.fallback ?? null,
      widthPx: width,
      em,
      lines: result.lines.map((l) => ({
        text: l.text, width: l.width, contentWidth: l.contentWidth,
        target: l.target, ratio: l.ratio, fill: l.fill
      })),
      metrics: result.metrics
    };
    if (args.compare) {
      const gr = greedyLayout(result.nodes, [width], em);
      payload.greedy = { lines: gr.lines, metrics: computeMetrics(gr.lines, width / em, 0) };
      payload.greedy.metrics = computeMetrics(gr.lines, width / em, 0);
    }
    console.log(JSON.stringify(payload, null, 2));
  } else if (args.quiet) {
    console.log(result.lines.map((l) => l.text).join('\n'));
  } else {
    printHuman(result, { em }, `width ${fmt(width / em)}em (${width}px), ${result.lines.length} lines`);
    if (args.compare) {
      const gr = greedyLayout(result.nodes, [width], em);
      const gm = computeMetrics(gr.lines, width / em, 0);
      printHuman({ lines: gr.lines, metrics: gm, feasible: true }, { em }, `\ngreedy baseline: ${gr.lines.length} lines`);
      const kpB = result.metrics.totalBadness;
      const grB = gm.totalBadness;
      const rel = grB > 0 ? ((kpB - grB) / grB) * 100 : 0;
      console.log(`\n  badness: KP ${fmt(kpB, 1)} vs greedy ${fmt(grB, 1)}  → ${rel <= 0 ? '' : '+'}${fmt(rel, 1)}%`);
    }
  }

  if (args.check) {
    const m = result.metrics;
    if (!result.feasible || m.kinsokuViolations > 0 || m.overflowLines > 0) process.exit(1);
  }
}

main();
