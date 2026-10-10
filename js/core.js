/* ===== analysis core (pure functions) ===== */
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

function fftMag(input) {
  const n = input.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = input[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

function bandMax(mag, center, rel) {
  const lo = Math.max(1, Math.floor(center * (1 - rel))), hi = Math.min(mag.length - 2, Math.ceil(center * (1 + rel)));
  let best = 0, at = -1;
  for (let i = lo; i <= hi; i++) if (mag[i] > best) { best = mag[i]; at = i; }
  return { v: best, at };
}

// Multi-pitch estimation (Klapuri 2006 style): compressed spectrum, harmonic-sum salience
// weighted by (f0+a)/(h*f0+b), then pick the best note and attenuate its partials, repeat.
const MP = { comp: 0.25, fundGate: 0.06, fmax: 7000, a: 52, b: 320, stop: 0.25, sub: 0.5, hpen: 0.5, maxNotes: 6, harmMin: 4, harmPeak: 1.3, fundPeak: 1.2 };
function detectNotes(frame, sr, opts = {}) {
  const minMidi = opts.minMidi ?? 40, maxMidi = opts.maxMidi ?? 88;
  let rms = 0; for (let i = 0; i < frame.length; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / frame.length);
  if (rms < (opts.gate ?? 0.0003)) return { rms, notes: [] };
  const raw = fftMag(frame), df = sr / frame.length;
  const mag = raw.map(v => Math.pow(v, MP.comp));
  let peakAll = 0; for (let i = 1; i < mag.length; i++) if (mag[i] > peakAll) peakAll = mag[i];
  // local noise floor (mean of a wide neighbourhood) to tell real partials from background
  const floor = new Float64Array(mag.length), W = 40;
  { let acc = 0; for (let i = 0; i < Math.min(mag.length, W); i++) acc += mag[i];
    for (let i = 0; i < mag.length; i++) { const lo = i - W - 1, hi = i + W; if (hi < mag.length) acc += mag[hi]; if (lo >= 0) acc -= mag[lo];
      floor[i] = acc / (Math.min(mag.length - 1, hi) - Math.max(0, lo + 1) + 1); } }
  const orig = mag.slice();
  const isPartial = c => { const r = bandMax(orig, c, 0.012); return r.at >= 0 && r.v > floor[r.at] * MP.harmPeak; };
  const notes = [];
  let firstSal = 0;
  for (let iter = 0; iter < MP.maxNotes; iter++) {
    let best = null;
    for (let m = minMidi; m <= maxMidi; m++) {
      if (notes.some(n => n.midi === m)) continue;
      const f0 = midiToFreq(m);
      if (bandMax(mag, f0 / df, 0.02).v < peakAll * MP.fundGate) continue;
      // a body resonance or hum has a fundamental but no harmonic series; require some upper partials
      if (MP.fundPeak > 0) { const r = bandMax(orig, f0 / df, 0.012); if (r.at < 0 || r.v < floor[r.at] * MP.fundPeak) continue; }
      if (MP.harmMin > 0) { let cnt = 0; for (let h = 2; h <= 6; h++) if (isPartial(h * f0 / df)) cnt++; if (cnt < MP.harmMin) continue; }
      let sal = 0;
      for (let h = 1; h * f0 < MP.fmax; h++) {
        const c = h * f0 / df; if (c >= mag.length - 2) break;
        sal += bandMax(mag, c, 0.012).v * (f0 + MP.a) / (h * f0 + MP.b);
      }
      // a candidate sitting on a non-octave partial of an already found note is likely that partial
      const onPartial = notes.some(n => { const r = f0 / midiToFreq(n.midi), h = Math.round(r); return h >= 3 && (h & (h - 1)) !== 0 && Math.abs(r - h) / h < 0.012; });
      if (onPartial) sal *= MP.hpen;
      if (!best || sal > best.sal) best = { m, sal };
    }
    if (!best) break;
    if (iter === 0) firstSal = best.sal;
    else if (best.sal < firstSal * MP.stop) break;
    // refine frequency with parabolic interpolation on the raw fundamental peak
    let freq = midiToFreq(best.m);
    const k = bandMax(raw, freq / df, 0.02).at;
    if (k > 0 && k < raw.length - 1) {
      const a = Math.log(raw[k - 1] + 1e-12), b = Math.log(raw[k] + 1e-12), c = Math.log(raw[k + 1] + 1e-12);
      const p = 0.5 * (a - c) / (a - 2 * b + c || 1e-12);
      freq = (k + p) * df;
    }
    // keep only notes whose measured pitch lands within 40 cents of the semitone (drops noise peaks)
    if (Math.abs(1200 * Math.log2(freq / midiToFreq(best.m))) < 40) notes.push({ midi: best.m, freq, salience: best.sal });
    const f0 = midiToFreq(best.m);
    for (let h = 1; h * f0 < MP.fmax + 500; h++) {
      const c = h * f0 / df; if (c >= mag.length - 2) break;
      const lo = Math.floor(c * 0.985), hi = Math.ceil(c * 1.015);
      for (let i = lo; i <= hi; i++) mag[i] *= MP.sub;
    }
  }
  notes.sort((x, y) => x.midi - y.midi);
  return { rms, notes, spec: raw, df };
}

function chromaFromNotes(notes) {
  const c = new Array(12).fill(0);
  for (const n of notes) c[n.midi % 12] += n.salience;
  const mx = Math.max(...c);
  return mx > 0 ? c.map(v => v / mx) : c;
}

const CHORD_TYPES = [
  ["", [0,4,7]], ["m", [0,3,7]], ["7", [0,4,7,10]], ["maj7", [0,4,7,11]], ["m7", [0,3,7,10]],
  ["6", [0,4,7,9]], ["m6", [0,3,7,9]], ["sus4", [0,5,7]], ["sus2", [0,2,7]], ["add9", [0,2,4,7]],
  ["dim", [0,3,6]], ["m7-5", [0,3,6,10]], ["dim7", [0,3,6,9]], ["aug", [0,4,8]], ["7sus4", [0,5,7,10]],
  ["5", [0,7]]
];

function recognizeChord(chroma, bassPc) {
  const total = chroma.reduce((a, b) => a + b, 0);
  const active = chroma.filter(v => v > 0.12).length;
  if (total <= 0) return [];
  if (active === 1) {
    const pc = chroma.indexOf(Math.max(...chroma));
    return [{ name: NOTE_NAMES[pc] + "（単音）", score: 1, root: pc, single: true }];
  }
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const [q, iv] of CHORD_TYPES) {
      const pcs = iv.map(i => (root + i) % 12);
      let covered = 0, missing = 0;
      for (const p of pcs) { covered += chroma[p]; if (chroma[p] < 0.1) missing++; }
      if (chroma[root] < 0.1) continue;
      let score = covered / total - 0.55 * missing / pcs.length - 0.035 * (pcs.length - 3);
      if (bassPc === root) score += 0.08;
      else if (bassPc != null && !pcs.includes(bassPc)) score -= 0.05;
      let name = NOTE_NAMES[root] + q;
      if (bassPc != null && bassPc !== root && pcs.includes(bassPc)) name += "/" + NOTE_NAMES[bassPc];
      out.push({ name, score, root });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 4);
}

// Follows one strum over time: keeps the strongest evidence for each pitch class while the
// sound decays (thirds fade first), and starts over when a new strum raises the level.
const TRACK = { hold: 0.95, onset: 1.6, rise: 1.3, flux: 0.3, floor: 0.15, skip: 2, seen: 4, keep: 0.2 };
function createTracker() {
  let acc = new Array(12).fill(0), seen = new Array(12).fill(0), bass = null, hist = [], prevSpec = null, pending = null, count = 0, shown = null, since = 99;
  return {
    reset() { acc.fill(0); seen.fill(0); bass = null; pending = null; count = 0; shown = null; hist = []; prevSpec = null; since = 99; },
    update(res) {
      // a new strum: the level jumps above the quietest of the last few frames
      // (keeps restarting while the level is still rising, so the attack itself is skipped)
      const prev = hist.length ? hist[hist.length - 1] : 0;
      // spectral flux catches a new chord even when it is quieter than the one still ringing
      let flux = 0;
      if (res.spec && prevSpec && prevSpec.length === res.spec.length) {
        const lo = Math.floor(60 / res.df), hi = Math.min(res.spec.length, Math.ceil(2000 / res.df));
        let up = 0, all = 0;
        for (let i = lo; i < hi; i++) { const a = Math.sqrt(res.spec[i]), b = Math.sqrt(prevSpec[i]); if (a > b) up += a - b; all += a; }
        flux = all > 0 ? up / all : 0;
      }
      if (res.spec) prevSpec = res.spec;
      const onset = res.rms > 1e-4 && ((hist.length > 0 && res.rms > Math.min(...hist) * TRACK.onset && res.rms > prev * TRACK.rise) || flux > TRACK.flux);
      hist.push(res.rms); if (hist.length > 5) hist.shift();
      if (onset) { acc.fill(0); seen.fill(0); bass = null; since = 0; } else since++;
      // the first frames of a strum are pick noise; let the strings settle before collecting evidence
      if (since < TRACK.skip) return { chroma: acc.slice(), cands: shown, onset };
      if (!res.notes.length) { acc = acc.map(v => v * 0.85); return { chroma: acc.slice(), cands: shown, onset }; }
      const c = chromaFromNotes(res.notes);
      acc = acc.map((v, i) => v * TRACK.hold + c[i]);
      // a pitch class heard in several frames of this strum stays part of the chord while it fades
      c.forEach((v, i) => { if (v > 0) seen[i]++; });
      const top = Math.max(...acc);
      acc = acc.map((v, i) => (seen[i] >= TRACK.seen ? Math.max(v, top * TRACK.keep) : v));
      const lowPc = res.notes[0].midi % 12;
      if (bass === null || onset) bass = res.notes[0].midi;
      else if (res.notes[0].midi < bass) bass = res.notes[0].midi;
      const mx = Math.max(...acc);
      const norm = acc.map(v => v / (mx || 1)).map(v => (v < TRACK.floor ? 0 : v));
      const cands = recognizeChord(norm, bass % 12);
      const name = cands[0] ? cands[0].name : null;
      if (name === pending) count++; else { pending = name; count = 1; }
      if (count >= 2 || shown === null) shown = cands;
      return { chroma: norm, cands: shown, bassMidi: bass, lowPc, onset };
    }
  };
}

// Karplus-Strong plucked strings for the built-in samples
const SAMPLE_VOICINGS = {
  C: [48,52,55,60,64], G: [43,47,50,55,59,67], Am: [45,52,57,60,64], Em: [40,47,52,55,59,64],
  D: [50,57,62,66], E7: [40,47,50,56,59,64], Am7: [45,52,55,60,64], Cmaj7: [48,52,55,59,64],
  Dm: [50,57,62,65], F: [41,48,53,57,60,65], E5: [40,47,52], A2: [45]
};
function synthStrum(midis, sr, seconds = 2.5, seed = 1) {
  const out = new Float32Array(Math.floor(sr * seconds));
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  midis.forEach((m, idx) => {
    const f = midiToFreq(m), N = Math.round(sr / f - 0.5), buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = rnd();
    for (let k = 0; k < 4; k++) { let prev = buf[N - 1]; for (let i = 0; i < N; i++) { const c = buf[i]; buf[i] = 0.5 * (c + prev); prev = c; } }
    const pp = Math.round(N / 6), tmp = Float32Array.from(buf); // pluck position comb
    for (let i = 0; i < N; i++) buf[i] = tmp[i] - tmp[(i + pp) % N];
    let mean = 0; for (const v of buf) mean += v / N; for (let i = 0; i < N; i++) buf[i] -= mean;
    const start = Math.floor(idx * 0.018 * sr);
    let p = 0;
    for (let t = start; t < out.length; t++) {
      const cur = buf[p], nxt = buf[(p + 1) % N];
      out[t] += cur * 0.25;
      buf[p] = 0.997 * 0.5 * (cur + nxt);
      p = (p + 1) % N;
    }
  });
  return out;
}
/* ===== end analysis core ===== */
