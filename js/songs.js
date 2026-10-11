/* ===== songs: chord dictionary, text parser, presets, storage ===== */
// Strings are numbered like TAB: 1 = high E ... 6 = low E.
const OPEN_MIDI = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
// natural harmonics: fret -> semitones above the open string (the overtone that fret's node gives)
const HARMONICS = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 };
// sounding pitches: a bent note at the pitch it is bent up to; a harmonic at its overtone;
// a capo raises every string (buildSong puts the song's capo on each step)
const stepMidis = step => step.notes.map(([s, f]) => OPEN_MIDI[s] + (step.capo || 0) + (step.harm ? HARMONICS[f] || f : f) + (step.tech === "b" ? step.bend : 0));
// steps that are played (a brushing stroke has no pitch but is played)
const isPlayed = st => st.notes.length > 0 || !!st.brush;

// Open-position voicings, written low E -> high E ("x" = not played).
const CHORD_SHAPES = {
  C: "x32010", D: "xx0232", E: "022100", F: "133211", G: "320003", A: "x02220", B: "x24442",
  Cm: "x35543", Dm: "xx0231", Em: "022000", Fm: "133111", Gm: "355333", Am: "x02210", Bm: "x24432",
  C7: "x32310", D7: "xx0212", E7: "020100", F7: "131211", G7: "320001", A7: "x02020", B7: "x21202",
  Cmaj7: "x32000", Dmaj7: "xx0222", Emaj7: "021100", Fmaj7: "xx3210", Gmaj7: "320002", Amaj7: "x02120",
  Dm7: "xx0211", Em7: "020000", Am7: "x02010", Bm7: "x20202",
  Dsus4: "xx0233", Asus4: "x02230", Esus4: "022200", Dsus2: "xx0230", Asus2: "x02200",
  C5: "x355xx", D5: "xx023x", E5: "022xxx", F5: "133xxx", G5: "355xxx", A5: "x022xx",
  Cadd9: "x32033"
};
// Movable barre shapes (frets relative to the root fret) for anything not listed above.
const BARRE_SHAPES = {
  6: { "": [0,2,2,1,0,0], m: [0,2,2,0,0,0], 7: [0,2,0,1,0,0], m7: [0,2,0,0,0,0], maj7: [0,null,1,1,0,null],
       sus4: [0,2,2,2,0,0], 5: [0,2,2,null,null,null], "7sus4": [0,2,0,2,0,0], m6: [0,2,2,0,2,0], 6: [0,2,2,1,2,0] },
  5: { "": [null,0,2,2,2,0], m: [null,0,2,2,1,0], 7: [null,0,2,0,2,0], m7: [null,0,2,0,1,0], maj7: [null,0,2,1,2,0],
       sus4: [null,0,2,2,3,0], sus2: [null,0,2,2,0,0], 5: [null,0,2,2,null,null], dim: [null,0,1,2,1,null],
       "m7-5": [null,0,1,0,1,null], dim7: [null,0,1,-1,1,null], aug: [null,0,3,2,2,null], add9: [null,0,2,4,2,0],
       "7sus4": [null,0,2,0,3,0], 6: [null,0,2,2,2,2], m6: [null,0,2,2,1,2] }
};
const FLAT_TO_SHARP = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
const CHORD_RE = /^([A-G])([#b]?)(maj7|m7-5|m7b5|7sus4|sus4|sus2|add9|dim7|dim|aug|maj|m6|m7|m|7|6|5)?$/;

// "C/G": a chord over another bass note (bass = its pitch class)
function parseChordName(name) {
  const [top, bassName, more] = String(name).split("/");
  if (more != null) return null;
  let bass = null;
  if (bassName != null) {
    const b = /^([A-G])([#b]?)$/.exec(bassName);
    if (!b) return null;
    const bn = FLAT_TO_SHARP[b[1] + b[2]] || b[1] + b[2];
    bass = NOTE_NAMES.indexOf(bn);
    if (bass < 0) return null;
  }
  const m = CHORD_RE.exec(top);
  if (!m) return null;
  let root = m[1] + m[2];
  if (FLAT_TO_SHARP[root]) root = FLAT_TO_SHARP[root];
  let q = m[3] || "";
  if (q === "maj") q = ""; if (q === "m7b5") q = "m7-5";
  const pc = NOTE_NAMES.indexOf(root);
  return pc < 0 ? null : { root, pc, q, bass };
}

function shapeToNotes(frets) {
  const notes = [];
  frets.forEach((f, i) => { if (f != null && f >= 0) notes.push([6 - i, f]); });
  return notes;
}

// Returns TAB notes for a chord name, or null if it can't be voiced.
function chordVoicing(name) {
  const c = parseChordName(name);
  if (!c) return null;
  if (c.bass != null) return withBass(chordVoicing(name.split("/")[0]), c.bass);
  const listed = CHORD_SHAPES[c.root + c.q];
  if (listed) return shapeToNotes([...listed].map(ch => (ch === "x" ? null : parseInt(ch, 36))));
  let best = null;
  for (const s of [6, 5]) {
    const shape = BARRE_SHAPES[s][c.q];
    if (!shape) continue;
    const base = ((c.pc - (s === 6 ? 4 : 9)) % 12 + 12) % 12 || 12;
    const fret = shape.some(v => v === -1) && base < 2 ? base + 12 : base;
    if (!best || fret < best.fret) best = { fret, frets: shape.map(v => (v == null ? null : fret + v)) };
  }
  return best ? shapeToNotes(best.frets) : null;
}

// A slash chord's shape: the chord with the bass note put on the lowest string that keeps the
// hand where it is (C/G -> 332010, G/B -> x20003, F/C -> x33211); the strings below it are not played.
function withBass(notes, bass) {
  if (!notes) return null;
  const low = notes.reduce((a, n) => (n[0] > a[0] ? n : a));
  if ((OPEN_MIDI[low[0]] + low[1]) % 12 === bass) return notes;
  const fretted = notes.map(n => n[1]).filter(f => f > 0);
  const lo = fretted.length ? Math.min(...fretted) : 0, hi = fretted.length ? Math.max(...fretted) : 0;
  for (const s of [6, 5, 4]) {
    for (const base of [0, 12]) {
      const f = ((bass - OPEN_MIDI[s]) % 12 + 12) % 12 + base;
      if (f === 0 || (f >= hi - 3 && f <= lo + 3)) return [[s, f], ...notes.filter(n => n[0] < s)];
    }
  }
  return null;
}

// The pitch classes a chord name asks for (used by the judge); a slash chord adds its bass.
function chordPitchClasses(name) {
  const c = parseChordName(name);
  if (!c) return null;
  const t = CHORD_TYPES.find(([q]) => q === c.q);
  if (!t) return null;
  const pcs = t[1].map(i => (c.pc + i) % 12);
  return c.bass != null && !pcs.includes(c.bass) ? [...pcs, c.bass] : pcs;
}

/* Text format (spaces between items, "|" between bars):
 *   C G Am F            one chord per bar
 *   | C G | Am F |      chords inside a bar share it
 *   6-3 5-2 4-0         string-fret single notes (one cell each)
 *   6-3+5-2             notes played together
 *   r                   rest
 *   x                   brushing (a muted strum: no pitch)
 *   6-0_  E5_           "_" = bridge mute (P.M.)
 *   ~:8                 tie: the previous note keeps ringing (across a bar line too)
 *   C*4                 the chord strummed 4 times in its bar
 *   C?  6-3?            judged loosely: any strum / note passes
 *   4-7h  4-5p  5-5s    hammer-on / pull-off / slide into this note (shown on the TAB; the pitch is judged as usual)
 *   3-7b  3-7b1  3-7d   bend up a whole / half step (judged at the bent pitch) / release a pre-bent note (3-7d1 / 3-7d2: half / whole)
 *   3-7v                vibrato
 *   3-<12>  4-<7>+3-<7> natural harmonics (frets 3 4 5 7 9 12 16 19 24)
 *   C/G                 slash chord (C over a G bass)
 *   @bpm120             tempo from the next note on (anywhere: a tempo change mid-song)
 *   @[ ... @]  @]3      repeat the part between (twice / 3 times); "@]" alone repeats from the top
 *   @[ A @alt1 B @alt2 C @]  endings: "@altn" to the next ending or "@]", played the n-th time only
 *                       (A B A C); "@alt0" ends an ending early; outside a repeat they are only shown
 *                       (older text: "@1" "@2" "@0")
 *   a "@[" with no "@]" repeats up to the next "@[" or the end of the song
 *   C:4  6-3:2  r:2     ":n" = length in cells (cell = 1/grid note; a song may set grid: 16)
 *   @cell16 ...         at the very start: one cell is a 16th note (@cell32: a 32nd; older text: "@16")
 *   @capo3 ...          at the very start: capo on the 3rd fret (frets are counted from the capo)
 *   % ...               a comment to the end of the line (kept with the next note: st.comments, after the
 *                       last note: tail); older text: a line starting with "#"
 */
function parseSongText(text, opts = {}) {
  const grid = opts.grid || 8, beats = (opts.timeSig || [4, 4])[0];
  const barCells = beats * grid / 4;
  // comment lines become "@#n" tokens, so they keep their place among the notes
  const comments = [];
  text = text.replace(/%(.*)$|^[ \t]*#(.*)$/gm, (_, a, b) => ` @#${comments.push((a ?? b).trim()) - 1} `);
  const usesBars = text.includes("|");
  const bars = text.split("|").map(b => b.trim()).filter(Boolean);
  const steps = [], errors = [];
  // directives waiting for the next note: tempo, repeat start; volta: inside the n-th ending (0: none)
  // (an ending written just after a repeat's "@]" only marks the bar it is in)
  let pending = {}, volta = 0, afterEnd = false, barOnly = false;
  for (const bar of (usesBars ? bars : [text])) {
    const items = [];
    const push = item => {
      if (volta) item.volta = volta;
      items.push(Object.assign(item, pending)); pending = {};
    };
    for (const tok of bar.split(/\s+/).filter(Boolean)) {
      if (tok[0] === "@") {
        let m;
        if ((m = /^@#(\d+)$/.exec(tok))) (pending.comments = pending.comments || []).push(comments[+m[1]]);
        else if ((m = /^@bpm(\d+)$/i.exec(tok)) && +m[1] >= 20 && +m[1] <= 300) pending.bpm = +m[1];
        else if (tok === "@[") { pending.repStart = true; afterEnd = false; volta = 0; }
        else if ((m = /^@(?:alt)?(\d)$/.exec(tok))) { volta = +m[1]; barOnly = afterEnd; }
        else if ((m = /^@\](\d*)$/.exec(tok)) && (!m[1] || (+m[1] >= 2 && +m[1] <= 9))) {
          const last = items[items.length - 1] || (!items.length && steps[steps.length - 1]);
          if (last) last.repEnd = m[1] ? +m[1] : 2;
          else errors.push(`「${tok}」の前に音がありません`);
          volta = 0; afterEnd = true;
        } else errors.push(`「${tok}」は読めません（@bpm120 / @[ / @] / @]3 / @alt1 / @alt2）`);
        continue;
      }
      // a trailing "?" marks a step judged loosely (any strum or note passes)
      const loose = /\?(:|$)/.test(tok.replace("_", ""));
      const pm = /_(\?)?(:|$)/.test(tok);
      let [body, lenStr] = tok.replace("?", "").replace(/_(?=\??(:|$))/, "").split(":");
      const len = lenStr ? parseInt(lenStr, 10) : null;
      if (lenStr && !(len > 0)) { errors.push(`「${tok}」の長さが読めません`); continue; }
      if (/^[rR]$/.test(body)) { push({ notes: [], len: len || 1 }); continue; }
      if (/^[xX]$/.test(body)) { push({ notes: [], brush: true, len: len || 1 }); continue; }
      // "~" holds the previous note on (a tie): nothing new to play, so wait mode skips it like a rest
      if (body === "~") { push({ notes: [], tie: true, len: len || 1 }); continue; }
      const extra = { ...(loose ? { loose: true } : {}), ...(pm ? { pm: true } : {}) };
      // a technique letter after a single note: h p s (display only), b / b1 bend, d release, v vibrato
      const tech = /^\d-<?\d+>?(h|p|s|v|b[12]?|d[12]?)$/.exec(body);
      if (tech) {
        body = body.slice(0, -tech[1].length);
        extra.tech = tech[1][0];
        if (extra.tech === "b") extra.bend = tech[1][1] === "1" ? 1 : 2;
        else if (extra.tech === "d" && tech[1][1]) extra.bend = +tech[1][1];
      }
      // "3-<12>": natural harmonics (every note of the step)
      const harm = /^\d-<\d+>(\+\d-<\d+>)*$/.test(body);
      if (harm) { body = body.replace(/[<>]/g, ""); extra.harm = true; }
      if (/^\d-\d+(\+\d-\d+)*$/.test(body)) {
        const notes = body.split("+").map(p => p.split("-").map(Number));
        const bad = notes.find(([s, f]) => s < 1 || s > 6 || f > 24);
        if (bad) { errors.push(`「${tok}」は弦1〜6・フレット0〜24で書いてください`); continue; }
        if (harm && notes.some(([, f]) => !HARMONICS[f])) { errors.push(`「${tok}」：ハーモニクスは 3・4・5・7・9・12・16・19・24 フレットです`); continue; }
        push({ notes: notes.sort((a, b) => b[0] - a[0]), len: len || 1, ...extra });
        continue;
      }
      // "C*4": the chord strummed 4 times, splitting its length
      const [name, timesStr] = body.split("*");
      const times = timesStr ? parseInt(timesStr, 10) : 1;
      if (!(times >= 1 && times <= 16)) { errors.push(`「${tok}」の回数が読めません`); continue; }
      const notes = chordVoicing(name);
      if (!notes) { errors.push(`「${tok}」はコード名としても音（弦-フレット）としても読めません`); continue; }
      for (let k = 0; k < times; k++) push({ notes, chord: name, len: len ? Math.max(1, Math.round(len / times)) : null, split: times, ...extra });
    }
    if (barOnly) { volta = 0; barOnly = false; }
    // chords without an explicit length fill the bar (or a whole bar each when no bars are written)
    const open = items.filter(i => i.len == null);
    const used = items.reduce((a, i) => a + (i.len || 0), 0);
    const share = usesBars ? Math.max(1, Math.floor((barCells - used) / (open.length || 1))) : barCells;
    for (const { split, ...i } of items) steps.push(Object.assign(i, { len: i.len ?? (usesBars ? share : Math.max(1, Math.round(barCells / (split || 1)))) }));
  }
  if (pending.repStart) errors.push("「@[」の後に音がありません");
  return { steps, errors, tail: pending.comments || [] };
}

// The repeats: each runs from its "@[" (or the end of the previous repeat, or the top) to its "@]";
// one left open ends before the next "@[" or at the end of the song (that step is marked autoEnd).
function repeatBlocks(steps) {
  const blocks = [];
  let open = -1, after = 0;
  const close = (end, count, auto) => {
    blocks.push({ start: open >= 0 ? open : after, end, count, auto });
    if (auto) steps[end].autoEnd = true;
    open = -1; after = end + 1;
  };
  steps.forEach((st, i) => {
    delete st.autoEnd;
    if (st.repStart) { if (open >= 0 && i > open) close(i - 1, 2, true); open = i; }
    if (st.repEnd) close(i, st.repEnd, false);
  });
  if (open >= 0) close(steps.length - 1, 2, true);
  return blocks;
}

// The order steps are played in, repeats unrolled; inside a repeat the n-th ending ("@n") plays
// only the n-th time through.
function playOrder(steps) {
  const blocks = repeatBlocks(steps);
  const order = [];
  let block = null;
  for (let i = 0; i < steps.length; i++) {
    if (!block || block.start !== i || block.pass === 1) {
      const b = blocks.find(x => x.start === i);
      if (b && b !== block) block = { ...b, pass: 1 };
    }
    const inBlock = block && i >= block.start && i <= block.end;
    if (!(inBlock && steps[i].volta && steps[i].volta !== block.pass)) order.push(i);
    if (inBlock && i === block.end) {
      if (block.pass < block.count) { block.pass++; i = block.start - 1; continue; }
      block = null;
    }
    if (order.length > 5000) break;
  }
  return order;
}

// The song as played: repeats written out, each step knowing which written step it is (src)
function expandSong(song) {
  return { ...song, steps: song.order.map(i => ({ ...song.steps[i], src: i })), order: song.order.map((_, k) => k) };
}

// older songs kept the tempo apart from the text ({ bpm: 80 }); now it is "@bpm80" in the text
function textWithBpm(s) {
  const text = s.text || "";
  // (only when no "@bpm" comes before the first note)
  if (!s.bpm || /@bpm\d/i.test(/^(\s*(\||@\S+))*/.exec(text)[0])) return text;
  const lead = /^(\s*@((cell)?(4|8|16|32)|capo\d{1,2})(?=\s|\||$)\s*)*/.exec(text)[0];
  return lead + `@bpm${s.bpm} ` + text.slice(lead.length);
}

const PRESET_SONGS = [
  { id: "preset-oudou", title: "王道進行", text: "@bpm80 F G Em Am" },
  { id: "preset-canon", title: "カノン進行", text: "@bpm80 C G Am Em F C F G" },
  { id: "preset-canon4", title: "カノン進行（1小節4回）", text: "@bpm75 C*4 G*4 Am*4 Em*4 F*4 C*4 F*4 G*4" },
  { id: "preset-minor", title: "マイナー進行", text: "@bpm80 Am Dm E Am" },
  { id: "preset-change", title: "持ち替え練習 C⇔G", text: "@bpm70 | C G | C G | Am F | C G |" },
  { id: "preset-scale", title: "Cメジャースケール", text: "@bpm70 5-3 4-0 4-2 4-3 3-0 3-2 2-0 2-1 2-0 3-2 3-0 4-3 4-2 4-0 5-3:2" },
  { id: "preset-penta", title: "Aマイナーペンタのリフ", text: "@bpm80 6-5 6-8 5-5 5-7 4-5 4-7 5-7 5-5 6-8 6-5:2 r 6-5+5-7:4" },
  { id: "preset-penta-solo", title: "Aマイナーペンタのソロ（16分）", grid: 16, text: "@bpm60 | r:10 3-5+4-5:1 4-7h:1 4-5:1 5-7:1 5-5s:2 | 5-3:4 5-7s:1 4-5:1 4-5:1 5-7:1 4-5:4 r:1 4-5:1 4-7:1 3-5:1 | 3-7b:6 3-7d:2 3-5:8 | r:2 3-9s:1 1-8:1 3-9:1 3-7s:1 3-5:1 3-7:1 3-7b:2 1-5:2 3-7d:2 3-5:2 | 4-7:1 4-5:1 4-7:1 4-5:1 5-7:1 5-5s:1 5-3:1 5-5:1 5-3:4 r:1 4-5:1 4-7:1 3-5:1 | 3-5:2 4-7:1 3-5:1 3-7:1 3-9s:1 2-8:2 3-9s:2 2-8:3 3-9s:1 2-8:2 | 2-10:4 r:1 2-8:1 2-10:1 1-8:1 1-10b:4 1-10d:2 1-8:1 1-10:1 | 1-8:8 1-15b:4 r:3 2-15b:1 | 2-15d:1 2-13:1 2-15:1 r:1 2-15b:2 2-13:1 2-15:1 2-13:8 |" }
];

const SONG_KEY = "guitaric.songs";
function loadUserSongs() {
  try { return JSON.parse(localStorage.getItem(SONG_KEY) || "[]"); } catch (e) { return []; }
}
function saveUserSongs(list) {
  try { localStorage.setItem(SONG_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}
function allSongs() { return [...loadUserSongs(), ...PRESET_SONGS.map(s => ({ ...s, preset: true }))]; }
function buildSong(s) {
  // leading "@cell16" (grid: cells per whole note; "@16" in older text) and "@capo3" in the text, so pasted text carries them
  let text = s.text || "", grid = s.grid || 8, capo = 0, m;
  // (comment lines before them are kept)
  let kept = "";
  while ((m = /^\s*@(?:cell)?(4|8|16|32|capo(\d{1,2}))(?=\s|\||$)/.exec(text)) || (m = /^\s*[#%].*(\n|$)/.exec(text))) {
    if (/^[#%]/.test(m[0].trim())) kept += m[0].trim() + "\n";
    else if (m[2] != null) capo = Math.min(12, +m[2]); else grid = +m[1];
    text = text.slice(m[0].length);
  }
  text = kept + text;
  const timeSig = s.timeSig || [4, 4], parsed = parseSongText(text, { timeSig, grid });
  // the tempo in force at each step ("@bpm" changes it from that step on; older songs: s.bpm)
  let tempo = s.bpm || 80;
  parsed.steps.forEach(st => { if (capo) st.capo = capo; if (st.bpm) tempo = st.bpm; st.tempo = tempo; });
  const order = playOrder(parsed.steps);
  return { ...s, timeSig, grid, capo, bpm: parsed.steps.length ? parsed.steps[0].tempo : tempo, order, ...parsed };
}
