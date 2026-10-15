// Kanban board + application detail view, drag/drop, and match analysis.
"use strict";

import {
  state, $, esc, STATUSES, BOARD_STATUSES, filteredApps, selectedApp,
  formatDate, isHttpUrl, touch, persistApps,
  mergeUniqueApplications, setSelectMode, toggleSelected, pruneSelection,
} from "./state.js";
import { I } from "./icons.js";
import { analyze } from "./api.js";
import { renderAll } from "./render.js";
import { openApplicationWizard, openDeleteModal, openDeleteApplications } from "./wizards.js";
import { openProfileModal } from "./profile.js";
import { exportExcelTable, readExcelApplications } from "./excel.js";
import { ANALYSIS_SCHEMA_VERSION, analysisFreshness, captureAnalysisInput, acceptAnalysisResult, hasSufficientJobDescription } from "./analysis-integrity.js";
import { renderAnalysisContent, renderAnalysisIndicators } from "./analysis-view.js";
import { analysisStatusMessage } from "./analysis-message.js";
import { createAutosave } from "./notes-autosave.js";
import { openPostingUrl } from "./posting-link.js";
import { bindMenu } from "./menu.js";
import { bindSelectPopover, selectPopoverMarkup } from "./select-popover.js";
import { createDragController } from "./kanban-drag.js";
import { notify } from "./notifications.js";
import { analysisFeedback, autosaveFeedback, importFeedback } from "./operation-notifications.js";
import { applyStatusChange } from "./status-change.js";
import { INPUT_LIMITS } from "./input-validation.js";

const TABLE_PAGE_SIZE = 10;
let pendingDetailSaves: Array<ReturnType<typeof createAutosave>> = [];
window.addEventListener("pagehide", () => pendingDetailSaves.forEach((save) => save.flushSilently()));

const drag = createDragController((id, status) => moveApplication(id, status));
// Browsers may still dispatch a click on the card right after a drop.
let lastDragEnd = 0;
let leaveTimer = 0;

export function renderBoardPage() {
  $("content").innerHTML =
    '<div class="toolbar">' +
    '<div class="search" role="search">' +
    '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
    '<input id="searchInput" type="search" aria-label="Search applications" placeholder="Search company, role, source, or notes" maxlength="200" value="' + esc(state.search) + '" />' +
    "</div>" +
    '<div class="toolbar-controls">' +
    '<div class="seg" id="layoutToggle" role="group" aria-label="Board layout">' +
    '<button class="seg-btn' + (state.boardLayout === "kanban" ? " active" : "") + '" type="button" data-layout="kanban" aria-pressed="' + (state.boardLayout === "kanban") + '" title="Kanban board">' +
    '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14M12 5v14M18 5v14"/></svg>Kanban</button>' +
    '<button class="seg-btn' + (state.boardLayout === "table" ? " active" : "") + '" type="button" data-layout="table" aria-pressed="' + (state.boardLayout === "table") + '" title="Table view">' +
    '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/></svg>Table</button>' +
    "</div>" +
    selectPopoverMarkup("statusFilter", "Status filter", [
      { value: "All", label: "All statuses" },
      ...STATUSES.map((status) => ({ value: status, label: status })),
    ], state.filter) +
    selectPopoverMarkup("sortSelect", "Sort applications", [
      { value: "updated", label: "Recently updated" }, { value: "ai", label: "AI Analysis" },
      { value: "company", label: "Company A-Z" }, { value: "role", label: "Role A-Z" },
      { value: "status", label: "Status A-Z" }, { value: "applied", label: "Applied date" },
      { value: "notes", label: "Notes A-Z" },
    ], state.sortBy.replace("-desc", "").replace("-asc", "")) +
    '<div class="data-menu-wrap">' +
    '<button class="icon-btn export-btn" id="dataMenuBtn" type="button" title="More board actions" aria-label="More board actions">' + I.more + "</button>" +
    '<div class="data-menu" id="dataMenu" role="menu" aria-label="Board actions" data-align="right" data-span-from="sortSelect">' +
    '<button class="data-menu-item" type="button" role="menuitem" id="selectModeBtn">' + I.check + "<span>" + (state.selectMode ? "Exit selection" : "Select applications") + "</span></button>" +
    '<button class="data-menu-item" type="button" role="menuitem" id="exportExcelBtn">' + I.download + "<span>Export to Excel</span></button>" +
    '<button class="data-menu-item" type="button" role="menuitem" id="importExcelBtn">' + I.upload + "<span>Import from Excel</span></button>" +
    "</div>" +
    '<input type="file" id="importExcelInput" accept=".xlsx" hidden />' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div id="boardHost"></div>';
  wireBoardControls();
  renderBoard();
}

