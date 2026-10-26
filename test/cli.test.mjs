import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/hanline.mjs');
const TEXT = '在古老的时代，当许愿还能实现的时候，有一位国王，他的女儿们都很美丽。';

const run = (args, input) => {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      input: input ?? '',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
};

test('lays out text and prints one line per output line', () => {
  const r = run(['--text', TEXT, '--width', '20', '--quiet']);
  assert.equal(r.code, 0);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.length >= 2, `expected several lines, got ${lines.length}`);
  assert.ok(lines.every((l) => l.length <= 21));
});

test('--json is machine readable and carries metrics', () => {
  const r = run(['--text', TEXT, '--width', '20', '--json']);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.feasible, true);
  assert.ok(Array.isArray(payload.lines));
  assert.equal(payload.metrics.kinsokuViolations, 0);
  assert.equal(typeof payload.metrics.totalBadness, 'number');
});

test('--compare reports both engines on identical nodes', () => {
  const r = run(['--text', TEXT, '--width', '17.5', '--json', '--compare']);
  const payload = JSON.parse(r.stdout);
  assert.ok(payload.greedy, 'greedy block missing');
  assert.equal(payload.greedy.lines.length > 0, true);
  assert.ok(payload.greedy.metrics.totalBadness >= 0);
});

test('--check exits 1 when the measure forces a fallback', () => {
  // 8em with a 21-character filename inside: no feasible optimal solution.
  const text = '导出后的文件名为report-2026-final.pdf，请检查。';
  const r = run(['--text', text, '--width', '8', '--check', '--quiet']);
  assert.equal(r.code, 1, 'a degraded layout must fail the gate');
});

test('--check exits 0 on a clean layout', () => {
  const r = run(['--text', TEXT, '--width', '20', '--check', '--quiet']);
  assert.equal(r.code, 0);
});

test('invalid width exits 2', () => {
  const r = run(['--text', TEXT, '--width', 'nope']);
  assert.equal(r.code, 2);
});

test('reads from stdin when no --text/--file is given', () => {
  const r = run(['--width', '10', '--quiet'], '测试文本，用于验证标准输入通路。');
  assert.equal(r.code, 0);
  assert.ok(r.stdout.trim().length > 0);
});

test('--widths sweeps several measures', () => {
  const r = run(['--text', TEXT, '--widths', '12,16,20']);
  assert.equal(r.code, 0);
  const rows = r.stdout.trim().split('\n').slice(1);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => /^\d+\s+\d+/.test(row)));
});

test('accepts a px suffix without --px', () => {
  const r = run(['--text', TEXT, '--width', '320px', '--quiet']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.trim().split('\n').length >= 2);
});
