/* ===== TAB rendering (SVG) ===== */
// scale: drawn size on screen relative to the layout units below (0.7 = 70%)
const TAB = { cell: 30, minStep: 40, row: 22, top: 46, pad: 16, scale: 0.7 };
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];
const BAR_STRIP = 24; // height of the bar strip over the staff in the editor

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
  const bars = [[]], endsBar = [], barOf = [];
  let cells = 0;
  song.steps.forEach((st, i) => {
    bars[bars.length - 1].push(i); barOf[i] = bars.length - 1;
    cells += st.len;
    endsBar[i] = st.len > 0 && cells % barCells === 0; // (a grace note never ends a bar)
    if (endsBar[i] && i < song.steps.length - 1) bars.push([]);
  });
  // start of each step in cells, for beaming within a beat
  const starts = [];
  song.steps.reduce((a, st, i) => { starts[i] = a; return a + st.len; }, 0);
  // first / second endings ("1." / "2." brackets)
  const volta = song.steps.map(st => st.volta || 0);
  const staffBottom = TAB.top + TAB.row * 5, stemEnd = staffBottom + 30;
  const left = TAB.pad + 18, height = stemEnd + 16; // room for a triplet "3" under the beams
  const states = [], at = []; // at[i] = { row, x, w }
  let groups = [], rowEls = [], playing = -1, lastWidth = 0;

  function layout() {
    const avail = Math.floor(Math.max(TAB.minStep * 4, (container.clientWidth || 800) / TAB.scale - left - TAB.pad));
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
      const width = Math.floor(end + TAB.pad);
      const svg = mk("svg", { class: "tab", width: width * TAB.scale, height: height * TAB.scale, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `TAB譜 ${ri + 1}段目` });
      const lines = mk("g", { class: "tab-lines" }, svg);
      for (let s = 0; s < 6; s++) {
        const y = TAB.top + s * TAB.row;
        mk("line", { x1: left, x2: end, y1: y, y2: y }, lines);
        const t = mk("text", { x: TAB.pad, y: y + 4, class: "tab-label" }, svg); t.textContent = STRING_LABELS[s];
      }
      for (const bx of [left, ...r.barEnds]) mk("line", { x1: bx, x2: bx, y1: TAB.top, y2: TAB.top + TAB.row * 5, class: "tab-bar" }, lines);
      let tempoEnd = 0;
      if (ri === 0) {
        const x = tempoEnd = tempoMark(svg, 4, 10, song.bpm || 80);
        if (song.capo) { const t = mk("text", { x: x + 10, y: 10, class: "tab-capo" }, svg); t.textContent = `Capo ${song.capo}`; }
      }
      // each bar's part of this row; opts.barStrip: a strip over it that selects the bar (else only
      // the bar number, small over the staff)
      const segs = [];
      for (const i of r.steps) {
        const seg = segs[segs.length - 1];
        if (seg && seg.bar === barOf[i]) seg.z = i; else segs.push({ bar: barOf[i], a: i, z: i });
      }
      const box = sg => ({ x: at[sg.a].x + 2, y: 0, width: at[sg.z].x + at[sg.z].w - at[sg.a].x - 4, height: BAR_STRIP, rx: 4 });
      if (opts.barStrip) for (const sg of segs) mk("rect", { ...box(sg), class: "tab-barhead", "data-bar": sg.bar }, svg);
      for (const i of r.steps) groups[i] = drawStep(svg, i);
      drawRhythm(svg, r.steps);
      for (const sg of segs) {
        if (!opts.barStrip) {
          if (bars[sg.bar][0] === sg.a) { const t = mk("text", { x: at[sg.a].x + 2, y: TAB.top - 5, class: "tab-barno" }, svg); t.textContent = sg.bar + 1; }
          continue;
        }
        if (bars[sg.bar][0] === sg.a) {
          // at the bar's left end, after a tempo mark there
          const b = box(sg), st = song.steps[sg.a];
          let nx = b.x + 4;
          if (sg.a === r.steps[0]) nx = Math.max(nx, tempoEnd);
          if (sg.a > 0 && st.bpm) nx = Math.max(nx, at[sg.a].x + 14 + 7 * String(st.bpm).length + 10 + (volta[sg.a] ? 16 : 0));
          const t = mk("text", { x: nx, y: 16, class: "tab-barno" }, svg);
          t.textContent = sg.bar + 1;
        }
        mk("rect", { ...box(sg), class: "tab-barhit", "data-bar": sg.bar }, svg);
      }
      rowEls.push(svg); frag.appendChild(svg);
    });
    container.replaceChildren(frag);
    states.forEach((v, i) => { if (v) groups[i].setAttribute("data-state", v); });
    if (playing >= 0 && groups[playing]) groups[playing].setAttribute("data-playing", "");
  }

  // a tie shows its held frets in parentheses at the head of a bar or of a row
  function tieParens(i) {
    return song.steps[i].tie && (starts[i] % barCells === 0 || i === 0 || at[i - 1].row !== at[i].row);
  }

  // the notes sounding at step i (for a tie, the note it holds)
  function heldNotes(i) {
    const st = song.steps[i];
    if (!st.tie) return st.notes;
    const h = song.steps.slice(0, i).reverse().find(x => x.notes.length);
    return h ? h.notes : [];
  }

  function drawStep(svg, i) {
    const st = song.steps[i];
    const g = mk("g", { class: "tab-step", "data-i": i }, svg);
    const { x: sx, w } = at[i];
    const hy = opts.barStrip ? BAR_STRIP + 2 : 4; // under the bar strip when there is one
    mk("rect", { x: sx + 2, y: hy, width: w - 4, height: height - 4 - hy, rx: 6, class: "tab-hl" }, g);
    const cx = sx + Math.min(w, TAB.minStep) / 2;
    // a tempo change ("@bpm") from this step on
    if (i > 0 && st.bpm) tempoMark(g, sx + (volta[i] && volta[i - 1] !== volta[i] ? 20 : 4), volta[i] ? 14 : 10, st.bpm);
    drawRepeat(g, st, sx, w);
    if (volta[i]) {
      // the ending's bracket over the top; it opens where the ending (or a new row) starts
      const prevSame = i > 0 && volta[i - 1] === volta[i] && at[i - 1].row === at[i].row;
      mk("line", { x1: sx + (prevSame ? 0 : 2), x2: sx + w, y1: 2, y2: 2, class: "tab-volta" }, g);
      if (!prevSame) {
        mk("line", { x1: sx + 2, x2: sx + 2, y1: 2, y2: 14, class: "tab-volta" }, g);
        const t = mk("text", { x: sx + 6, y: 14, class: "tab-capo" }, g); t.textContent = volta[i] + ".";
      }
    }
    // (a staccato dot over the 1st string's number pushes the chord name up)
    if (st.chord) { const t = mk("text", { x: cx, y: TAB.top - (st.stac && st.notes.some(n => n[0] === 1) ? 18 : 12), class: "tab-chord" }, g); t.textContent = st.chord; }
    else {
      // techniques, string by string: H / P / sl. over the step; a slur, a slant line (slide from the
      // previous note, slide in from below, slide out downward) or a bend arrow at each string's note
      const labels = [];
      // (a tie with marks: they move every held note)
      const marked = st.tie && st.tieMarks ? heldNotes(i).map(h => [h[0], h[1], st.tieMarks]) : st.notes;
      for (const n of marked) {
        const [s, f] = n, m = markOf(n), lw = String(f).length + (st.tie ? 2 : 0); // (a tie shows "(7)")
        const y = TAB.top + (s - 1) * TAB.row;
        const prev = song.steps[i - 1], pn = prev && !prev.chord && heldNotes(i - 1).find(x => x[0] === s);
        const label = { h: "H", p: "P", s: "sl." }[m.start];
        if (label && !labels.includes(label)) labels.push(label);
        // how it starts
        if ((m.start === "h" || m.start === "p") && pn && at[i - 1].row === at[i].row) {
          const px = at[i - 1].x + Math.min(at[i - 1].w, TAB.minStep) / 2;
          mk("path", { d: `M${px + 4} ${y - 9} Q${(px + cx) / 2} ${y - 20} ${cx - 4} ${y - 9}`, class: "tab-slur" }, g);
        } else if (m.start === "s" && pn && at[i - 1].row === at[i].row) {
          // a slide: a slant line from the previous note's number to this one's
          const px = at[i - 1].x + Math.min(at[i - 1].w, TAB.minStep) / 2, up = pn[1] < f;
          const x0 = prev.tie && !tieParens(i - 1) ? px + 3 : px + 6 + (String(pn[1]).length - 1) * 4 + (prev.tie ? 6 : 0), x1 = cx - 6 - (String(f).length - 1) * 4;
          mk("line", { x1: x0, x2: x1, y1: up ? y + 4 : y - 4, y2: up ? y - 4 : y + 4, class: "tab-slur" }, g);
        } else if (m.start === "s" || m.start === "i") {
          const up = m.start === "i" || !pn || pn[1] < f, x0 = cx - 18, x1 = cx - 8;
          mk("line", { x1: x0, x2: x1, y1: up ? y + 5 : y - 5, y2: up ? y - 5 : y + 5, class: "tab-slur" }, g);
        }
        // while it rings
        if (m.move === "o") {
          const x0 = cx + 4 + lw * 4;
          mk("line", { x1: x0, x2: x0 + 10, y1: y - 5, y2: y + 5, class: "tab-slur" }, g);
        } else if (m.move === "t") {
          // a trill: the other fret in parentheses after this one, and "tr" over the staff with a wavy
          // line on to the end of the note's length
          const t = mk("text", { x: cx + 8 + lw * 4, y: y + 4, class: "tab-trill" }, g); t.textContent = `(${m.trill})`;
          if (!g.querySelector(".tab-trline")) {
            const tr = mk("text", { x: cx - 4, y: TAB.top - 9, class: "tab-tech tab-trline" }, g); tr.textContent = "tr.";
            const x0 = cx + 9, n4 = Math.max(1, Math.floor((sx + w - 4 - x0) / 4));
            mk("path", { d: `M${x0} ${TAB.top - 13} q1 -3 2 0` + " t2 0".repeat(2 * n4 - 1), class: "tab-slur" }, g);
          }
        } else if (m.move) drawBend(g, st, n, cx, i);
      }
      if (marked.some(n => markOf(n).v)) {
        // vibrato: a wavy line over the note
        mk("path", { d: `M${cx - 8} ${TAB.top - 14} q2 -4 4 0 t4 0 t4 0 t4 0`, class: "tab-slur" }, g);
      } else if (labels.length) { const t = mk("text", { x: cx, y: TAB.top - 12, class: "tab-tech" }, g); t.textContent = labels.join(" "); }
    }
    // staccato: a dot just over the top fret number (over the tie's slur when the next step holds it)
    if (st.stac && st.notes.length) {
      const top = TAB.top + (Math.min(...st.notes.map(n => n[0])) - 1) * TAB.row, next = song.steps[i + 1];
      mk("circle", { cx, cy: top - (next && next.tie ? 18 : 13), r: 2, class: "tab-repeat" }, g);
    }
    // bridge mute: "P.M." where a run starts (and at a new row), a dashed line on over the run
    if (st.pm) {
      const prev = song.steps[i - 1], next = song.steps[i + 1];
      const first = !prev || !prev.pm || at[i - 1].row !== at[i].row;
      if (first) { const t = mk("text", { x: cx - 10, y: 20, class: "tab-pm" }, g); t.textContent = "P.M."; }
      const x1 = first ? cx + 18 : cx;
      const x2 = next && next.pm && at[i + 1] && at[i + 1].row === at[i].row ? at[i + 1].x + Math.min(at[i + 1].w, TAB.minStep) / 2 : cx + 8;
      if (x2 > x1) mk("line", { x1, x2, y1: 16, y2: 16, class: "tab-pmline" }, g);
    }
    // brushing: one big x across the middle of the strings, as in printed TAB
    if (st.brush) {
      const y0 = TAB.top + 2.5 * TAB.row - 10, y1 = TAB.top + 2.5 * TAB.row + 10;
      mk("path", { d: `M${cx - 9} ${y0} L${cx + 9} ${y1} M${cx + 9} ${y0} L${cx - 9} ${y1}`, class: "tab-brush" }, g);
    }
    // a muted string among the notes: x on it
    for (const s of st.brush ? [] : st.mute || []) {
      const y = TAB.top + (s - 1) * TAB.row;
      mk("rect", { x: cx - 9, y: y - 9, width: 18, height: 18, rx: 4, class: "tab-bg" }, g);
      const t = mk("text", { x: cx, y: y + 5, class: "tab-fret tab-x" }, g); t.textContent = "×";
    }
    for (const n of st.notes) {
      // (a grace note smaller)
      const [s, f] = n, y = TAB.top + (s - 1) * TAB.row, label = markOf(n).harm ? `<${f}>` : String(f);
      mk("rect", { x: cx - 5 - label.length * 4, y: y - 9, width: 10 + label.length * 8, height: 18, rx: 4, class: "tab-bg" }, g);
      const t = mk("text", { x: cx, y: y + 5, class: st.grace ? "tab-fret tab-grace" : "tab-fret" }, g); t.textContent = label;
    }
    const held = st.tie && song.steps.slice(0, i).reverse().find(x => x.notes.length);
    if (held) {
      // a tie: a slur from the previous note (or tie) on each held string, over the note (under it
      // for the lowest of several); the held frets in parentheses only at the head of a bar (or of a
      // row, where there is no slur to read)
      const strings = held.notes.map(n => n[0]), low = Math.max(...strings);
      const sameRow = i > 0 && at[i - 1].row === at[i].row;
      const pv = at[i - 1], px = sameRow ? pv.x + Math.min(pv.w, TAB.minStep) / 2 : 0;
      const paren = tieParens(i);
      for (const [s, f] of held.notes) {
        const y = TAB.top + (s - 1) * TAB.row, label = `(${f})`, half = 5 + label.length * 4;
        if (sameRow) {
          const prev = song.steps[i - 1];
          const x0 = prev.tie ? px + (tieParens(i - 1) ? 1 + label.length * 4 : 2) : px + 1 + String(f).length * 4;
          const x1 = paren ? cx - half + 3 : cx - 2, dy = strings.length > 1 && s === low ? 1 : -1;
          mk("path", { d: `M${x0} ${y + dy * 7} Q${(x0 + x1) / 2} ${y + dy * 15} ${x1} ${y + dy * 7}`, class: "tab-slur" }, g);
        }
        if (!paren) continue;
        mk("rect", { x: cx - half, y: y - 9, width: 2 * half, height: 18, rx: 4, class: "tab-bg" }, g);
        const t = mk("text", { x: cx, y: y + 5, class: "tab-fret tab-tie" }, g); t.textContent = label;
      }
    } else if (!st.notes.length && !st.brush) drawRests(g, st.len, sx, w);
    if (opts.onStepClick) g.addEventListener("click", () => opts.onStepClick(i));
    return g;
  }

  // a tempo mark "♩ = 120" (the note drawn, not a font glyph); returns where it ends
  function tempoMark(parent, x, y, bpm) {
    mk("ellipse", { cx: x + 3, cy: y - 2.5, rx: 3.2, ry: 2.3, transform: `rotate(-20 ${x + 3} ${y - 2.5})`, class: "tab-repeat" }, parent);
    mk("line", { x1: x + 5.9, x2: x + 5.9, y1: y - 3, y2: y - 12, class: "tab-repeatline" }, parent);
    const t = mk("text", { x: x + 10, y, class: "tab-capo" }, parent); t.textContent = `= ${bpm}`;
    return x + 10 + 7 * String(bpm).length + 10;
  }

  // repeat signs: a thick and a thin bar line with two dots facing the repeated part; "×3" over an end
  // played more than twice
  function drawRepeat(g, st, sx, w) {
    const ys = [TAB.top + TAB.row * 1.5, TAB.top + TAB.row * 3.5];
    const sign = (x, dir) => {
      mk("rect", { x: dir > 0 ? x : x - 3, y: TAB.top, width: 3, height: TAB.row * 5, class: "tab-repeat" }, g);
      mk("line", { x1: x + dir * 6, x2: x + dir * 6, y1: TAB.top, y2: TAB.top + TAB.row * 5, class: "tab-repeatline" }, g);
      for (const y of ys) mk("circle", { cx: x + dir * 10.5, cy: y, r: 2.2, class: "tab-repeat" }, g);
    };
    if (st.repStart) sign(sx, 1);
    if (st.repEnd || st.autoEnd) {
      sign(sx + w, -1);
      if (st.repEnd > 2) { const t = mk("text", { x: sx + w - 2, y: TAB.top - 4, class: "tab-capo tab-times" }, g); t.textContent = `×${st.repEnd}`; }
    }
  }

  // standard TAB bend marks: a curved arrow up from the fret to "full" / "1/2" above the staff;
  // a release starts bent, so it gets a straight arrow up to "full" / "1/2" and a curved arrow back down
  function drawBend(g, st, note, cx, i) {
    const [s, f] = note, t = note[2].move, amount = t[1] === "1" ? 1 : t[1] ? +t[1] : 0;
    const y = TAB.top + (s - 1) * TAB.row, ax = cx + 20, tip = 16;
    const head = (x, yy, up) => mk("path", { d: up ? `M${x} ${yy} l-3.5 7 h7 z` : `M${x} ${yy} l-3.5 -7 h7 z`, class: "tab-arrowhead" }, g);
    const label = (x, amount) => { const t = mk("text", { x, y: tip - 4, class: "tab-bendlabel" }, g); t.textContent = amount === 1 ? "1/2" : "full"; };
    if (t[0] === "b") {
      mk("path", { d: `M${cx + 9} ${y - 1} Q${ax} ${y - 1} ${ax} ${tip + 6}`, class: "tab-arrow" }, g);
      head(ax, tip, true);
      label(ax, amount || 2);
    } else {
      // the bend amount comes from the bend this releases (same string and fret), else a whole step
      const bentOf = x => x.notes.find(m => m[0] === s && m[1] === f && bendOf(m[2]));
      const from = song.steps.slice(0, i).reverse().map(bentOf).find(Boolean);
      mk("line", { x1: cx, x2: cx, y1: y - 10, y2: tip + 6, class: "tab-arrow" }, g);
      head(cx, tip, true);
      label(cx, amount || (from ? bendOf(from[2]) : 2));
      mk("path", { d: `M${cx + 3} ${tip + 2} Q${ax} ${tip + 2} ${ax} ${y - 15}`, class: "tab-arrow" }, g);
      head(ax, y - 9, false);
    }
  }

  // rest symbols for the rest's length, split into standard values (whole, half, quarter, 8th, 16th)
  function drawRests(g, len, sx, w) {
    // largest standard values first, dotted ones included, so 3 sixteenths is one dotted 8th rest
    const values = [], q0 = len * 4 / song.grid;
    let rem = q0;
    // a triplet rest: the symbol of its plain value (the bracket under the staff says "3")
    const tv = noteValue({ len });
    if (tv.tup) { values.push(tv); rem = 0; }
    const choices = [];
    for (const base of [4, 2, 1, 0.5, 0.25, 0.125]) for (const dots of [1, 0]) choices.push({ q: base * (2 - 1 / 2 ** dots), base, dots });
    choices.sort((a, b) => b.q - a.q);
    for (const c of choices) {
      if (c.base * song.grid / 4 < 1) continue; // finer than the grid
      while (rem >= c.q - 1e-6) { values.push(c); rem -= c.q; }
    }
    const y3 = TAB.top + 2 * TAB.row, y4 = TAB.top + 3 * TAB.row, mid = (y3 + y4) / 2;
    const gap = Math.min(20, (w - 12) / Math.max(1, values.length));
    let x = sx + Math.min(w, TAB.minStep) / 2 - (values.length - 1) * gap / 2;
    for (const { base: q, dots } of values) {
      for (let d = 0; d < dots; d++) mk("circle", { cx: x + 8 + d * 4.5, cy: y3 + 5, r: 1.8, class: "tab-restsym" }, g);
      if (q >= 4) mk("rect", { x: x - 7, y: y3, width: 14, height: 6, class: "tab-restsym" }, g);          // whole: hangs from a line
      else if (q >= 2) mk("rect", { x: x - 7, y: y4 - 6, width: 14, height: 6, class: "tab-restsym" }, g); // half: sits on a line
      else if (q >= 1) mk("path", { d: `M${x - 3} ${mid - 13} L${x + 4} ${mid - 5} Q${x} ${mid - 1} ${x + 1} ${mid + 2} L${x + 5} ${mid + 7} Q${x - 3} ${mid + 5} ${x + 1} ${mid + 13} Q${x - 7} ${mid + 7} ${x - 1} ${mid + 5} L${x - 4} ${mid} Q${x} ${mid - 4} ${x - 3} ${mid - 13} z`, class: "tab-restsym" }, g);
      else {
        // 8th rest: a dot with a flag on a slanted stem; a 16th rest has two, a 32nd three
        const flags = q >= 0.5 ? 1 : q >= 0.25 ? 2 : 3;
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

  // note value of a step as { base, dots, tup? } in quarter notes (base 4 = whole ... 0.25 = 16th;
  // tup 3 = a triplet value, 2/3 as long)
  function noteValue(st) {
    const q = st.len * 4 / song.grid;
    for (const base of [4, 2, 1, 0.5, 0.25, 0.125]) {
      for (const dots of [0, 1, 2]) {
        const v = base * (2 - 1 / 2 ** dots);
        if (Math.abs(v - q) < 1e-6) return { base, dots };
      }
    }
    // a triplet: three of these in the time of two
    for (const base of [2, 1, 0.5, 0.25, 0.125]) if (Math.abs(base * 2 / 3 - q) < 1e-6) return { base, dots: 0, tup: 3 };
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
    const restY = TAB.top + 3 * TAB.row + 4; // just under a rest symbol
    // stems start just under the lowest fret number of the step (a tie: the held note)
    const lowY = st => {
      if (st.brush) return TAB.top + 2.5 * TAB.row + 13;
      const ns = st.notes.length ? st.notes : (st.tie && song.steps.slice(0, song.steps.indexOf(st)).reverse().find(x => x.notes.length) || { notes: [] }).notes;
      return TAB.top + (Math.max(...ns.map(n => n[0])) - 1) * TAB.row + 10;
    };
    const items = rowSteps.map(i => {
      const st = song.steps[i], v = noteValue(st), exact = Math.abs(v.base * (2 - 1 / 2 ** v.dots) * (v.tup ? 2 / 3 : 1) - st.len * 4 / song.grid) < 1e-6;
      if (st.notes.length || st.tie || st.brush) return { i, x: xOf(i), v, top: lowY(st), note: true };
      // a rest shorter than a beat with a single symbol may sit under the beam of its beat
      return exact && v.base < 1 ? { i, x: xOf(i), v, top: restY, note: false } : null;
    });
    for (const n of items) {
      if (!n || !n.note || n.v.base >= 4) continue; // whole notes have no stem
      // a half note gets a shorter stem, like the open note head it stands for
      const y2 = n.v.base >= 2 ? (Math.max(n.top, staffBottom) + stemEnd) / 2 : stemEnd;
      mk("line", { x1: n.x, x2: n.x, y1: n.top, y2, class: "tab-stem" }, gr);
      for (let d = 0; d < n.v.dots; d++) mk("circle", { cx: n.x + 5 + d * 4.5, cy: y2 - 4, r: 1.7, class: "tab-dot" }, gr);
    }
    // beam groups: 8ths-or-shorter (and short rests) in the same beat; a longer note or rest breaks it
    const groupsOf = [];
    let cur = [];
    items.forEach(n => {
      if (!n || n.v.base >= 1) { if (cur.length) groupsOf.push(cur); cur = []; return; }
      const prev = cur[cur.length - 1];
      if (prev && Math.floor(starts[prev.i] / beatCells) !== Math.floor(starts[n.i] / beatCells)) { groupsOf.push(cur); cur = []; }
      cur.push(n);
    });
    if (cur.length) groupsOf.push(cur);
    for (const grp0 of groupsOf) {
      // rests only join a beam that has notes; trailing rests stay out of it
      let grp = grp0;
      while (grp.length && !grp[grp.length - 1].note) grp = grp.slice(0, -1);
      const notes = grp.filter(n => n.note);
      if (!notes.length) continue;
      if (grp.length === 1) {
        // a lone 8th/16th: flags
        const n = grp[0];
        // a printed flag: thick where it leaves the stem, curving up and thinning to a point
        for (let b = 0; b < beams(n.v); b++) {
          const y = stemEnd - b * 7;
          mk("path", { d: `M${n.x - 0.6} ${y} C${n.x + 5} ${y - 5} ${n.x + 11} ${y - 10} ${n.x + 8} ${y - 21} C${n.x + 9.5} ${y - 13} ${n.x + 5} ${y - 11} ${n.x - 0.6} ${y - 8} Z`, class: "tab-flag" }, gr);
        }
        continue;
      }
      // rests in the group get a stem of their own down to the beam
      for (const n of grp) if (!n.note) mk("line", { x1: n.x, x2: n.x, y1: n.top, y2: stemEnd, class: "tab-stem" }, gr);
      // primary beam across the group, then the inner beams between members that share them
      mk("rect", { x: grp[0].x - 0.7, y: stemEnd - 3, width: grp[grp.length - 1].x - grp[0].x + 1.4, height: 3.5, class: "tab-beam" }, gr);
      for (let lvl = 2; lvl <= 3; lvl++) {
        const y = stemEnd - 3 - (lvl - 1) * 6;
        grp.forEach((n, k) => {
          if (beams(n.v) < lvl) return;
          const next = grp[k + 1], prev = grp[k - 1];
          if (next && beams(next.v) >= lvl) mk("rect", { x: n.x - 0.7, y, width: next.x - n.x + 1.4, height: 3.5, class: "tab-beam" }, gr);
          else if (!(prev && beams(prev.v) >= lvl)) {
            // a lone shorter value in the group: a stub pointing into the group
            const toward = next ? 1 : -1, len = 8;
            mk("rect", { x: toward > 0 ? n.x - 0.7 : n.x - len, y, width: len + 0.7, height: 3.5, class: "tab-beam" }, gr);
          }
        });
      }
    }
    drawTuplets(gr, items, groupsOf);
  }

  // triplets: a "3" under each set of three-in-the-time-of-two; a bracket when the set is not
  // exactly one beamed group (quarter-note triplets, rests at its ends, mixed values)
  function drawTuplets(gr, items, groupsOf) {
    const q = n => song.steps[n.i].len * 4 / song.grid;
    const sets = [];
    let run = [];
    const flush = () => {
      // split a run of triplet values into sets, each as long as two of its shortest value
      let set = [], sum = 0, span = 0;
      for (const n of run) {
        set.push(n); sum += q(n);
        span = set.length === 1 ? 2 * n.v.base : Math.min(span, 2 * n.v.base);
        if (sum >= span - 1e-6) { sets.push(set); set = []; sum = 0; }
      }
      if (set.length) sets.push(set);
      run = [];
    };
    for (const n of items) {
      if (n && n.v.tup && (!run.length || at[run[run.length - 1].i].row === at[n.i].row)) run.push(n);
      else if (run.length) { flush(); if (n && n.v.tup) run.push(n); }
    }
    if (run.length) flush();
    const y = stemEnd + 9;
    for (const set of sets) {
      const x0 = set[0].x, x1 = set[set.length - 1].x, xm = (x0 + x1) / 2;
      const beamed = set.every(n => n.note) && groupsOf.some(g => g.length > 1 && set.every(n => g.includes(n)));
      const t = mk("text", { x: xm, y: y + 3, class: "tab-tuplet" }, gr); t.textContent = "3";
      if (!beamed) {
        mk("path", { d: `M${x0 - 3} ${y - 5} V${y} H${xm - 6} M${xm + 6} ${y} H${x1 + 3} V${y - 5}`, class: "tab-tupbracket" }, gr);
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

const MARK_NAMES = { h: "ハンマリング", p: "プリング", s: "スライド", i: "スライドイン", o: "スライドアウト", t: "トリル",
  b: "1音チョーキング", b1: "半音チョーキング", d: "チョーキングを戻す", d1: "チョーキングを戻す", d2: "チョーキングを戻す" };
const markNames = m => [m.start && MARK_NAMES[m.start], m.move && MARK_NAMES[m.move], m.v && "ビブラート", m.fast && "速く", m.harm && "ハーモニクス"].filter(Boolean).join("・");
const stepLabel = st => st.brush ? "ブラッシング" : (st.chord || (st.notes.length ? stepMidis(st).map(noteName).join("+") : "休符"))
  + (st.pm ? "（P.M.）" : "") + (st.stac ? "（スタッカート）" : "") + (st.grace ? "（装飾音）" : "");
const stepWhere = st => st.chord ? "" : [...st.notes.map(n => `${n[0]}弦${n[1]}フレット${n[2] ? `（${markNames(n[2])}）` : ""}`),
  ...(st.mute || []).map(s => `${s}弦ミュート`)].join("・");