function wireBoardControls() {
  const searchInput = $("searchInput");
  if (searchInput) searchInput.addEventListener("input", (e) => {
    state.search = e.target.value;
    state.tablePage = 1;
    renderBoard();
  });
  const sf = $("statusFilter");
  if (sf) {
    bindSelectPopover(sf, $("statusFilterListbox"), (value) => {
      state.filter = value as typeof state.filter;
      state.tablePage = 1;
      renderAll();
    });
  }
  const sort = $("sortSelect");
  if (sort) {
    // Kanban sorts inside each column: filteredApps() orders the whole list and
    // the columns keep that order when they filter by status.
    sort.title = state.boardLayout === "kanban" ? "Sort applications within each column" : "Sort applications";
    bindSelectPopover(sort, $("sortSelectListbox"), (value) => {
      state.sortBy = value;
      state.tablePage = 1;
      renderBoard();
    });
  }
  const menuBtn = $("dataMenuBtn");
  const menu = $("dataMenu");
  bindMenu(menuBtn, menu);
  const selectBtn = $("selectModeBtn");
  if (selectBtn) selectBtn.addEventListener("click", () => {
    menu?.classList.remove("open");
    setSelectMode(!state.selectMode);
    renderBoardPage();
  });
  const exportBtn = $("exportExcelBtn");
  if (exportBtn) exportBtn.addEventListener("click", () => {
    menu?.classList.remove("open");
    try {
      exportExcelTable(state.applications);
      notify.success("Export started.");
    } catch {
      notify.error("Export failed.", { detail: "The Excel file could not be created." });
    }
  });
  const importBtn = $("importExcelBtn");
  const importInput = $("importExcelInput");
  if (importBtn && importInput) {
    importBtn.addEventListener("click", () => { menu?.classList.remove("open"); importInput.click(); });
    importInput.addEventListener("change", async () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = "";
      if (file) await importExcelFile(file);
    });
  }
  document.querySelectorAll("#layoutToggle .seg-btn").forEach((b) => b.addEventListener("click", () => {
    state.boardLayout = b.dataset.layout === "table" ? "table" : "kanban";
    state.tablePage = 1;
    renderAll();
  }));
}

async function importExcelFile(file) {
  try {
    const imported = await readExcelApplications(file);
    const result = mergeUniqueApplications(state.applications, imported);
    state.applications = result.applications;
    if (!state.applications.some((app) => app.id === state.selectedId)) {
      state.selectedId = state.applications[0]?.id || "";
    }
    state.tablePage = 1;
    const persisted = persistApps(true);
    renderAll();
    importFeedback(result, persisted);
  } catch (err) {
    notify.error("Import failed.", { detail: err.message || "The selected file could not be read." });
  }
}

// Visible statuses used by Kanban selection, including the dedicated archive.
function boardColumns(): readonly string[] {
  return state.filter === "Archived" ? ["Archived"] : BOARD_STATUSES;
}

function renderBoard() {
  const host = $("boardHost");
  pruneSelection();
  const list = filteredApps();
  host.innerHTML = "";
  if (state.selectMode) {
    // Kanban hides statuses without a column (e.g. Archived under "All"), so the
    // bar must only offer what is actually on screen.
    const columns = boardColumns();
    const selectable = state.boardLayout === "table" ? list : list.filter((a) => columns.includes(a.status));
    host.appendChild(selectionBar(selectable));
  }
  const layoutHost = document.createElement("div");
  layoutHost.className = "layout-host";
  host.appendChild(layoutHost);
  if (state.boardLayout === "table") renderTable(layoutHost, list);
  else if (state.filter === "Archived") renderArchive(layoutHost, list);
  else renderKanban(layoutHost, list);
}

function renderArchive(host, list) {
  const section = document.createElement("section");
  section.className = "archive-section";
  section.setAttribute("aria-labelledby", "archiveTitle");
  const total = state.applications.filter((app) => app.status === "Archived").length;
  section.innerHTML = '<header class="archive-head"><h2 id="archiveTitle">Archived</h2>' +
    '<span class="archive-count">' + total + ' application' + (total === 1 ? "" : "s") + '</span></header>';
  if (list.length) {
    const grid = document.createElement("div");
    grid.className = "archive-grid";
    list.forEach((app) => grid.appendChild(appCard(app)));
    section.appendChild(grid);
  } else {
    const empty = document.createElement("div");
    empty.className = "archive-empty";
    empty.innerHTML = '<div><svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v13h14V7M10 11h4"/></svg>' +
      '<h3>' + (total ? 'No matching archived applications' : 'No archived applications') + '</h3>' +
      '<p>' + (total ? 'Try a different search.' : 'Archived applications will appear here.') + '</p></div>';
    section.appendChild(empty);
  }
  host.appendChild(section);
}

