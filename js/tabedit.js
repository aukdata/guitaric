/* ===== click-to-edit on the TAB (曲を作る): edits go back into the song text ===== */
// The text stays the one source of truth: each edit changes the parsed steps, writes them back
// as text, and the preview is drawn again from that text.

// one step as a text token ("6-3h?:2", "C", "r:2", "~:8")
function stepToken(st, withLen) {
  const len = withLen && st.len !== 1 ? ":" + st.len : "";
  if (st.tie) return "~" + len;
  if (!st.notes.length) return "r" + len;
  const q = st.loose ? "?" : "";
  if (st.chord) return st.chord + q + len;
  const tech = st.tech ? st.tech + (st.tech === "b" && st.bend === 1 ? "1" : "") : "";
  return st.notes.map(([s, f]) => `${s}-${f}`).join("+") + tech + q + len;
}

const stepSig = st => JSON.stringify([st.notes, st.chord || "", st.len, st.tech || "", st.bend || 0, !!st.loose, !!st.tie]);

// Writes the steps as bar-separated text, keeping it short where the parser gives the same steps back
// ("| C*4 | G Am |" rather than "| C:2 C:2 C:2 C:2 | G:4 Am:4 |").
function stepsToText(steps, grid, timeSig, prefix) {
  const barCells = timeSig[0] * grid / 4, bars = [];
  let cell = 0;
  for (const st of steps) { const b = Math.floor(cell / barCells); (bars[b] = bars[b] || []).push(st); cell += st.len; }
  const same = (a, b) => a.length === b.length && a.every((st, i) => stepSig(st) === stepSig(b[i]));
  const out = bars.filter(Boolean).map(bar => {
    // runs of the same chord with the same length become "C*4"
    const runs = [];
    for (const st of bar) {
      const r = runs[runs.length - 1];
      if (r && st.chord && r.st.chord === st.chord && stepSig(r.st) === stepSig(st)) r.n++;
      else runs.push({ st, n: 1 });
    }
    const tok = (r, open) => {
      if (!r.st.chord || r.n === 1) return open && r.st.chord ? stepToken(r.st, false) : stepToken(r.st, true);
      const q = r.st.loose ? "?" : "";
      return `${r.st.chord}*${r.n}${q}` + (open ? "" : ":" + r.st.len * r.n);
    };
    const short = runs.map(r => tok(r, true)).join(" ");
    if (same(parseSongText(`|${short}|`, { grid, timeSig }).steps, bar)) return short;
    return runs.map(r => tok(r, false)).join(" ");
  });
  return (prefix || "") + "| " + out.join(" | ") + " |";
}

const vedit = { sel: null, undo: [], digit: "", digitAt: 0 };

function veditSong() { return buildSong({ text: $("eText").value, grid: editingGrid }); }

// apply a change to a copy of the steps and write the result back into the text box
function veditChange(fn) {
  const song = veditSong();
  if (song.errors.length) return;
  const steps = song.steps.map(st => ({ ...st, notes: st.notes.map(n => n.slice()) }));
  const sel = fn(steps, song);
  if (sel === false) return;
  const prefix = (/^\s*@(4|8|16)\b\s*/.exec($("eText").value) || [""])[0];
  vedit.undo.push($("eText").value);
  if (vedit.undo.length > 100) vedit.undo.shift();
  $("eText").value = steps.length ? stepsToText(steps, song.grid, song.timeSig, prefix) : prefix.trim();
  if (sel) vedit.sel = sel;
  previewEditor();
}

function veditUndo() {
  if (!vedit.undo.length) return;
  $("eText").value = vedit.undo.pop();
  previewEditor();
}

const asNotes = st => { delete st.chord; delete st.tie; };
function setFret(steps, i, s, f) {
  const st = steps[i];
  asNotes(st);
  st.notes = st.notes.filter(n => n[0] !== s);
  if (f != null) st.notes.push([s, f]);
  st.notes.sort((a, b) => b[0] - a[0]);
  if (st.notes.length !== 1) { delete st.tech; delete st.bend; }
  if (!st.notes.length) delete st.loose;
}
const restLike = len => ({ notes: [], len });

function lenChoices(grid, cur) {
  const list = [[grid / 16, "16分"], [grid / 8, "8分"], [grid * 3 / 16, "付点8分"], [grid / 4, "4分"], [grid * 3 / 8, "付点4分"],
    [grid / 2, "2分"], [grid * 3 / 4, "付点2分"], [grid, "全"]].filter(([n]) => Number.isInteger(n) && n >= 1);
  const seen = new Set(), out = [];
  for (const [n, l] of list) if (!seen.has(n)) { seen.add(n); out.push([n, l + "音符"]); }
  if (cur && !seen.has(cur)) out.push([cur, `${cur}マス`]);
  return out.sort((a, b) => a[0] - b[0]);
}

