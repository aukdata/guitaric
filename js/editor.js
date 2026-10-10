/* ===== 曲を作る: the song list (editing itself is in tabedit.js) ===== */

function renderSongList() {
  const list = $("eList");
  list.innerHTML = "";
  for (const s of allSongs()) {
    const row = document.createElement("div"); row.className = "song-row";
    const name = document.createElement("span"); name.className = "song-title"; name.textContent = s.title;
    if (s.preset) { const tag = document.createElement("small"); tag.textContent = "練習用"; name.append(tag); }
    const play = document.createElement("button"); play.type = "button"; play.textContent = "練習する";
    play.addEventListener("click", () => { setCurrentSongId(s.id); fillSongSelect(); loadPractice(s.id); location.hash = "practice"; });
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = s.preset ? "コピーして編集" : "編集";
    edit.addEventListener("click", () => openEditor(s.preset ? { ...s, id: null, title: s.title + "（コピー）" } : s));
    const exp = document.createElement("button"); exp.type = "button"; exp.textContent = "書き出す";
    exp.addEventListener("click", () => exportSongs([s], s.title));
    row.append(name, play, edit);
    if (!s.preset) row.append(exp);
    if (!s.preset) {
      const del = document.createElement("button"); del.type = "button"; del.textContent = "削除"; del.className = "danger";
      del.addEventListener("click", () => {
        if (!confirm(`「${s.title}」を削除しますか？`)) return;
        saveUserSongs(loadUserSongs().filter(x => x.id !== s.id));
        renderSongList(); fillSongSelect(); loadPractice($("pSong").value);
      });
      row.append(del);
    }
    list.append(row);
  }
}

$("eNew").addEventListener("click", () => openEditor(null));

renderSongList();
