/* SVG icons from Lucide (https://lucide.dev), ISC License, Copyright (c) Lucide Icons and Contributors.
 * Inlined so the app also works offline and from file://. <i data-icon="name"></i> is replaced by the icon. */
const ICONS = {
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "skip-back": '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/>',
  "play": '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  "square": '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  "corner-up-left": '<path d="M20 20v-7a4 4 0 0 0-4-4H4"/><path d="M9 14 4 9l5-5"/>',
  "ellipsis": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  "mic": '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  "music-3": '<circle cx="12" cy="18" r="4"/><path d="M16 18V2"/>',
  // quarter rest, drawn in the same stroke style (not part of Lucide)
  "repeat": '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  "brush": '<path d="M3 7h3M18 7h3M3 12h3M18 12h3M3 17h3M18 17h3"/><path d="M8.5 5.5l7 13M15.5 5.5l-7 13"/>',
  "rest": '<path d="M10 3l4.5 5.5-3.5 3.5 4 5"/><path d="M15 17c-3-1.5-6.5.5-3 4.5"/>',
  "circle": '<circle cx="12" cy="12" r="10"/>',
  "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "pencil": '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  "list": '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  "undo-2": '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  "redo-2": '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  "save": '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  "keyboard": '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  "type": '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  "trash-2": '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  "download": '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  "upload": '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  "check": '<path d="M20 6 9 17l-5-5"/>',
};
// play / stop / record dots read better filled
const FILLED_ICONS = new Set(["play", "square", "circle", "skip-back", "music-3"]);

function iconSvg(name) {
  return `<svg class="ic${FILLED_ICONS.has(name) ? " filled" : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}
// replace the icon inside a button (keeps any text label next to it)
function setIcon(el, name) {
  const old = el.querySelector("svg.ic, i[data-icon]");
  const tmp = document.createElement("span"); tmp.innerHTML = iconSvg(name);
  if (old) old.replaceWith(tmp.firstChild); else el.prepend(tmp.firstChild);
}
function renderIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach(i => { const t = document.createElement("span"); t.innerHTML = iconSvg(i.dataset.icon); i.replaceWith(t.firstChild); });
}
renderIcons();

/* ===== small pop-up menu (the "…" buttons) ===== */
// items: [{label, icon?, danger?, run}] ; one menu open at a time
let openMenuEl = null;
function closeMenu() {
  if (!openMenuEl) return;
  openMenuEl.anchor.setAttribute("aria-expanded", "false");
  openMenuEl.remove(); openMenuEl = null;
}
function showMenu(anchor, items) {
  const again = openMenuEl && openMenuEl.anchor === anchor;
  closeMenu();
  if (again) return;
  const m = document.createElement("div"); m.className = "menu"; m.setAttribute("role", "menu"); m.anchor = anchor;
  for (const it of items) {
    const b = document.createElement(it.file ? "label" : "button");
    b.className = "menu-item" + (it.danger ? " danger" : ""); b.setAttribute("role", "menuitem");
    if (!it.file) b.type = "button";
    b.innerHTML = it.icon ? iconSvg(it.icon) : "";
    b.append(it.label);
    if (it.file) {
      // a file picker has to be opened by the tap itself
      const inp = document.createElement("input"); inp.type = "file"; inp.hidden = true;
      if (it.accept) inp.accept = it.accept; inp.multiple = !!it.multiple;
      inp.addEventListener("change", () => { closeMenu(); it.run(inp.files); });
      b.append(inp); b.tabIndex = 0;
    } else b.addEventListener("click", () => { closeMenu(); it.run(); });
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  const top = r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4;
  m.style.left = left + scrollX + "px"; m.style.top = top + scrollY + "px";
  anchor.setAttribute("aria-expanded", "true");
  openMenuEl = m;
  const first = m.querySelector(".menu-item"); if (first) first.focus({ preventScroll: true });
}
document.addEventListener("pointerdown", e => {
  if (openMenuEl && !openMenuEl.contains(e.target) && !openMenuEl.anchor.contains(e.target)) closeMenu();
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && openMenuEl) { const a = openMenuEl.anchor; closeMenu(); a.focus(); } });
addEventListener("resize", closeMenu);
