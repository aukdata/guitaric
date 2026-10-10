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
    if (!st.notes.length) continue;
    // a note rings until the next one starts (the last one rings on); ties after this step keep it ringing
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
    src.connect(g); g.connect(out); src.start(start); src.stop(start + ring + 0.02);
    sources.push(src);
  }
  return { sources, timers, start, end: t };
}

/* ----- playback settings shared by the practice and editor screens ----- */
// click: 0 (none) / 4 (quarter notes) / 8 (eighth notes); rate: speed factor; vol: 0..1 slider;
// stopMode: "stay" (cursor stays where playback stopped) / "return" (back to where it started)
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
  document.querySelectorAll("[data-stop]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.stop === transport.stopMode)));
  document.querySelectorAll(".t-rate").forEach(el => { el.value = String(transport.rate); });
  document.querySelectorAll(".t-vol").forEach(el => { if (+el.value !== transport.vol) el.value = transport.vol; });
}
function bindTransport() {
  document.querySelectorAll("[data-click]").forEach(b => b.addEventListener("click", () => setTransport("click", +b.dataset.click)));
  document.querySelectorAll("[data-stop]").forEach(b => b.addEventListener("click", () => setTransport("stopMode", b.dataset.stop)));
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
