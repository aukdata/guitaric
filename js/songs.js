/* ===== songs: chord dictionary, text parser, presets, storage ===== */
// Strings are numbered like TAB: 1 = high E ... 6 = low E.
const OPEN_MIDI = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
const stepMidis = step => step.notes.map(([s, f]) => OPEN_MIDI[s] + f);

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

function parseChordName(name) {
  const m = CHORD_RE.exec(name);
  if (!m) return null;
  let root = m[1] + m[2];
  if (FLAT_TO_SHARP[root]) root = FLAT_TO_SHARP[root];
  let q = m[3] || "";
  if (q === "maj") q = ""; if (q === "m7b5") q = "m7-5";
  const pc = NOTE_NAMES.indexOf(root);
  return pc < 0 ? null : { root, pc, q };
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

// The pitch classes a chord name asks for (used by the judge).
function chordPitchClasses(name) {
  const c = parseChordName(name);
  if (!c) return null;
  const t = CHORD_TYPES.find(([q]) => q === c.q);
  return t ? t[1].map(i => (c.pc + i) % 12) : null;
}

/* Text format (spaces between items, "|" between bars):
 *   C G Am F            one chord per bar
 *   | C G | Am F |      chords inside a bar share it
 *   6-3 5-2 4-0         string-fret single notes (one cell each)
 *   6-3+5-2             notes played together
 *   r                   rest
 *   C*4                 the chord strummed 4 times in its bar
 *   C?  6-3?            judged loosely: any strum / note passes
 *   3-7b  3-7d          bend up (chōking) / release a pre-bent note (judged loosely)
 *   C:4  6-3:2  r:2     ":n" = length in cells (cell = 1/grid note; a song may set grid: 16)
 */
function parseSongText(text, opts = {}) {
  const grid = opts.grid || 8, beats = (opts.timeSig || [4, 4])[0];
  const barCells = beats * grid / 4;
  const usesBars = text.includes("|");
  const bars = text.split("|").map(b => b.trim()).filter(Boolean);
  const steps = [], errors = [];
  for (const bar of (usesBars ? bars : [text])) {
    const items = [];
    for (const tok of bar.split(/\s+/).filter(Boolean)) {
      // a trailing "?" marks a step judged loosely (any strum or note passes)
      const loose = /\?(:|$)/.test(tok);
      let [body, lenStr] = tok.replace("?", "").split(":");
      const len = lenStr ? parseInt(lenStr, 10) : null;
      if (lenStr && !(len > 0)) { errors.push(`「${tok}」の長さが読めません`); continue; }
      if (/^[rR]$/.test(body)) { items.push({ notes: [], len: len || 1 }); continue; }
      const extra = loose ? { loose: true } : {};
      // "3-7b" bend up (chōking), "3-7d" release a pre-bent note: shown on the TAB, judged loosely
      const bend = /^\d-\d+[bd]$/.test(body) ? body.slice(-1) : null;
      if (bend) { body = body.slice(0, -1); extra.loose = true; extra.bend = bend === "b" ? "up" : "down"; }
      if (/^\d-\d+(\+\d-\d+)*$/.test(body)) {
        const notes = body.split("+").map(p => p.split("-").map(Number));
        const bad = notes.find(([s, f]) => s < 1 || s > 6 || f > 24);
        if (bad) { errors.push(`「${tok}」は弦1〜6・フレット0〜24で書いてください`); continue; }
        items.push({ notes: notes.sort((a, b) => b[0] - a[0]), len: len || 1, ...extra });
        continue;
      }
      // "C*4": the chord strummed 4 times, splitting its length
      const [name, timesStr] = body.split("*");
      const times = timesStr ? parseInt(timesStr, 10) : 1;
      if (!(times >= 1 && times <= 16)) { errors.push(`「${tok}」の回数が読めません`); continue; }
      const notes = chordVoicing(name);
      if (!notes) { errors.push(`「${tok}」はコード名としても音（弦-フレット）としても読めません`); continue; }
      for (let k = 0; k < times; k++) items.push({ notes, chord: name, len: len ? Math.max(1, Math.round(len / times)) : null, split: times, ...extra });
    }
    // chords without an explicit length fill the bar (or a whole bar each when no bars are written)
    const open = items.filter(i => i.len == null);
    const used = items.reduce((a, i) => a + (i.len || 0), 0);
    const share = usesBars ? Math.max(1, Math.floor((barCells - used) / (open.length || 1))) : barCells;
    for (const { split, ...i } of items) steps.push({ ...i, len: i.len ?? (usesBars ? share : Math.max(1, Math.round(barCells / (split || 1)))) });
  }
  return { steps, errors };
}

const PRESET_SONGS = [
  { id: "preset-oudou", title: "王道進行", bpm: 80, text: "F G Em Am" },
  { id: "preset-canon", title: "カノン進行", bpm: 80, text: "C G Am Em F C F G" },
  { id: "preset-canon4", title: "カノン進行（1小節4回）", bpm: 75, text: "C*4 G*4 Am*4 Em*4 F*4 C*4 F*4 G*4" },
  { id: "preset-minor", title: "マイナー進行", bpm: 80, text: "Am Dm E Am" },
  { id: "preset-change", title: "持ち替え練習 C⇔G", bpm: 70, text: "| C G | C G | Am F | C G |" },
  { id: "preset-scale", title: "Cメジャースケール", bpm: 70, text: "5-3 4-0 4-2 4-3 3-0 3-2 2-0 2-1 2-0 3-2 3-0 4-3 4-2 4-0 5-3:2" },
  { id: "preset-penta", title: "Aマイナーペンタのリフ", bpm: 80, text: "6-5 6-8 5-5 5-7 4-5 4-7 5-7 5-5 6-8 6-5:2 r 6-5+5-7:4" },
  { id: "preset-penta-solo", title: "Aマイナーペンタのソロ（16分）", bpm: 60, grid: 16, text: "| r:10 3-5+4-5:1 4-7:1 4-5:1 5-7:1 5-5:2 | 5-3:4 5-7:1 4-5:1 4-5:1 5-7:1 4-5:4 r:1 4-5:1 4-7:1 3-5:1 | 3-7b:6 3-7d:2 3-5:8 | r:2 3-9:1 1-8:1 3-9:1 3-7:1 3-5:1 3-7:1 3-7b:2 1-5:2 3-7d:2 3-5:2 | 4-7:1 4-5:1 4-7:1 4-5:1 5-7:1 5-5:1 5-3:1 5-5:1 5-3:4 r:1 4-5:1 4-7:1 3-5:1 | 3-5:2 4-7:1 3-5:1 3-7:1 3-9:1 2-8:2 3-9:2 2-8:3 3-9:1 2-8:2 | 2-10:4 r:1 2-8:1 2-10:1 1-8:1 1-10b:4 1-10d:2 1-8:1 1-10:1 | 1-8:8 1-15b:4 r:3 2-15b:1 | 2-13:2 2-15:1 r:1 2-15d:2 2-13:1 2-15:1 2-13:8 |" }
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
  const timeSig = s.timeSig || [4, 4], grid = s.grid || 8;
  return { ...s, timeSig, grid, ...parseSongText(s.text, { timeSig, grid }) };
}
