/* ===== editor: write songs as text, preview the TAB, save in the browser ===== */
let editingId = null, editingGrid = 8; // grid (cells per whole note) of the song being edited

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
        if (editingId === s.id) openEditor(null);
        renderSongList(); fillSongSelect(); loadPractice($("pSong").value);
      });
      row.append(del);
    }
    list.append(row);
  }
}

function openEditor(s) {
  editingId = s ? s.id : null;
  editingGrid = (s && s.grid) || 8;
  $("eTitle").value = s ? s.title : "";
  $("eBpm").value = s ? s.bpm || 80 : 80;
  $("eText").value = s ? s.text : "";
  $("eHeading").textContent = editingId ? "曲を編集" : "新しい曲";
  if (typeof vedit !== "undefined") { vedit.sel = null; vedit.undo.length = 0; }
  previewEditor();
}

function previewEditor() {
  const song = buildSong({ text: $("eText").value, grid: editingGrid });
  $("eErrors").textContent = song.errors.join(" / ");
  const tab = song.steps.length ? renderTab($("eTab"), song) : null;
  if (!tab) $("eTab").innerHTML = '<span class="empty">入力するか「TABで書き始める」を押すと、ここにTAB譜が表示されます</span>';
  $("eSave").disabled = !song.steps.length;
  if (typeof refreshVisualEdit === "function") refreshVisualEdit(song, tab);
}

function saveEditor() {
  const text = $("eText").value.trim(), song = buildSong({ text, grid: editingGrid });
  if (!song.steps.length) return;
  const list = loadUserSongs();
  const entry = { id: editingId || "song-" + Date.now().toString(36), title: $("eTitle").value.trim() || "無題の曲", bpm: +$("eBpm").value || 80, text };
  if (editingGrid !== 8) entry.grid = editingGrid;
  const at = list.findIndex(x => x.id === entry.id);
  if (at >= 0) list[at] = entry; else list.unshift(entry);
  if (!saveUserSongs(list)) { $("eErrors").textContent = "このブラウザでは保存できませんでした"; return; }
  editingId = entry.id;
  $("eHeading").textContent = "曲を編集";
  $("eSaved").textContent = "保存しました";
  setTimeout(() => { $("eSaved").textContent = ""; }, 2000);
  renderSongList(); fillSongSelect();
  if (currentSongId() === entry.id) loadPractice(entry.id);
}

$("eText").addEventListener("input", previewEditor);
$("eSave").addEventListener("click", saveEditor);
$("eNew").addEventListener("click", () => openEditor(null));
document.querySelectorAll("[data-insert]").forEach(b => b.addEventListener("click", () => {
  $("eText").value = b.dataset.insert; $("eText").dispatchEvent(new Event("input"));
}));

renderSongList();
openEditor(null);
