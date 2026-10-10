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
