/* ===== TAB editor (full screen, DTM style): click a note, edit it in the window below it ===== */
// The song text stays the source of truth: each edit changes the parsed steps and writes them back
// as text (stepsToText), and the TAB is drawn again from that text.

// marks for the whole note ("_.'?")
const stepFlags = st => (st.pm ? "_" : "") + (st.stac ? "." : "") + (st.grace ? "'" : "") + (st.loose ? "?" : "");
// a length in written cells: "2", or a fraction ("1/3") when the song counts in finer cells (scale)
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lenText = (len, scale = 1) => { const g = gcd(len, scale); return scale / g === 1 ? String(len / g) : `${len / g}/${scale / g}`; };
// one step as a text token ("6-3h?:2", "C", "r:2", "~:8", "6-3:1/3")
function stepToken(st, withLen, scale = 1) {
  const len = withLen && st.len !== scale && !st.grace ? ":" + lenText(st.len, scale) : "";
  if (st.tie) return "~" + marksText(st.tieMarks) + len;
  if (st.brush) return "x" + (st.loose ? "?" : "") + len;
  if (!st.notes.length) return "r" + len;
  const q = stepFlags(st);
  if (st.chord) return st.chord + q + len;
  // each string with its own marks, muted strings as "x", from the 6th string down
  const parts = st.notes.map(([s, f, m]) => [s, (m && m.harm ? `<${f}>` : f) + marksText(m)]).concat((st.mute || []).map(s => [s, "x"]));
  return parts.sort((a, b) => b[0] - a[0]).map(([s, f]) => `${s}-${f}`).join("+") + q + len;
}

// tempo and repeat marks around a token ("@[ @bpm120 C*4 @]3"): those before it from its first step,
// the repeat end from its last; volta: the ending it opens ("@alt2") or closes ("@alt0"), or ""
function marked(st, last, tok, volta, noBpm) {
  return (st.repStart ? "@[ " : "") + volta + (st.bpm && !noBpm ? `@bpm${st.bpm} ` : "") + tok
    + (last.repEnd ? (last.repEnd === 2 ? " @]" : ` @]${last.repEnd}`) : "");
}
// marks that belong to a place in the song, not to the note there (kept when the note is replaced)
const MARKS = ["bpm", "repStart", "repEnd", "volta", "comments"];
const withMarks = (from, st) => { for (const k of MARKS) if (from[k]) st[k] = from[k]; return st; };

const noteSig = st => JSON.stringify([st.notes.map(n => [n[0], n[1], marksText(n[2]) + (markOf(n).harm ? "<>" : "")]), st.mute || [],
  st.chord || "", st.len, !!st.loose, st.tie ? "~" + marksText(st.tieMarks) : "", !!st.pm, !!st.stac, !!st.grace, !!st.brush, st.volta || 0]);
const stepSig = st => noteSig(st) + JSON.stringify([st.bpm || 0, !!st.repStart, st.repEnd || 0]);

// Writes the steps as bar-separated text, keeping it short where the parser gives the same steps back
// ("| C*4 | G Am |" rather than "| C:2 C:2 C:2 C:2 | G:4 Am:4 |").
// The first step's tempo goes in front of the first bar ("@bpm90 | C G |").
// Comments ("% ...") go on their own lines before their step (tail: after the last bar).
// (grid: cells per whole note inside; scale: inside cells per written cell, for fractions like ":1/3")
function stepsToText(steps, grid, timeSig, prefix, tail, scale = 1) {
  const lines = st => (st.comments || []).map(c => `% ${c}\n`).join("");
  const barCells = timeSig[0] * grid / 4, bars = [];
  let cell = 0;
  for (const st of steps) { const b = Math.floor(cell / barCells); (bars[b] = bars[b] || []).push(st); cell += st.len; }
  // where an ending starts ("@altn"), and where one stops before a repeat end closed it ("@alt0")
  const voltaTok = new Map();
  steps.forEach((st, i) => {
    const prev = steps[i - 1], carried = prev && prev.volta && !prev.repEnd && !st.repStart ? prev.volta : 0;
    if ((st.volta || 0) !== carried) voltaTok.set(st, `@alt${st.volta || 0} `);
  });
  const opensVolta = { has: st => voltaTok.has(st) };
  const lead = steps[0] && steps[0].bpm ? `@bpm${steps[0].bpm} ` : "";
  // the parser reads the marks back too; a first ending runs on into the next bar
  const same = (a, b) => a.length === b.length && a.every((st, i) => stepSig(st) === stepSig(b[i]));
  const strip = st => { const c = { ...st }; delete c.tempo; delete c.capo; return c; };
  const out = bars.filter(Boolean).map((bar, bi) => {
    // runs of the same chord with the same length (and no marks) become "C*4"
    const runs = [];
    // (marks can open a run, and a repeat end close it)
    for (const st of bar) {
      const r = runs[runs.length - 1];
      if (r && !st.bpm && !st.grace && !st.repStart && !st.comments && !opensVolta.has(st) && !r.last.repEnd && st.chord && r.st.chord === st.chord && noteSig(r.st) === noteSig(st)) { r.n++; r.last = st; }
      else runs.push({ st, last: st, n: 1 });
    }
    const tok = (r, open) => {
      let t;
      if (!r.st.chord || r.n === 1) t = open && r.st.chord ? stepToken(r.st, false, scale) : stepToken(r.st, true, scale);
      else t = `${r.st.chord}*${r.n}${stepFlags(r.st)}` + (open ? "" : ":" + lenText(r.st.len * r.n, scale));
      // (a comment inside the bar breaks the line there; one on the bar's first note goes before the bar)
      return (r.st !== bar[0] && r.st.comments ? "\n" + lines(r.st) : "") + marked(r.st, r.last, t, voltaTok.get(r.st) || "", r.st === steps[0]);
    };
    const short = runs.map(r => tok(r, true)).join(" ");
    const pre = (bi === 0 ? lead : "") + (bar[0].volta && !voltaTok.has(bar[0]) ? `@alt${bar[0].volta} ` : "");
    const back = parseSongText(`${pre}|${short}|`, { grid: grid / scale, timeSig }).steps;
    back.forEach(st => { st.len = Math.round(st.len * scale); });
    if (same(back, bar.map(strip))) return short;
    return runs.map(r => tok(r, false)).join(" ");
  });
  const fb = bars.filter(Boolean);
  const body = out.map((b, k) => (k && fb[k][0].comments ? " |\n" + lines(fb[k][0]) + "| " : k ? " | " : "") + b).join("");
  const head = steps[0] && steps[0].comments ? (prefix ? prefix.trim() + "\n" : "") + lines(steps[0]) : prefix || "";
  const end = tail && tail.length ? "\n" + tail.map(c => `% ${c}`).join("\n") : "";
  return (head + lead + "| " + body + " |" + end).replace(/ +\n/g, "\n");
}

