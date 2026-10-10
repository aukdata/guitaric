/* ===== practice: wait mode (advance when the expected chord/note is played) ===== */
// settle: seconds after a strum before judging (the 0.34 s chord window still holds the previous sound).
// A repeat of the same chord/note can only be told apart by a new strum, so it uses a stricter path.
const JUDGE = { present: 0.2, extra: 0.3, extraNote: 0.25, extraSal: 0.8, okFrames: 2, wrongAfter: 0.9, settle: 0.12, settleSame: 0.2, minGap: 0.3 };
const practice = {
  song: null, idx: 0, tab: null, stream: null, source: null, raf: 0,
  tracker: createTracker(), okRun: 0, missRun: 0, fresh: true, silent: 0, wrongShown: false, sameAsPrev: false, loose: false, lastOk: false, ringing: [], strummed: false,
  onsetDet: null, tap: null, tapOut: null, onsets: [], lastStrum: -1,
  marks: [], firstTry: [], startedAt: 0, mutedUntil: 0, wakeLock: null
};
const model = { sources: [], timers: [], gain: null, from: null, cur: 0 };

function currentSongId() { try { return localStorage.getItem("guitaric.song"); } catch (e) { return null; } }
function setCurrentSongId(id) { try { localStorage.setItem("guitaric.song", id); } catch (e) {} }

// practice a saved song by id (falls back to the first song)
function loadPractice(id) {
  const s = allSongs().find(x => x.id === id) || allSongs()[0];
  setCurrentSongId(s.id);
  loadPracticeSong(s, false);
}

// practice a song object; fromEditor = the editor's unsaved content (編集 goes back to that draft)
function loadPracticeSong(s, fromEditor) {
  if (model.sources.length) stopModel();
  practice.fromEditor = fromEditor;
  practice.songId = fromEditor ? null : s.id;
  practice.song = buildSong(s);
  practice.tab = renderTab($("pTab"), practice.song, { onStepClick: i => { if (model.sources.length) stopModel(); gotoStep(i); } });
  $("prTitle").textContent = (s.title || "無題の曲") + (fromEditor ? "（未保存）" : "");
  setMetroSong(practice.song);
  restartPractice();
}

function openPractice(id) {
  loadPractice(id);
  location.hash = "practice";
}

function markStep(k, state) { practice.marks[k] = state; practice.tab.setState(k, state); }

function playableIndex(i) {
  const steps = practice.song.steps;
  while (i < steps.length && !steps[i].notes.length) i++; // wait mode skips rests
  return i;
}

function restartPractice() {
  practice.firstTry = practice.song.steps.map(() => true);
  practice.startedAt = 0;
  $("pResult").hidden = true;
  practice.tab.clearStates(); practice.marks = [];
  gotoStep(playableIndex(0));
}

function gotoStep(i) {
  const steps = practice.song.steps;
  // steps from here on are unplayed again; a step left "current" by jumping ahead is cleared too
  for (let k = 0; k < steps.length; k++) if (k >= i || practice.marks[k] === "current") markStep(k, "");
  practice.idx = i;
  practice.okRun = 0; practice.missRun = 0; practice.fresh = false;
  if (i >= steps.length) { finishPractice(); return; }
  const prev = steps.slice(0, i).reverse().find(x => x.notes.length);
  practice.sameAsPrev = !!prev && soundKey(prev) === soundKey(steps[i]);
  // the last strum before a chord change: the fretting hand is already moving to the next chord,
  // so open strings and half-released notes are expected; any strum passes
  const next = steps.slice(i + 1).find(x => x.notes.length);
  practice.loose = !!steps[i].loose || (!!steps[i].chord && practice.sameAsPrev && !!next && soundKey(next) !== soundKey(steps[i]));
  practice.ringing = prev ? stepMidis(prev).map(m => m % 12) : [];
  practice.last = null;
  practice.strummed = false;
  markStep(i, "current");
  practice.tab.scrollTo(i);
  const st = steps[i];
  $("pWhere").textContent = practice.loose ? (st.loose ? "判定ゆるめ" : "コードチェンジ前（判定ゆるめ）") : "";
  $("pProgress").textContent = `${i + 1} / ${steps.length}`;
  setFeedback(practice.stream ? "弾いてください" : "● を押すとマイクで判定が始まります", "");
}

