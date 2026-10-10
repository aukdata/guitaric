/* ===== TAB rendering (SVG) ===== */
const TAB = { cell: 30, minStep: 40, row: 22, top: 30, pad: 16 };
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
  const left = TAB.pad + 18, height = TAB.top + TAB.row * 5 + 18;
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
    if (st.chord) { const t = mk("text", { x: cx, y: 20, class: "tab-chord" }, g); t.textContent = st.chord; }
    else if (st.tech) {
      const t = mk("text", { x: cx, y: 20, class: "tab-tech" }, g);
      t.textContent = { h: "H", p: "P", s: "sl.", b: st.bend === 1 ? "↑½" : "↑full", d: "↓" }[st.tech];
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
    const held = st.tie && song.steps.slice(0, i).reverse().find(x => x.notes.length);
    if (held) {
      // a tie shows the held frets in parentheses
      for (const [s, f] of held.notes) {
        const y = TAB.top + (s - 1) * TAB.row, label = `(${f})`;
        mk("rect", { x: cx - 5 - label.length * 4, y: y - 9, width: 10 + label.length * 8, height: 18, rx: 4, class: "tab-bg" }, g);
        const t = mk("text", { x: cx, y: y + 5, class: "tab-fret tab-tie" }, g); t.textContent = label;
      }
    } else if (!st.notes.length) { const t = mk("text", { x: cx, y: TAB.top + TAB.row * 2.5 + 5, class: "tab-rest" }, g); t.textContent = "休"; }
    if (opts.onStepClick) g.addEventListener("click", () => opts.onStepClick(i));
    return g;
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
