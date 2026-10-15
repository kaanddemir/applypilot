// Entry point: control wiring and bootstrap.
"use strict";

import "../css/base.css";
import "../css/app.css";
import "../css/profile.css";

import { state, $, esc, applicationLoadIssue } from "./state.js";
import { renderAll } from "./render.js";
import { openApplicationWizard, closeModal, isModalOpen } from "./wizards.js";
import { bindMenu, closeMenus } from "./menu.js";
import { I } from "./icons.js";
import { openProfileModal } from "./profile.js";
import { THEME_OPTIONS, applyTheme, setThemePreference, themePreference, watchSystemTheme } from "./theme.js";
import type { ThemePreference } from "./theme.js";
import { initializeNotifications, notify } from "./notifications.js";

const THEME_LABELS: Record<ThemePreference, string> = { light: "Light", dark: "Dark", system: "System" };
const THEME_ICONS: Record<ThemePreference, string> = { light: I.sun, dark: I.moon, system: I.monitor };

// The theme lives in the app menu; each option shows its own icon and the
// current preference is checked.
function renderThemeControl() {
  const preference = themePreference();
  $("themeOptions").innerHTML = THEME_OPTIONS.map((option) =>
    '<button class="data-menu-item" type="button" role="menuitemradio" data-theme-option="' + option + '" aria-checked="' + (option === preference) + '">' +
      THEME_ICONS[option] + "<span>" + esc(THEME_LABELS[option]) + "</span>" +
      (option === preference ? '<span class="menu-check">' + I.check + "</span>" : "") +
    "</button>"
  ).join("");
}

function goToBoard() {
  state.viewMode = "board";
  state.filter = "All";
  renderAll();
}

function initControls() {
  $("addAppBtn").addEventListener("click", () => openApplicationWizard());
  $("brandHome").addEventListener("click", goToBoard);
  $("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeModal(); });

  bindMenu($("appMenuBtn"), $("appMenu"));
  $("profileBtn").addEventListener("click", () => { closeMenus(); openProfileModal(); });
  // Picking a theme keeps the menu open so the change can be compared at once.
  $("themeOptions").addEventListener("click", (e) => {
    const option = (e.target as Element).closest("[data-theme-option]") as HTMLElement | null;
    if (!option) return;
    const value = option.dataset.themeOption as ThemePreference;
    setThemePreference(value);
    renderThemeControl();
    ($("themeOptions").querySelector('[data-theme-option="' + value + '"]') as HTMLElement | null)?.focus();
  });
  watchSystemTheme(renderThemeControl);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // One press, one layer: an open menu closes before the dialog behind it.
    if (closeMenus(true)) return;
    if (isModalOpen()) closeModal();
  });
}

(function init() {
  applyTheme();
  initializeNotifications();
  renderThemeControl();
  initControls();
  if (!state.selectedId && state.applications.length) state.selectedId = state.applications[0].id;
  renderAll();
  if (applicationLoadIssue === "malformed" || applicationLoadIssue === "unsupported" || applicationLoadIssue === "oversized") notify.error("Saved application data is invalid.", { detail: "The original storage is protected. Import a backup before making changes." });
  else if (applicationLoadIssue === "unavailable") notify.error("Browser storage is unavailable.", { detail: "Changes may not survive a reload." });
})();