function setFeedback(msg, kind) {
  const el = $("pFeedback"); el.textContent = msg; el.dataset.kind = kind;
}

function finishPractice() {
  const steps = practice.song.steps, idxs = steps.map((s, i) => i).filter(i => steps[i].notes.length);
  const first = idxs.filter(i => practice.firstTry[i]).length;
  const secs = practice.startedAt ? (performance.now() - practice.startedAt) / 1000 : 0;
  $("pWhere").textContent = "";
  $("pProgress").textContent = `${steps.length} / ${steps.length}`;
  setFeedback("最後まで弾けました", "ok");
  $("pResultText").textContent = `かかった時間 ${secs.toFixed(1)} 秒 · 一発で弾けた割合 ${idxs.length ? Math.round(first / idxs.length * 100) : 0}%（${first} / ${idxs.length}）`;
  $("pResult").hidden = false;
}

// Is the expected step sounding? Returns { ok, missing } (missing = note names not heard).
// A strum (or pluck) adds energy: either a big rise, or a clear rise with a strong spectral change.
// Fret squeaks and finger noise on a ringing chord measure below this (checked on real recordings).
// (thresholds from the real recordings: cannon.wav's 32 strums vs. its squeaks and finger noise)
const isStrum = o => o.rise >= 8 || (o.rise >= 3 && o.strength >= 0.025) || (o.rise >= 2 && o.strength >= 0.06);

// notes sounded by the fretting hand alone: no new pick attack to wait for
const noAttack = st => !st.chord && ["h", "p", "s", "d"].includes(st.tech);

const soundKey = st => st.chord ? (chordPitchClasses(st.chord) || []).slice().sort().join() : stepMidis(st).sort().join();

// Is the expected step sounding, and nothing else? Returns { ok, missing, extra } (note names).
// repeat: the same chord was just confirmed, so a new strum only has to sound consistent with it
// (low roots such as G2 need ~0.5 s to show up, longer than a quick re-strum leaves them).
// ringing: pitch classes of the previous step, which may still sound under the new note.
function judgeStep(st, res, tr, repeat, ringing) {
  const ch = tr.chroma, total = ch.reduce((a, b) => a + b, 0);
  if (st.chord) {
    const pcs = chordPitchClasses(st.chord) || [...new Set(stepMidis(st).map(m => m % 12))];
    if (!total) return { ok: false, missing: [], extra: [] };
    const missing = pcs.filter(pc => ch[pc] < JUDGE.present);
    // a tone outside the chord: a wrong fret or a string that should be muted
    // (tones of the previous step may still ring; they only count toward the overall ratio below)
    const extraPcs = ch.map((v, pc) => (!pcs.includes(pc) && !ringing.includes(pc) && v >= JUDGE.extraNote ? pc : -1)).filter(pc => pc >= 0);
    // the previous chord rings on for a while after a change; its tones don't count as foreign here
    // (playing the old chord again still fails, because then the new chord's own tones are missing)
    const extra = ch.reduce((a, v, pc) => a + (pcs.includes(pc) || ringing.includes(pc) ? 0 : v), 0) / total;
    const root = parseChordName(st.chord).pc;
    // four-note chords often lose their fifth; allow one missing tone except the root
    const allowed = pcs.length >= 4 ? 1 : 0;
    const ok = !extraPcs.length && (repeat ? missing.length < pcs.length && extra <= JUDGE.extra
      : !missing.includes(root) && missing.length <= allowed && extra <= JUDGE.extra);
    return { ok, missing: missing.map(pc => NOTE_NAMES[pc]), extra: extraPcs.map(pc => NOTE_NAMES[pc]) };
  }
  const want = stepMidis(st), wantPcs = want.map(m => m % 12);
  const top = Math.max(0, ...res.notes.map(n => n.salience));
  // strong notes of another pitch class that the previous step doesn't explain
  const extra = [...new Set(res.notes.filter(n => n.salience >= top * JUDGE.extraSal && !wantPcs.includes(n.midi % 12) && !ringing.includes(n.midi % 12)).map(n => noteName(n.midi)))];
  if (want.length === 1) {
    // the target must be one of the loudest notes, not the previous note still ringing under a new one
    const hit = res.notes.some(n => n.midi === want[0] && n.salience >= top * 0.7);
    return { ok: hit && !extra.length, missing: hit ? [] : [noteName(want[0])], extra };
  }
  const missing = want.filter(m => ch[m % 12] < JUDGE.present);
  return { ok: missing.length === 0 && !extra.length, missing: missing.map(noteName), extra };
}

