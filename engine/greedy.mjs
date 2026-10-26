// Greedy ("first fit") line breaking — the algorithm every hand-rolled CJK
// wrapper uses, and what browsers do for `word-break: normal`.
//
// This module exists for one reason: to make the claim "Knuth-Plass is better"
// falsifiable. It consumes the *same* node list as the optimal solver, so the
// only variable between the two runs is the break-selection policy.
const INF = 10000;

/**
 * Split a node list into chunks delimited by legal break points.
 *
 * Each chunk carries its own trailing glue, because whether that glue is
 * inside the line or discarded at the line end depends on what the caller
 * decides later. Combining two chunks therefore means: add both widths, then
 * subtract the trailing glue of the *last* one.
 */
export function chunkify(nodes) {
  const bps = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n.type === 'glue') bps.push(i);
    else if (n.type === 'penalty' && n.penalty !== INF) bps.push(i);
  }

  const chunks = [];
  let prevBp = -1;
  for (const bp of bps) {
    let w = 0, st = 0, sh = 0;
    const parts = [];
    for (let i = prevBp + 1; i <= bp; i += 1) {
      const n = nodes[i];
      if (n.type === 'box') { w += n.width; parts.push(n.value ?? ''); }
      else if (n.type === 'glue') {
        w += n.width; st += n.stretch; sh += n.shrink;
        if (n.value) parts.push(n.value);
      } else if (n.type === 'penalty') { w += n.width ?? 0; }
    }
    const tail = nodes[bp];
    chunks.push({
      from: prevBp + 1,
      to: bp,
      width: w,
      stretch: st,
      shrink: sh,
      text: parts.join(''),
      tailWidth: tail.type === 'glue' ? tail.width : 0,
      tailStretch: tail.type === 'glue' ? tail.stretch : 0,
      tailShrink: tail.type === 'glue' ? tail.shrink : 0,
      forced: tail.type === 'penalty' && tail.penalty === -INF
    });
    prevBp = bp;
  }
  return chunks;
}

function combine(list) {
  let w = 0, st = 0, sh = 0, text = '';
  for (const c of list) { w += c.width; st += c.stretch; sh += c.shrink; text += c.text; }
  const last = list[list.length - 1];
  return {
    width: w - last.tailWidth,
    stretch: st - last.tailStretch,
    shrink: sh - last.tailShrink,
    text
  };
}

/**
 * Greedy layout over the same nodes.
 *
 * @param {object[]} nodes
 * @param {number[]} lineWidths px
 * @param {number} em
 */
export function greedyLayout(nodes, lineWidths, em = 16) {
  const chunks = chunkify(nodes);
  const targetOf = (i) => lineWidths[i] ?? lineWidths[lineWidths.length - 1];

  const groups = [];
  let acc = null;
  for (const c of chunks) {
    const target = targetOf(groups.length);
    if (acc === null) { acc = [c]; continue; }
    const merged = combine([...acc, c]);
    if (merged.width <= target || c.forced) acc.push(c);
    else { groups.push(acc); acc = [c]; }
  }
  if (acc) groups.push(acc);

  const lines = groups.map((g, i) => {
    const m = combine(g);
    const target = targetOf(i);
    const isLast = i === groups.length - 1;
    let ratio = 0;
    if (!isLast) {
      const delta = target - m.width;
      if (delta >= 0) ratio = m.stretch > 0 ? delta / m.stretch : 99;
      else ratio = m.shrink > 0 ? delta / m.shrink : -1;
    }
    return {
      index: i,
      text: m.text,
      width: (m.width + (isLast ? 0 : ratio * (ratio < 0 ? m.shrink : m.stretch))) / em,
      contentWidth: m.width / em,
      naturalWidth: m.width / em,
      target: target / em,
      ratio,
      fill: target > 0 ? m.width / target : 1
    };
  });

  return { lines, chunks };
}