// called after every preview: redraw the selection and fill in the panel
function refreshVisualEdit(song, tab) {
  const panel = $("vEdit");
  const ok = !song.errors.length;
  $("vStart").hidden = !ok || song.steps.length > 0;
  if (!ok) { vedit.sel = null; $("vWhere").textContent = "テキストの間違いを直すと、TAB譜をクリックして編集できます"; }
  if (vedit.sel && vedit.sel.i >= song.steps.length) vedit.sel = song.steps.length ? { i: song.steps.length - 1, s: vedit.sel.s } : null;
  panel.dataset.active = vedit.sel ? "1" : "";
  panel.querySelectorAll("button, select, input").forEach(el => { if (el.id !== "vUndo" && el.id !== "vAddBar") el.disabled = !vedit.sel; });
  $("vUndo").disabled = !vedit.undo.length;
  if (!vedit.sel) {
    if (ok) $("vWhere").textContent = song.steps.length ? "TAB譜の線をクリック（タップ）すると、その場所を編集できます" : "";
    return;
  }
  const { i, s } = vedit.sel, st = song.steps[i];
  tab.setState(i, "current");
  drawCursor();
  // where: bar and beat
  const barCells = song.timeSig[0] * song.grid / 4, beat = song.grid / 4;
  const cell = song.steps.slice(0, i).reduce((a, x) => a + x.len, 0);
  const bar = Math.floor(cell / barCells) + 1, b = (cell % barCells) / beat + 1;
  const what = st.tie ? "タイ" : stepLabel(st);
  $("vWhere").textContent = `${bar}小節目 ${Number.isInteger(b) ? b : b.toFixed(1)}拍目・${s}弦 ― ${what}`;
  $("vLen").innerHTML = lenChoices(song.grid, st.len).map(([n, l]) => `<option value="${n}">${l}</option>`).join("");
  $("vLen").value = st.len;
  const single = !st.chord && st.notes.length === 1;
  $("vTech").disabled = !single;
  $("vTech").value = single && st.tech ? st.tech + (st.tech === "b" ? st.bend : "") : "";
  $("vLoose").checked = !!st.loose;
  $("vLoose").disabled = !st.notes.length;
  if (document.activeElement !== $("vChord")) $("vChord").value = st.chord || "";
  const fret = (st.notes.find(n => n[0] === s) || [])[1];
  $("vPad").querySelectorAll("button").forEach(btn => btn.setAttribute("aria-pressed", fret != null && btn.dataset.fret === String(fret) ? "true" : "false"));
}

// a box around the selected string of the selected step
function drawCursor() {
  const old = $("eTab").querySelector(".tab-cursor");
  if (old) old.remove();
  if (!vedit.sel) return;
  const g = $("eTab").querySelector(`.tab-step[data-i="${vedit.sel.i}"]`);
  if (!g) return;
  const hl = g.querySelector(".tab-hl");
  const x = +hl.getAttribute("x") - 2, w = +hl.getAttribute("width") + 4;
  const cx = x + Math.min(w, TAB.minStep) / 2, y = TAB.top + (vedit.sel.s - 1) * TAB.row;
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of Object.entries({ x: cx - 13, y: y - 10, width: 26, height: 20, rx: 4, class: "tab-cursor" })) r.setAttribute(k, v);
  hl.after(r);
}

function veditSelect(i, s) {
  vedit.sel = { i, s };
  vedit.digit = "";
  previewEditor();
}

function veditSetFret(f) {
  if (!vedit.sel) return;
  const { i, s } = vedit.sel;
  veditChange(steps => { setFret(steps, i, s, f); });
}

function veditInsert(after) {
  if (!vedit.sel) return;
  const { i, s } = vedit.sel;
  veditChange(steps => { steps.splice(after ? i + 1 : i, 0, restLike(steps[i].len)); return { i: after ? i + 1 : i, s }; });
}

function veditDelete() {
  if (!vedit.sel) return;
  const { i, s } = vedit.sel;
  veditChange(steps => { steps.splice(i, 1); return steps.length ? { i: Math.min(i, steps.length - 1), s } : null; });
  if (!veditSong().steps.length) vedit.sel = null;
}

// a new bar of quarter rests to fill in
function veditAddBar() {
  veditChange((steps, song) => {
    const q = Math.max(1, song.grid / 4), barCells = song.timeSig[0] * song.grid / 4;
    // finish a part-filled last bar first, so the new bar starts on the bar line
    let left = (barCells - steps.reduce((a, st) => a + st.len, 0) % barCells) % barCells;
    while (left > 0) { const n = left % q || q; steps.push(restLike(n)); left -= n; }
    const first = steps.length;
    for (let k = 0; k < song.timeSig[0]; k++) steps.push(restLike(q));
    return { i: first, s: vedit.sel ? vedit.sel.s : 1 };
  });
}

