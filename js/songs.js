/* ===== songs: chord dictionary, text parser, presets, storage ===== */
// Strings are numbered like TAB: 1 = high E ... 6 = low E.
const OPEN_MIDI = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
// natural harmonics: fret -> semitones above the open string (the overtone that fret's node gives)
const HARMONICS = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 };
// Each note is [string, fret, marks?]. marks (only when there are any):
//   start  how the note begins: "h" hammer-on, "p" pull-off, "s" slide from the note before, "i" slide in
//   move   while it rings: "b" / "b1" bend (whole / half), "d" / "d1" / "d2" release, "o" slide out,
//          "t" trill (trill: the other fret)
//   v      vibrato;  fast  "!" (the slide or bend done quickly);  harm  natural harmonic ("<12>")
const markOf = n => n[2] || {};
const bendOf = m => (m && m.move && m.move[0] === "b" ? (m.move === "b1" ? 1 : 2) : 0);
// sounding pitches: a bent note at the pitch it is bent up to; a harmonic at its overtone;
// a capo raises every string (buildSong puts the song's capo on each step)
const noteMidi = (n, capo) => OPEN_MIDI[n[0]] + (capo || 0) + (markOf(n).harm ? HARMONICS[n[1]] || n[1] : n[1]) + bendOf(n[2]);
const stepMidis = step => step.notes.map(n => noteMidi(n, step.capo));
// played by the fretting hand alone (no pick): hammer-on, pull-off, slide from the note before, a release
const unpicked = n => { const m = markOf(n); return m.start ? "hps".includes(m.start) : !!m.move && m.move[0] === "d"; };
// the note whose pitch bends or wavers (judged by its pitch moving), if any
const bendNote = st => st.chord ? null : st.notes.find(n => bendOf(n[2]) || markOf(n).v) || null;
// a note's marks written out ("hb1v!"), in a fixed order
const marksText = m => !m ? "" : (m.start || "") + (m.move ? (m.move === "t" ? "t" + m.trill : m.move) : "") + (m.v ? "v" : "") + (m.fast ? "!" : "");
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
 *   marks for the whole note go after it, in any order:
 *   6-0_  E5_           "_" = bridge mute (P.M.)
 *   6-3.                "." = staccato (its length kept, the sound cut short)
 *   5-5' 5-7h           "'" = grace note (no length: a moment at the start of the next note)
 *   ~:8                 tie: the previous note keeps ringing (across a bar line too)
 *   ~b  ~d  ~o  ~t7  ~v  ~b!   a tie may move the held notes: bend / release / slide out / trill / vibrato
 *   C*4                 the chord strummed 4 times in its bar
 *   C?  6-3?            judged loosely: any strum / note passes
 *   marks for one string go right after its fret, in any order, one from each group:
 *   4-7h  4-5p  5-5s  5-7i   how it starts: hammer-on / pull-off / slide from the note before / slide in
 *   3-7b  3-7b1  3-7d   while it rings: bend up a whole / half step (judged at the bent pitch) / release a
 *                       pre-bent note (3-7d1 / 3-7d2: half / whole); 5-7o slide out; 3-5t7 trill with fret 7
 *   3-7v                vibrato
 *   3-7b!  5-7s!        "!": the slide or bend done quickly
 *   (older text: 5-7si / 5-7so for slide in / out)
 *   3-<12>  4-<7>+3-7   natural harmonics (frets 3 4 5 7 9 12 16 19 24)
 *   5-3+4-x+3-0         "x": a muted string
 *   C/G                 slash chord (C over a G bass)
 *   @bpm120             tempo from the next note on (anywhere: a tempo change mid-song)
 *   @[ ... @]  @]3      repeat the part between (twice / 3 times); "@]" alone repeats from the top
 *   @[ A @alt1 B @alt2 C @]  endings: "@altn" to the next ending or "@]", played the n-th time only
 *                       (A B A C); "@alt0" ends an ending early; outside a repeat they are only shown
 *                       (older text: "@1" "@2" "@0")
 *   a "@[" with no "@]" repeats up to the next "@[" or the end of the song
 *   6-3:1/3  6-3:2/3    a fraction of a cell (triplets: buildSong counts in finer cells inside, song.scale)
 *   C:4  6-3:2  r:2     ":n" = length in cells (cell = 1/grid note; a song may set grid: 16)
 *   @cell16 ...         at the very start: one cell is a 16th note (@cell32: a 32nd; older text: "@16")
 *   @capo3 ...          at the very start: capo on the 3rd fret (frets are counted from the capo)
 *   % ...               a comment to the end of the line (kept with the next note: st.comments, after the
 *                       last note: tail); older text: a line starting with "#"
 */