// Toolbar shown while bulk-select mode is on: select-all over the current
// filter/search results, plus the bulk delete.
function selectionBar(list) {
  const bar = document.createElement("div");
  bar.className = "select-bar";
  const count = state.selectedIds.size;
  const allSelected = list.length > 0 && list.every((a) => state.selectedIds.has(a.id));
  bar.innerHTML =
    '<label class="select-all-label">' +
    '<input type="checkbox" class="js-select-all"' + (allSelected ? " checked" : "") + (list.length ? "" : " disabled") + " />" +
    "<span>Select all</span>" +
    "</label>" +
    statusSelectMenu(list) +
    '<span class="select-count">' + (count ? count + " of " + list.length + " selected" : "Nothing selected") + "</span>" +
    '<div class="select-bar-actions">' +
    '<button class="ghost-btn js-select-clear" type="button"' + (count ? "" : " disabled") + ">Clear</button>" +
    '<button class="danger-btn js-select-delete" type="button"' + (count ? "" : " disabled") + ">" + I.trash + "Delete" + (count ? " " + count : "") + "</button>" +
    '<button class="ghost-btn js-select-exit" type="button">Done</button>' +
    "</div>";
  bar.querySelector(".js-select-all").addEventListener("change", (e) => {
    if (e.target.checked) list.forEach((a) => state.selectedIds.add(a.id));
    else list.forEach((a) => state.selectedIds.delete(a.id));
    renderBoard();
  });
  bar.querySelector(".js-select-clear").addEventListener("click", () => {
    state.selectedIds.clear();
    renderBoard();
  });
  bar.querySelector(".js-select-delete").addEventListener("click", () => {
    const apps = state.applications.filter((a) => state.selectedIds.has(a.id));
    openDeleteApplications(apps, () => state.selectedIds.clear());
  });
  bar.querySelector(".js-select-exit").addEventListener("click", () => {
    setSelectMode(false);
    renderBoardPage();
  });
  wireStatusSelectMenu(bar, list);
  return bar;
}

// Status-group picker: one checkbox per status that is actually present in the
// current results. The kanban has column checkboxes too; this keeps both views
// working the same way.
function statusSelectMenu(list) {
  const groups = STATUSES.filter((s) => list.some((a) => a.status === s));
  if (!groups.length) return "";
  return '<div class="status-select-wrap">' +
    '<button class="status-select-btn" type="button" aria-label="Select applications by status">Select by status' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
    "</button>" +
    '<div class="status-select-menu" role="group" aria-label="Application statuses">' + groups.map((status) => {
      const apps = list.filter((a) => a.status === status);
      const on = apps.every((a) => state.selectedIds.has(a.id));
      return '<label class="status-select-item"><input type="checkbox" class="js-status-group" data-status="' + esc(status) + '"' + (on ? " checked" : "") + " />" +
        "<span>" + esc(status) + '</span><span class="status-select-count">' + apps.length + "</span></label>";
    }).join("") + "</div>" +
    "</div>";
}

function wireStatusSelectMenu(bar, list) {
  const wrap = bar.querySelector(".status-select-wrap");
  if (!wrap) return;
  const menu = wrap.querySelector(".status-select-menu");
  const trigger = wrap.querySelector(".status-select-btn");
  menu.id = "statusSelectMenu";
  bindMenu(trigger, menu);
  wrap.querySelectorAll(".js-status-group").forEach((box) => box.addEventListener("change", () => {
    const apps = list.filter((a) => a.status === box.dataset.status);
    if (box.checked) apps.forEach((a) => state.selectedIds.add(a.id));
    else apps.forEach((a) => state.selectedIds.delete(a.id));
    renderBoard();
    // renderBoard rebuilds the bar, so reopen the menu to keep picking groups.
    $("boardHost").querySelector(".status-select-btn")?.click();
  }));
}

function renderKanban(host, list) {
  const board = document.createElement("div");
  board.className = "board";
  boardColumns().forEach((status) => {
    const col = document.createElement("section");
    col.className = "column";
    const apps = list.filter((a) => a.status === status);
    const colAllPicked = apps.length > 0 && apps.every((a) => state.selectedIds.has(a.id));
    col.innerHTML = '<div class="column-head">' +
      (state.selectMode
        ? '<input type="checkbox" class="js-col-select" title="Select all in ' + esc(status) + '" aria-label="Select all in ' + esc(status) + '"' +
        (colAllPicked ? " checked" : "") + (apps.length ? "" : " disabled") + " />"
        : "") +
      '<span class="column-dot" aria-hidden="true"></span><h2 class="column-title">' + esc(status) + '</h2><span class="column-count" aria-label="' + apps.length + ' application' + (apps.length === 1 ? "" : "s") + '">' + apps.length + "</span></div>";
    col.dataset.status = status;
    col.setAttribute("aria-label", status);
    col.querySelector(".js-col-select")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.checked) apps.forEach((a) => state.selectedIds.add(a.id));
      else apps.forEach((a) => state.selectedIds.delete(a.id));
      renderBoard();
    });
    // The whole column (header included) is the drop zone. Highlighting is
    // driven by dragover alone, which also fires over child elements, so moving
    // between cards never toggles it off and on.
    col.addEventListener("dragover", (e) => {
      window.clearTimeout(leaveTimer);
      if (!drag.over(status, col)) { e.dataTransfer.dropEffect = "none"; return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      drag.drop(status);
    });
    const body = document.createElement("div");
    body.className = "column-body";
    body.dataset.status = status;
    if (!apps.length) {
      body.innerHTML = '<p class="empty-column">' + (state.search.trim() ? "No matches" : "No applications") + "</p>";
    } else {
      apps.forEach((app) => body.appendChild(appCard(app)));
    }
    col.appendChild(body);
    board.appendChild(col);
  });
  // Safari reports a null relatedTarget on most dragleave events, so leaving is
  // confirmed only when no dragover follows shortly after.
  board.addEventListener("dragleave", (e) => {
    if (board.contains(e.relatedTarget as Node)) return;
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => drag.leave(), 60);
  });
  host.appendChild(board);
}

