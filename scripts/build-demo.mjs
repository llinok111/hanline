// Bundle the ESM engine into one classic script so demo/index.html works from
// file:// with no server and no build step at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Dependency order matters: chars has no deps, nodes needs Typeset, index needs
// everything.
const MODULES = [
  'engine/chars.mjs',
  'engine/_upstream.generated.mjs',
  'engine/nodes.mjs',
  'engine/metrics.mjs',
  'engine/greedy.mjs',
  'engine/index.mjs'
];

const stripModuleSyntax = (src) => src
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s+from\s+[^;]*;\s*$/gm, '')
  .replace(/^export\s+(function|const|let|class)\b/gm, '$1');

const parts = MODULES.map((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return `// ---- ${rel} ----\n${stripModuleSyntax(src)}`;
});

const engineBundle = `
(function () {
'use strict';
${parts.join('\n')}

window.hanline = {
  layout, toPlainText, buildNodes, canBreakBetween, segment,
  greedyLayout, chunkify, computeMetrics, countKinsokuViolations, badnessOf,
  KIND, classify, defaultWidth, TABLES
};
})();
`;

const template = fs.readFileSync(path.join(ROOT, 'demo/template.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'demo/app.js'), 'utf8');

const out = template
  .replace('/*__ENGINE__*/', () => engineBundle)
  .replace('/*__APP__*/', () => app);

// Normalise to LF so the output is identical whether the sources were checked
// out on Windows (CRLF working tree) or Linux, and so CI's drift check works.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const normalised = out.split(CR + LF).join(LF);

const target = path.join(ROOT, 'demo/index.html');
fs.writeFileSync(target, normalised, 'utf8');
console.log(`wrote ${path.relative(ROOT, target)} (${(fs.statSync(target).size / 1024).toFixed(1)} KiB)`);
