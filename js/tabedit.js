/* ===== TAB editor (full screen, DTM style): click a note, edit it in the window below it ===== */
// The song text stays the source of truth: each edit changes the parsed steps and writes them back
// as text (stepsToText), and the TAB is drawn again from that text.

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

function lenChoices(grid, cur) {
  const list = [[grid / 16, "16分"], [grid / 8, "8分"], [grid * 3 / 16, "付点8分"], [grid / 4, "4分"], [grid * 3 / 8, "付点4分"],
    [grid / 2, "2分"], [grid * 3 / 4, "付点2分"], [grid, "全"]].filter(([n]) => Number.isInteger(n) && n >= 1);
  const seen = new Set(), out = [];
  for (const [n, l] of list) if (!seen.has(n)) { seen.add(n); out.push([n, l + "音符"]); }
  if (cur && !seen.has(cur)) out.push([cur, `${cur}マス`]);
  return out.sort((a, b) => a[0] - b[0]);
}

const ED_DRAFT = "guitaric.draft";
const NEW_SONG_TEXT = "| r:2 r:2 r:2 r:2 |";
const ed = {
  loaded: false, id: null, grid: 8, text: "", saved: "",
  song: null, tab: null, sel: null, popOpen: false,
  undo: [], redo: [], digit: "", digitAt: 0, clip: null, play: null,
};

const edSnapshot = () => JSON.stringify([$("edTitle").value.trim(), +$("edBpm").value || 80, ed.text]);
const edDirty = () => ed.loaded && edSnapshot() !== ed.saved;
const cloneStep = st => ({ ...st, notes: st.notes.map(n => n.slice()) });

function edSaveDraft() {
  try {
    localStorage.setItem(ED_DRAFT, JSON.stringify({ id: ed.id, grid: ed.grid, title: $("edTitle").value, bpm: +$("edBpm").value || 80, text: ed.text, saved: ed.saved }));
  } catch (e) {}
}
function edClearDraft() { try { localStorage.removeItem(ED_DRAFT); } catch (e) {} }

// Opens a song (null = new song) in the editor and switches to it.
function openEditor(s) {
  if (edDirty() && !confirm("保存していない変更があります。破棄して別の曲を開きますか？")) return;
  edLoad(s ? { id: s.id, grid: s.grid || 8, title: s.title, bpm: s.bpm || 80, text: s.text } : null);
  location.hash = "edit";
}

function edLoad(d, saved) {
  edStop(false);
  ed.loaded = true;
  ed.id = d ? d.id : null;
  ed.grid = (d && d.grid) || 8;
  ed.text = d ? d.text : NEW_SONG_TEXT;
  $("edTitle").value = d ? d.title : "";
  $("edBpm").value = d ? d.bpm : 80;
  ed.undo = []; ed.redo = [];
  ed.saved = saved || (d && d.id ? edSnapshot() : "");
  ed.sel = { i: 0, s: 1 }; ed.popOpen = false;
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
  ed.tab = n ? renderTab($("edTab"), song) : null;
  if (!n) $("edTab").innerHTML = '<p class="empty">まだ何もありません</p>';
  if (ed.sel && ed.tab) ed.tab.setState(ed.sel.i, "current");
  if (ed.play && ed.tab) ed.tab.setPlaying(ed.play.cur);
  edDrawCursor();
  edStatus();
  edShowPop();
  $("edUndo").disabled = !ed.undo.length;
  $("edRedo").disabled = !ed.redo.length;
  $("edSave").disabled = !n;
  $("edSave").dataset.dirty = edDirty() ? "1" : "";
}

