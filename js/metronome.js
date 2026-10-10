/* ===== metronome: click at the song's BPM (times a speed factor), scheduled ahead on the audio clock ===== */
// The click is a short Hann-windowed tone above 3 kHz: the onset detector only looks at 80-2500 Hz,
// so a click leaking from the speaker into the mic is not taken for a strum.
const metro = { on: false, bpm: 80, rate: 1, beats: 4, next: 0, beat: 0, timer: 0, raf: 0, queue: [], volume: 0.5 };

function clickAt(t, accent) {
  const len = 0.025, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.frequency.value = accent ? 4200 : 3300;
  const curve = new Float32Array(32).map((_, i) => Math.sin(Math.PI * i / 31) ** 2 * metro.volume * (accent ? 1 : 0.7));
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(curve, t, len);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + len + 0.01);
}

const effectiveBpm = () => metro.bpm * metro.rate;

function scheduleClicks() {
  const spb = 60 / effectiveBpm();
  while (metro.next < ctx.currentTime + 0.12) {
    const b = metro.beat % metro.beats;
    clickAt(metro.next, b === 0);
    metro.queue.push({ t: metro.next, b });
    metro.next += spb; metro.beat++;
  }
}

function drawBeat() {
  metro.raf = requestAnimationFrame(drawBeat);
  let cur = null;
  while (metro.queue.length && metro.queue[0].t <= ctx.currentTime) cur = metro.queue.shift();
  if (!cur) return;
  $("mDots").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i === cur.b));
}

function startMetronome() {
  ensureContext();
  metro.on = true; metro.beat = 0; metro.queue = [];
  metro.next = ctx.currentTime + 0.1;
  scheduleClicks();
  metro.timer = setInterval(scheduleClicks, 25);
  drawBeat();
  $("mToggle").setAttribute("aria-pressed", "true");
  $("mToggle").classList.add("primary");
  keepScreenOn();
}

function stopMetronome() {
  metro.on = false;
  clearInterval(metro.timer); cancelAnimationFrame(metro.raf);
  $("mToggle").setAttribute("aria-pressed", "false");
  $("mToggle").classList.remove("primary");
  $("mDots").querySelectorAll("i").forEach(d => d.classList.remove("on"));
}

function setMetroBeats(n) {
  metro.beats = n;
  $("mDots").innerHTML = "<i></i>".repeat(n);
}

function updateMetroLabel() {
  $("mEff").textContent = metro.rate === 1 ? "" : `→ ${Math.round(effectiveBpm())} BPM`;
}

// called when a song is loaded: take its tempo and time signature
function setMetroSong(song) {
  metro.bpm = song.bpm || 80;
  $("mBpm").value = metro.bpm;
  setMetroBeats(song.timeSig[0]);
  updateMetroLabel();
}

$("mToggle").addEventListener("click", () => (metro.on ? stopMetronome() : startMetronome()));
$("mBpm").addEventListener("input", e => {
  const v = +e.target.value;
  if (v >= 20 && v <= 300) { metro.bpm = v; updateMetroLabel(); }
});
$("mRate").addEventListener("change", e => {
  metro.rate = +e.target.value; updateMetroLabel();
  try { localStorage.setItem("guitaric.rate", e.target.value); } catch (err) {}
});
$("mVol").addEventListener("input", e => { metro.volume = +e.target.value; });
try {
  const r = localStorage.getItem("guitaric.rate");
  if (r) { $("mRate").value = r; metro.rate = +r; }
} catch (e) {}
