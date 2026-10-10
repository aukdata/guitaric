/* ===== export / import songs as files (曲を作る) ===== */
// File format: { "app": "guitaric", "version": 1, "songs": [{ "title", "bpm", "text", "grid"? }] }
// Import also takes a bare song or an array of songs, and a plain .txt file of song text.

const fileSafe = name => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "guitaric";

function exportSongs(songs, name) {
  const data = { app: "guitaric", version: 1,
    songs: songs.map(s => ({ title: s.title, bpm: s.bpm || 80, text: s.text, ...(s.grid && s.grid !== 8 ? { grid: s.grid } : {}) })) };
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileSafe(name) + ".guitaric.json";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// the songs in one file's contents (throws when nothing usable is found)
function songsFromFile(name, content) {
  let data;
  try { data = JSON.parse(content); } catch (e) {
    // not JSON: the whole file is song text, titled after the file
    const text = content.trim();
    if (!text) throw new Error("空のファイルです");
    return [{ title: name.replace(/(\.guitaric)?\.(txt|json)$/i, ""), bpm: 80, text }];
  }
  const list = Array.isArray(data) ? data : Array.isArray(data.songs) ? data.songs : [data];
  const songs = list.filter(s => s && typeof s.text === "string" && s.text.trim()).map(s => ({
    title: String(s.title || "無題の曲").slice(0, 100),
    bpm: Math.max(30, Math.min(240, +s.bpm || 80)),
    text: s.text.slice(0, 20000),
    ...([4, 16].includes(+s.grid) ? { grid: +s.grid } : {})
  }));
  if (!songs.length) throw new Error("曲が見つかりません");
  return songs;
}

async function importFiles(files) {
  const mine = loadUserSongs(), added = [], problems = [];
  let skipped = 0;
  for (const f of files) {
    try {
      for (const s of songsFromFile(f.name, await f.text())) {
        // the same song already saved: don't add it twice
        if (mine.some(x => x.title === s.title && x.text === s.text)) { skipped++; continue; }
        const song = buildSong(s);
        if (!song.steps.length) { problems.push(`「${s.title}」は読めませんでした`); continue; }
        const entry = { id: "song-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...s };
        mine.unshift(entry); added.push(entry);
      }
    } catch (e) { problems.push(`${f.name}：${e.message}`); }
  }
  if (added.length && !saveUserSongs(mine)) { $("eFileMsg").textContent = "このブラウザでは保存できませんでした"; return; }
  renderSongList();
  const msg = [added.length ? `${added.length}曲を読み込みました` : "", skipped ? `${skipped}曲は保存済みのため省きました` : "", ...problems].filter(Boolean);
  $("eFileMsg").textContent = msg.join(" / ") || "読み込める曲がありませんでした";
}

$("eExportAll").addEventListener("click", () => {
  const mine = loadUserSongs();
  if (!mine.length) { $("eFileMsg").textContent = "書き出す自分の曲がありません"; return; }
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  exportSongs(mine, `guitaric-songs-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);
  $("eFileMsg").textContent = `${mine.length}曲を書き出しました`;
});
$("eImport").addEventListener("change", async e => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) await importFiles(files);
});
