/* ===== practice: wait mode (advance when the expected chord/note is played) ===== */
const JUDGE = { present: 0.2, extra: 0.3, okFrames: 2, wrongFrames: 6, settle: 2 };
const practice = {
  song: null, idx: 0, tab: null, stream: null, source: null, raf: 0,
  tracker: createTracker(), okRun: 0, missRun: 0, fresh: true, sinceOnset: 99, silent: 0,
  firstTry: [], startedAt: 0, mutedUntil: 0, wakeLock: null
};

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
  practice.song = buildSong(s);
  practice.tab = renderTab($("pTab"), practice.song, { onStepClick: i => gotoStep(i) });
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
  practice.okRun = 0; practice.missRun = 0; practice.fresh = false; practice.sinceOnset = 99;
  if (i >= steps.length) { finishPractice(); return; }
  practice.tab.setState(i, "current");
  practice.tab.scrollTo(i);
  const st = steps[i];
  $("pTarget").textContent = stepLabel(st);
  $("pWhere").textContent = stepWhere(st);
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
function judgeStep(st, res, tr) {
  if (st.chord) {
    const pcs = chordPitchClasses(st.chord) || [...new Set(stepMidis(st).map(m => m % 12))];
    const ch = tr.chroma, total = ch.reduce((a, b) => a + b, 0);
    if (!total) return { ok: false, missing: [] };
    const missing = pcs.filter(pc => ch[pc] < JUDGE.present);
    const extra = ch.reduce((a, v, pc) => a + (pcs.includes(pc) ? 0 : v), 0) / total;
    const root = parseChordName(st.chord).pc;
    // four-note chords often lose their fifth; allow one missing tone except the root
    const allowed = pcs.length >= 4 ? 1 : 0;
    const ok = !missing.includes(root) && missing.length <= allowed && extra <= JUDGE.extra;
    return { ok, missing: missing.map(pc => NOTE_NAMES[pc]) };
  }
  const want = stepMidis(st);
  if (want.length === 1) {
    // the target must be one of the loudest notes, not the previous note still ringing under a new one
    const top = Math.max(0, ...res.notes.map(n => n.salience));
    const ok = res.notes.some(n => n.midi === want[0] && n.salience >= top * 0.7);
    return { ok, missing: ok ? [] : [noteName(want[0])] };
  }
  const missing = want.filter(m => tr.chroma[m % 12] < JUDGE.present);
  return { ok: missing.length === 0, missing: missing.map(noteName) };
}

function practiceTick(buf) {
  const res = detectNotes(buf, ctx.sampleRate);
  const db = 20 * Math.log10(res.rms + 1e-9);
  $("pMeter").style.width = Math.max(0, Math.min(100, (db + 70) / 60 * 100)) + "%";
  const tr = practice.tracker.update(res);
  if (res.notes.length) practice.silent = 0;
  else if (++practice.silent === 6) practice.tracker.reset();
  if (ctx.currentTime < practice.mutedUntil) return;
  const steps = practice.song.steps;
  if (practice.idx >= steps.length) return;
  const st = steps[practice.idx];
  if (tr.onset) { practice.fresh = true; practice.sinceOnset = 0; } else practice.sinceOnset++;
  const j = judgeStep(st, res, tr);
  if (j.ok) {
    practice.missRun = 0;
    // only a new attack counts, so a chord still ringing from the previous step can't pass the next one
    // the analysis window is ~0.34 s long, so right after an attack the old note still dominates it
    if (practice.sinceOnset < JUDGE.settle) return;
    if (practice.fresh && ++practice.okRun >= JUDGE.okFrames) {
      if (!practice.startedAt) practice.startedAt = performance.now();
      setFeedback("OK", "ok");
      practice.tab.setState(practice.idx, practice.firstTry[practice.idx] ? "done" : "done-retry");
      gotoStep(playableIndex(practice.idx + 1));
      if (practice.idx < steps.length) setFeedback("OK", "ok");
    }
    return;
  }
  practice.okRun = 0;
  // the target is not sounding now, so the next time it appears it is a fresh attempt
  if (++practice.missRun >= 2) practice.fresh = true;
  if (res.notes.length && practice.sinceOnset >= JUDGE.wrongFrames && practice.sinceOnset < JUDGE.wrongFrames + 2) {
    if (!practice.startedAt) practice.startedAt = performance.now();
    practice.firstTry[practice.idx] = false;
    const heard = st.chord && tr.cands && tr.cands[0] ? tr.cands[0].name.replace("（単音）", "")
      : res.notes.slice().sort((a, b) => b.salience - a.salience).slice(0, st.notes.length > 1 ? 3 : 1).map(n => noteName(n.midi)).join(" ");
    setFeedback(`今鳴っているのは ${heard}` + (j.missing.length ? `（${j.missing.join("・")} が聞こえません）` : ""), "ng");
  }
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
  if (practice.source) practice.source.disconnect();
  practice.stream = practice.source = null;
  if (practice.wakeLock) { practice.wakeLock.release().catch(() => {}); practice.wakeLock = null; }
  $("pMic").innerHTML = '<span class="dot"></span>マイクを開始';
  $("pMic").classList.add("primary");
  $("pMeter").style.width = "0%";
}

// Plays the current step so the player can hear it; judging pauses meanwhile so the speaker can't pass it.
function playModel() {
  ensureContext();
  const st = practice.song.steps[practice.idx];
  if (!st || !st.notes.length) return;
  const data = synthStrum(stepMidis(st), ctx.sampleRate, 1.6);
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0);
  const src = ctx.createBufferSource(); src.buffer = b;
  const g = ctx.createGain(); g.gain.value = 2.5;
  src.connect(g); g.connect(ctx.destination); src.start();
  practice.mutedUntil = ctx.currentTime + 1.8;
  practice.tracker.reset();
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
