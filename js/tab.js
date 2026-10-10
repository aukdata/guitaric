/* ===== TAB rendering (SVG) ===== */
const TAB = { cell: 30, minStep: 40, row: 22, top: 46, pad: 16 };
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];

// Draws the song as TAB staves that wrap to the container's width (at bar lines when a bar fits).
// Returns { setState, clearStates, setPlaying, scrollTo } so callers can highlight and follow along.
function renderTab(container, song, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const barCells = song.timeSig[0] * song.grid / 4;
  const cellW = TAB.cell * 8 / song.grid; // an 8th note keeps the same width on a 16th grid
  const fullWidths = song.steps.map(st => Math.max(TAB.minStep, st.len * cellW));
  // steps grouped into bars
  const bars = [[]], endsBar = [];
  let cells = 0;
  song.steps.forEach((st, i) => {
    bars[bars.length - 1].push(i);
    cells += st.len;
    endsBar[i] = cells % barCells === 0;
    if (endsBar[i] && i < song.steps.length - 1) bars.push([]);
  });
  // start of each step in cells, for beaming within a beat
  const starts = [];
  song.steps.reduce((a, st, i) => { starts[i] = a; return a + st.len; }, 0);
  const staffBottom = TAB.top + TAB.row * 5, stemTop = staffBottom + 7, stemEnd = staffBottom + 36;
  const left = TAB.pad + 18, height = stemEnd + 12;
  const states = [], at = []; // at[i] = { row, x, w }
  let groups = [], rowEls = [], playing = -1, lastWidth = 0;

  function layout() {
    const avail = Math.max(TAB.minStep * 4, (container.clientWidth || 800) - left - TAB.pad);
    const widths = fullWidths.map(w => Math.min(w, avail)); // a long rest or note never overflows a row
    lastWidth = container.clientWidth;
    // pack whole bars into rows; a bar wider than the screen breaks between steps
    const rows = [];
    let row = null, x = 0;
    const newRow = () => { row = { steps: [], barAfter: [], width: 0 }; rows.push(row); x = 0; };
    newRow();
    for (const bar of bars) {
      const bw = bar.reduce((a, i) => a + widths[i], 0);
      if (x > 0 && x + bw > avail) newRow();
      for (const i of bar) {
        if (x > 0 && x + widths[i] > avail) newRow();
        row.steps.push(i); x += widths[i]; row.width = x;
      }
      if (endsBar[bar[bar.length - 1]]) row.barAfter.push(bar[bar.length - 1]);
    }
    // every row but the last is stretched to the full width, like printed music
    rows.forEach((r, ri) => {
      const k = ri < rows.length - 1 && r.width ? Math.min(2.5, avail / r.width) : 1;
      let rx = left;
      for (const i of r.steps) { at[i] = { row: ri, x: rx, w: widths[i] * k }; rx += widths[i] * k; }
      r.barEnds = r.barAfter.map(i => at[i].x + at[i].w);
    });
    groups = []; rowEls = [];
    const frag = document.createDocumentFragment();
    rows.forEach((r, ri) => {
      const end = r.steps.length ? at[r.steps[r.steps.length - 1]].x + at[r.steps[r.steps.length - 1]].w : left;
      const width = end + TAB.pad;
      const svg = mk("svg", { class: "tab", width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `TAB譜 ${ri + 1}段目` });
      const lines = mk("g", { class: "tab-lines" }, svg);
      for (let s = 0; s < 6; s++) {
        const y = TAB.top + s * TAB.row;
        mk("line", { x1: left, x2: end, y1: y, y2: y }, lines);
        const t = mk("text", { x: TAB.pad, y: y + 4, class: "tab-label" }, svg); t.textContent = STRING_LABELS[s];
      }
      for (const bx of [left, ...r.barEnds]) mk("line", { x1: bx, x2: bx, y1: TAB.top, y2: TAB.top + TAB.row * 5, class: "tab-bar" }, lines);
      for (const i of r.steps) groups[i] = drawStep(svg, i);
      drawRhythm(svg, r.steps);
      rowEls.push(svg); frag.appendChild(svg);
    });
    container.replaceChildren(frag);
    states.forEach((v, i) => { if (v) groups[i].setAttribute("data-state", v); });
    if (playing >= 0 && groups[playing]) groups[playing].setAttribute("data-playing", "");
  }

  function drawStep(svg, i) {
    const st = song.steps[i];
    const g = mk("g", { class: "tab-step", "data-i": i }, svg);
    const { x: sx, w } = at[i];
    mk("rect", { x: sx + 2, y: 4, width: w - 4, height: height - 8, rx: 6, class: "tab-hl" }, g);
    const cx = sx + Math.min(w, TAB.minStep) / 2;
    if (st.chord) { const t = mk("text", { x: cx, y: TAB.top - 12, class: "tab-chord" }, g); t.textContent = st.chord; }
    else if (st.tech) {
      const label = { h: "H", p: "P", s: "sl." }[st.tech];
      if (label) { const t = mk("text", { x: cx, y: TAB.top - 12, class: "tab-tech" }, g); t.textContent = label; }
      // a slur (H/P) or a slant line (slide) from the previous note on the same string
      const [s, f] = st.notes[0], y = TAB.top + (s - 1) * TAB.row;
      const prev = song.steps[i - 1], pn = prev && !prev.chord && prev.notes.find(n => n[0] === s);
      if ((st.tech === "h" || st.tech === "p") && pn && at[i - 1].row === at[i].row) {
        const px = at[i - 1].x + Math.min(at[i - 1].w, TAB.minStep) / 2;
        mk("path", { d: `M${px + 4} ${y - 9} Q${(px + cx) / 2} ${y - 20} ${cx - 4} ${y - 9}`, class: "tab-slur" }, g);
      } else if (st.tech === "s") {
        const up = !pn || pn[1] < f, x0 = cx - 18, x1 = cx - 8;
        mk("line", { x1: x0, x2: x1, y1: up ? y + 5 : y - 5, y2: up ? y - 5 : y + 5, class: "tab-slur" }, g);
      }
    }
    for (const [s, f] of st.notes) {
      const y = TAB.top + (s - 1) * TAB.row, label = String(f);
      mk("rect", { x: cx - 5 - label.length * 4, y: y - 9, width: 10 + label.length * 8, height: 18, rx: 4, class: "tab-bg" }, g);
      const t = mk("text", { x: cx, y: y + 5, class: "tab-fret" }, g); t.textContent = label;
    }
    if (st.tech === "b" || st.tech === "d") drawBend(g, st, cx);
    const held = st.tie && song.steps.slice(0, i).reverse().find(x => x.notes.length);
    if (held) {
      // a tie shows the held frets in parentheses
      for (const [s, f] of held.notes) {
        const y = TAB.top + (s - 1) * TAB.row, label = `(${f})`;
        mk("rect", { x: cx - 5 - label.length * 4, y: y - 9, width: 10 + label.length * 8, height: 18, rx: 4, class: "tab-bg" }, g);
        const t = mk("text", { x: cx, y: y + 5, class: "tab-fret tab-tie" }, g); t.textContent = label;
      }
    } else if (!st.notes.length) drawRests(g, st.len, sx, w);
    if (opts.onStepClick) g.addEventListener("click", () => opts.onStepClick(i));
    return g;
  }

  // standard TAB bend marks: a curved arrow up from the fret to "full" / "1/2" above the staff,
  // and for a release a curved arrow coming back down onto the fret
  function drawBend(g, st, cx) {
    const y = TAB.top + (st.notes[0][0] - 1) * TAB.row, ax = cx + 20, tip = 16;
    const head = (x, yy, up) => mk("path", { d: up ? `M${x} ${yy} l-3.5 7 h7 z` : `M${x} ${yy} l-3.5 -7 h7 z`, class: "tab-arrowhead" }, g);
    if (st.tech === "b") {
      mk("path", { d: `M${cx + 9} ${y - 1} Q${ax} ${y - 1} ${ax} ${tip + 6}`, class: "tab-arrow" }, g);
      head(ax, tip, true);
      const t = mk("text", { x: ax, y: tip - 4, class: "tab-bendlabel" }, g); t.textContent = st.bend === 1 ? "1/2" : "full";
    } else {
      mk("path", { d: `M${cx - 2} ${tip} Q${ax} ${tip} ${ax} ${y - 15}`, class: "tab-arrow" }, g);
      head(ax, y - 9, false);
    }
  }

  // rest symbols for the rest's length, split into standard values (whole, half, quarter, 8th, 16th)
  function drawRests(g, len, sx, w) {
    const values = [];
    for (const v of [song.grid, song.grid / 2, song.grid / 4, song.grid / 8, song.grid / 16]) {
      if (v < 1 || v !== Math.floor(v)) continue;
      while (len >= v) { values.push(v * 4 / song.grid); len -= v; } // in quarter notes
    }
    const y3 = TAB.top + 2 * TAB.row, y4 = TAB.top + 3 * TAB.row, mid = (y3 + y4) / 2;
    const gap = Math.min(18, (w - 12) / Math.max(1, values.length));
    let x = sx + Math.min(w, TAB.minStep) / 2 - (values.length - 1) * gap / 2;
    for (const q of values) {
      if (q >= 4) mk("rect", { x: x - 7, y: y3, width: 14, height: 6, class: "tab-restsym" }, g);          // whole: hangs from a line
      else if (q >= 2) mk("rect", { x: x - 7, y: y4 - 6, width: 14, height: 6, class: "tab-restsym" }, g); // half: sits on a line
      else if (q >= 1) mk("path", { d: `M${x - 3} ${mid - 13} L${x + 4} ${mid - 5} Q${x} ${mid - 1} ${x + 1} ${mid + 2} L${x + 5} ${mid + 7} Q${x - 3} ${mid + 5} ${x + 1} ${mid + 13} Q${x - 7} ${mid + 7} ${x - 1} ${mid + 5} L${x - 4} ${mid} Q${x} ${mid - 4} ${x - 3} ${mid - 13} z`, class: "tab-restsym" }, g);
      else {
        // 8th rest: a dot with a flag on a slanted stem; a 16th rest has two
        const flags = q >= 0.5 ? 1 : 2;
        mk("line", { x1: x + 4, y1: mid - 8, x2: x - 1 - flags * 1.5, y2: mid + 8 + (flags - 1) * 5, class: "tab-reststem" }, g);
        for (let k = 0; k < flags; k++) {
          const fy = mid - 6 + k * 7, fx = x + 4 - k * 2.2;
          mk("circle", { cx: fx - 6, cy: fy - 2, r: 2.6, class: "tab-restsym" }, g);
          mk("path", { d: `M${fx - 6} ${fy} Q${fx - 2} ${fy + 2} ${fx} ${fy - 2}`, class: "tab-reststem" }, g);
        }
      }
      x += gap;
    }
  }

  // note value of a step as { base, dots } in quarter notes (base 4 = whole ... 0.25 = 16th)
  function noteValue(st) {
    const q = st.len * 4 / song.grid;
    for (const base of [4, 2, 1, 0.5, 0.25, 0.125]) {
      for (const dots of [0, 1, 2]) {
        const v = base * (2 - 1 / 2 ** dots);
        if (Math.abs(v - q) < 1e-6) return { base, dots };
      }
    }
    // not a single standard value: show the largest one it holds
    for (const base of [4, 2, 1, 0.5, 0.25, 0.125]) if (q >= base) return { base, dots: 0 };
    return { base: 0.125, dots: 0 };
  }

  // rhythm under the staff, as in printed TAB: stems for half notes and shorter, flags or beams
  // for 8ths and shorter (beamed within a beat), and dots for dotted values
  function drawRhythm(svg, rowSteps) {
    const gr = mk("g", { class: "tab-rhythm" }, svg);
    const beatCells = song.grid / 4 * (4 / song.timeSig[1]);
    const xOf = i => at[i].x + Math.min(at[i].w, TAB.minStep) / 2;
    const beams = v => Math.max(0, Math.round(Math.log2(0.5 / v.base)) + 1); // 8th = 1, 16th = 2, 32nd = 3
    const notes = rowSteps.filter(i => song.steps[i].notes.length || song.steps[i].tie).map(i => ({ i, x: xOf(i), v: noteValue(song.steps[i]) }));
    for (const n of notes) {
      if (n.v.base >= 4) continue; // whole notes have no stem
      // a half note gets a shorter stem, like the open note head it stands for
      const y2 = n.v.base >= 2 ? stemTop + (stemEnd - stemTop) / 2 : stemEnd;
      mk("line", { x1: n.x, x2: n.x, y1: stemTop, y2, class: "tab-stem" }, gr);
      for (let d = 0; d < n.v.dots; d++) mk("circle", { cx: n.x + 5 + d * 4.5, cy: y2 - 4, r: 1.7, class: "tab-dot" }, gr);
    }
    // beam groups: consecutive 8ths-or-shorter in the same beat (a rest or a longer note breaks it)
    const groupsOf = [];
    let cur = [];
    rowSteps.forEach((i, k) => {
      const st = song.steps[i], n = notes.find(m => m.i === i);
      const beat = Math.floor(starts[i] / beatCells);
      const prev = cur[cur.length - 1];
      if (!n || n.v.base >= 1) { if (cur.length) groupsOf.push(cur); cur = []; return; }
      if (prev && Math.floor(starts[prev.i] / beatCells) !== beat) { groupsOf.push(cur); cur = []; }
      cur.push(n);
    });
    if (cur.length) groupsOf.push(cur);
    for (const grp of groupsOf) {
      if (grp.length === 1) {
        // a lone 8th/16th: flags
        const n = grp[0];
        for (let b = 0; b < beams(n.v); b++) {
          const y = stemEnd - b * 6;
          mk("path", { d: `M${n.x} ${y} q8 -3 9 -12`, class: "tab-flag" }, gr);
        }
        continue;
      }
      // primary beam across the group, then the inner beams between notes that share them
      mk("rect", { x: grp[0].x - 0.7, y: stemEnd - 3, width: grp[grp.length - 1].x - grp[0].x + 1.4, height: 3.5, class: "tab-beam" }, gr);
      for (let lvl = 2; lvl <= 3; lvl++) {
        const y = stemEnd - 3 - (lvl - 1) * 6;
        grp.forEach((n, k) => {
          if (beams(n.v) < lvl) return;
          const next = grp[k + 1], prev = grp[k - 1];
          if (next && beams(next.v) >= lvl) mk("rect", { x: n.x - 0.7, y, width: next.x - n.x + 1.4, height: 3.5, class: "tab-beam" }, gr);
          else if (!(prev && beams(prev.v) >= lvl)) {
            // a lone shorter note in the group: a stub pointing into the group
            const toward = next ? 1 : -1, len = 8;
            mk("rect", { x: toward > 0 ? n.x - 0.7 : n.x - len, y, width: len + 0.7, height: 3.5, class: "tab-beam" }, gr);
          }
        });
      }
    }
  }

  layout();
  // re-flow when the width changes (rotation, window resize, a hidden view becoming visible)
  if (container._tabObserver) container._tabObserver.disconnect();
  if (typeof ResizeObserver !== "undefined") {
    let timer = 0;
    container._tabObserver = new ResizeObserver(() => {
      if (container.clientWidth === lastWidth) return;
      clearTimeout(timer); timer = setTimeout(layout, 100);
    });
    container._tabObserver.observe(container);
  }
  const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  return {
    setState(i, state) { states[i] = state; groups[i] && groups[i].setAttribute("data-state", state); },
    clearStates() { states.length = 0; groups.forEach(g => g.removeAttribute("data-state")); },
    // the step being played back by the model playback (-1 = none)
    setPlaying(i) {
      if (groups[playing]) groups[playing].removeAttribute("data-playing");
      playing = i;
      if (groups[i]) groups[i].setAttribute("data-playing", "");
    },
    // bring the row holding step i into view without jumping when it is already visible
    scrollTo(i) {
      if (!at[i] || !rowEls[at[i].row] || !container.offsetParent) return;
      const r = rowEls[at[i].row].getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) rowEls[at[i].row].scrollIntoView({ block: "nearest", behavior: smooth() });
    }
  };
}

const stepLabel = st => st.chord || (st.tech === "b" ? `${noteName(OPEN_MIDI[st.notes[0][0]] + st.notes[0][1])}→${noteName(stepMidis(st)[0])}`
  : st.notes.length ? st.notes.map(([s, f]) => noteName(OPEN_MIDI[s] + f)).join("+") : "休符");
const stepWhere = st => st.chord ? "" : st.notes.map(([s, f]) => `${s}弦${f}フレット`).join("・")
  + (st.tech ? { h: "（ハンマリング）", p: "（プリング）", s: "（スライド）", d: "（チョーキングを戻す）",
    b: `（${st.bend === 1 ? "半音" : "1音"}チョーキング → ${noteName(stepMidis(st)[0])}）` }[st.tech] : "");
