/* ===== app shell: mode switching, offline support ===== */
bindTransport();
// songs = the song list; practice and edit are full-screen screens opened from it
const VIEWS = ["songs", "practice", "edit", "analyze"];
const DEFAULT_VIEW = "songs";
const OLD_VIEWS = { editor: "songs" }; // names used by earlier versions (bookmarks, saved view)

function showView(name) {
  name = OLD_VIEWS[name] || name;
  if (!VIEWS.includes(name)) name = DEFAULT_VIEW;
  // only one mode listens at a time
  if (name !== "analyze" && micStream) stopMic();
  if (name !== "practice" && practice.stream) stopPracticeMic();
  if (name !== "practice" && model.sources.length) stopModel();
  if (name !== "edit") edStop(false);
  for (const v of VIEWS) $("view-" + v).hidden = v !== name;
  // practice and the editor take the whole screen (no app header or mode tabs)
  document.body.classList.toggle("editing", name === "edit" || name === "practice");
  const tabName = name === "edit" || name === "practice" ? "songs" : name;
  document.querySelectorAll("nav .tab").forEach(t => {
    if (t.dataset.view === tabName) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  if (name === "edit") edEnsureOpen();
  try { localStorage.setItem("guitaric.view", name); } catch (e) {}
  // canvases measure 0 while hidden; redraw once visible
  if (name === "analyze") drawChroma(shownChroma);
  if (name === "practice" && practice.tab) practice.tab.scrollTo(practiceSrc());
  updateMetronome();
}

document.querySelectorAll("nav .tab").forEach(t => t.addEventListener("click", () => {
  history.replaceState(null, "", "#" + t.dataset.view);
  showView(t.dataset.view);
}));
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

let initialView = location.hash.slice(1);
if (!VIEWS.includes(initialView)) { try { initialView = localStorage.getItem("guitaric.view"); } catch (e) {} }
showView(initialView);

// service worker only works over http(s); opening the file directly still works without it
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// iPhone Safari zooms on a double tap anywhere touch-action can't reach (text, the TAB drawing),
// so a second tap within 350 ms is turned into a plain click instead of a zoom. Pinch zoom still works.
{
  let lastTap = 0;
  document.addEventListener("touchend", e => {
    const now = Date.now(), quick = now - lastTap < 350;
    lastTap = now;
    if (!quick || e.touches.length || e.changedTouches.length !== 1) return;
    const t = e.target;
    if (t.closest && t.closest("input, textarea, select, label")) return;
    e.preventDefault();
    const p = e.changedTouches[0];
    t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY }));
  }, { passive: false });
}