function appCard(app) {
  const card = document.createElement("button");
  card.type = "button";
  // Dragging a card would fight with tapping it to select, so it's off in select mode.
  card.draggable = !state.selectMode;
  const picked = state.selectMode && state.selectedIds.has(app.id);
  card.className = "app-card" + (app.id === state.selectedId && !state.selectMode ? " active" : "") +
    (state.selectMode ? " selectable" : "") + (picked ? " picked" : "");
  // Buttons only allow phrasing content, so the card is built from spans.
  const badge = analysisBadge(app);
  const meta = (app.appliedAt ? '<span class="applied-date">' + I.clock + '<span>' + esc(formatDate(app.appliedAt)) + "</span></span>" : "") + badge;
  card.innerHTML =
    (state.selectMode ? '<span class="card-check' + (picked ? " on" : "") + '" aria-hidden="true">' + (picked ? I.check : "") + "</span>" : "") +
    '<span class="card-title">' +
    '<span class="company">' + esc(app.company || "Untitled company") + "</span>" +
    '<span class="role">' + esc(app.role || "Role not set") + "</span>" +
    "</span>" +
    (meta ? '<span class="card-meta">' + meta + "</span>" : "") +
    (app.notes.trim() ? '<span class="card-notes"><span class="visually-hidden">Notes: </span>' + esc(app.notes) + "</span>" : "");
  card.title = (app.company || "Untitled company") + " · " + (app.role || "Role not set");
  if (state.selectMode) card.setAttribute("aria-pressed", picked ? "true" : "false");
  card.addEventListener("click", () => {
    if (Date.now() - lastDragEnd < 250) return;
    if (state.selectMode) {
      toggleSelected(app.id);
      renderBoard();
      return;
    }
    state.selectedId = app.id;
    state.viewMode = "detail";
    renderAll();
  });
  card.addEventListener("dragstart", (e) => {
    if (state.selectMode) { e.preventDefault(); return; }
    drag.start(app.id, app.status);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", app.id);
    // Anchor the drag image where the pointer grabbed the card instead of
    // letting each browser pick its own offset.
    const box = card.getBoundingClientRect();
    e.dataTransfer.setDragImage(card, e.clientX - box.left, e.clientY - box.top);
    // The drag image is captured after this handler returns; styling the card
    // now would make the image itself faded.
    requestAnimationFrame(() => {
      if (drag.activeId !== app.id) return;
      card.classList.add("dragging");
      card.closest(".board")?.classList.add("is-dragging");
    });
  });
  card.addEventListener("dragend", () => {
    // A successful drop re-renders first, so this card may already be detached.
    window.clearTimeout(leaveTimer);
    drag.end();
    lastDragEnd = Date.now();
    card.classList.remove("dragging");
    document.querySelectorAll(".board.is-dragging, .app-card.dragging, .column.drop-target")
      .forEach((el) => el.classList.remove("is-dragging", "dragging", "drop-target"));
  });
  return card;
}

// Same wording on cards and in the table so freshness reads identically everywhere.
const ANALYSIS_BADGES = {
  current: "Analyzed",
  stale: "Outdated",
  imported: "Imported",
  unverified: "Unverified",
};
function analysisBadge(app) {
  const freshness = analysisFreshness(app, state.profile);
  if (freshness === "none") return "";
  return '<span class="fresh-badge fresh-' + freshness + '">' + ANALYSIS_BADGES[freshness] + "</span>";
}

function moveApplication(id, status) {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return;
  applyStatusChange(app, status, persistApps, renderBoard);
}

