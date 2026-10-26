(function () {
  'use strict';
  var H = window.hanline;
  var FONT_STACK = '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';

  var DEFAULT_TEXT = '本产品支持批量导出图片并自动压缩20%大小，导出后的文件名为report-2026-final.pdf。如果你需要更高分辨率，请在设置面板中把DPI调整为300，然后重新生成。注意：该功能仅在专业版中可用，试用期为14天。续费用户可享受九折优惠，详情请参阅《服务条款》第 3.2 条。';

  var el = {
    text: document.getElementById('text'),
    width: document.getElementById('width'),
    widthVal: document.getElementById('widthVal'),
    em: document.getElementById('em'),
    emVal: document.getElementById('emVal'),
    squeeze: document.getElementById('squeeze'),
    kp: document.getElementById('kp'),
    gr: document.getElementById('gr'),
    kpNote: document.getElementById('kpNote'),
    grNote: document.getElementById('grNote'),
    kpMetrics: document.getElementById('kpMetrics'),
    grMetrics: document.getElementById('grMetrics')
  };

  el.text.value = DEFAULT_TEXT;

  // A single measuring context, configured once per (font, size) pair.
  var measureCanvas = document.createElement('canvas');
  var measureCtx = measureCanvas.getContext('2d');
  var cachedEm = 0;

  function measure(s) {
    return measureCtx.measureText(s).width;
  }
  function setFont(em) {
    if (cachedEm === em) return;
    cachedEm = em;
    measureCtx.font = em + 'px ' + FONT_STACK;
  }

  var COLORS = {
    ink: '#18181b',
    rule: '#e4e4e7',
    kp: '#1d4ed8',
    gr: '#b45309',
    muted: '#a1a1aa'
  };

  function sizeCanvas(canvas, cssWidth, cssHeight) {
    var dpr = window.devicePixelRatio || 1;
    canvas.style.height = cssHeight + 'px';
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function render(canvas, result, em, accent, measureWidthEm, measurePx) {
    var padX = 56;
    var padY = 22;
    var lineHeight = Math.round(em * 1.85);
    var cssWidth = canvas.parentElement.clientWidth;
    var cssHeight = padY * 2 + Math.max(1, result.lines.length) * lineHeight;
    var ctx = sizeCanvas(canvas, cssWidth, cssHeight);

    ctx.font = em + 'px ' + FONT_STACK;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.ink;

    var nodes = result.nodes;
    var breaks = result.breaks || [];
    if (!breaks.length) {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(result.feasible ? '(no lines)' : '(fallback: greedy)', padX, padY + em);
      return;
    }

    // Draw the measure boundary once, so it is obvious when a line overflows.
    ctx.save();
    ctx.strokeStyle = COLORS.rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(padX + measurePx + 0.5, padY - 4);
    ctx.lineTo(padX + measurePx + 0.5, cssHeight - padY + 6);
    ctx.stroke();
    ctx.restore();

    var lastIdx = breaks.length - 1;
    var lineStart = 0;
    for (var i = 1; i < breaks.length; i += 1) {
      var end = breaks[i].position;
      var isLast = i === lastIdx;
      var raw = breaks[i].ratio;
      var ratio = isLast ? Math.min(raw, 0) : raw;

      for (var j = lineStart; j < nodes.length; j += 1) {
        if (nodes[j].type === 'box' || (nodes[j].type === 'penalty' && nodes[j].penalty === -10000)) {
          lineStart = j;
          break;
        }
      }

      var y = padY + (i - 1) * lineHeight + em;
      var x = padX;
      ctx.fillStyle = COLORS.ink;
      for (var k = lineStart; k < end; k += 1) {
        var n = nodes[k];
        if (n.type === 'box') {
          ctx.fillText(n.value, x, y);
          x += n.width;
        } else if (n.type === 'glue') {
          x += n.width + ratio * (ratio < 0 ? n.shrink : n.stretch);
        }
      }

      // ratio badge lives in the left gutter so it never overlaps the text
      var badge = (ratio > 0 ? '+' : ratio < 0 ? '−' : ' ') + Math.abs(ratio).toFixed(2);
      ctx.save();
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(String(i), padX - 44, y - 2);
      ctx.fillStyle = Math.abs(ratio) > 0.02 ? accent : COLORS.muted;
      ctx.fillText(badge, padX - 10, y - 2);
      ctx.restore();
      ctx.font = em + 'px ' + FONT_STACK;

      // mark the stretch/shrink visually: a hairline under the adjusted run
      if (Math.abs(ratio) > 0.02) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.setLineDash(ratio < 0 ? [2, 3] : []);
        ctx.beginPath();
        ctx.moveTo(padX, y + 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
        ctx.restore();
      }

      lineStart = end;
    }
    void measureWidthEm;
  }

  function metricCells(host, m, warn) {
    var items = [
      ['lines', m.lineCount, false],
      ['badness', m.totalBadness == null ? '—' : m.totalBadness.toFixed(1), warn && (m.totalBadness || 0) > 0],
      ['worst', m.worstRatio == null ? '—' : m.worstRatio.toFixed(2), warn && (m.worstRatio || 0) > 1],
      ['kinsoku', m.kinsokuViolations, m.kinsokuViolations > 0]
    ];
    host.innerHTML = items.map(function (it) {
      return '<div><div class="k">' + it[0] + '</div><div class="v' + (it[2] ? ' bad' : '') + '">' + it[1] + '</div></div>';
    }).join('');
  }

  function run() {
    var text = el.text.value;
    var em = Number(el.em.value);
    var widthEm = Number(el.width.value);
    var squeezing = el.squeeze.checked;

    el.widthVal.textContent = widthEm.toFixed(1) + ' em';
    el.emVal.textContent = em + ' px';

    setFont(em);
    var measurePx = widthEm * em;

    var opts = {
      em: em,
      width: measurePx,
      measure: measure,
      punctuationSqueezing: squeezing
    };

    var kp = H.layout(text, opts);
    var gr = H.greedyLayout(kp.nodes, [measurePx], em);

    render(el.kp, kp, em, COLORS.kp, widthEm, measurePx);
    renderGreedy(kp, gr, em, measurePx);

    metricCells(el.kpMetrics, kp.metrics, true);
    var gm = H.computeMetrics(gr.lines, widthEm, 0);
    metricCells(el.grMetrics, gm, true);

    el.kpNote.textContent = kp.feasible ? kp.lines.length + ' lines' : 'fallback';
    el.grNote.textContent = gr.lines.length + ' lines';
    window.__lastRun = { kp: kp, gr: gr, gm: gm };
  }

  // Greedy lines carry text only; render them by re-walking their own chunks.
  function renderGreedy(kp, gr, em, measurePx) {
    var canvas = el.gr;
    var padX = 56, padY = 22;
    var lineHeight = Math.round(em * 1.85);
    var cssWidth = canvas.parentElement.clientWidth;
    var cssHeight = padY * 2 + Math.max(1, gr.lines.length) * lineHeight;
    var ctx = sizeCanvas(canvas, cssWidth, cssHeight);
    ctx.font = em + 'px ' + FONT_STACK;
    ctx.textBaseline = 'alphabetic';

    ctx.save();
    ctx.strokeStyle = COLORS.rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(padX + measurePx + 0.5, padY - 4);
    ctx.lineTo(padX + measurePx + 0.5, cssHeight - padY + 6);
    ctx.stroke();
    ctx.restore();

    gr.lines.forEach(function (line, idx) {
      var y = padY + idx * lineHeight + em;
      var x = padX;
      // Re-measure glyph by glyph; greedy has no per-glue plan, so distribute
      // the required stretch evenly across the inter-character gaps.
      var chars = Array.from(line.text);
      var natural = chars.reduce(function (s, c) { return s + measure(c); }, 0);
      var isLast = idx === gr.lines.length - 1;
      // Greedy never compresses below natural width: if the line already
      // overflows, spread no gap at all rather than emit a negative one.
      var extra = (isLast || natural >= measurePx) ? 0
        : (measurePx - natural) / Math.max(1, chars.length - 1);
      ctx.fillStyle = COLORS.ink;
      chars.forEach(function (c, ci) {
        ctx.fillText(c, x, y);
        x += measure(c) + (ci < chars.length - 1 ? extra : 0);
      });

      var r = line.ratio;
      var badge = (r > 0 ? '+' : r < 0 ? '−' : ' ') + Math.abs(r).toFixed(2);
      ctx.save();
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(String(idx + 1), padX - 44, y - 2);
      ctx.fillStyle = Math.abs(r) > 0.02 ? COLORS.gr : COLORS.muted;
      ctx.fillText(badge, padX - 10, y - 2);
      ctx.restore();
      ctx.font = em + 'px ' + FONT_STACK;

      if (!isLast && Math.abs(r) > 0.02) {
        ctx.save();
        ctx.strokeStyle = COLORS.gr;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.setLineDash(r < 0 ? [2, 3] : []);
        ctx.beginPath();
        ctx.moveTo(padX, y + 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 60);
  }

  ['input', 'change'].forEach(function (ev) {
    el.text.addEventListener(ev, schedule);
    el.width.addEventListener(ev, schedule);
    el.em.addEventListener(ev, schedule);
    el.squeeze.addEventListener(ev, schedule);
  });
  window.addEventListener('resize', schedule);
  run();
})();