function edWhere(i) {
  const song = ed.song, barCells = song.timeSig[0] * song.grid / 4, beat = song.grid / 4;
  const cell = song.steps.slice(0, i).reduce((a, x) => a + x.len, 0);
  const b = (cell % barCells) / beat + 1;
  return `${Math.floor(cell / barCells) + 1}小節目 ${Number.isInteger(b) ? b : b.toFixed(1)}拍目`;
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
  if (!ed.sel) return;
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
function edShowPop() {
  const pop = $("edPop");
  const g = ed.sel && $("edTab").querySelector(`.tab-step[data-i="${ed.sel.i}"]`);
  if (!ed.popOpen || !g || ed.play || ed.song.errors.length) { pop.hidden = true; return; }
  const st = ed.song.steps[ed.sel.i], s = ed.sel.s;
  $("popWhere").textContent = `${edWhere(ed.sel.i)}・${s}弦`;
  $("popStrings").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.s === s)));
  const fret = (st.notes.find(n => n[0] === s) || [])[1];
  $("popPad").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(fret != null && b.dataset.fret === String(fret))));
  $("popLen").innerHTML = lenChoices(ed.song.grid, st.len).map(([n, l]) => `<option value="${n}">${l}</option>`).join("");
  $("popLen").value = st.len;
  $("popLoose").checked = !!st.loose;
  $("popLoose").disabled = !st.notes.length;
  const single = !st.chord && st.notes.length === 1, tech = st.tech ? st.tech + (st.tech === "b" ? st.bend : "") : "";
  $("popTech").querySelectorAll("button").forEach(b => { b.disabled = !single; b.setAttribute("aria-pressed", String(single && b.dataset.tech === tech)); });
  if (document.activeElement !== $("popChord")) $("popChord").value = st.chord || "";
  pop.hidden = false;
  // just below the note, kept inside the editor's width
  const body = $("edBody").getBoundingClientRect(), hl = g.querySelector(".tab-hl").getBoundingClientRect();
  const left = Math.max(0, Math.min(hl.left - body.left - 8, body.width - pop.offsetWidth));
  pop.style.left = left + "px";
  pop.style.top = (hl.bottom - body.top + 4) + "px";
  const r = pop.getBoundingClientRect();
  if (r.bottom > innerHeight) window.scrollBy(0, Math.min(r.bottom - innerHeight + 8, r.top - 120));
}

function edSelect(i, s, open) {
  ed.sel = { i, s };
  ed.digit = "";
  if (open != null) ed.popOpen = open;
  edRender();
  if (ed.tab) ed.tab.scrollTo(i);
}

/* ----- edits ----- */
// apply a change to a copy of the steps and write the result back as text
function edChange(fn) {
  if (ed.song.errors.length) return;
  const steps = ed.song.steps.map(cloneStep);
  const sel = fn(steps, ed.song);
  if (sel === false) return;
  const prefix = (/^\s*@(4|8|16)\b\s*/.exec(ed.text) || [""])[0];
  edSetText(steps.length ? stepsToText(steps, ed.song.grid, ed.song.timeSig, prefix) : prefix.trim(), sel);
}