// --- Table (editable grid) view ---
function renderTable(host, list) {
  const totalPages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE));
  state.tablePage = Math.min(Math.max(state.tablePage, 1), totalPages);
  const pageStart = (state.tablePage - 1) * TABLE_PAGE_SIZE;
  const pageApps = list.slice(pageStart, pageStart + TABLE_PAGE_SIZE);
  const cols = [
    ["company", "Company"], ["role", "Role"], ["status", "Status"],
    ["applied", "Applied"], ["ai", "AI"], ["edit", ""],
  ];
  const sortMap = {
    company: "company",
    role: "role",
    status: "status",
    applied: "applied",
    ai: "ai",
    notes: "notes"
  };
  const pageAllSelected = pageApps.length > 0 && pageApps.every((a) => state.selectedIds.has(a.id));
  const selectHead = state.selectMode
    ? '<th class="t-select"><input type="checkbox" class="js-page-select-all" aria-label="Select all rows on this page"' + (pageAllSelected ? " checked" : "") + (pageApps.length ? "" : " disabled") + " /></th>"
    : "";
  const head = selectHead + cols.map(([key, label]) => {
    const sortable = sortMap[key];
    const baseSort = state.sortBy.replace("-desc", "").replace("-asc", "");
    const active = sortable && baseSort === sortMap[key];
    let indicator = "";
    if (active) {
      const isDesc = state.sortBy.endsWith("-desc") || state.sortBy === "applied" || state.sortBy === "updated" || state.sortBy === "ai";
      indicator = isDesc
        ? '<span class="sort-icon desc" aria-hidden="true">▼</span>'
        : '<span class="sort-icon asc" aria-hidden="true">▲</span>';
    }
    // Header sorting lives on a real button so it is keyboard reachable.
    if (!sortable) return '<th scope="col" class="t-' + key + '">' + (label ? esc(label) : '<span class="visually-hidden">Actions</span>') + "</th>";
    const ariaSort = active ? (indicator.includes("desc") ? "descending" : "ascending") : "none";
    return '<th scope="col" class="sortable t-' + key + '" aria-sort="' + ariaSort + '"><button class="th-sort" type="button" data-sort="' + sortMap[key] + '">' + esc(label) + indicator + "</button></th>";
  }).join("");

  const rows = pageApps.map((app) => {
    const badge = analysisBadge(app);
    // is-empty lets the card layout below 640px drop a field rather than print
    // an em dash; the desktop table keeps the cell so the columns still line up.
    const statusSel = '<select class="mini-select js-row-status" data-id="' + esc(app.id) + '" aria-label="Status for ' + esc(app.company || "Untitled") + '">' +
      STATUSES.map((s) => '<option value="' + esc(s) + '"' + (s === app.status ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select>";
    const picked = state.selectMode && state.selectedIds.has(app.id);
    const selectCell = state.selectMode
      ? '<td class="t-select"><input type="checkbox" class="js-row-select" data-id="' + esc(app.id) + '" aria-label="Select application"' + (picked ? " checked" : "") + " /></td>"
      : "";
    return '<tr data-id="' + esc(app.id) + '" tabindex="0"' + (picked ? ' class="picked"' : "") + ">" +
      selectCell +
      '<td class="t-company" title="' + esc(app.company || "Untitled") + '">' + esc(app.company || "Untitled") + "</td>" +
      '<td class="t-role" title="' + esc(app.role || "") + '">' + esc(app.role || "—") + "</td>" +
      '<td class="t-status">' + statusSel + "</td>" +
      // data-label feeds the ::before caption the notes cell uses below 640px,
      // where the header row is hidden.
      '<td class="t-applied' + (app.appliedAt ? "" : " is-empty") + '">' + esc(app.appliedAt ? formatDate(app.appliedAt) : "—") + "</td>" +
      '<td class="t-ai' + (badge ? "" : " is-empty") + '">' + (badge || '<span class="muted" aria-label="Not analyzed">—</span>') + "</td>" +
      '<td class="t-edit"><button class="table-edit-btn js-row-edit" type="button" data-id="' + esc(app.id) + '" title="Edit application" aria-label="Edit ' + esc(app.company || "application") + '">' + I.edit + "</button></td>" +
      "</tr>";
  }).join("");

  const pagination = list.length > TABLE_PAGE_SIZE
    ? '<nav class="table-pagination" aria-label="Table pagination">' +
    '<button class="pagination-btn js-prev-page" type="button" aria-label="Previous page" title="Previous page"' + (state.tablePage === 1 ? " disabled" : "") + '>' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
    "</button>" +
    '<span class="pagination-page" aria-live="polite">' + state.tablePage + " / " + totalPages + "</span>" +
    '<button class="pagination-btn js-next-page" type="button" aria-label="Next page" title="Next page"' + (state.tablePage === totalPages ? " disabled" : "") + '>' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
    "</button>" +
    "</nav>"
    : "";

  host.innerHTML =
    '<div class="table-wrap"><table class="app-table' + (state.selectMode ? " has-select" : "") + '"><thead><tr>' + head + "</tr></thead><tbody>" +
    (rows || '<tr><td colspan="' + (state.selectMode ? 7 : 6) + '" class="muted table-empty-cell">No applications match your filters.</td></tr>') +
    "</tbody></table></div>" + pagination;

  host.querySelectorAll("thead .th-sort").forEach((th) => th.addEventListener("click", () => {
    const clickedSort = th.dataset.sort;
    const currentBase = state.sortBy.replace("-desc", "").replace("-asc", "");
    if (currentBase === clickedSort) {
      if (clickedSort === "applied" || clickedSort === "updated" || clickedSort === "ai") {
        state.sortBy = state.sortBy === clickedSort ? clickedSort + "-asc" : clickedSort;
      } else {
        state.sortBy = state.sortBy === clickedSort ? clickedSort + "-desc" : clickedSort;
      }
    } else {
      state.sortBy = clickedSort;
    }
    state.tablePage = 1;
    const sortSelect = $("sortSelect");
    const sortValue = state.sortBy.replace("-desc", "").replace("-asc", "");
    const activeSortOption = sortSelect?.parentElement?.querySelector('[data-value="' + sortValue + '"]') as HTMLElement | null;
    sortSelect?.querySelector("span")?.replaceChildren(document.createTextNode(activeSortOption?.textContent || "Recently updated"));
    sortSelect?.parentElement?.querySelectorAll('[role="option"]').forEach((option) => {
      option.setAttribute("aria-selected", String((option as HTMLElement).dataset.value === sortValue));
    });
    renderBoard();
    host.querySelector('.th-sort[data-sort="' + clickedSort + '"]')?.focus();
  }));
  host.querySelector(".js-prev-page")?.addEventListener("click", () => {
    state.tablePage -= 1;
    renderBoard();
  });
  host.querySelector(".js-next-page")?.addEventListener("click", () => {
    state.tablePage += 1;
    renderBoard();
  });
  host.querySelectorAll(".js-row-status").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("keydown", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => moveApplication(e.target.dataset.id, e.target.value));
  });
  host.querySelectorAll(".js-row-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const app = state.applications.find((a) => a.id === btn.dataset.id);
      if (app) openApplicationWizard(app);
    });
  });
  host.querySelector(".js-page-select-all")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.checked) pageApps.forEach((a) => state.selectedIds.add(a.id));
    else pageApps.forEach((a) => state.selectedIds.delete(a.id));
    renderBoard();
  });
  host.querySelectorAll(".js-row-select").forEach((box) => box.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSelected(box.dataset.id);
    renderBoard();
  }));
  const activateRow = (tr) => {
    if (state.selectMode) {
      toggleSelected(tr.dataset.id);
      renderBoard();
      host.querySelector('tr[data-id="' + tr.dataset.id + '"]')?.focus();
      return;
    }
    state.selectedId = tr.dataset.id;
    state.viewMode = "detail";
    renderAll();
  };
  host.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", () => activateRow(tr));
    tr.addEventListener("keydown", (e) => {
      if (e.target !== tr || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      activateRow(tr);
    });
  });
}