function showWrong(st, res, tr, j) {
  practice.wrongShown = true;
  if (!practice.startedAt) practice.startedAt = performance.now();
  practice.firstTry[practice.idx] = false;
  const heard = st.chord && tr.cands && tr.cands[0] ? tr.cands[0].name.replace("（単音）", "")
    : res.notes.slice().sort((a, b) => b.salience - a.salience).slice(0, st.notes.length > 1 ? 3 : 1).map(n => noteName(n.midi)).join(" ");
  const why = [j.missing.length ? `${j.missing.join("・")} が聞こえません` : "", j.extra.length ? `余計な音 ${j.extra.join("・")} が鳴っています` : ""].filter(Boolean).join("、");
  setFeedback(`今鳴っているのは ${heard || "—"}` + (why ? `（${why}）` : ""), "ng");
}

function passStep() {
  if (!practice.startedAt) practice.startedAt = performance.now();
  markStep(practice.idx, practice.firstTry[practice.idx] ? "done" : "done-retry");
  practice.lastOk = false;
  gotoStep(playableIndex(practice.idx + 1));
  if (practice.idx < practice.song.steps.length) setFeedback("OK", "ok");
}

function practiceTick(buf) {
  const res = detectNotes(buf, ctx.sampleRate);
  const db = 20 * Math.log10(res.rms + 1e-9);
  $("pMeter").style.width = Math.max(0, Math.min(100, (db + 70) / 60 * 100)) + "%";
  // strums found by the short-window onset detector since the last frame
  let strum = false;
  for (const o of practice.onsets.splice(0)) {
    // a strum must add energy; fret squeaks and finger noise on a ringing chord don't
    if (o.t < practice.mutedUntil || o.t - practice.lastStrum < JUDGE.minGap || !isStrum(o)) continue;
    practice.lastStrum = o.t; strum = true;
  }
  const steps = practice.song.steps;
  // the current step already sounded right but hadn't been confirmed yet (a slow root like G2) when the
  // next strum came: credit it now so the new strum counts for the next step instead of being used up
  if (strum && practice.lastOk && practice.idx < steps.length) passStep();
  // the previous strum on this step never passed and the player has moved on: say what was wrong
  // (chords only: single notes pick up small noises between notes that are not real attempts)
  else if (strum && practice.strummed && !practice.wrongShown && practice.last && practice.idx < steps.length && steps[practice.idx].chord)
    showWrong(steps[practice.idx], practice.last.res, practice.last.tr, practice.last.j);
  if (strum) practice.tracker.markOnset();
  const tr = practice.tracker.update(res);
  if (res.notes.length) practice.silent = 0;
  else if (++practice.silent === 6) practice.tracker.reset();
  practice.lastOk = false;
  if (ctx.currentTime < practice.mutedUntil) return;
  if (practice.idx >= steps.length) return;
  const st = steps[practice.idx];
  if (strum) { practice.fresh = true; practice.okRun = 0; practice.strummed = true; practice.wrongShown = false; }
  // time since the attack itself (the onset event arrives ~0.1 s late, but carries its own time)
  const since = ctx.currentTime - practice.lastStrum;
  const j = practice.loose ? { ok: res.notes.length > 0, missing: [], extra: [] } : judgeStep(st, res, tr, practice.sameAsPrev, practice.ringing);
  if (j.ok) {
    practice.missRun = 0;
    practice.lastOk = practice.fresh;
    // only a new attack counts, so a chord still ringing from the previous step can't pass the next one
    if (since < (practice.sameAsPrev ? JUDGE.settleSame : JUDGE.settle)) return;
    if (practice.fresh && ++practice.okRun >= (practice.sameAsPrev ? 1 : JUDGE.okFrames)) passStep();
    return;
  }
  practice.okRun = 0;
  // the target is not sounding now, so the next time it appears it is a fresh attempt
  // (only for hammer-ons, pull-offs, slides and bend releases, which have no pick attack; every
  // other note or chord needs its own attack, or one pluck could pass two steps of the same note)
  if (++practice.missRun >= 2 && noAttack(st)) practice.fresh = true;
  practice.last = { res, tr, j };
  // only a strum made while this step is current can be wrong (not the previous chord still ringing)
  // (a note held over from the previous step is not a mistake either: the new one may just be late)
  const loudest = res.notes.reduce((a, n) => (!a || n.salience > a.salience ? n : a), null);
  if (practice.strummed && !practice.wrongShown && loudest && since >= JUDGE.wrongAfter &&
      !(!st.chord && practice.ringing.includes(loudest.midi % 12))) showWrong(st, res, tr, j);
}

