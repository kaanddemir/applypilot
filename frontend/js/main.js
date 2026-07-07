// Entry point: control wiring, provider switching, and bootstrap.
// (store.js runs the legacy-key migration on import, before state.js reads.)
"use strict";

import { store, LS } from "./store.js";
import { state, $, persistApps, persistChat } from "./state.js";
import { renderAll, renderSidebar, closeMobileSidebar } from "./render.js";
import { openApplicationWizard, closeModal } from "./wizards.js";
import { newChatSession } from "./chat.js";
import { updateProviderUI } from "./ai.js";

function applyCollapsed(collapsed) {
  document.querySelector(".app").classList.toggle("collapsed", collapsed);
  store.set(LS.collapsed, collapsed ? "1" : "0");
  const btn = $("collapseBtn");
  if (btn) btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  renderSidebar();
}

function initControls() {
  $("addAppSide").addEventListener("click", () => openApplicationWizard());
  $("profileBtn").addEventListener("click", () => { state.viewMode = "profile"; closeMobileSidebar(); renderAll(); });
  $("newChatBtn").addEventListener("click", () => newChatSession());
  $("collapseBtn").addEventListener("click", () => applyCollapsed(!document.querySelector(".app").classList.contains("collapsed")));
  $("boardNav").addEventListener("click", () => { state.viewMode = "board"; state.filter = "All"; closeMobileSidebar(); renderAll(); });
  $("chatNav").addEventListener("click", () => { state.viewMode = "chat"; closeMobileSidebar(); renderAll(); });
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(); });

  document.addEventListener("click", (e) => {
    const pop = $("appPopover");
    const btn = $("attachAppBtn");
    if (pop && btn && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      pop.classList.remove("open");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeMobileSidebar(); }
  });
}

(function init() {
  initControls();
  const storedCollapsed = store.get(LS.collapsed, null);
  applyCollapsed(storedCollapsed != null ? storedCollapsed === "1" : window.innerWidth <= 820);
  if (!state.selectedId && state.applications.length) state.selectedId = state.applications[0].id;
  persistApps();
  persistChat();
  updateProviderUI();
  renderAll();
  // Local engine is loaded manually now.
})();