// --- Detail view ---
export function renderDetailPage() {
  const content = $("content");
  const app = selectedApp();
  if (!app) {
    content.innerHTML =
      '<div class="empty-state"><div><div class="empty-icon">' + I.briefcase + '</div><h1>No application selected</h1><p>Select an application card from the board.</p><button class="secondary-btn" id="backToBoard" type="button">Back to board</button></div></div>';
    $("backToBoard").addEventListener("click", () => { state.viewMode = "board"; renderAll(); });
    return;
  }
  const canOpen = isHttpUrl(app.jobSources[0]?.url);
  content.innerHTML =
    '<div class="detail">' +
    '<button class="detail-back-link" id="backToBoard" type="button">' + I.back + 'Back to applications</button>' +
    '<div class="detail-head">' +
    '<div class="detail-title"><h1 class="detail-company">' + esc(app.company || "Untitled company") + '</h1><p class="role-text">' + esc(app.role || "Role not set") + "</p></div>" +
    '<div class="detail-actions">' +
    (canOpen ? '<button class="secondary-btn js-open" type="button">' + I.external + "Open posting</button>" : "") +
    '<button class="secondary-btn" id="editApp" type="button">' + I.edit + "Edit</button>" +
    '<button class="ghost-btn btn-danger" id="deleteApp" type="button">' + I.trash + "Delete</button>" +
    "</div>" +
    "</div>" +
    detailsPanel(app) +
    aiReviewPanel(app) +
    jobDescriptionPanel(app) +
    notesPanel(app) +
    "</div>";
  $("backToBoard").addEventListener("click", () => {
    pendingDetailSaves.forEach((save) => save.flushSilently());
    state.viewMode = "board";
    renderAll();
  });
  $("editApp").addEventListener("click", () => openApplicationWizard(app));
  $("deleteApp").addEventListener("click", () => openDeleteModal(app));
  wireDetailActions(app);
}