function lenChoices(grid, cur) {
  const list = [[grid / 24, "3連16分"], [grid / 12, "3連8分"], [grid / 6, "3連4分"], [grid / 16, "16分"], [grid / 8, "8分"], [grid * 3 / 16, "付点8分"], [grid / 4, "4分"], [grid * 3 / 8, "付点4分"],
    [grid / 2, "2分"], [grid * 3 / 4, "付点2分"], [grid, "全"]].filter(([n]) => Number.isInteger(n) && n >= 1);
  const seen = new Set(), out = [];
  for (const [n, l] of list) if (!seen.has(n)) { seen.add(n); out.push([n, l + "音符"]); }
  if (cur && !seen.has(cur)) out.push([cur, `${lenText(cur, (ed.song && ed.song.scale) || 1)}マス`]);
  return out.sort((a, b) => a[0] - b[0]);
}

const ED_DRAFT = "guitaric.draft";
const ED_DISCARD = "保存していない変更があります。\n変更を破棄しますか？";
const NEW_SONG_TEXT = "| r:2 r:2 r:2 r:2 |";
const ed = {
  loaded: false, id: null, grid: 8, text: "", saved: "",
  song: null, tab: null, sel: null, popOpen: false, bar: null,
  undo: [], redo: [], digit: "", digitAt: 0, clip: null, play: null,
};

const edSnapshot = () => JSON.stringify([$("edTitle").value.trim(), ed.text]);
const edDirty = () => ed.loaded && edSnapshot() !== ed.saved;
const cloneStep = st => ({ ...st, notes: st.notes.map(n => (n[2] ? [n[0], n[1], { ...n[2] }] : n.slice())), ...(st.mute ? { mute: st.mute.slice() } : {}),
  ...(st.tieMarks ? { tieMarks: { ...st.tieMarks } } : {}) });

function edSaveDraft() {
  try {
    localStorage.setItem(ED_DRAFT, JSON.stringify({ id: ed.id, grid: ed.grid, title: $("edTitle").value, text: ed.text, saved: ed.saved }));
  } catch (e) {}
}

// Opens a song (null = new song) in the editor and switches to it.
function openEditor(s) {
  if (edDirty() && !confirm(ED_DISCARD)) return;
  edLoad(s ? { id: s.id, grid: s.grid || 8, title: s.title, text: textWithBpm(s) } : null);
  location.hash = "edit";
}

function edLoad(d, saved) {
  edStop(false);
  ed.loaded = true;
  ed.id = d ? d.id : null;
  ed.grid = (d && d.grid) || 8;
  ed.text = d ? textWithBpm(d) : NEW_SONG_TEXT; // (a draft from before "@bpm" carries d.bpm)
  $("edTitle").value = d ? d.title : "";
  ed.undo = []; ed.redo = [];
  ed.saved = saved || (d && d.id ? edSnapshot() : "");
  ed.sel = { i: 0, s: 1 }; ed.popOpen = false; ed.bar = null;
  edRender();
  edSaveDraft();
}

// called when the editor view is shown: keep what is open, or bring back the draft from last time
function edEnsureOpen() {
  if (ed.loaded) { edRender(); return; }
  let d = null;
  try { d = JSON.parse(localStorage.getItem(ED_DRAFT) || "null"); } catch (e) {}
  edLoad(d, d && d.saved);
}

function edRender() {
  ed.song = buildSong({ text: ed.text, grid: ed.grid });
  const song = ed.song, n = song.steps.length;
  if (ed.sel && ed.sel.i >= n) ed.sel = n ? { i: n - 1, s: ed.sel.s } : null;
  if (!ed.sel && n) ed.sel = { i: 0, s: 1 };
  ed.tab = n ? renderTab($("edTab"), song, { barStrip: true }) : null;
  if (!n) $("edTab").innerHTML = '<p class="empty">まだ何もありません</p>';
  if (ed.sel && ed.tab && ed.bar == null) ed.tab.setState(ed.sel.i, "current");
  if (ed.play && ed.tab) ed.tab.setPlaying(ed.play.cur);
  edDrawCursor();
  edStatus();
  edShowPop();
  edShowBarPop();
  if (!song.errors.length) $("edCapo").value = song.capo || 0;
  $("edUndo").disabled = !ed.undo.length;
  $("edRedo").disabled = !ed.redo.length;
  $("edSave").disabled = !n;
  $("edSave").dataset.dirty = edDirty() ? "1" : "";
}

// "3小節目 2+1/16拍目": the beat, plus how far into it as a note value
function edWhere(i) {
  const song = ed.song, barCells = song.timeSig[0] * song.grid / 4, beat = song.grid / 4;
  const cell = song.steps.slice(0, i).reduce((a, x) => a + x.len, 0), inBar = cell % barCells;
  const b = Math.floor(inBar / beat) + 1, off = inBar % beat;
  const g = gcd(off, song.grid);
  return `${Math.floor(cell / barCells) + 1}小節目 ${b}${off ? `+${off / g}/${song.grid / g}` : ""}拍目`;
}

function edStatus(msg) {
  const el = $("edStatus");
  el.classList.toggle("bad", !!ed.song.errors.length);
  if (ed.song.errors.length) {
    el.textContent = "読めない所があります：" + ed.song.errors.join(" / ");
    return;
  }
  if (msg) { el.textContent = msg; return; }
  if (!ed.sel) { el.textContent = ""; return; }
  const st = ed.song.steps[ed.sel.i];
  const len = (lenChoices(ed.song.grid, st.len).find(([n]) => n === st.len) || [0, ""])[1];
  el.textContent = `${edWhere(ed.sel.i)}・${ed.sel.s}弦 ― ${st.tie ? "タイ" : stepLabel(st)}（${len}）`;
}

// a box around the selected string of the selected step
function edDrawCursor() {
  const old = $("edTab").querySelector(".tab-cursor");
  if (old) old.remove();
  if (!ed.sel || ed.bar != null) return;
  const g = $("edTab").querySelector(`.tab-step[data-i="${ed.sel.i}"]`);
  if (!g) return;
  const hl = g.querySelector(".tab-hl");
  const x = +hl.getAttribute("x") - 2, w = +hl.getAttribute("width") + 4;
  const cx = x + Math.min(w, TAB.minStep) / 2, y = TAB.top + (ed.sel.s - 1) * TAB.row;
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of Object.entries({ x: cx - 13, y: y - 10, width: 26, height: 20, rx: 4, class: "tab-cursor" })) r.setAttribute(k, v);
  hl.after(r);
}

