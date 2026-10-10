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

function songRow(s) {
  const row = document.createElement("div"); row.className = "song-row";
  const name = document.createElement("span"); name.className = "song-title"; name.textContent = s.title;
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
  row.append(name, play, edit, more);
  return row;
}

function renderSongList() {
  const songs = allSongs(), mine = songs.filter(s => !s.preset);
  $("eList").replaceChildren(...mine.map(songRow));
  if (!mine.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "まだありません";
    $("eList").append(p);
  }
  $("ePresets").replaceChildren(...songs.filter(s => s.preset).map(songRow));
}

$("eNew").addEventListener("click", () => openEditor(null));

renderSongList();