function aiReviewPanel(app) {
  const a = app.matchAnalysis;
  const message = analysisStatusMessage(app, state.profile);
  const blocked = analyzing || !hasSufficientJobDescription(app.jobText);
  return '<section class="detail-section" aria-labelledby="analysisTitle">' +
    '<div class="detail-section-head">' +
    '<h2 class="detail-section-title" id="analysisTitle">' + I.target + "AI Analysis</h2>" +
    '<div class="analysis-header-actions"><div id="analysisIndicators" class="analysis-indicators" aria-live="polite" aria-atomic="true">' + renderAnalysisIndicators(app, state.profile) + '</div>' +
    '<button class="primary-btn js-analyze" type="button" aria-describedby="analyzeHint"' + (blocked ? " disabled" : "") + (analyzing ? ' aria-busy="true"' : "") + ">" + (analyzing ? '<span class="spinner" aria-hidden="true"></span>Analyzing…' : I.bolt + (a ? "Re-analyze" : "Analyze")) + "</button></div>" +
    "</div>" +
    '<p class="analysis-empty" id="analyzeHint"' + (message ? "" : " hidden") + ">" + esc(message) + "</p>" +
    (a ? '<div id="analysisBody" class="analysis-body">' + renderAnalysisContent(a) + "</div>" : "") +
    "</section>";
}

function jobDescriptionPanel(app) {
  return '<section class="detail-section" aria-labelledby="jobTextTitle">' +
    '<div class="detail-section-head">' +
    '<h2 class="detail-section-title" id="jobTextTitle">' + I.doc + "Job Description</h2>" +
    "</div>" +
    '<textarea id="jobTextInput" class="job-text-input" aria-labelledby="jobTextTitle" maxlength="30000" placeholder="Paste the job description, including responsibilities and qualifications. This is required for AI analysis.">' + esc(app.jobText || "") + "</textarea>" +
    "</section>";
}

function notesPanel(app) {
  return '<section class="detail-section detail-notes" aria-labelledby="jobNotesTitle">' +
    '<div class="detail-section-head">' +
    '<h2 class="detail-section-title" id="jobNotesTitle">Notes</h2>' +
    "</div>" +
    '<textarea id="notesInput" class="job-text-input" aria-labelledby="jobNotesTitle" maxlength="' + INPUT_LIMITS.notes + '" placeholder="Add notes about this application...">' + esc(app.notes || "") + "</textarea>" +
    "</section>";
}

function detailsPanel(app) {
  const jobUrls = app.jobSources.map((entry) => entry.url).filter(Boolean);
  const sources = app.jobSources.map((entry) => entry.source).filter(Boolean);
  const urlHtml = jobUrls.length ? '<div class="detail-url-list">' + jobUrls.map((url) => {
    let displayUrl = url;
    try { displayUrl = new URL(url).hostname.replace(/^www\./, ""); } catch (_) { /* show the entered value */ }
    return isHttpUrl(url)
      ? '<a class="detail-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(url) + '">' + esc(displayUrl) + I.external + "</a>"
      : "<span>" + esc(displayUrl) + "</span>";
  }).join("") + "</div>" : "Not set";
  const sourceHtml = sources.length
    ? '<div class="detail-url-list">' + sources.map((source) => "<span>" + esc(source) + "</span>").join("") + "</div>"
    : "Not set";
  return '<section class="detail-section" aria-labelledby="infoTitle">' +
    '<h2 class="detail-section-title" id="infoTitle">' + I.briefcase + "Application Info</h2>" +
    '<div class="info-table">' +
    infoRow("Company", app.company || "Untitled company", !app.company) +
    infoRow("Role", app.role || "Role not set", !app.role) +
    infoRow("Status", headerStatusSelect(app), false, true, "", "detailStatus") +
    infoRow("Applied", formatDate(app.appliedAt), !app.appliedAt) +
    infoRow("Sources", sourceHtml, !sources.length, true) +
    infoRow("Job URLs", urlHtml, !jobUrls.length, true) +
    "</div>" +
    "</section>";
}