// one string of notes played together: "5-7", "5-7s", "3-<12>", "4-x" (muted), then its marks in any order
const NOTE_RE = /^(\d)-(<\d+>|\d+|x)([a-z0-9!]*)$/;
const MARK_RE = /si|so|[hpsiov!]|b[12]?|d[12]?|t\d+/y;
// a string's marks ("bv!") -> { marks } or { bad } (an error text)
function parseMarks(text, fret) {
  const m = {}, seen = {};
  MARK_RE.lastIndex = 0;
  while (MARK_RE.lastIndex < text.length) {
    const at = MARK_RE.lastIndex, k = MARK_RE.exec(text);
    if (!k) return { bad: `：「${text.slice(at)}」は読めません` };
    let t = k[0];
    if (t === "si") t = "i"; else if (t === "so") t = "o"; else if (t === "b2") t = "b";
    const group = "hpsi".includes(t) ? "start" : t === "v" ? "v" : t === "!" ? "fast" : "move";
    if (seen[group]) return { bad: `：「${seen[group]}」と「${k[0]}」は一緒に付けられません` };
    seen[group] = k[0];
    if (group === "start") m.start = t;
    else if (group === "v") m.v = true;
    else if (group === "fast") m.fast = true;
    else if (t[0] === "t") {
      m.move = "t"; m.trill = +t.slice(1);
      if (m.trill === fret || m.trill > 24) return { bad: "：トリルの相手のフレットが読めません（例 3-5t7）" };
    } else m.move = t;
  }
  if (m.fast && !(m.start === "s" || m.start === "i" || (m.move && "bdo".includes(m.move[0])))) return { bad: "：! はスライドかチョーキングに付けます" };
  return { marks: m };
}
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
      // marks for the whole note, after it in any order: "_" bridge mute, "." staccato, "'" grace note,
      // "?" judged loosely, ":n" length in cells
      const cut = tok.search(/[_.?'’‘:]/);
      let body = cut < 0 ? tok : tok.slice(0, cut);
      const suffix = cut < 0 ? "" : tok.slice(cut);
      const sm = suffix.match(/[_.?'’‘]|:\d+(?:\/\d+)?|\*\d+/g) || [];
      const whole = sm.join("") === suffix;
      // (a chord's "*4" may come among them too: "E5_*4")
      const strums = sm.find(x => x[0] === "*");
      if (strums && !body.includes("*")) { body += strums; sm.splice(sm.indexOf(strums), 1); }
      if (!whole || !body || sm.some(x => x[0] === "*")) { errors.push(`「${tok}」：_ . ' ? :長さ は音符の最後に書きます（例 4-0+3-2_.、6-3?:2）`); continue; }
      const flags = sm.map(x => (x[0] === ":" ? ":" : "‘’".includes(x) ? "'" : x));
      if (new Set(flags).size !== flags.length) { errors.push(`「${tok}」：同じ記号が2回あります`); continue; }
      const lenStr = sm.find(x => x[0] === ":");
      // ":2" cells, or a fraction of a cell (":1/3" "2/3": triplets)
      const lenM = lenStr && /^:(\d+)(?:\/(\d+))?$/.exec(lenStr);
      const len = lenM ? +lenM[1] / (lenM[2] ? +lenM[2] : 1) : null;
      if (lenStr && !(len > 0 && (!lenM[2] || (+lenM[2] >= 1 && +lenM[2] <= 16)))) { errors.push(`「${tok}」の長さが読めません（例 :2 :1/3 :2/3）`); continue; }
      const loose = flags.includes("?"), pm = flags.includes("_"), stac = flags.includes("."), grace = flags.includes("'");
      const tieM = /^~([a-z0-9!]*)$/.exec(body);
      const rest = /^[rR]$/.test(body) || !!tieM, brush = /^[xX]$/.test(body);
      if (rest && (loose || pm || stac || grace)) { errors.push(`「${tok}」：休符・タイには _ . ' ? を付けられません`); continue; }
      if (brush && (pm || stac || grace)) { errors.push(`「${tok}」：ブラッシングに付けられるのは ? だけです`); continue; }
      if (grace && lenStr) { errors.push(`「${tok}」：装飾音（'）は長さを持ちません`); continue; }
      if (/^[rR]$/.test(body)) { push({ notes: [], len: len || 1 }); continue; }
      if (brush) { push({ notes: [], brush: true, len: len || 1, ...(loose ? { loose: true } : {}) }); continue; }
      // "~" holds the previous note on (a tie): nothing new to play, so wait mode skips it like a rest
      // its marks move the held notes' pitch ("~b" bends while it rings, "~o" slides out at its end)
      if (tieM) {
        const r = parseMarks(tieM[1], -1);
        if (!r.bad && r.marks.start) r.bad = "：タイには入り方（h p s i）は付けられません";
        if (r.bad) { errors.push(`「${tok}」${r.bad}`); continue; }
        push({ notes: [], tie: true, len: len || 1, ...(Object.keys(r.marks).length ? { tieMarks: r.marks } : {}) }); continue;
      }
      // a grace note takes no time: it sounds for a moment at the start of the next note
      const extra = { ...(loose ? { loose: true } : {}), ...(pm ? { pm: true } : {}), ...(stac ? { stac: true } : {}), ...(grace ? { grace: true } : {}) };
      // notes played together, each string with its own marks ("5-12s+3-14s", "3-7bv"); "x" = a muted
      // string (touched, not sounding); "3-<12>" = a natural harmonic
      const parts = body.split("+").map(p => NOTE_RE.exec(p));
      if (parts.every(Boolean)) {
        const notes = [], mute = [];
        let bad = "";
        for (const [, sStr, f, t] of parts) {
          const s = +sStr, fret = f === "x" ? 0 : +f.replace(/[<>]/g, "");
          if (s < 1 || s > 6 || fret > 24) bad = "は弦1〜6・フレット0〜24で書いてください";
          else if (notes.some(n => n[0] === s) || mute.includes(s)) bad = "：同じ弦が2回あります";
          else if (f === "x") { if (t) bad = "：ミュート（x）には記号を付けられません"; else mute.push(s); }
          else if (f[0] === "<" && !HARMONICS[fret]) bad = "：ハーモニクスは 3・4・5・7・9・12・16・19・24 フレットです";
          else {
            const r = parseMarks(t, fret);
            if (r.bad) bad = r.bad;
            else {
              if (f[0] === "<") r.marks.harm = true;
              notes.push(Object.keys(r.marks).length ? [s, fret, r.marks] : [s, fret]);
            }
          }
          if (bad) break;
        }
        if (bad) { errors.push(`「${tok}」${bad}`); continue; }
        if (!notes.length) {
          if (pm || stac || grace) { errors.push(`「${tok}」：ブラッシングに付けられるのは ? だけです`); continue; }
          push({ notes: [], brush: true, len: len || 1, ...(loose ? { loose: true } : {}) }); continue;
        }
        const st = { notes: notes.sort((a, b) => b[0] - a[0]), len: grace ? 0 : len || 1, ...extra };
        if (mute.length) st.mute = mute.sort((a, b) => b - a);
        push(st);
        continue;
      }
      // "C*4": the chord strummed 4 times, splitting its length
      const [name, timesStr] = body.split("*");
      const times = timesStr ? parseInt(timesStr, 10) : 1;
      if (!(times >= 1 && times <= 16)) { errors.push(`「${tok}」の回数が読めません`); continue; }
      const notes = chordVoicing(name);
      if (!notes) { errors.push(`「${tok}」はコード名としても音（弦-フレット）としても読めません`); continue; }
      if (grace && times > 1) { errors.push(`「${tok}」：装飾音（'）は1回だけです`); continue; }
      for (let k = 0; k < times; k++) push({ notes, chord: name, len: grace ? 0 : len ? Math.max(1, Math.round(len / times)) : null, split: times, ...extra });
    }
    if (barOnly) { volta = 0; barOnly = false; }
    // chords without an explicit length fill the bar (or a whole bar each when no bars are written)
    const open = items.filter(i => i.len == null);
    const used = Math.round(items.reduce((a, i) => a + (i.len || 0), 0) * 48) / 48;
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
  // (anywhere before the first note; comment lines and tempo marks among them are kept)
  let kept = "";
  for (;;) {
    if ((m = /^\s*@(?:cell)?(4|8|16|32|capo(\d{1,2}))(?=\s|\||$)/.exec(text))) {
      if (m[2] != null) capo = Math.min(12, +m[2]); else grid = +m[1];
    } else if ((m = /^\s*([#%].*|@bpm\d+(?=\s|\||$))/i.exec(text))) kept += m[1] + "\n";
    else break;
    text = text.slice(m[0].length);
  }
  text = kept + text;
  const timeSig = s.timeSig || [4, 4], parsed = parseSongText(text, { timeSig, grid });
  // fractions of a cell (":1/3"): the song counts in finer cells inside (scale per written cell), so
  // every length stays a whole number; the editor writes them back as fractions
  let scale = 1;
  while (scale < 48 && !parsed.steps.every(st => Math.abs(st.len * scale - Math.round(st.len * scale)) < 1e-6)) scale++;
  if (scale > 1) parsed.steps.forEach(st => { st.len = Math.round(st.len * scale); });
  // the tempo in force at each step ("@bpm" changes it from that step on; older songs: s.bpm)
  let tempo = s.bpm || 80;
  parsed.steps.forEach(st => { if (capo) st.capo = capo; if (st.bpm) tempo = st.bpm; st.tempo = tempo; });
  const order = playOrder(parsed.steps);
  return { ...s, timeSig, grid: grid * scale, scale, capo, bpm: parsed.steps.length ? parsed.steps[0].tempo : tempo, order, ...parsed };
}
