/* ===== app shell: mode switching, offline support ===== */
const VIEWS = ["practice", "editor", "analyze"];
const DEFAULT_VIEW = "analyze";

function showView(name) {
  if (!VIEWS.includes(name)) name = DEFAULT_VIEW;
  for (const v of VIEWS) $("view-" + v).hidden = v !== name;
  document.querySelectorAll(".tab").forEach(t => {
    if (t.dataset.view === name) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  try { localStorage.setItem("guitaric.view", name); } catch (e) {}
  // canvases measure 0 while hidden; redraw once visible
  if (name === "analyze") drawChroma(shownChroma);
}

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
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
