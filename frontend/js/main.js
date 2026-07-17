// Entry point: control wiring, provider switching, and bootstrap.
// (store.js runs the legacy-key migration on import, before state.js reads.)
"use strict";

import { store, LS } from "./store.js";
import { state, $, persistApps, persistChat } from "./state.js";
import { renderAll, renderSidebar, closeMobileSidebar, openMobileSidebar, isSidebarOpen } from "./render.js";
import { openApplicationWizard, closeModal } from "./wizards.js?v=3";
import { newChatSession } from "./chat.js";
import { updateProviderUI } from "./ai.js";

// Mirrors the 900px `md` breakpoint documented in css/base.css. Change both together.
const DRAWER_MQ = window.matchMedia("(max-width: 900px)");
const isDrawer = () => DRAWER_MQ.matches;

function applyCollapsed(collapsed) {
  document.querySelector(".app").classList.toggle("collapsed", collapsed);
  // Don't persist while the sidebar is a drawer — collapse is meaningless there
  // and writing it would clobber the user's desktop preference.
  if (!isDrawer()) store.set(LS.collapsed, collapsed ? "1" : "0");
  const btn = $("collapseBtn");
  if (btn) btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  renderSidebar();
}

// Single reconciliation point between the stored preference and the breakpoint:
// the drawer ignores `collapsed` entirely, the desktop layout restores it.
function syncLayout() {
  if (isDrawer()) {
    document.querySelector(".app").classList.remove("collapsed");
    closeMobileSidebar();
    renderSidebar();
  } else {
    applyCollapsed(store.get(LS.collapsed, null) === "1");
  }
}

function initControls() {
  // Every control in the drawer closes it: leaving it open behind a modal would
  // both obscure the modal and swallow the first Escape.
  $("addAppSide").addEventListener("click", () => { closeMobileSidebar(); openApplicationWizard(); });
  $("profileBtn").addEventListener("click", () => { state.viewMode = "profile"; closeMobileSidebar(); renderAll(); });
  $("newChatBtn").addEventListener("click", () => { closeMobileSidebar(); newChatSession(); });
  $("collapseBtn").addEventListener("click", () => applyCollapsed(!document.querySelector(".app").classList.contains("collapsed")));
  $("boardNav").addEventListener("click", () => { state.viewMode = "board"; state.filter = "All"; closeMobileSidebar(); renderAll(); });
  $("chatNav").addEventListener("click", () => { state.viewMode = "chat"; closeMobileSidebar(); renderAll(); });
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(); });
  $("menuBtn").addEventListener("click", () => (isSidebarOpen() ? closeMobileSidebar() : openMobileSidebar()));
  $("sidebarScrim").addEventListener("click", () => closeMobileSidebar());
  DRAWER_MQ.addEventListener("change", syncLayout);

  document.addEventListener("click", (e) => {
    const pop = $("appPopover");
    const btn = $("attachAppBtn");
    if (pop && btn && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      pop.classList.remove("open");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // One press, one action: the drawer sits above the page, so it wins.
    if (isSidebarOpen()) { closeMobileSidebar(); return; }
    closeModal();
  });
}

(function init() {
  initControls();
  syncLayout();
  if (!state.selectedId && state.applications.length) state.selectedId = state.applications[0].id;
  persistApps();
  persistChat();
  updateProviderUI();
  renderAll();
  // Local engine is loaded manually now.
})();