function edSetText(text, sel) {
  if (text === ed.text) return;
  ed.undo.push({ text: ed.text, sel: ed.sel });
  if (ed.undo.length > 200) ed.undo.shift();
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

const asNotes = st => { delete st.chord; delete st.tie; };
function setFret(st, s, f) {
  asNotes(st);
  st.notes = st.notes.filter(n => n[0] !== s);
  if (f != null) st.notes.push([s, f]);
  st.notes.sort((a, b) => b[0] - a[0]);
  if (st.notes.length !== 1) { delete st.tech; delete st.bend; }
  if (!st.notes.length) delete st.loose;
}
const restStep = len => ({ notes: [], len });

function edFret(f) {
  if (!ed.sel) return;
  const { i, s } = ed.sel;
  edChange(steps => { setFret(steps[i], s, f); });
}

// "h" "p" "s" "b2" "b1" "d" or "" (none); the same one again turns it off
function edTech(v, toggle) {
  if (!ed.sel) return;
  const st = ed.song.steps[ed.sel.i];
  if (st.chord || st.notes.length !== 1) { edStatus("奏法は単音にだけ付けられます"); return; }
  const cur = st.tech ? st.tech + (st.tech === "b" ? st.bend : "") : "";
  if (toggle && cur === v) v = "";
  const { i } = ed.sel;
  edChange(steps => {
    delete steps[i].tech; delete steps[i].bend;
    if (v) { steps[i].tech = v[0]; if (v[0] === "b") steps[i].bend = +v[1]; }
  });
}

function edLen(len) {
  if (!ed.sel) return;
  const { i } = ed.sel;
  edChange(steps => { steps[i].len = len; });
}
function edLenStep(dir) {
  if (!ed.sel) return;
  const st = ed.song.steps[ed.sel.i], list = lenChoices(ed.song.grid, st.len).map(([n]) => n);
  const k = list.indexOf(st.len) + dir;
  if (k >= 0 && k < list.length) edLen(list[k]);
}

function edLoose(on) {
  if (!ed.sel || !ed.song.steps[ed.sel.i].notes.length) return;
  const { i } = ed.sel;
  edChange(steps => { if (on) steps[i].loose = true; else delete steps[i].loose; });
}

function edInsert(after, step) {
  if (!ed.sel) return;
  const { i, s } = ed.sel, at = after ? i + 1 : i;
  edChange(steps => { steps.splice(at, 0, step ? cloneStep(step) : restStep(steps[i].len)); return { i: at, s }; });
}

function edDelete() {
  if (!ed.sel) return;
  const { i, s } = ed.sel;
  edChange(steps => { steps.splice(i, 1); return steps.length ? { i: Math.min(i, steps.length - 1), s } : null; });
}

function edRest() {
  if (!ed.sel) return;
  const { i } = ed.sel;
  edChange(steps => { steps[i] = restStep(steps[i].len); });
}

function edChord(name) {
  if (!ed.sel || !name) return;
  const notes = chordVoicing(name);
  if (!notes) { edStatus(`「${name}」はコード名として読めません`); return; }
  const { i } = ed.sel;
  edChange(steps => { const st = steps[i]; steps[i] = { notes, chord: name, len: st.len, ...(st.loose ? { loose: true } : {}) }; });
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
  // the song's tempo times the playback speed (0.2x ... 1.5x)
  const bpm = Math.max(30, Math.min(240, +$("edBpm").value || 80)) * transport.rate;
  const r = scheduleSong(ed.song, from, bpm, gain, i => {
    if (!ed.play) return;
    ed.play.cur = i;
    if (ed.tab) { ed.tab.setPlaying(i); ed.tab.scrollTo(i); }
  });
  ed.play = { ...r, from, cur: from, gain };
  scheduleSongClicks(ed.song, from, bpm, r.start, gain);
  ed.play.timers.push(setTimeout(() => edStop(true), (r.end - ctx.currentTime) * 1000));
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
  const entry = { id: ed.id || "song-" + Date.now().toString(36), title: $("edTitle").value.trim() || "無題の曲", bpm: +$("edBpm").value || 80, text: ed.text.trim() };
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

// 練習: practice this song; with unsaved changes, ask whether to save first
function edPractice() {
  edStop(false);
  if (!edDirty() && ed.id) { openPractice(ed.id); return; }
  if (!edDirty() && !ed.id) { edGoPractice(); return; }
  const dlg = $("edLeaveDlg");
  dlg.returnValue = "";
  dlg.onclose = () => {
    if (dlg.returnValue === "save") { edSave(); if (!edDirty()) openPractice(ed.id); }
    else if (dlg.returnValue === "nosave") edGoPractice();
  };
  dlg.showModal();
}
// practice what the editor holds now, without saving it
function edGoPractice() {
  if (ed.song.errors.length || !ed.song.steps.length) { edStatus("練習できる音がありません"); return; }
  loadPracticeSong({ title: $("edTitle").value.trim() || "無題の曲", bpm: +$("edBpm").value || 80, text: ed.text, grid: ed.grid }, true);
  location.hash = "practice";
}

function edBack() {
  if (edDirty() && !confirm("保存していない変更があります。保存せずに一覧に戻りますか？")) return;
  edStop(false);
  ed.loaded = false;
  edClearDraft();
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
  edSetText(text, { i: 0, s: ed.sel ? ed.sel.s : 1 });
  $("edTextDlg").close();
}

/* ----- wiring ----- */
{
  const strings = $("popStrings");
  for (let s = 1; s <= 6; s++) {
    const b = document.createElement("button"); b.type = "button"; b.dataset.s = s;
    b.textContent = s; b.title = `${s}弦（${STRING_LABELS[s - 1]}）・Shift+${s}`;
    strings.append(b);
  }
  strings.addEventListener("click", e => { const b = e.target.closest("button"); if (b && ed.sel) edSelect(ed.sel.i, +b.dataset.s); });
  const pad = $("popPad");
  for (let f = 0; f <= 15; f++) {
    const b = document.createElement("button"); b.type = "button"; b.dataset.fret = f; b.textContent = f;
    pad.append(b);
  }
  const x = document.createElement("button"); x.type = "button"; x.dataset.fret = "x"; x.textContent = "消す"; x.className = "clear"; x.title = "この弦の音を消す（Delete）";
  pad.append(x);
  pad.addEventListener("click", e => { const b = e.target.closest("button"); if (b) edFret(b.dataset.fret === "x" ? null : +b.dataset.fret); });
  $("popTech").addEventListener("click", e => { const b = e.target.closest("button"); if (b) edTech(b.dataset.tech, false); });
}
$("popLen").addEventListener("change", e => edLen(+e.target.value));
$("popLoose").addEventListener("change", e => edLoose(e.target.checked));
$("popChordSet").addEventListener("click", () => { edChord($("popChord").value.trim()); $("popChord").blur(); });
$("popChord").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); edChord($("popChord").value.trim()); $("popChord").blur(); }
  else if (e.key === "Escape") { e.preventDefault(); $("popChord").blur(); edShowPop(); }
});
$("popInsBefore").addEventListener("click", () => edInsert(false));
$("popInsAfter").addEventListener("click", () => edInsert(true));
$("popRest").addEventListener("click", edRest);
$("popDel").addEventListener("click", edDelete);
$("popClose").addEventListener("click", () => { ed.popOpen = false; edShowPop(); });

