/* ===== metronome for practice: clicks at the practice tempo while the mic is on ===== */
// Uses the shared click setting (none / quarter / eighth notes), speed and volume (player.js).
// The model playback schedules its own clicks, so the metronome pauses while it plays.
const metro = { on: false, next: 0, n: 0, timer: 0, out: null };

// the tempo ("@bpm") at the step being practiced, times the speed setting
function practiceBpm() {
  const st = practice.song && practice.song.steps[Math.min(practice.idx, practice.song.steps.length - 1)];
  return (st && st.tempo) || (practice.song && practice.song.bpm) || 80;
}
const effectiveBpm = () => practiceBpm() * transport.rate;

function scheduleClicks() {
  const per = Math.max(1, transport.click / 4), beats = practice.song ? practice.song.timeSig[0] : 4;
  while (metro.next < ctx.currentTime + 0.12) {
    const k = metro.n % (beats * per);
    clickTone(metro.next, k === 0 ? 2 : k % per === 0 ? 1 : 0, metro.out);
    metro.next += 60 / effectiveBpm() / per; metro.n++;
  }
}

function startMetronome() {
  if (metro.on || !transport.click) return;
  ensureContext();
  metro.out = ctx.createGain(); metro.out.gain.value = transportGain(); metro.out.connect(ctx.destination);
  metro.on = true; metro.n = 0;
  metro.next = ctx.currentTime + 0.1;
  scheduleClicks();
  metro.timer = setInterval(scheduleClicks, 25);
}

function stopMetronome() {
  if (!metro.on) return;
  metro.on = false;
  clearInterval(metro.timer);
  metro.out.disconnect(); metro.out = null;
}

// on while the practice mic is on, the click is set and the model is not playing; restart: from the bar head
function updateMetronome(restart) {
  const want = !!practice.stream && !!transport.click && !model.sources.length && !$("view-practice").hidden;
  if (!want || restart) stopMetronome();
  if (want) startMetronome();
}

// called when a song is loaded
function setMetroSong() {
  updateMetronome(true);
}

transport.listeners.push(key => {
  if (key === "vol" && metro.out) metro.out.gain.value = transportGain();
  if (key === "click") updateMetronome(true);
});
