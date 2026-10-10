/* ===== practice: wait mode (advance when the expected chord/note is played) ===== */
// settle: seconds after a strum before judging (the 0.34 s chord window still holds the previous sound).
// A repeat of the same chord/note can only be told apart by a new strum, so it uses a stricter path.
const JUDGE = { present: 0.2, extra: 0.3, extraNote: 0.25, extraSal: 0.8, okFrames: 2, wrongAfter: 0.9, settle: 0.12, settleSame: 0.2, minGap: 0.3 };
const practice = {
  song: null, idx: 0, tab: null, stream: null, source: null, raf: 0,
  tracker: createTracker(), okRun: 0, missRun: 0, fresh: true, silent: 0, wrongShown: false, sameAsPrev: false, loose: false, lastOk: false, ringing: [], strummed: false,
  onsetDet: null, tap: null, tapOut: null, onsets: [], lastStrum: -1,
  firstTry: [], startedAt: 0, mutedUntil: 0, wakeLock: null
};
const model = { sources: [], timers: [] };

function currentSongId() { try { return localStorage.getItem("guitaric.song"); } catch (e) { return null; } }
function setCurrentSongId(id) { try { localStorage.setItem("guitaric.song", id); } catch (e) {} }

function fillSongSelect() {
  const sel = $("pSong"), songs = allSongs(), cur = currentSongId();
  sel.innerHTML = "";
  const groups = [["自分の曲", songs.filter(s => !s.preset)], ["練習用", songs.filter(s => s.preset)]];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const og = document.createElement("optgroup"); og.label = label;
    for (const s of list) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.title; og.append(o); }
    sel.append(og);
  }
  sel.value = songs.some(s => s.id === cur) ? cur : songs[0].id;
}

function loadPractice(id) {
  const s = allSongs().find(x => x.id === id) || allSongs()[0];
  setCurrentSongId(s.id);
  if (model.sources.length) stopModel();
  practice.song = buildSong(s);
  practice.tab = renderTab($("pTab"), practice.song, { onStepClick: i => gotoStep(i) });
  setMetroSong(practice.song);
  restartPractice();
}

function playableIndex(i) {
  const steps = practice.song.steps;
  while (i < steps.length && !steps[i].notes.length) i++; // wait mode skips rests
  return i;
}

function restartPractice() {
  practice.firstTry = practice.song.steps.map(() => true);
  practice.startedAt = 0;
  $("pResult").hidden = true;
  practice.tab.clearStates();
  gotoStep(playableIndex(0));
}

function gotoStep(i) {
  const steps = practice.song.steps;
  for (let k = 0; k < steps.length; k++) if (k >= i) practice.tab.setState(k, "");
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
  practice.tab.setState(i, "current");
  practice.tab.scrollTo(i);
  const st = steps[i];
  $("pTarget").textContent = stepLabel(st);
  $("pWhere").textContent = practice.loose ? (st.loose ? "判定ゆるめ" : "コードチェンジ前（判定ゆるめ）") : stepWhere(st);
  $("pProgress").textContent = `${i + 1} / ${steps.length}`;
  setFeedback(practice.stream ? "弾いてください" : "「マイクを開始」を押すと判定が始まります", "");
}

function setFeedback(msg, kind) {
  const el = $("pFeedback"); el.textContent = msg; el.dataset.kind = kind;
}

function finishPractice() {
  const steps = practice.song.steps, idxs = steps.map((s, i) => i).filter(i => steps[i].notes.length);
  const first = idxs.filter(i => practice.firstTry[i]).length;
  const secs = practice.startedAt ? (performance.now() - practice.startedAt) / 1000 : 0;
  $("pTarget").textContent = "完了";
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
  practice.tab.setState(practice.idx, practice.firstTry[practice.idx] ? "done" : "done-retry");
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
  // (only for single notes, where a soft hammer-on may not register as an attack; a chord always
  // needs a strum: fingers landing on the next shape make sounds of their own)
  if (++practice.missRun >= 2 && !practice.sameAsPrev && !st.chord) practice.fresh = true;
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
  $("pMic").innerHTML = '<span class="dot"></span>マイクを停止';
  $("pMic").classList.remove("primary");
  setFeedback("弾いてください", "");
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
  cancelAnimationFrame(practice.raf); practice.raf = 0;
  if (practice.stream) practice.stream.getTracks().forEach(t => t.stop());
  [practice.source, practice.tap, practice.tapOut].forEach(n => n && n.disconnect());
  if (practice.tap) practice.tap.onaudioprocess = null;
  practice.stream = practice.source = practice.tap = practice.tapOut = null;
  if (practice.wakeLock) { practice.wakeLock.release().catch(() => {}); practice.wakeLock = null; }
  $("pMic").innerHTML = '<span class="dot"></span>マイクを開始';
  $("pMic").classList.add("primary");
  $("pMeter").style.width = "0%";
}