function infoRow(label, value, muted = false, raw = false, cls = "", labelFor = "") {
  const classStr = cls ? " " + cls : "";
  const labelHtml = labelFor
    ? '<label class="detail-label" for="' + labelFor + '">' + esc(label) + "</label>"
    : '<div class="detail-label">' + esc(label) + "</div>";
  return '<div class="info-row' + classStr + '">' + labelHtml + '<div class="info-value' + (muted ? " muted" : "") + '">' + (raw ? value : esc(value)) + "</div></div>";
}
function headerStatusSelect(app) {
  return '<select class="select select-sm js-status" id="detailStatus">' +
    STATUSES.map((s) => '<option value="' + esc(s) + '"' + (s === app.status ? " selected" : "") + ">" + esc(s) + "</option>").join("") +
    "</select>";
}
function wireDetailActions(app) {
  pendingDetailSaves.forEach((save) => save.flushSilently());
  pendingDetailSaves = [];
  const notesInput = document.querySelector<HTMLTextAreaElement>("#notesInput");
  if (notesInput) {
    const autosave = createAutosave(
      (value) => { app.notes = value; touch(app); },
      persistApps,
      (saved, announceSuccess) => autosaveFeedback(saved, "Notes", announceSuccess),
      app.notes || "",
    );
    pendingDetailSaves.push(autosave);
    notesInput.addEventListener("input", () => autosave.input(notesInput.value));
    notesInput.addEventListener("blur", autosave.flush);
  }
  const status = document.querySelector(".js-status");
  if (status) status.addEventListener("change", () => {
    applyStatusChange(app, status.value, persistApps, renderAll);
    $("detailStatus")?.focus();
  });
  const openBtn = document.querySelector(".js-open");
  if (openBtn) openBtn.addEventListener("click", () => openPosting(app));
  const jobInput = document.querySelector<HTMLTextAreaElement>("#jobTextInput");
  if (jobInput) {
    const autosave = createAutosave(
      (value) => { app.jobText = value; touch(app); },
      persistApps,
      (saved, announceSuccess) => autosaveFeedback(saved, "Job description", announceSuccess),
      app.jobText || "",
    );
    pendingDetailSaves.push(autosave);
    jobInput.addEventListener("input", () => {
      autosave.input(jobInput.value);
      // Typing changes what Analyze accepts and whether the saved analysis is
      // still current; update those in place so the textarea keeps focus.
      const hint = analysisStatusMessage(app, state.profile);
      const hintEl = $("analyzeHint");
      if (hintEl) { hintEl.textContent = hint; hintEl.hidden = !hint; }
      document.querySelectorAll(".js-analyze").forEach((btn) => { if (!analyzing) btn.disabled = !hasSufficientJobDescription(app.jobText); });
      const indicators = $("analysisIndicators");
      if (indicators) indicators.innerHTML = renderAnalysisIndicators(app, state.profile);
    });
    jobInput.addEventListener("blur", autosave.flush);
  }
  document.querySelectorAll(".js-analyze").forEach((btn) => btn.addEventListener("click", () => runAnalyze(app)));
}

function openPosting(app) {
  const url = app.jobSources[0]?.url;
  if (openPostingUrl(url) === "error") {
    notify.warning("Posting could not be opened.", { detail: "Try again or use the Job URLs link." });
  }
}

export function requireProfile() {
  if (!state.profile.trim()) {
    openProfileModal();
    return false;
  }
  return true;
}

let analyzing = false;
let analysisStorageRevision = 0;
window.addEventListener("storage", (event) => {
  if (event.key === null || event.key === "applypilot_applications" || event.key === "applypilot_profile") analysisStorageRevision++;
});
async function runAnalyze(app) {
  if (analyzing) return; // guard against double-clicks while a run is in flight
  if (!requireProfile()) return;
  if (!hasSufficientJobDescription(app.jobText)) {
    notify.warning("Job description required.", { detail: "Add concrete responsibilities or qualifications before analyzing." });
    return;
  }
  const snapshot = captureAnalysisInput(app, state.profile);
  const storageRevision = analysisStorageRevision;
  const jobContext = snapshot.jobInformation;
  if (state.profile.length > INPUT_LIMITS.profile || jobContext.length > 40_000 || state.profile.length + jobContext.length > 60_000) {
    notify.warning("Analysis input is too long.", { detail: "Shorten the CV or job description and try again." });
    return;
  }
  const btns = Array.from(document.querySelectorAll(".js-analyze"));
  btns.forEach((b) => { b.disabled = true; b.dataset.orig = b.innerHTML; b.innerHTML = '<span class="spinner" aria-hidden="true"></span>Analyzing…'; b.setAttribute("aria-busy", "true"); });
  analyzing = true;
  try {
    const result = await analyze(jobContext, snapshot.profile);
    const empty = !result || result.schema_version !== ANALYSIS_SCHEMA_VERSION || !result.overall_assessment || !result.requirements.length;
    if (empty) {
      notify.error("Analysis failed.", { detail: "No usable analysis was returned. Add more job detail and try again." });
      return;
    }
    if (storageRevision !== analysisStorageRevision || !acceptAnalysisResult(snapshot, state.applications, state.profile, result)) {
      notify.warning("Analysis was not saved.", { detail: "The application or CV changed while analysis was running. Analyze again to use the current inputs." });
      return;
    }
    touch(app);
    analysisFeedback(persistApps());
  } catch (err) {
    notify.error("Analysis failed.", { detail: err?.message || "Please try again." });
  } finally {
    analyzing = false;
    // Restore any buttons still in the DOM (renderAll on success replaces them).
    btns.forEach((b) => { if (document.body.contains(b)) { b.disabled = false; b.removeAttribute("aria-busy"); b.innerHTML = b.dataset.orig || b.innerHTML; } });
    renderAll();
  }
}
