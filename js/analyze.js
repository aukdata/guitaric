/* ===== UI ===== */
const $ = id => document.getElementById(id);
const FFT_SIZE = 16384;
let ctx = null, analyser = null, micStream = null, micSource = null, tapNode = null, mute = null;
let playSource = null, rafId = 0, shownChroma = new Array(12).fill(0), silentFrames = 0;
const tracker = createTracker();
let recording = false, recChunks = [], recStart = 0, recCount = 0;

function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.classList.toggle("err", !!err); }

function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

async function startMic() {
  ensureContext();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    setStatus("マイクを使えませんでした（" + (e.name || "error") + "）。ブラウザのマイク許可を確認するか、音声ファイルかサンプルで試してください。", true);
    return;
  }
  stopPlayback();
  micSource = ctx.createMediaStreamSource(micStream);
  micSource.connect(analyser);
  tapNode = ctx.createScriptProcessor(4096, 1, 1);
  tapNode.onaudioprocess = e => { if (recording) recChunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  mute = ctx.createGain(); mute.gain.value = 0;
  micSource.connect(tapNode); tapNode.connect(mute); mute.connect(ctx.destination);
  $("micBtn").innerHTML = '<span class="dot"></span>マイクを停止';
  $("micBtn").classList.remove("primary");
  $("recBtn").disabled = false;
  setStatus("マイク入力を解析中です（" + ctx.sampleRate + " Hz）。弦を鳴らしてください。");
  startLoop();
}

function stopMic() {
  if (recording) toggleRec();
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  [micSource, tapNode, mute].forEach(n => n && n.disconnect());
  micStream = micSource = tapNode = mute = null;
  $("micBtn").innerHTML = '<span class="dot"></span>マイクを開始';
  $("micBtn").classList.add("primary");
  $("recBtn").disabled = true;
  setStatus("マイクを停止しました。");
}

function stopPlayback() { if (playSource) { try { playSource.stop(); } catch (e) {} playSource.disconnect(); playSource = null; } }

function playBuffer(audioBuf, label) {
  ensureContext();
  stopPlayback();
  playSource = ctx.createBufferSource();
  playSource.buffer = audioBuf;
  playSource.connect(analyser);
  analyser.connect(ctx.destination);
  playSource.onended = () => { analyser.disconnect(); };
  playSource.start();
  tracker.reset();
  setStatus(label + " を再生しながら解析しています。");
  startLoop();
}

function playSample() {
  ensureContext();
  const key = $("sampleSel").value;
  const data = synthStrum(SAMPLE_VOICINGS[key], ctx.sampleRate, 3);
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.copyToChannel(data, 0);
  playBuffer(buf, "サンプル " + key);
}

async function analyzeFile(file) {
  ensureContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    playBuffer(buf, file.name);
  } catch (e) { setStatus("このファイルは読み込めませんでした。WAV・MP3・M4Aなどの音声ファイルを選んでください。", true); }
}

function encodeWav(chunks, sr) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

function toggleRec() {
  const btn = $("recBtn");
  if (!recording) {
    recChunks = []; recording = true; recStart = performance.now();
    btn.classList.add("rec-on"); btn.innerHTML = '<span class="dot"></span>録音を停止';
    $("recTimer").hidden = false;
  } else {
    recording = false;
    btn.classList.remove("rec-on"); btn.innerHTML = '<span class="dot"></span>録音';
    $("recTimer").hidden = true;
    const blob = encodeWav(recChunks, ctx.sampleRate);
    const secs = recChunks.reduce((a, c) => a + c.length, 0) / ctx.sampleRate;
    addRecording(blob, secs);
  }
}

function addRecording(blob, secs) {
  const list = $("recs");
  if (!recCount) list.innerHTML = "";
  recCount++;
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  const fname = `guitaric-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.wav`;
  const url = URL.createObjectURL(blob);
  const row = document.createElement("div"); row.className = "rec";
  const audio = document.createElement("audio"); audio.controls = true; audio.src = url;
  const meta = document.createElement("span"); meta.className = "meta";
  meta.textContent = `${secs.toFixed(1)} 秒 · ${(blob.size / 1024).toFixed(0)} KB`;
  const a = document.createElement("a"); a.href = url; a.download = fname; a.textContent = fname + " を保存";
  row.append(audio, meta, a);
  list.prepend(row);
}

