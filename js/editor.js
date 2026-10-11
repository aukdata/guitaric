/* ===== 曲: the song list (editing itself is in tabedit.js) ===== */

function iconButton(icon, label, run, cls) {
  const b = document.createElement("button"); b.type = "button"; b.className = "icon" + (cls ? " " + cls : "");
  b.title = label; b.setAttribute("aria-label", label); b.innerHTML = iconSvg(icon);
  b.addEventListener("click", run);
  return b;
}

function deleteSong(s) {
  if (!confirm(`「${s.title}」を削除しますか？`)) return;
  saveUserSongs(loadUserSongs().filter(x => x.id !== s.id));
  renderSongList();
  if (practice.songId === s.id) loadPractice(null);
}

// when a song was last saved (songs saved before this was kept: the time in their id)
function songUpdated(s) {
  if (s.updated) return s.updated;
  const t = /^song-([0-9a-z]{8})/.exec(s.id || "");
  return t ? parseInt(t[1], 36) : 0;
}
function dateText(t) {
  if (!t) return "";
  const d = new Date(t), now = new Date(), p = n => String(n).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return (d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "/") + `${d.getMonth() + 1}/${d.getDate()}`;
}

function songRow(s) {
  const row = document.createElement("div"); row.className = "song-row";
  const name = document.createElement("span"); name.className = "song-title"; name.textContent = s.title;
  if (!s.preset) {
    const t = songUpdated(s), date = document.createElement("time"); date.className = "song-date";
    date.textContent = dateText(t);
    if (t) { date.dateTime = new Date(t).toISOString(); date.title = new Date(t).toLocaleString("ja-JP"); }
    row.append(name, date);
  }
  const copy = () => openEditor({ ...s, id: null, title: s.title + "（コピー）" });
  const play = iconButton("play", "練習する", () => openPractice(s.id), "play");
  const edit = iconButton("pencil", s.preset ? "コピーして編集" : "編集", () => (s.preset ? copy() : openEditor(s)));
  const more = iconButton("ellipsis", "その他", e => showMenu(e.currentTarget, s.preset ? [
    { label: "コピーして編集", icon: "pencil", run: copy },
    { label: "ファイルに書き出す", icon: "download", run: () => exportSongs([s], s.title) },
  ] : [
    { label: "コピーして編集", icon: "pencil", run: copy },
    { label: "ファイルに書き出す", icon: "download", run: () => exportSongs([s], s.title) },
    { label: "削除", icon: "trash-2", danger: true, run: () => deleteSong(s) },
  ]));
  more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
  if (s.preset) row.append(name);
  row.append(play, edit, more);
  return row;
}

// 自分の曲's order: a column (title / updated) and its direction, kept in this browser
const SORT_KEY = "guitaric.songSort";
let songSort = { by: "updated", desc: true };
try { songSort = { ...songSort, ...JSON.parse(localStorage.getItem(SORT_KEY) || "{}") }; } catch (e) {}

function sortHead(by, label) {
  const on = songSort.by === by, b = document.createElement("button");
  b.type = "button"; b.className = "sort-head" + (on ? " on" : "");
  b.innerHTML = `<span></span>${on ? iconSvg(songSort.desc ? "arrow-down" : "arrow-up") : ""}`;
  b.firstChild.textContent = label;
  if (on) b.setAttribute("aria-sort", songSort.desc ? "descending" : "ascending");
  b.addEventListener("click", () => {
    // a new column starts with its natural order: titles A→Z, newest first
    songSort = on ? { by, desc: !songSort.desc } : { by, desc: by === "updated" };
    try { localStorage.setItem(SORT_KEY, JSON.stringify(songSort)); } catch (e) {}
    renderSongList();
  });
  return b;
}

function sortedSongs(list) {
  const coll = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  const cmp = songSort.by === "title" ? (a, b) => coll.compare(a.title, b.title) || songUpdated(b) - songUpdated(a)
    : (a, b) => songUpdated(a) - songUpdated(b);
  const out = [...list].sort(cmp);
  return songSort.desc ? out.reverse() : out;
}

// search: every word must be in the title (ignores case, full/half width, hiragana/katakana)
const foldText = t => t.normalize("NFKC").toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
function searchMatch(s) {
  const words = foldText($("eSearch").value).split(/\s+/).filter(Boolean), title = foldText(s.title || "");
  return words.every(w => title.includes(w));
}
const emptyNote = text => { const p = document.createElement("p"); p.className = "empty"; p.textContent = text; return p; };

function renderSongList() {
  const all = allSongs(), searching = !!$("eSearch").value.trim();
  const songs = all.filter(searchMatch), mine = songs.filter(s => !s.preset);
  const head = document.createElement("div"); head.className = "song-row song-head";
  head.append(sortHead("title", "曲名"), sortHead("updated", "更新日"));
  $("eList").replaceChildren(...(mine.length ? [head] : []), ...sortedSongs(mine).map(songRow));
  if (!mine.length) $("eList").append(emptyNote(searching && all.some(s => !s.preset) ? "見つかりません" : "まだありません"));
  const presets = songs.filter(s => s.preset);
  $("ePresets").replaceChildren(...presets.map(songRow));
  if (!presets.length) $("ePresets").append(emptyNote("見つかりません"));
}

$("eNew").addEventListener("click", () => openEditor(null));
$("eSearch").addEventListener("input", renderSongList);

renderSongList();