/* ----- the edit window under the selected note ----- */
// the 音価 slider, short to long (fractions of a whole note); dotted values sit between the plain ones
const LEN_VALUES = [[1 / 32, "32分"], [1 / 16, "16分"], [3 / 32, "付点16分"], [1 / 8, "8分"], [3 / 16, "付点8分"],
  [1 / 4, "4分"], [3 / 8, "付点4分"], [1 / 2, "2分"], [3 / 4, "付点2分"], [1, "全"]];
const MAX_FRET = 22;
// slider position for a step's length (the nearest value when it is not a standard one)
function lenPos(len, grid) {
  const v = len / grid;
  let best = 0;
  LEN_VALUES.forEach(([x], k) => { if (Math.abs(Math.log2(v / x)) < Math.abs(Math.log2(v / LEN_VALUES[best][0]))) best = k; });
  return best;
}
// a bend release's amount: its own, else the bend it lets down (same string and fret), else full
function releaseBend(i, n) {
  if (n[2].move[1]) return +n[2].move[1];
  for (let k = i - 1; k >= 0; k--) {
    const m = ed.song.steps[k].notes.find(x => x[0] === n[0] && x[1] === n[1] && bendOf(x[2]));
    if (m) return bendOf(m[2]);
  }
  return 2;
}

function edShowPop() {
  const pop = $("edPop");
  const g = ed.sel && $("edTab").querySelector(`.tab-step[data-i="${ed.sel.i}"]`);
  if (!ed.popOpen || !g || ed.play || ed.song.errors.length) { pop.hidden = true; return; }
  const i = ed.sel.i, st = ed.song.steps[i], s = ed.sel.s;
  // tabs: note / rest / brushing
  const kind = st.brush ? "brush" : st.notes.length || st.tie ? "note" : "rest";
  $("popKind").querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.kind === kind)));
  $("popNote").hidden = kind === "rest";
  $("popPlay").disabled = !isPlayed(st) && !st.tie;
  $("popFrets").querySelectorAll(".fret-row").forEach(row => {
    // -2: not played, -1: muted (x), 0..: the fret
    const rs = +row.dataset.s, n = st.notes.find(x => x[0] === rs);
    const f = n ? n[1] : st.brush || (st.mute || []).includes(rs) ? -1 : -2;
    const range = row.querySelector("input");
    if (document.activeElement !== range || +range.value !== f) range.value = Math.min(f, MAX_FRET);
    row.querySelector("output").textContent = f === -2 ? "–" : f === -1 ? "x" : f;
    row.classList.toggle("sel", rs === s);
    row.classList.toggle("on", f >= 0);
  });
  if (document.activeElement !== $("popChord")) $("popChord").value = st.chord || "";
  // the selected string's marks (only on a note written string by string); a tie's marks move every
  // held note (no start, no harmonics)
  const n = !st.chord && st.notes.find(x => x[0] === s), m = st.tie ? st.tieMarks || {} : n ? markOf(n) : {};
  for (const id of ["popStart", "popMove", "popVib", "popFast", "popHarm", "popTrill"]) $(id).disabled = !n && !(st.tie && !/Start|Harm/.test(id));
  $("popStart").value = m.start || "";
  $("popMove").value = !m.move ? "" : m.move[0] === "d" ? (n ? "d" + releaseBend(i, n) : m.move[1] ? m.move : "d2") : m.move;
  $("popTrill").hidden = m.move !== "t";
  if (m.move === "t" && document.activeElement !== $("popTrill")) $("popTrill").value = m.trill;
  $("popVib").checked = !!m.v;
  $("popFast").checked = !!m.fast;
  $("popFast").disabled = (!n && !st.tie) || !(m.start === "s" || m.start === "i" || (m.move && "bdo".includes(m.move[0])));
  $("popHarm").checked = !!m.harm;
  $("popHarm").disabled = !n || !HARMONICS[n[1]];
  // marks for the whole note
  const sounding = st.notes.length > 0;
  for (const [id, k] of [["popPm", "pm"], ["popStac", "stac"], ["popGrace", "grace"], ["popLoose", "loose"]]) {
    $(id).checked = !!st[k];
    $(id).disabled = k === "loose" ? !isPlayed(st) : !sounding;
  }
  $("popLen").disabled = !!st.grace;
  $("popLen").value = lenPos(st.len, ed.song.grid);
  pop.hidden = false;
  // just below the note, kept inside the editor's width
  const body = $("edBody").getBoundingClientRect(), hl = g.querySelector(".tab-hl").getBoundingClientRect();
  const left = Math.max(0, Math.min(hl.left - body.left - 8, body.width - pop.offsetWidth));
  pop.style.left = left + "px";
  pop.style.top = (hl.bottom - body.top + 4) + "px";
  const r = pop.getBoundingClientRect();
  if (r.bottom > innerHeight && !pop.contains(document.activeElement)) window.scrollBy(0, Math.min(r.bottom - innerHeight + 8, r.top - 120));
}

function edSelect(i, s, open) {
  ed.sel = { i, s };
  ed.digit = ""; ed.bar = null;
  if (open != null) ed.popOpen = open;
  edRender();
  if (ed.tab) ed.tab.scrollTo(i);
}

/* ----- edits ----- */
// apply a change to a copy of the steps and write the result back as text
// opts.grid: switch the song to a finer grid first (all lengths scaled); opts.capo: a new capo fret;
// opts.merge: a key that makes repeated changes of the same control (a slider being dragged) one undo step
function edChange(fn, opts = {}) {
  if (ed.song.errors.length) return;
  let grid = ed.song.grid;
  const capo = opts.capo ?? ed.song.capo;
  const steps = ed.song.steps.map(cloneStep);
  if (opts.grid && opts.grid > grid) {
    steps.forEach(st => { st.len *= opts.grid / grid; });
    grid = opts.grid;
  }
  const sel = fn(steps, { ...ed.song, grid });
  if (sel === false) return;
  // the grid (when not the song's own) and the capo lead the text: "@cell16 @capo3 | ... |"
  // (the written cell: a song with triplets counts in finer cells inside)
  const scale = ed.song.scale || 1, written = grid / scale;
  const prefix = [written !== ed.grid ? `@cell${written}` : "", capo ? `@capo${capo}` : ""].filter(Boolean).join(" ");
  const tail = ed.song.tail || [];
  edSetText(steps.length ? stepsToText(steps, grid, ed.song.timeSig, prefix ? prefix + " " : "", tail, scale)
    : [prefix, ...tail.map(c => `% ${c}`)].filter(Boolean).join("\n"), sel, opts.merge);
}

