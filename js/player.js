/* ===== playback of a song with the synthesized guitar (practice model and editor) ===== */
// Schedules steps from..end of the song into `out`. onStep(i) fires as each step starts.
// Returns { sources, timers, start, end } (audio times of the first step and of the end of the last step's length).
function scheduleSong(song, from, bpm, out, onStep) {
  const steps = song.steps, cell = 60 / bpm * 4 / song.grid;
  const sources = [], timers = [];
  let t = ctx.currentTime + 0.15;
  const start = t;
  for (let i = from; i < steps.length; i++) {
    const st = steps[i], dur = st.len * cell, start = t;
    timers.push(setTimeout(() => onStep(i), (start - ctx.currentTime) * 1000));
    t += dur;
    if (st.brush) { sources.push(brushSound(start, out)); continue; }
    if (!st.notes.length) continue;
    // a note rings until the next one starts (the last one rings on); ties after this step keep it ringing
    let held = dur, k = i + 1;
    while (steps[k] && steps[k].tie) held += steps[k++].len * cell;
    let ring = k >= steps.length ? held + 1.6 : held + 0.05;
    if (st.pm) ring = Math.min(ring, 0.22); // bridge mute: stopped short by the palm
    const data = synthStrum(stepMidis(st), ctx.sampleRate, ring + (st.tech === "s" ? 0.3 : 0.05), i + 1);
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0);
    const src = ctx.createBufferSource(); src.buffer = b;
    // a slide glides from the previous note on the same string up or down into this one
    const prev = steps[i - 1];
    if (st.tech === "s" && prev && prev.notes.length === 1 && prev.notes[0][0] === st.notes[0][0] && prev.notes[0][1] !== st.notes[0][1]) {
      const glide = Math.min(0.15, dur * 0.5);
      src.playbackRate.setValueAtTime(2 ** ((prev.notes[0][1] - st.notes[0][1]) / 12), start);
      src.playbackRate.exponentialRampToValueAtTime(1, start + glide);
    }
    // bends glide up into the bent pitch; a release starts bent and comes down
    if (st.tech === "b") {
      src.playbackRate.setValueAtTime(2 ** (-st.bend / 12), start);
      src.playbackRate.linearRampToValueAtTime(1, start + Math.min(0.2, dur * 0.6));
    } else if (st.tech === "d") {
      const up = 2 ** ((st.bend || 2) / 12);
      src.playbackRate.setValueAtTime(up, start);
      src.playbackRate.setValueAtTime(up, start + Math.min(0.08, dur * 0.3));
      src.playbackRate.linearRampToValueAtTime(1, start + Math.min(0.25, dur * 0.8));
    }
    const g = ctx.createGain();
    const vol = st.tech === "h" || st.tech === "p" || st.tech === "s" ? 1.6 : 2.5; // not picked: softer
    if (st.pm) {
      // the palm on the bridge dulls the sound and makes it die away fast
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      g.gain.setValueAtTime(vol * 1.4, start);
      g.gain.exponentialRampToValueAtTime(vol * 0.15, start + ring - 0.04);
      src.connect(lp); lp.connect(g);
    } else {
      g.gain.setValueAtTime(vol, start);
      g.gain.setValueAtTime(vol, start + ring - 0.04);
      src.connect(g);
    }
    g.gain.linearRampToValueAtTime(0, start + ring);
    g.connect(out); src.start(start); src.stop(start + ring + 0.02);
    sources.push(src);
  }
  return { sources, timers, start, end: t };
}

// brushing: the muted strings struck, a short dull noise with no pitch
function brushSound(t, out) {
  const n = Math.round(ctx.sampleRate * 0.09), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.exp(-k / (ctx.sampleRate * 0.018));
  const src = ctx.createBufferSource(); src.buffer = b;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 1.8;
  src.connect(bp); bp.connect(g); g.connect(out); src.start(t);
  return src;
}

// one step on its own (the editor window's ▶, a double tap in practice); a new one cuts the last off
let preview = null;
function previewStep(song, i, bpm) {
  const st = song.steps[i];
  if (!st || !isPlayed(st)) return;
  ensureContext();
  if (preview) { preview.sources.forEach(src => { try { src.stop(); } catch (e) {} }); preview.gain.disconnect(); }
  const gain = ctx.createGain(); gain.gain.value = transportGain(); gain.connect(ctx.destination);
  const r = scheduleSong({ ...song, steps: [st] }, 0, bpm, gain, () => {});
  preview = { sources: r.sources, gain };
  return r.end + 1.6; // when it has rung out
}