async function keepScreenOn() {
  try {
    practice.wakeLock = await navigator.wakeLock.request("screen");
    practice.wakeLock.addEventListener("release", () => { practice.wakeLock = null; });
  } catch (e) {}
}

async function startPracticeMic() {
  setAudioSession(true);
  ensureContext();
  if (typeof micStream !== "undefined" && micStream) stopMic();
  stopPlayback();
  try {
    practice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    setFeedback("マイクを使えませんでした（" + (e.name || "error") + "）。ブラウザのマイク許可を確認してください。", "ng");
    return;
  }
  practice.source = ctx.createMediaStreamSource(practice.stream);
  practice.source.connect(analyser);
  practice.tracker.reset();
  // stream the raw input to the onset detector in small blocks
  practice.onsetDet = createOnsetDetector(ctx.sampleRate);
  practice.onsets = []; practice.lastStrum = -1;
  practice.tap = ctx.createScriptProcessor(1024, 1, 1);
  practice.tap.onaudioprocess = e => {
    const x = e.inputBuffer.getChannelData(0);
    practice.onsets.push(...practice.onsetDet.push(x, ctx.currentTime - x.length / ctx.sampleRate));
  };
  practice.tapOut = ctx.createGain(); practice.tapOut.gain.value = 0;
  practice.source.connect(practice.tap); practice.tap.connect(practice.tapOut); practice.tapOut.connect(ctx.destination);
  $("pMic").setAttribute("aria-pressed", "true"); $("pMic").setAttribute("aria-label", "マイクを停止"); $("pMic").title = "マイクを停止";
  setFeedback("弾いてください", "");
  updateMetronome();
  await keepScreenOn();
  const buf = new Float32Array(FFT_SIZE);
  let last = 0;
  const loop = t => {
    practice.raf = requestAnimationFrame(loop);
    if (t - last < 70) return; last = t;
    analyser.getFloatTimeDomainData(buf);
    practiceTick(buf);
  };
  practice.raf = requestAnimationFrame(loop);
}

function stopPracticeMic() {
  setAudioSession(false);
  cancelAnimationFrame(practice.raf); practice.raf = 0;
  if (practice.stream) practice.stream.getTracks().forEach(t => t.stop());
  [practice.source, practice.tap, practice.tapOut].forEach(n => n && n.disconnect());
  if (practice.tap) practice.tap.onaudioprocess = null;
  practice.stream = practice.source = practice.tap = practice.tapOut = null;
  if (practice.wakeLock) { practice.wakeLock.release().catch(() => {}); practice.wakeLock = null; }
  $("pMic").setAttribute("aria-pressed", "false"); $("pMic").setAttribute("aria-label", "マイクを開始"); $("pMic").title = "マイクを開始（判定を始める）";
  $("pMeter").style.width = "0%";
  updateMetronome();
}

// (model = the sources and timers of the playback in progress, declared at the top)
// Plays the song from the current step at the practice tempo, highlighting each step as it sounds.
// Judging pauses meanwhile so the speaker can't pass steps; pressing again stops it.
// On stop the practice position goes back to where playback began, or to where it stopped.

