/* ===== playback of a song with the synthesized guitar (practice model and editor) ===== */
// seconds per grid cell at a step's tempo ("@bpm"), times the playback speed
const cellSecs = (song, st, rate) => 60 / ((st.tempo || song.bpm || 80) * rate) * 4 / song.grid;

// Schedules the song from step `from` to the end into `out`, in playing order (repeats unrolled; a
// step inside a repeat starts from its first time through). onStep(i) fires as each step starts.
// Returns { sources, timers, start, end } (audio times of the first step and of the end of the last step's length).
function scheduleSong(song, from, rate, out, onStep) {
  const steps = song.steps, order = song.order || steps.map((_, i) => i);
  const sources = [], timers = [];
  let t = ctx.currentTime + 0.15;
  const t0 = t;
  let lag = 0; // a grace note just before: the next note sounds a moment later
  for (let p = Math.max(0, order.indexOf(from)); p < order.length; p++) {
    const i = order[p], st = steps[i], cell = cellSecs(song, st, rate), dur = st.len * cell;
    const start = t + lag;
    lag = 0;
    timers.push(setTimeout(() => onStep(i), (start - ctx.currentTime) * 1000));
    t += dur;
    if (st.brush) { sources.push(brushSound(start, out)); continue; }
    if (!st.notes.length) continue;
    // a note rings until the next one starts (the last one rings on); ties after this step keep it ringing
    let held = dur, k = p + 1;
    while (k < order.length && steps[order[k]].tie) held += steps[order[k]].len * cellSecs(song, steps[order[k++]], rate);
    let ring = k >= order.length ? held + 1.6 : held + 0.05;
    if (st.grace) { lag = Math.min(0.06, steps[order[p + 1]] ? steps[order[p + 1]].len * cellSecs(song, steps[order[p + 1]], rate) / 3 : 0.06); ring = lag + 0.03; }
    if (st.stac) ring = Math.min(ring, Math.max(0.08, dur * 0.45)); // staccato: cut short, its length kept
    if (st.pm) ring = Math.min(ring, 0.22); // bridge mute: stopped short by the palm
    // notes with different marks sound apart (each string bends or slides on its own); muted
    // strings add a dull click
    const prev = steps[order[p - 1]], groups = new Map();
    st.notes.forEach((n, j) => { const key = JSON.stringify(n[2] || {}); if (!groups.has(key)) groups.set(key, { notes: [], j }); groups.get(key).notes.push(n); });
    for (const g of groups.values()) sources.push(...noteSound({ ...st, notes: g.notes }, markOf(g.notes[0]), start + g.j * 0.018, dur, ring, prev, out, i + 1));
    if (st.mute) sources.push(brushSound(start, out, 0.8));
  }
  return { sources, timers, start: t0, end: t };
}