function edSetText(text, sel, merge) {
  if (text === ed.text) return;
  const now = performance.now();
  if (!(merge && ed.merge === merge && now - ed.mergeAt < 2000)) {
    ed.undo.push({ text: ed.text, sel: ed.sel });
    if (ed.undo.length > 200) ed.undo.shift();
  }
  ed.merge = merge || null; ed.mergeAt = now;
  ed.redo = [];
  ed.text = text;
  if (sel) ed.sel = sel;
  edRender();
  edSaveDraft();
}

function edUndo(redo) {
  const from = redo ? ed.redo : ed.undo, to = redo ? ed.undo : ed.redo;
  if (!from.length) return;
  const u = from.pop();
  to.push({ text: ed.text, sel: ed.sel });
  ed.text = u.text; ed.sel = u.sel;
  edRender();
  edSaveDraft();
}

const asNotes = st => { delete st.chord; delete st.tie; delete st.brush; };
// f: a fret, "x" (muted) or null (not played); a fret keeps the string's marks
function setFret(st, s, f) {
  const brush = st.brush;
  asNotes(st);
  const old = st.notes.find(n => n[0] === s);
  st.notes = st.notes.filter(n => n[0] !== s);
  // a brushing stroke given a fret becomes that note alone
  const mute = brush ? [] : (st.mute || []).filter(m => m !== s);
  if (f === "x") mute.push(s);
  else if (f != null) {
    const m = old && old[2] ? { ...old[2] } : {};
    if (m.harm && !HARMONICS[f]) delete m.harm; // no harmonic at that fret
    if (m.move === "t" && m.trill === f) m.trill = f + 2 > 24 ? f - 2 : f + 2;
    st.notes.push(Object.keys(m).length ? [s, f, m] : [s, f]);
  }
  st.notes.sort((a, b) => b[0] - a[0]);
  if (mute.length) st.mute = mute.sort((a, b) => b - a); else delete st.mute;
  // no string sounding: a brushing stroke
  if (!st.notes.length) { delete st.pm; delete st.stac; delete st.grace; delete st.mute; st.brush = true; if (!st.len) st.len = 1; }
}
const restStep = len => ({ notes: [], len });

function edFret(f, string, merge) {
  if (!ed.sel) return;
  const i = ed.sel.i, s = string || ed.sel.s;
  edChange(steps => { setFret(steps[i], s, f); return { i, s }; }, { merge });
}

// a mark on the selected string's note: key "start" ("h" "p" "s" "i"), "move" ("b" "b1" "d2" "d1" "o" "t"),
// "v", "fast", "harm"; value "" / false takes it off; toggle: the same one again takes it off
function edMark(key, value, toggle) {
  if (!ed.sel) return;
  const { i, s } = ed.sel, st = ed.song.steps[i];
  const n = !st.chord && st.notes.find(x => x[0] === s);
  if (st.tie && (key === "start" || key === "harm")) return;
  if (!n && !st.tie) { edStatus(`${s}弦に音を置いてから選んでください`); return; }
  const m = st.tie ? st.tieMarks || {} : markOf(n);
  if (toggle && (m[key] === value || (key === "move" && value[0] === "d" && m.move && m.move[0] === "d"))) value = "";
  if (key === "harm" && value && !HARMONICS[n[1]]) { edStatus("ハーモニクスは 3・4・5・7・9・12・16・19・24 フレットです"); return; }
  edChange(steps => {
    const tie = steps[i].tie, t = tie ? null : steps[i].notes.find(x => x[0] === s), mm = { ...(tie ? steps[i].tieMarks : markOf(t)) };
    // (a tie's trill goes to the held note's fret + 2)
    const held = tie ? (steps.slice(0, i).reverse().find(x => x.notes.length) || { notes: [[s, 0]] }).notes : null;
    const fret = tie ? (held.find(x => x[0] === s) || held[0])[1] : t[1];
    if (value) mm[key] = value; else delete mm[key];
    if (key === "move") {
      delete mm.trill;
      if (value === "t") mm.trill = Math.max(0, Math.min(24, fret + 2 > 24 ? fret - 2 : fret + 2));
      if (value === "d2") mm.move = "d2";
    }
    // "!" only for a slide or a bend
    if (mm.fast && !(mm.start === "s" || mm.start === "i" || (mm.move && "bdo".includes(mm.move[0])))) delete mm.fast;
    if (tie) { if (Object.keys(mm).length) steps[i].tieMarks = mm; else delete steps[i].tieMarks; return; }
    t.length = 2;
    if (Object.keys(mm).length) t.push(mm);
  });
}
function edTrill(f) {
  if (!ed.sel || !(f >= 0 && f <= 24)) return;
  const { i, s } = ed.sel;
  const st = ed.song.steps[i], n = st.notes.find(x => x[0] === s);
  if (st.tie ? !st.tieMarks || st.tieMarks.move !== "t" : !n || markOf(n).move !== "t" || f === n[1]) return;
  edChange(steps => { (steps[i].tie ? steps[i].tieMarks : steps[i].notes.find(x => x[0] === s)[2]).trill = f; });
}
// a mark for the whole note: "pm" "stac" "grace" "loose"
function edFlag(key, on) {
  if (!ed.sel) return;
  const { i } = ed.sel, st = ed.song.steps[i];
  if (key === "loose" ? !isPlayed(st) : !st.notes.length) return;
  if (on == null) on = !st[key];
  edChange(steps => {
    const t = steps[i];
    if (on) t[key] = true; else delete t[key];
    // a grace note has no length; taken off, it gets one cell
    if (key === "grace") t.len = on ? 0 : t.len || 1;
  });
}

/* ----- the bar window: tempo and repeats belong to bars ----- */
// steps grouped into bars (as on the TAB)
function barsOf(song) {
  const barCells = song.timeSig[0] * song.grid / 4, bars = [[]];
  let cells = 0;
  song.steps.forEach((st, i) => {
    bars[bars.length - 1].push(i);
    cells += st.len;
    if (st.len > 0 && cells % barCells === 0 && i < song.steps.length - 1) bars.push([]); // (a grace note never ends one)
  });
  return bars;
}

function edOpenBar(b) {
  const bar = barsOf(ed.song)[b];
  if (!bar) return;
  if (ed.play) edStop(false);
  ed.bar = b; ed.popOpen = false;
  ed.sel = { i: bar[0], s: ed.sel ? ed.sel.s : 1 };
  edRender();
}
function edCloseBar() { ed.bar = null; edRender(); }