// (model = the sources and timers of the playback in progress, declared at the top)
// Plays the whole song at the metronome tempo, highlighting each step as it sounds.
// Judging pauses meanwhile so the speaker can't pass steps; pressing again stops it.

function stopModel() {
  model.sources.forEach(src => { try { src.stop(); } catch (e) {} });
  model.timers.forEach(clearTimeout);
  model.sources = []; model.timers = [];
  if (practice.tab) { practice.tab.setPlaying(-1); practice.tab.scrollTo(practice.idx); }
  practice.mutedUntil = Math.min(practice.mutedUntil, ctx ? ctx.currentTime : 0);
  practice.tracker.reset();
  $("pModel").textContent = "お手本";
}

function playModel() {
  ensureContext();
  if (model.sources.length) { stopModel(); return; }
  const steps = practice.song.steps, cell = 60 / effectiveBpm() * 4 / practice.song.grid;
  const t0 = ctx.currentTime + 0.15;
  let t = t0;
  steps.forEach((st, i) => {
    const dur = st.len * cell, start = t;
    model.timers.push(setTimeout(() => { practice.tab.setPlaying(i); practice.tab.scrollTo(i); }, (start - ctx.currentTime) * 1000));
    t += dur;
    if (!st.notes.length) return;
    // a note rings until the next one starts (the last one rings on)
    // ties after this step keep it ringing
    let held = dur, k = i + 1;
    while (steps[k] && steps[k].tie) held += steps[k++].len * cell;
    const ring = k >= steps.length ? held + 1.6 : held + 0.05;
    const data = synthStrum(stepMidis(st), ctx.sampleRate, ring + 0.05, i + 1);
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0);
    const src = ctx.createBufferSource(); src.buffer = b;
    // bends glide up into the bent pitch; a release starts bent and comes down
    if (st.tech === "b") {
      src.playbackRate.setValueAtTime(2 ** (-st.bend / 12), start);
      src.playbackRate.linearRampToValueAtTime(1, start + Math.min(0.2, dur * 0.6));
    } else if (st.tech === "d") {
      src.playbackRate.setValueAtTime(2 ** (2 / 12), start);
      src.playbackRate.setValueAtTime(2 ** (2 / 12), start + Math.min(0.08, dur * 0.3));
      src.playbackRate.linearRampToValueAtTime(1, start + Math.min(0.25, dur * 0.8));
    }
    const g = ctx.createGain();
    const vol = st.tech === "h" || st.tech === "p" || st.tech === "s" ? 1.6 : 2.5; // not picked: softer
    g.gain.setValueAtTime(vol, start);
    g.gain.setValueAtTime(vol, start + ring - 0.04);
    g.gain.linearRampToValueAtTime(0, start + ring);
    src.connect(g); g.connect(ctx.destination); src.start(start); src.stop(start + ring + 0.02);
    model.sources.push(src);
  });
  const end = t + 1.6;
  model.timers.push(setTimeout(stopModel, (end - ctx.currentTime) * 1000));
  practice.mutedUntil = end + 0.2;
  practice.tracker.reset();
  $("pModel").textContent = "停止";
}

$("pSong").addEventListener("change", e => loadPractice(e.target.value));
$("pMic").addEventListener("click", () => (practice.stream ? stopPracticeMic() : startPracticeMic()));
$("pRestart").addEventListener("click", restartPractice);
$("pAgain").addEventListener("click", restartPractice);
$("pPrev").addEventListener("click", () => {
  let i = practice.idx - 1;
  while (i > 0 && !practice.song.steps[i].notes.length) i--;
  if (i >= 0) gotoStep(i);
});
$("pNext").addEventListener("click", () => {
  if (practice.idx >= practice.song.steps.length) return;
  practice.firstTry[practice.idx] = false;
  practice.tab.setState(practice.idx, "skipped");
  gotoStep(playableIndex(practice.idx + 1));
});
$("pModel").addEventListener("click", playModel);
document.addEventListener("keydown", e => {
  if ($("view-practice").hidden || e.target.closest("input, textarea, select")) return;
  if (e.key === "ArrowRight") $("pNext").click();
  else if (e.key === "ArrowLeft") $("pPrev").click();
});
document.addEventListener("visibilitychange", async () => {
  if (practice.stream && document.visibilityState === "visible" && !practice.wakeLock) {
    await keepScreenOn();
  }
});

fillSongSelect();
loadPractice($("pSong").value);