function veditMove(di, ds) {
  if (!vedit.sel) return;
  const n = veditSong().steps.length;
  veditSelect(Math.max(0, Math.min(n - 1, vedit.sel.i + di)), Math.max(1, Math.min(6, vedit.sel.s + ds)));
}

// clicks on the TAB: the step under the pointer, and the nearest string line
$("eTab").addEventListener("click", e => {
  const g = e.target.closest(".tab-step"), svg = e.target.closest("svg");
  if (!g || !svg || veditSong().errors.length) return;
  const m = svg.getScreenCTM();
  const y = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).y : e.offsetY;
  const s = Math.max(1, Math.min(6, Math.round((y - TAB.top) / TAB.row) + 1));
  veditSelect(+g.dataset.i, s);
});

// the preview re-flows on resize and loses the cursor box; put it back
new MutationObserver(() => { if (vedit.sel && !$("eTab").querySelector(".tab-cursor")) drawCursor(); })
  .observe($("eTab"), { childList: true });

{
  const pad = $("vPad");
  for (let f = 0; f <= 15; f++) {
    const b = document.createElement("button"); b.type = "button"; b.dataset.fret = f; b.textContent = f;
    pad.append(b);
  }
  const x = document.createElement("button"); x.type = "button"; x.dataset.fret = "x"; x.textContent = "消す"; x.className = "clear";
  pad.append(x);
  pad.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b) veditSetFret(b.dataset.fret === "x" ? null : +b.dataset.fret);
  });
}
$("vLen").addEventListener("change", e => {
  const { i } = vedit.sel, len = +e.target.value;
  veditChange(steps => { steps[i].len = len; });
});
$("vTech").addEventListener("change", e => {
  const { i } = vedit.sel, v = e.target.value;
  veditChange(steps => {
    delete steps[i].tech; delete steps[i].bend;
    if (v) { steps[i].tech = v[0]; if (v[0] === "b") steps[i].bend = +v[1]; }
  });
});
$("vLoose").addEventListener("change", e => {
  const { i } = vedit.sel, on = e.target.checked;
  veditChange(steps => { if (on) steps[i].loose = true; else delete steps[i].loose; });
});
function applyChord() {
  if (!vedit.sel) return;
  const name = $("vChord").value.trim(), { i } = vedit.sel;
  if (!name) return;
  const notes = chordVoicing(name);
  if (!notes) { $("vWhere").textContent = `「${name}」はコード名として読めません`; return; }
  veditChange(steps => { const st = steps[i]; steps[i] = { notes, chord: name, len: st.len, ...(st.loose ? { loose: true } : {}) }; });
  $("vChord").blur();
}
$("vChordSet").addEventListener("click", applyChord);
$("vChord").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyChord(); } });
$("vInsBefore").addEventListener("click", () => veditInsert(false));
$("vInsAfter").addEventListener("click", () => veditInsert(true));
$("vRest").addEventListener("click", () => { const { i } = vedit.sel; veditChange(steps => { steps[i] = restLike(steps[i].len); }); });
$("vDel").addEventListener("click", veditDelete);
$("vAddBar").addEventListener("click", veditAddBar);
$("vStart").addEventListener("click", veditAddBar);
$("vUndo").addEventListener("click", veditUndo);
$("eText").addEventListener("input", () => { vedit.undo.length = 0; });

// keyboard (PC): digits = fret, arrows move, Delete clears, Enter adds a step after, Ctrl+Z undoes
document.addEventListener("keydown", e => {
  if ($("view-editor").hidden || e.target.closest("input, textarea, select")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { if (vedit.undo.length) { e.preventDefault(); veditUndo(); } return; }
  if (!vedit.sel || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (/^\d$/.test(k)) {
    // two digits typed quickly make a two-digit fret (1 then 2 = 12)
    const now = performance.now(), two = vedit.digit && now - vedit.digitAt < 800 && +(vedit.digit + k) <= 24;
    const f = two ? +(vedit.digit + k) : +k;
    vedit.digit = two ? "" : k; vedit.digitAt = now;
    veditSetFret(f);
  } else if (k === "ArrowLeft") veditMove(-1, 0);
  else if (k === "ArrowRight") veditMove(1, 0);
  else if (k === "ArrowUp") veditMove(0, -1);
  else if (k === "ArrowDown") veditMove(0, 1);
  else if (k === "Delete" || k === "Backspace") veditSetFret(null);
  else if (k === "Enter") veditInsert(true);
  else if (k === "Escape") { vedit.sel = null; previewEditor(); }
  else return;
  e.preventDefault();
});

previewEditor();