function edShowBarPop() {
  const pop = $("edBarPop"), bars = ed.song.steps.length ? barsOf(ed.song) : [];
  if (ed.bar != null && !bars[ed.bar]) ed.bar = null;
  $("edTab").querySelectorAll(".tab-barhead").forEach(r => r.classList.toggle("sel", +r.dataset.bar === ed.bar));
  const hit = ed.bar != null && $("edTab").querySelector(`.tab-barhit[data-bar="${ed.bar}"]`);
  if (!hit || ed.play || ed.song.errors.length) { pop.hidden = true; return; }
  const steps = ed.song.steps, bar = bars[ed.bar], a = bar[0], z = bar[bar.length - 1];
  $("barTitle").textContent = `${ed.bar + 1}小節目`;
  // tempo at the bar's start: the first bar always sets it; later bars change it only when ticked
  $("barBpmOn").checked = a === 0 || !!steps[a].bpm;
  $("barBpmOn").disabled = a === 0;
  $("barBpm").disabled = !$("barBpmOn").checked;
  if (document.activeElement !== $("barBpm")) $("barBpm").value = steps[a].tempo || ed.song.bpm || 80;
  // |: starts a repeat outside any (explicit) repeat; :|, the ending and the count belong to the repeat
  const bs = blockOf(ed.song, a), be = blockOf(ed.song, z), blk = be || bs, nv = nextVolta(ed.song, a);
  $("barRepStart").setAttribute("aria-pressed", String(!!steps[a].repStart));
  $("barRepStart").disabled = !!bs && bs.start !== a && !!steps[bs.start].repStart;
  $("barRepEnd").setAttribute("aria-pressed", String(!!steps[z].repEnd || !!steps[z].autoEnd));
  $("barRepEnd").disabled = !be;
  $("barVolta").textContent = (nv || (blk ? blk.count : 1)) + ".";
  $("barVolta").setAttribute("aria-pressed", String(!!steps[a].volta));
  $("barVolta").disabled = !nv;
  $("barRepCount").value = blk ? blk.count : 2;
  $("barRepCount").disabled = !blk;
  pop.hidden = false;
  // just below the strip, kept inside the editor's width
  const body = $("edBody").getBoundingClientRect(), r0 = hit.getBoundingClientRect();
  pop.style.left = Math.max(0, Math.min(r0.left - body.left, body.width - pop.offsetWidth)) + "px";
  pop.style.top = (r0.bottom - body.top + 4) + "px";
  const r = pop.getBoundingClientRect();
  if (r.bottom > innerHeight && !pop.contains(document.activeElement)) window.scrollBy(0, Math.min(r.bottom - innerHeight + 8, r.top - 120));
}

// the tempo from the bar's start ("@bpm"): on = change it here (always on for the first bar)
function edBarBpmOn(on) {
  if (ed.bar == null) return;
  const a = barsOf(ed.song)[ed.bar][0], v = ed.song.steps[a].tempo || ed.song.bpm || 80;
  edChange(steps => { if (on || a === 0) steps[a].bpm = v; else delete steps[a].bpm; });
}
function edBarBpm(v) {
  if (ed.bar == null || !(v >= 20 && v <= 300)) return;
  const a = barsOf(ed.song)[ed.bar][0];
  edChange(steps => { steps[a].bpm = v; }, { merge: "bpm" });
}
// the repeat a step is in (null: none)
const blockOf = (song, i) => repeatBlocks(song.steps.map(cloneStep)).find(b => i >= b.start && i <= b.end) || null;
// the number the ending button offers at step i: its own, or one past the last ending before it in its
// repeat (null: past the repeat's count)
function nextVolta(song, i) {
  const st = song.steps[i], b = blockOf(song, i);
  if (st.volta) return st.volta;
  if (!b) return null;
  const n = Math.max(0, ...song.steps.slice(b.start, i).map(x => x.volta || 0)) + 1;
  return n <= b.count ? n : null;
}

// repeat marks of the bar: "start" (|: at its start), "end" (:| at its end; moves its repeat's end here),
// "volta" (the next ending, from this bar to the next ending or the repeat's end; again: off from here),
// "count" (how many times its repeat plays)
function edBarRepeat(kind, n) {
  if (ed.bar == null) return;
  const bar = barsOf(ed.song)[ed.bar], a = bar[0], z = bar[bar.length - 1];
  const bs = blockOf(ed.song, a), be = blockOf(ed.song, z), v = kind === "volta" ? nextVolta(ed.song, a) : 0;
  if (kind === "volta" && !v) return;
  edChange(steps => {
    if (kind === "start") {
      if (steps[a].repStart) delete steps[a].repStart;
      else if (!(bs && bs.start !== a && steps[bs.start].repStart)) steps[a].repStart = true;
    } else if (kind === "end") {
      if (steps[z].repEnd) delete steps[z].repEnd;
      else if (be) { const count = steps[be.end].repEnd || 2; delete steps[be.end].repEnd; steps[z].repEnd = count; }
    } else if (kind === "count") { const b = be || bs; if (b) steps[b.end].repEnd = n; }
    else if (steps[a].volta) {
      const was = steps[a].volta;
      for (let k = a; k < steps.length && steps[k].volta === was; k++) delete steps[k].volta;
    } else {
      for (let k = a; k <= Math.max(bs ? bs.end : z, z); k++) { if (k > a && steps[k].volta) break; steps[k].volta = v; }
    }
  });
}

function edLen(len) {
  if (!ed.sel) return;
  const { i } = ed.sel;
  edChange(steps => { steps[i].len = len; delete steps[i].grace; });
}
// from the 音価 slider; a value finer than the grid makes the grid finer
function edLenValue(k) {
  if (!ed.sel) return;
  const v = LEN_VALUES[k][0];
  let grid = ed.song.grid;
  while (!Number.isInteger(v * grid) && grid < 32) grid *= 2;
  if (!Number.isInteger(v * grid)) return;
  const { i } = ed.sel;
  edChange(steps => { steps[i].len = v * grid; delete steps[i].grace; }, { grid, merge: "len" });
}
function edLenStep(dir) {
  if (!ed.sel) return;
  const st = ed.song.steps[ed.sel.i], list = lenChoices(ed.song.grid, st.len).map(([n]) => n);
  const k = list.indexOf(st.len) + dir;
  if (k >= 0 && k < list.length) edLen(list[k]);
}