$("edTab").addEventListener("click", e => {
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
  if (ed.popOpen && !e.target.closest(".tab-step, .ed-pop")) { ed.popOpen = false; edShowPop(); }
});
// the TAB re-flows on resize: put the cursor and the window back
new MutationObserver(() => { if (ed.sel && !$("edTab").querySelector(".tab-cursor")) { edDrawCursor(); edShowPop(); } })
  .observe($("edTab"), { childList: true });

$("edBack").addEventListener("click", edBack);
$("edSave").addEventListener("click", edSave);
$("edPractice").addEventListener("click", edPractice);
$("edPrev").addEventListener("click", () => edMove(-1, 0));
$("edNext").addEventListener("click", () => edMove(1, 0));
$("edTitle").addEventListener("input", () => { $("edSave").dataset.dirty = edDirty() ? "1" : ""; edSaveDraft(); });
$("edBpm").addEventListener("input", () => { $("edSave").dataset.dirty = edDirty() ? "1" : ""; edSaveDraft(); });
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
$("edTextArea").addEventListener("input", () => {
  const song = buildSong({ text: $("edTextArea").value, grid: ed.grid });
  $("edTextErr").textContent = song.errors.join(" / ");
});
$("edKeys").addEventListener("click", () => $("edKeysDlg").showModal());
window.addEventListener("beforeunload", e => { if (edDirty()) { edSaveDraft(); } });

// keyboard (PC), DTM style
document.addEventListener("keydown", e => {
  if ($("view-edit").hidden || document.querySelector("dialog[open]")) return;
  if (e.target.closest("input, textarea, select")) {
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
  if (k === "Escape") { if (ed.popOpen) { done(); ed.popOpen = false; edShowPop(); } return; }
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
  else if (key === "h" || key === "p" || key === "s") { done(); edTech(key, true); }
  else if (key === "b") { done(); edTech(e.shiftKey ? "b1" : "b2", true); }
  else if (key === "d") { done(); edTech("d", true); }
  else if (key === "r") { done(); edRest(); }
  else if (key === "l") { done(); edLoose(!ed.song.steps[ed.sel.i].loose); }
  else if (k === "[") { done(); edLenStep(-1); }
  else if (k === "]") { done(); edLenStep(1); }
  else if (key === "c") { done(); ed.popOpen = true; edShowPop(); $("popChord").focus(); $("popChord").select(); }
});
