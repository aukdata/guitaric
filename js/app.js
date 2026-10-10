/* ===== app shell: mode switching, offline support ===== */
const VIEWS = ["practice", "editor", "edit", "analyze"]; // "edit" = the full-screen TAB editor
const DEFAULT_VIEW = "practice";

function showView(name) {
  if (!VIEWS.includes(name)) name = DEFAULT_VIEW;
  // only one mode listens at a time
  if (name !== "analyze" && micStream) stopMic();
  if (name !== "practice" && practice.stream) stopPracticeMic();
  if (name !== "practice" && metro.on) stopMetronome();
  if (name !== "edit") edStop(false);
  for (const v of VIEWS) $("view-" + v).hidden = v !== name;
  // the editor takes the whole screen (no app header or mode tabs)
  document.body.classList.toggle("editing", name === "edit");
  const tabName = name === "edit" ? "editor" : name;
  document.querySelectorAll("nav .tab").forEach(t => {
    if (t.dataset.view === tabName) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  if (name === "edit") edEnsureOpen();
  try { localStorage.setItem("guitaric.view", name); } catch (e) {}
  // canvases measure 0 while hidden; redraw once visible
  if (name === "analyze") drawChroma(shownChroma);
  if (name === "practice" && practice.tab) practice.tab.scrollTo(practice.idx);
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