function edInsert(after, step) {
  if (!ed.sel) return;
  const { i, s } = ed.sel, at = after ? i + 1 : i;
  // a copy of the current step (or of the given one: paste / duplicate), without its tempo or repeat marks
  edChange(steps => {
    const c = cloneStep(step || steps[i]);
    delete c.bpm; delete c.repStart; delete c.repEnd; delete c.comments;
    if (!(steps[at] && steps[at - 1] && steps[at].volta && steps[at - 1].volta === steps[at].volta)) delete c.volta;
    steps.splice(at, 0, c); return { i: at, s };
  });
}

function edDelete() {
  if (!ed.sel) return;
  const { i, s } = ed.sel;
  edChange(steps => {
    // a tempo change or repeat start moves on to the next step, a repeat end back to the one before
    const [gone] = steps.splice(i, 1), next = steps[i], prev = steps[i - 1];
    if (next) {
      if (gone.bpm && !next.bpm) next.bpm = gone.bpm;
      if (gone.repStart) next.repStart = true;
      if (gone.comments) next.comments = [...gone.comments, ...(next.comments || [])];
    }
    if (prev && gone.repEnd && !prev.repEnd) prev.repEnd = gone.repEnd;
    return steps.length ? { i: Math.min(i, steps.length - 1), s } : null;
  });
}

function edRest() {
  if (!ed.sel) return;
  const { i } = ed.sel;
  edChange(steps => { steps[i] = withMarks(steps[i], restStep(steps[i].len || 1)); });
}

// brushing (every string muted, "x"); toggle: again turns it back into a rest
function edBrush(toggle) {
  if (!ed.sel) return;
  const { i } = ed.sel;
  edChange(steps => { const len = steps[i].len || 1; steps[i] = withMarks(steps[i], toggle && steps[i].brush ? restStep(len) : { notes: [], brush: true, len }); });
}


function edCapo(n) {
  edChange(() => {}, { capo: n });
}

function edChord(name) {
  if (!ed.sel || !name) return;
  const notes = chordVoicing(name);
  if (!notes) { edStatus(`「${name}」はコード名として読めません`); return; }
  const { i } = ed.sel;
  edChange(steps => {
    const st = steps[i], c = { notes, chord: name, len: st.len || 1 };
    for (const k of ["loose", "pm", "stac", "grace"]) if (st[k]) c[k] = true;
    if (c.grace) c.len = 0;
    steps[i] = withMarks(st, c);
  });
}

// a new bar of quarter rests at the end (a part-filled last bar is finished first)
function edAddBar() {
  if (ed.song.errors.length) return;
  edChange((steps, song) => {
    const q = Math.max(1, song.grid / 4), barCells = song.timeSig[0] * song.grid / 4;
    let left = (barCells - steps.reduce((a, st) => a + st.len, 0) % barCells) % barCells;
    while (left > 0) { const n = left % q || q; steps.push(restStep(n)); left -= n; }
    const first = steps.length;
    for (let k = 0; k < song.timeSig[0]; k++) steps.push(restStep(q));
    return { i: first, s: ed.sel ? ed.sel.s : 1 };
  });
  if (ed.tab && ed.sel) ed.tab.scrollTo(ed.sel.i);
}

function edMove(di, ds) {
  if (!ed.sel) return;
  const n = ed.song.steps.length;
  edSelect(Math.max(0, Math.min(n - 1, ed.sel.i + di)), Math.max(1, Math.min(6, ed.sel.s + ds)));
}

/* ----- playback ----- */

function edPlay() {
  if (ed.play) { edStop(false); return; }
  if (!ed.song || !ed.song.steps.length) return;
  ensureContext();
  if (ctx.state === "suspended") ctx.resume();
  const from = ed.sel ? ed.sel.i : 0;
  const gain = ctx.createGain(); gain.gain.value = transportGain(); gain.connect(ctx.destination);
  // each step's tempo ("@bpm") times the playback speed (0.2x ... 1.5x)
  const r = scheduleSong(ed.song, from, transport.rate, gain, i => {
    if (!ed.play) return;
    ed.play.cur = i;
    if (ed.tab) { ed.tab.setPlaying(i); ed.tab.scrollTo(i); }
  });
  ed.play = { ...r, from, cur: from, gain };
  scheduleSongClicks(ed.song, from, transport.rate, r.start, gain);
  ed.play.timers.push(whenHeard([{ t: r.end, fn: () => edStop(true) }]));
  setIcon($("edPlay"), "square"); $("edPlay").setAttribute("aria-label", "停止"); $("edPlay").classList.add("on");
  edRender();
}


// natural: the song played to its end (its last note is left to ring out)
function edStop(natural) {
  const p = ed.play;
  if (!p) return;
  ed.play = null;
  p.timers.forEach(clearTimeout);
  if (natural) setTimeout(() => p.gain.disconnect(), 2500);
  else { p.sources.forEach(src => { try { src.stop(); } catch (e) {} }); p.gain.disconnect(); }
  if (ed.tab) ed.tab.setPlaying(-1);
  if (ed.sel) ed.sel = { i: transport.stopMode === "return" ? p.from : p.cur, s: ed.sel.s };
  setIcon($("edPlay"), "play"); $("edPlay").setAttribute("aria-label", "再生"); $("edPlay").classList.remove("on");
  if (ed.loaded) { edRender(); if (ed.tab && ed.sel) ed.tab.scrollTo(ed.sel.i); }
}

/* ----- save / leave ----- */
function edSave() {
  if (!ed.song.steps.length) return;
  const list = loadUserSongs();
  const entry = { id: ed.id || "song-" + Date.now().toString(36), title: $("edTitle").value.trim() || "無題の曲", text: ed.text.trim() };
  if (ed.grid !== 8) entry.grid = ed.grid;
  const at = list.findIndex(x => x.id === entry.id);
  if (at >= 0) list[at] = entry; else list.unshift(entry);
  if (!saveUserSongs(list)) { edStatus("このブラウザでは保存できませんでした"); return; }
  ed.id = entry.id;
  ed.saved = edSnapshot();
  edSaveDraft();
  edRender();
  edStatus("保存しました");
  renderSongList();
  if (practice.songId === entry.id && !practice.fromEditor) loadPractice(entry.id);
}

// 練習: practice this song; unsaved changes are discarded after asking
function edPractice() {
  edStop(false);
  if (!edDirty() && ed.id) { openPractice(ed.id); return; }
  if (!edDirty() && !ed.id) { edGoPractice(); return; }
  if (!confirm(ED_DISCARD)) return;
  // the changes are dropped: practice the saved song (a song never saved has nothing to practice)
  edRevert();
  if (ed.id) openPractice(ed.id); else location.hash = "songs";
}
// back to the song as saved (a new song: empty), so coming back to the editor shows that
function edRevert() {
  const s = ed.id && loadUserSongs().find(x => x.id === ed.id);
  edLoad(s ? { id: s.id, grid: s.grid || 8, title: s.title, text: textWithBpm(s) } : null);
}
// practice what the editor holds now, without saving it
function edGoPractice() {
  if (ed.song.errors.length || !ed.song.steps.length) { edStatus("練習できる音がありません"); return; }
  loadPracticeSong({ title: $("edTitle").value.trim() || "無題の曲", text: ed.text, grid: ed.grid }, true);
  location.hash = "practice";
}