/* ----- playback settings shared by the practice and editor screens ----- */
// click: 0 (none) / 4 (quarter notes) / 8 (eighth notes); rate: speed factor; vol: 0..1 slider;
// stopMode: "stay" (cursor stays where playback stopped) / "return" (back to where it started; the ↩ toggle)
const transport = (() => {
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  return { click: +get("guitaric.edClick", 0), rate: +get("guitaric.edRate", 1), vol: +get("guitaric.edVol", 0.7),
    stopMode: get("guitaric.edStop", "return"), listeners: [] };
})();
const transportGain = () => transport.vol * transport.vol;
function setTransport(key, value) {
  transport[key] = value;
  const store = { click: "guitaric.edClick", rate: "guitaric.edRate", vol: "guitaric.edVol", stopMode: "guitaric.edStop" }[key];
  try { localStorage.setItem(store, value); } catch (e) {}
  showTransport();
  transport.listeners.forEach(fn => fn(key));
}
// every screen's controls show the same settings
function showTransport() {
  document.querySelectorAll("[data-click]").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.click === transport.click)));
  document.querySelectorAll(".t-return").forEach(b => b.setAttribute("aria-pressed", String(transport.stopMode === "return")));
  document.querySelectorAll(".t-rate").forEach(el => { el.value = String(transport.rate); });
  document.querySelectorAll(".t-vol").forEach(el => { if (+el.value !== transport.vol) el.value = transport.vol; });
}
function bindTransport() {
  document.querySelectorAll("[data-click]").forEach(b => b.addEventListener("click", () => setTransport("click", +b.dataset.click)));
  document.querySelectorAll(".t-return").forEach(b => b.addEventListener("click", () => setTransport("stopMode", transport.stopMode === "return" ? "stay" : "return")));
  // phones: "…" pops up click / BPM / speed
  document.querySelectorAll(".ed-toolbar").forEach(tb => {
    const more = tb.querySelector(".tb-more-btn");
    const setMore = open => { tb.classList.toggle("more", open); more.setAttribute("aria-expanded", String(open)); };
    more.addEventListener("click", e => { e.stopPropagation(); setMore(!tb.classList.contains("more")); });
    document.addEventListener("click", e => { if (tb.classList.contains("more") && !e.target.closest(".tb-more")) setMore(false); });
  });
  document.querySelectorAll(".t-rate").forEach(el => el.addEventListener("change", () => setTransport("rate", +el.value)));
  document.querySelectorAll(".t-vol").forEach(el => el.addEventListener("input", () => setTransport("vol", +el.value)));
  showTransport();
}

// One click: a short Hann-windowed tone above 2.5 kHz, so the practice onset detector
// (80-2500 Hz) does not take a click leaking from the speaker into the mic for a strum.
function clickTone(t, kind, out) {
  const osc = ctx.createOscillator(), g = ctx.createGain(), len = 0.025;
  osc.frequency.value = kind === 2 ? 4200 : kind === 1 ? 3300 : 3000;
  const peak = kind === 2 ? 0.9 : kind === 1 ? 0.6 : 0.35;
  const curve = new Float32Array(32).map((_, i) => Math.sin(Math.PI * i / 31) ** 2 * peak);
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(curve, t, len);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + len + 0.01);
}

// clicks on every quarter or eighth note of the song from step `from` on (bar heads accented)
function scheduleSongClicks(song, from, bpm, start, out) {
  const div = transport.click;
  if (!div) return;
  const cell = 60 / bpm * 4 / song.grid, every = Math.max(1, song.grid / div), barCells = song.timeSig[0] * song.grid / 4;
  const cells = song.steps.map(st => st.len), fromCell = cells.slice(0, from).reduce((a, b) => a + b, 0);
  const total = cells.reduce((a, b) => a + b, 0);
  for (let c = Math.ceil(fromCell / every) * every; c < total; c += every)
    clickTone(start + (c - fromCell) * cell, c % barCells === 0 ? 2 : c % (song.grid / 4) === 0 ? 1 : 0, out);
}
