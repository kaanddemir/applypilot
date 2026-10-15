// Top-level render orchestration shared by every feature module.
"use strict";

import { state, $, persistView } from "./state.js";
import { renderBoardPage, renderDetailPage } from "./board.js";

export function renderAll() {
  renderNav();
  renderMain();
  persistView();
}

// Only the board/detail pages remain; the logo is the way back to the board.
export function renderNav() {
  $("brandHome").toggleAttribute("aria-current", false);
  if (state.viewMode === "board") $("brandHome").setAttribute("aria-current", "page");
}

export function renderMain() {
  if (state.viewMode === "detail") renderDetailPage();
  else renderBoardPage();
}