function edBack() {
  if (edDirty()) { if (!confirm(ED_DISCARD)) return; edRevert(); }
  edStop(false);
  location.hash = "songs";
}

/* ----- text input (secondary) ----- */
function edOpenText() {
  $("edTextArea").value = ed.text;
  $("edTextErr").textContent = "";
  $("edTextDlg").showModal();
}
function edApplyText() {
  const text = $("edTextArea").value.trim();
  const song = buildSong({ text, grid: ed.grid });
  if (song.errors.length) { $("edTextErr").textContent = song.errors.join(" / "); return; }
  // fewer notes than now: something written would be lost
  if (song.steps.length < ed.song.steps.length && !confirm(`今の${ed.song.steps.length}音が${song.steps.length}音になります。\n反映しますか？`)) return;
  edSetText(text, { i: 0, s: ed.sel ? ed.sel.s : 1 });
  $("edTextDlg").close();
}

/* ----- wiring ----- */
{
  // one fret slider per string (1st string on top, as on the TAB); far left: not played, then x (muted)
  const frets = $("popFrets");
  for (let s = 1; s <= 6; s++) {
    const row = document.createElement("label"); row.className = "fret-row"; row.dataset.s = s;
    row.innerHTML = `<span class="fret-str">${s}<small>${STRING_LABELS[s - 1]}</small></span>` +
      `<input type="range" min="-2" max="${MAX_FRET}" step="1" aria-label="${s}弦のフレット"><output></output>`;
    const range = row.querySelector("input");
    range.addEventListener("input", () => { const f = +range.value; edFret(f === -2 ? null : f === -1 ? "x" : f, s, "fret" + s); });
    row.addEventListener("pointerdown", () => { if (ed.sel && ed.sel.s !== s) { ed.sel = { i: ed.sel.i, s }; edDrawCursor(); edStatus(); edShowPop(); } });
    frets.append(row);
  }
}
$("popKind").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || !ed.sel) return;
  const st = ed.song.steps[ed.sel.i];
  // a rest made a note starts with every string muted (brushing) until frets are chosen
  if (b.dataset.kind === "rest" && (isPlayed(st) || st.tie)) edRest();
  else if (b.dataset.kind === "brush" && !st.brush) edBrush(false);
  else if (b.dataset.kind === "note" && !st.notes.length && !st.tie && !st.brush) edBrush(false);
  else edShowPop();
});
$("popStart").addEventListener("change", e => edMark("start", e.target.value));
$("popMove").addEventListener("change", e => edMark("move", e.target.value));
$("popTrill").addEventListener("change", e => edTrill(Math.round(+e.target.value)));
$("popVib").addEventListener("change", e => edMark("v", e.target.checked));
$("popFast").addEventListener("change", e => edMark("fast", e.target.checked));
$("popHarm").addEventListener("change", e => edMark("harm", e.target.checked));
for (const [id, k] of [["popPm", "pm"], ["popStac", "stac"], ["popGrace", "grace"]]) $(id).addEventListener("change", e => edFlag(k, e.target.checked));
$("popLen").addEventListener("input", () => edLenValue(+$("popLen").value));
$("popLoose").addEventListener("change", e => edFlag("loose", e.target.checked));
$("barBpmOn").addEventListener("change", e => edBarBpmOn(e.target.checked));
$("barBpm").addEventListener("change", e => edBarBpm(Math.round(+e.target.value)));
$("barBpm").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
$("barRepStart").addEventListener("click", () => edBarRepeat("start"));
$("barRepEnd").addEventListener("click", () => edBarRepeat("end"));
$("barVolta").addEventListener("click", () => edBarRepeat("volta"));
$("barRepCount").addEventListener("change", e => edBarRepeat("count", +e.target.value));
$("barClose").addEventListener("click", edCloseBar);
$("edCapo").addEventListener("change", e => edCapo(+e.target.value));
$("popChordSet").addEventListener("click", () => { edChord($("popChord").value.trim()); $("popChord").blur(); });
$("popChord").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); edChord($("popChord").value.trim()); $("popChord").blur(); }
  else if (e.key === "Escape") { e.preventDefault(); $("popChord").blur(); edShowPop(); }
});
$("popInsBefore").addEventListener("click", () => edInsert(false));
$("popInsAfter").addEventListener("click", () => edInsert(true));
$("popDel").addEventListener("click", edDelete);
$("popPlay").addEventListener("click", () => {
  if (ed.sel) previewStep(ed.song, ed.sel.i, transport.rate);
});
$("popClose").addEventListener("click", () => { ed.popOpen = false; edShowPop(); });

$("edTab").addEventListener("click", e => {
  const hit = e.target.closest(".tab-barhit");
  if (hit && !ed.song.errors.length) { edOpenBar(+hit.dataset.bar); return; }
  const g = e.target.closest(".tab-step"), svg = e.target.closest("svg");
  if (!g || !svg || ed.song.errors.length) return;
  const m = svg.getScreenCTM();
  const y = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).y : e.offsetY;
  const s = Math.max(1, Math.min(6, Math.round((y - TAB.top) / TAB.row) + 1));
  if (ed.play) edStop(false);
  edSelect(+g.dataset.i, s, true);
});
// a click on empty space closes the edit window
$("edBody").addEventListener("click", e => {
  if (e.target.closest(".tab-step, .tab-barhit, .ed-pop")) return;
  if (ed.popOpen) { ed.popOpen = false; edShowPop(); }
  if (ed.bar != null) edCloseBar();
});
// the TAB re-flows on resize: put the cursor and the window back
new MutationObserver(() => { if (ed.sel && !$("edTab").querySelector(".tab-cursor")) { edDrawCursor(); edShowPop(); edShowBarPop(); } })
  .observe($("edTab"), { childList: true });

