/* ===== TAB rendering (SVG) ===== */
const TAB = { cell: 30, minStep: 40, row: 22, top: 30, pad: 16 };
const STRING_LABELS = ["e", "B", "G", "D", "A", "E"];

// Draws the song as a TAB staff. Returns { el, stepX } so callers can highlight and scroll.
function renderTab(container, song, opts = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const barCells = song.timeSig[0] * song.grid / 4;
  const xs = [];
  let x = TAB.pad + 18, cells = 0;
  const bars = [x];
  for (const st of song.steps) {
    const w = Math.max(TAB.minStep, st.len * TAB.cell);
    xs.push({ x, w });
    x += w; cells += st.len;
    if (cells % barCells === 0) bars.push(x);
  }
  if (bars[bars.length - 1] !== x) bars.push(x);
  const width = x + TAB.pad, height = TAB.top + TAB.row * 5 + 18;
  const svg = mk("svg", { class: "tab", width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "TAB譜" });
  const lines = mk("g", { class: "tab-lines" }, svg);
  for (let s = 0; s < 6; s++) {
    const y = TAB.top + s * TAB.row;
    mk("line", { x1: TAB.pad + 18, x2: x, y1: y, y2: y }, lines);
    const t = mk("text", { x: TAB.pad, y: y + 4, class: "tab-label" }, svg); t.textContent = STRING_LABELS[s];
  }
  for (const bx of bars) mk("line", { x1: bx, x2: bx, y1: TAB.top, y2: TAB.top + TAB.row * 5, class: "tab-bar" }, lines);
  const groups = song.steps.map((st, i) => {
    const g = mk("g", { class: "tab-step", "data-i": i }, svg);
    const { x: sx, w } = xs[i];
    mk("rect", { x: sx + 2, y: 4, width: w - 4, height: height - 8, rx: 6, class: "tab-hl" }, g);
    const cx = sx + Math.min(w, TAB.minStep) / 2;
    if (st.chord) { const t = mk("text", { x: cx, y: 20, class: "tab-chord" }, g); t.textContent = st.chord; }
    else if (st.tech) {
      const t = mk("text", { x: cx, y: 20, class: "tab-tech" }, g);
      t.textContent = { h: "H", p: "P", s: "sl.", b: st.bend === 1 ? "↑½" : "↑full", d: "↓" }[st.tech];
      // a slur (H/P) or a slant line (slide) from the previous note on the same string
      const [s, f] = st.notes[0], y = TAB.top + (s - 1) * TAB.row;
      const prev = song.steps[i - 1], pn = prev && !prev.chord && prev.notes.find(n => n[0] === s);
      if ((st.tech === "h" || st.tech === "p") && pn && pn[0] === s) {
        const px = xs[i - 1].x + Math.min(xs[i - 1].w, TAB.minStep) / 2;
        mk("path", { d: `M${px + 4} ${y - 9} Q${(px + cx) / 2} ${y - 20} ${cx - 4} ${y - 9}`, class: "tab-slur" }, g);
      } else if (st.tech === "s") {
        const up = !(pn && pn[0] === s) || pn[1] < f, x0 = cx - 18, x1 = cx - 8;
        mk("line", { x1: x0, x2: x1, y1: up ? y + 5 : y - 5, y2: up ? y - 5 : y + 5, class: "tab-slur" }, g);
      }
    }
    for (const [s, f] of st.notes) {
      const y = TAB.top + (s - 1) * TAB.row, label = String(f);
      mk("rect", { x: cx - 5 - label.length * 4, y: y - 9, width: 10 + label.length * 8, height: 18, rx: 4, class: "tab-bg" }, g);
      const t = mk("text", { x: cx, y: y + 5, class: "tab-fret" }, g); t.textContent = label;
    }
    if (!st.notes.length) { const t = mk("text", { x: cx, y: TAB.top + TAB.row * 2.5 + 5, class: "tab-rest" }, g); t.textContent = "休"; }
    if (opts.onStepClick) g.addEventListener("click", () => opts.onStepClick(i));
    return g;
  });
  container.replaceChildren(svg);
  return {
    setState(i, state) { groups[i] && groups[i].setAttribute("data-state", state); },
    clearStates() { groups.forEach(g => g.removeAttribute("data-state")); },
    scrollTo(i) {
      if (!xs[i]) return;
      const target = xs[i].x - container.clientWidth * 0.3;
      container.scrollTo({ left: Math.max(0, target), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
}

const stepLabel = st => st.chord || (st.tech === "b" ? `${noteName(OPEN_MIDI[st.notes[0][0]] + st.notes[0][1])}→${noteName(stepMidis(st)[0])}`
  : st.notes.length ? st.notes.map(([s, f]) => noteName(OPEN_MIDI[s] + f)).join("+") : "休符");
const stepWhere = st => st.chord ? "" : st.notes.map(([s, f]) => `${s}弦${f}フレット`).join("・")
  + (st.tech ? { h: "（ハンマリング）", p: "（プリング）", s: "（スライド）", d: "（チョーキングを戻す）",
    b: `（${st.bend === 1 ? "半音" : "1音"}チョーキング → ${noteName(stepMidis(st)[0])}）` }[st.tech] : "");