function stopModel(natural) {
  const wasPlaying = model.sources.length > 0;
  if (!natural) model.sources.forEach(src => { try { src.stop(); } catch (e) {} });
  model.timers.forEach(clearTimeout);
  if (model.gain) { const g = model.gain; if (natural) setTimeout(() => g.disconnect(), 2500); else g.disconnect(); }
  model.sources = []; model.timers = []; model.gain = null;
  if (practice.tab) practice.tab.setPlaying(-1);
  if (wasPlaying && model.from != null && practice.song) {
    const to = transport.stopMode === "return" ? model.from : playableIndex(model.cur);
    if (to !== practice.idx && to < practice.song.steps.length) gotoStep(to);
    else if (practice.tab) practice.tab.scrollTo(practice.idx);
  }
  practice.mutedUntil = natural ? practice.mutedUntil : Math.min(practice.mutedUntil, ctx ? ctx.currentTime : 0);
  practice.tracker.reset();
  setIcon($("pModel"), "play"); $("pModel").setAttribute("aria-label", "お手本を再生"); $("pModel").classList.remove("on");
  updateMetronome();
}

function playModel() {
  ensureContext();
  if (ctx.state === "suspended") ctx.resume();
  if (model.sources.length) { stopModel(); return; }
  const from = Math.min(practice.idx, practice.song.steps.length - 1), bpm = effectiveBpm();
  stopMetronome();
  const gain = ctx.createGain(); gain.gain.value = transportGain(); gain.connect(ctx.destination);
  const r = scheduleSong(practice.song, from, bpm, gain, i => { model.cur = i; practice.tab.setPlaying(i); practice.tab.scrollTo(i); });
  scheduleSongClicks(practice.song, from, bpm, r.start, gain);
  model.sources = r.sources; model.timers = r.timers; model.gain = gain; model.from = from; model.cur = from;
  const end = r.end + 1.6;
  model.timers.push(setTimeout(() => stopModel(true), (r.end - ctx.currentTime) * 1000));
  practice.mutedUntil = end + 0.2;
  practice.tracker.reset();
  setIcon($("pModel"), "square"); $("pModel").setAttribute("aria-label", "停止"); $("pModel").classList.add("on");
}

transport.listeners.push(key => {
  if (key === "vol" && model.gain) model.gain.gain.value = transportGain();
  // restart the playback with the new speed or click from the step being played
  if ((key === "rate" || key === "click") && model.sources.length) {
    const from = model.from, cur = model.cur;
    model.from = null; stopModel(); gotoStep(cur); playModel(); model.from = from;
  }
});

$("pMic").addEventListener("click", () => (practice.stream ? stopPracticeMic() : startPracticeMic()));
$("pAgain").addEventListener("click", restartPractice);
$("pPrev").addEventListener("click", () => {
  let i = practice.idx - 1;
  while (i > 0 && !practice.song.steps[i].notes.length) i--;
  if (i >= 0) gotoStep(i);
});
$("pNext").addEventListener("click", () => {
  if (practice.idx >= practice.song.steps.length) return;
  practice.firstTry[practice.idx] = false;
  markStep(practice.idx, "skipped");
  gotoStep(playableIndex(practice.idx + 1));
});
$("pModel").addEventListener("click", playModel);
document.addEventListener("keydown", e => {
  if ($("view-practice").hidden || e.target.closest("input, textarea, select")) return;
  if (e.key === "ArrowRight") $("pNext").click();
  else if (e.key === "ArrowLeft") $("pPrev").click();
  else if (e.key === " ") { e.preventDefault(); playModel(); }
});
document.addEventListener("visibilitychange", async () => {
  if (practice.stream && document.visibilityState === "visible" && !practice.wakeLock) {
    await keepScreenOn();
  }
});

// ⏮: start over from the top (clears the results too)
$("prHome").addEventListener("click", () => { if (model.sources.length) { model.from = null; stopModel(); } restartPractice(); });
$("prBack").addEventListener("click", () => { location.hash = "songs"; });
// 編集: back to the editor's draft when practicing it, else open this song in the editor
$("prEdit").addEventListener("click", () => {
  if (practice.fromEditor) { location.hash = "edit"; return; }
  const s = allSongs().find(x => x.id === practice.songId);
  if (!s) return;
  if (ed.loaded && ed.id === s.id && !s.preset) { location.hash = "edit"; return; }
  openEditor(s.preset ? { ...s, id: null, title: s.title + "（コピー）" } : s);
});
$("prBpm").addEventListener("input", () => updateMetronome(true));

loadPractice(currentSongId());