$("edBack").addEventListener("click", edBack);
$("edSave").addEventListener("click", edSave);
$("edPractice").addEventListener("click", edPractice);
$("edPrev").addEventListener("click", () => edMove(-1, 0));
$("edNext").addEventListener("click", () => edMove(1, 0));
$("edTitle").addEventListener("input", () => { $("edSave").dataset.dirty = edDirty() ? "1" : ""; edSaveDraft(); });
$("edPlay").addEventListener("click", edPlay);
$("edHome").addEventListener("click", () => { if (ed.play) edStop(false); if (ed.song.steps.length) edSelect(0, ed.sel ? ed.sel.s : 1); });
// restart from the note being played, keeping where playback began
function edRestartPlay() {
  if (!ed.play) return;
  const { cur, from } = ed.play, s = ed.sel ? ed.sel.s : 1;
  edStop(false); ed.sel = { i: cur, s }; edPlay(); ed.play.from = from;
}
transport.listeners.push(key => {
  if (key === "vol" && ed.play) ed.play.gain.gain.value = transportGain();
  if (key === "click" || key === "rate") edRestartPlay();
});
$("edUndo").addEventListener("click", () => edUndo(false));
$("edRedo").addEventListener("click", () => edUndo(true));
$("edAddBar").addEventListener("click", edAddBar);
$("edText").addEventListener("click", edOpenText);
$("edTextApply").addEventListener("click", edApplyText);
$("edTextClear").addEventListener("click", () => {
  if (!$("edTextArea").value || !confirm("テキストをすべて消しますか？")) return;
  $("edTextArea").value = ""; $("edTextErr").textContent = ""; $("edTextArea").focus();
});
// the notation list as plain text, one line per item
$("edHowtoCopy").addEventListener("click", async () => {
  const text = [...$("edHowto").querySelectorAll("h3, li")].map(e => (e.tagName === "H3" ? "\n## " : "- ") + e.textContent.trim()).join("\n").trim();
  const b = $("edHowtoCopy");
  try { await navigator.clipboard.writeText(text); } catch { return; }
  b.innerHTML = iconSvg("check");
  setTimeout(() => { b.innerHTML = iconSvg("copy"); }, 1200);
});
$("edTextArea").addEventListener("input", () => {
  const song = buildSong({ text: $("edTextArea").value, grid: ed.grid });
  $("edTextErr").textContent = song.errors.join(" / ");
});
$("edKeys").addEventListener("click", () => $("edKeysDlg").showModal());
window.addEventListener("beforeunload", e => { if (edDirty()) { edSaveDraft(); } });

// keyboard (PC), DTM style
document.addEventListener("keydown", e => {
  if ($("view-edit").hidden || document.querySelector("dialog[open]")) return;
  const control = e.target.closest("input[type=range], input[type=checkbox]");
  if (control && /^(Arrow|Home$|End$|Page)/.test(e.key)) return;
  if (!control && e.target.closest("input, textarea, select")) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); edSave(); }
    return;
  }
  const k = e.key, key = k.toLowerCase(), code = e.code;
  const done = () => e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    if (key === "z") { done(); edUndo(e.shiftKey); }
    else if (key === "y") { done(); edUndo(true); }
    else if (key === "s") { done(); edSave(); }
    else if (ed.sel && key === "c") { done(); ed.clip = cloneStep(ed.song.steps[ed.sel.i]); edStatus("コピーしました"); }
    else if (ed.sel && key === "x") { done(); ed.clip = cloneStep(ed.song.steps[ed.sel.i]); edDelete(); }
    else if (ed.sel && key === "v" && ed.clip) { done(); edInsert(true, ed.clip); }
    else if (ed.sel && key === "d") { done(); edInsert(true, ed.song.steps[ed.sel.i]); }
    return;
  }
  if (e.altKey) return;
  if (k === " ") { done(); edPlay(); return; }
  if (k === "?") { done(); $("edKeysDlg").showModal(); return; }
  if (k === "Escape") {
    if (ed.popOpen) { done(); ed.popOpen = false; edShowPop(); }
    else if (ed.bar != null) { done(); edCloseBar(); }
    return;
  }
  if (k === "Home") { done(); $("edHome").click(); return; }
  if (!ed.sel) return;
  const digit = /^(Digit|Numpad)(\d)$/.exec(code);
  if (digit && e.shiftKey) {
    const s = +digit[2];
    if (s >= 1 && s <= 6) { done(); edSelect(ed.sel.i, s); }
    return;
  }
  if (digit) {
    // two digits typed quickly make a two-digit fret (1 then 2 = 12)
    const d = digit[2], now = performance.now();
    const two = ed.digit !== "" && now - ed.digitAt < 800 && +(ed.digit + d) <= 24;
    const f = two ? +(ed.digit + d) : +d;
    ed.digit = two ? "" : d; ed.digitAt = now;
    done(); edFret(f);
    return;
  }
  if (k === "End") { done(); edSelect(ed.song.steps.length - 1, ed.sel.s); }
  else if (k === "ArrowLeft") { done(); edMove(-1, 0); }
  else if (k === "ArrowRight") { done(); edMove(1, 0); }
  else if (k === "ArrowUp") { done(); edMove(0, -1); }
  else if (k === "ArrowDown") { done(); edMove(0, 1); }
  else if (k === "Delete" || k === "Backspace") { done(); if (e.shiftKey) edDelete(); else edFret(null); }
  else if (k === "Enter") { done(); edInsert(!e.shiftKey); }
  else if (key === "h" || key === "p" || key === "s" || key === "i") { done(); edMark("start", key, true); }
  else if (key === "b") { done(); edMark("move", e.shiftKey ? "b1" : "b", true); }
  else if (key === "d") { done(); edMark("move", e.shiftKey ? "d1" : "d2", true); }
  else if (key === "o" || key === "t") { done(); edMark("move", key, true); }
  else if (key === "v" || key === "f" || key === "n") { done(); const k2 = { v: "v", f: "fast", n: "harm" }[key], n = ed.song.steps[ed.sel.i].notes.find(x => x[0] === ed.sel.s); edMark(k2, !(n && markOf(n)[k2])); }
  else if (key === "r") { done(); edRest(); }
  else if (key === "l") { done(); edFlag("loose"); }
  else if (key === "m") { done(); edFlag("pm"); }
  else if (k === ".") { done(); edFlag("stac"); }
  else if (k === "'") { done(); edFlag("grace"); }
  else if (key === "x" && e.shiftKey) { done(); const st = ed.song.steps[ed.sel.i]; edFret((st.mute || []).includes(ed.sel.s) ? null : "x"); }
  else if (key === "x") { done(); edBrush(true); }
  else if (k === "[") { done(); edLenStep(-1); }
  else if (k === "]") { done(); edLenStep(1); }
  else if (key === "c") { done(); ed.popOpen = true; edShowPop(); $("popChord").focus(); $("popChord").select(); }
});