// one group of notes of a step (the same marks m), from `start`; returns its audio sources
function noteSound(st, m, start, dur, ring, prev, out, seed) {
  const sources = [];
  const fast = m.fast ? 0.3 : 1;
  if (m.harm && !st.pm && !st.stac) ring = Math.max(ring, Math.min(ring + 1.2, 2.5)); // a harmonic keeps ringing
  if (m.move === "o") ring = Math.min(ring, dur + 0.05);
  const data = synthStrum(stepMidis(st), ctx.sampleRate, ring + (m.start === "s" ? 0.3 : 0.05), seed);
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0);
  const src = ctx.createBufferSource(); src.buffer = b;
  const rate = src.playbackRate;
  // how it starts: a slide glides from the previous note on the same string (notes played together
  // slide by the same amount: the first one's); a slide in comes up from a few frets below
  const from = m.start === "s" && prev && prev.notes.find(n => n[0] === st.notes[0][0]);
  if (from && from[1] !== st.notes[0][1]) {
    rate.setValueAtTime(2 ** ((from[1] - st.notes[0][1]) / 12), start);
    rate.exponentialRampToValueAtTime(1, start + Math.min(0.15 * fast, dur * 0.5 || 0.05));
  } else if (m.start === "i") {
    rate.setValueAtTime(2 ** (-4 / 12), start);
    rate.exponentialRampToValueAtTime(1, start + Math.min(0.12 * fast, dur * 0.5 || 0.05));
  }
  // while it rings: bends glide up into the bent pitch; a release starts bent and comes down;
  // a slide out falls away at the end; a trill alternates with the other fret about 12 times a second
  const bend = bendOf(m);
  if (bend) {
    rate.setValueAtTime(2 ** (-bend / 12), start);
    rate.linearRampToValueAtTime(1, start + Math.min(0.2 * fast, dur * 0.6));
  } else if (m.move && m.move[0] === "d") {
    const up = 2 ** ((+m.move[1] || 2) / 12);
    rate.setValueAtTime(up, start);
    rate.setValueAtTime(up, start + Math.min(0.08 * fast, dur * 0.3));
    rate.linearRampToValueAtTime(1, start + Math.min(0.25 * fast, dur * 0.8));
  } else if (m.move === "o") {
    const fall = start + Math.max(dur * 0.5, dur - 0.15 * fast);
    rate.setValueAtTime(1, fall);
    rate.exponentialRampToValueAtTime(2 ** (-7 / 12), start + dur);
  } else if (m.move === "t") {
    const other = 2 ** ((m.trill - st.notes[0][1]) / 12);
    for (let k = 1, x = start + 1 / 12; x < start + Math.min(ring, dur); k++, x += 1 / 12) rate.setValueAtTime(k % 2 ? other : 1, x);
  }
  if (m.v) {
    // vibrato: the pitch wavers about ±25 cents, 5.5 times a second, after the attack
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, start);
    depth.gain.linearRampToValueAtTime(0.015, start + Math.min(0.25, dur * 0.4 || 0.1));
    lfo.connect(depth); depth.connect(rate);
    lfo.start(start); lfo.stop(start + ring + 0.05);
    sources.push(lfo);
  }
  const g = ctx.createGain();
  const vol = (m.start && "hps".includes(m.start) ? 1.6 : 2.5) * (st.grace ? 0.8 : 1); // not picked: softer
  if (m.harm) {
    // a harmonic: a pure, bell-like tone (the overtone alone, no low partials or pick noise)
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = midiToFreq(Math.max(...stepMidis(st))) * 1.6;
    g.gain.setValueAtTime(vol * 1.3, start);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, start + ring - 0.04);
    src.connect(lp); lp.connect(g);
  } else if (st.pm) {
    // the palm on the bridge dulls the sound and makes it die away fast
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    g.gain.setValueAtTime(vol * 1.4, start);
    g.gain.exponentialRampToValueAtTime(vol * 0.15, start + ring - 0.04);
    src.connect(lp); lp.connect(g);
  } else {
    g.gain.setValueAtTime(vol, start);
    g.gain.setValueAtTime(vol, start + Math.max(0, ring - 0.04));
    src.connect(g);
  }
  g.gain.linearRampToValueAtTime(0, start + ring);
  g.connect(out); src.start(start); src.stop(start + ring + 0.02);
  sources.push(src);
  return sources;
}

// brushing: the muted strings struck, a short dull noise with no pitch
function brushSound(t, out, vol = 1.8) {
  const n = Math.round(ctx.sampleRate * 0.09), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.exp(-k / (ctx.sampleRate * 0.018));
  const src = ctx.createBufferSource(); src.buffer = b;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(bp); bp.connect(g); g.connect(out); src.start(t);
  return src;
}

// one step on its own (the editor window's ▶, a double tap in practice); a new one cuts the last off
let preview = null;
function previewStep(song, i, rate) {
  const st = song.steps[i];
  if (!st || !isPlayed(st)) return;
  ensureContext();
  if (preview) { preview.sources.forEach(src => { try { src.stop(); } catch (e) {} }); preview.gain.disconnect(); }
  const gain = ctx.createGain(); gain.gain.value = transportGain(); gain.connect(ctx.destination);
  const r = scheduleSong({ ...song, steps: [st], order: [0] }, 0, rate, gain, () => {});
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

// clicks on every quarter or eighth note of the song from step `from` on (bar heads accented),
// following the playing order and each step's tempo
function scheduleSongClicks(song, from, rate, start, out) {
  const div = transport.click;
  if (!div) return;
  const every = Math.max(1, song.grid / div), barCells = song.timeSig[0] * song.grid / 4;
  const order = song.order || song.steps.map((_, i) => i), p0 = Math.max(0, order.indexOf(from));
  let c = order.slice(0, p0).reduce((a, i) => a + song.steps[i].len, 0), t = start;
  for (let p = p0; p < order.length; p++) {
    const st = song.steps[order[p]], cell = cellSecs(song, st, rate);
    for (let k = 0; k < st.len; k++, c++)
      if (c % every === 0) clickTone(t + k * cell, c % barCells === 0 ? 2 : c % (song.grid / 4) === 0 ? 1 : 0, out);
    t += st.len * cell;
  }
}