function drawChroma(chroma) {
  shownChroma = chroma;
  const cv = $("chroma"), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim(), line = css.getPropertyValue("--line").trim(), muted = css.getPropertyValue("--muted").trim();
  const labelH = 20, colW = w / 12, top = 6;
  for (let i = 0; i < 12; i++) {
    const x = i * colW + colW * 0.15, bw = colW * 0.7, bh = (h - labelH - top) * chroma[i];
    g.fillStyle = line; g.fillRect(x, top, bw, h - labelH - top);
    g.fillStyle = accent; g.fillRect(x, h - labelH - bh, bw, bh);
    g.fillStyle = muted; g.font = "12px 'IBM Plex Mono', monospace"; g.textAlign = "center";
    g.fillText(NOTE_NAMES[i], i * colW + colW / 2, h - 5);
  }
}

function render(res) {
  const notesEl = $("notes");
  if (res.notes.length) {
    notesEl.innerHTML = "";
    res.notes.forEach((n, i) => {
      const el = document.createElement("span"); el.className = "note" + (i === 0 ? " bass" : "");
      el.textContent = noteName(n.midi);
      const sm = document.createElement("small"); sm.textContent = n.freq.toFixed(1) + "Hz"; el.append(sm);
      notesEl.append(el);
    });
    const strongest = res.notes.reduce((a, b) => (b.salience > a.salience ? b : a));
    const cents = 100 * (freqToMidi(strongest.freq) - strongest.midi);
    $("tunerText").textContent = `${noteName(strongest.midi)}  ${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`;
    const nd = $("needle"); nd.style.left = (50 + Math.max(-50, Math.min(50, cents))) + "%";
    nd.style.background = Math.abs(cents) < 5 ? "var(--good)" : Math.abs(cents) < 15 ? "var(--warn)" : "var(--bad)";
  }
  const chordEl = $("chord");
  if (res.cands && res.cands.length) {
    chordEl.textContent = res.cands[0].name.replace("（単音）", "");
    chordEl.classList.remove("stale");
    $("chordSub").textContent = res.cands[0].single ? "単音として検出" : (res.bassMidi != null ? "ベース " + noteName(res.bassMidi) : "");
    $("cands").innerHTML = res.cands.slice(1).map(c => `<span class="cand"><b>${c.name}</b> ${(c.score * 100).toFixed(0)}</span>`).join("");
  } else if (!res.notes.length) {
    chordEl.classList.add("stale");
  }
}

function startLoop() {
  if (rafId) return;
  const buf = new Float32Array(FFT_SIZE);
  let last = 0;
  const tick = t => {
    rafId = requestAnimationFrame(tick);
    if (recording) {
      const s = (performance.now() - recStart) / 1000;
      $("recTimer").textContent = Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0");
    }
    if (t - last < 70) return; last = t;
    analyser.getFloatTimeDomainData(buf);
    const res = detectNotes(buf, ctx.sampleRate);
    // level meter in dB: -70 dBFS (empty) to -10 dBFS (full), so quiet microphones still show movement
    const db = 20 * Math.log10(res.rms + 1e-9);
    $("meterBar").style.width = Math.max(0, Math.min(100, (db + 70) / 60 * 100)) + "%";
    const tr = tracker.update(res);
    res.cands = tr.cands;
    res.bassMidi = tr.bassMidi;
    if (res.notes.length) {
      silentFrames = 0;
      drawChroma(tr.chroma);
    } else if (++silentFrames === 6) {
      drawChroma(new Array(12).fill(0));
      tracker.reset();
    }
    render(res);
  };
  rafId = requestAnimationFrame(tick);
}

$("micBtn").addEventListener("click", () => (micStream ? stopMic() : startMic()));
$("recBtn").addEventListener("click", toggleRec);
$("sampleBtn").addEventListener("click", playSample);
$("fileInput").addEventListener("change", e => { if (e.target.files[0]) analyzeFile(e.target.files[0]); e.target.value = ""; });
window.addEventListener("resize", () => drawChroma(shownChroma));

// Opening state: show what a C chord looks like before any sound is played
(function preview() {
  const sr = 48000, data = synthStrum(SAMPLE_VOICINGS.C, sr, 0.6);
  const res = detectNotes(data.subarray(sr * 0.2, sr * 0.2 + FFT_SIZE), sr);
  if (!res.notes.length) return;
  const c = chromaFromNotes(res.notes);
  res.cands = recognizeChord(c, res.notes[0].midi % 12);
  res.bassMidi = res.notes[0].midi;
  render(res); drawChroma(c);
  $("chord").classList.add("stale");
  $("chordSub").textContent = "例：サンプルの C コードを解析した結果";
})();
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  setStatus("このブラウザではマイクを使えません。音声ファイルかサンプルで試してください。", true);
}
