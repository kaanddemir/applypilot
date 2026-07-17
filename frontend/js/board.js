// Kanban board + application detail view, drag/drop, and the non-chat AI actions
// (fetch job text, run match analysis).
"use strict";

import {
  state, $, esc, STATUSES, BOARD_STATUSES, filteredApps, selectedApp,
  formatDate, sourceFromUrl, isHttpUrl, setChatContext, touch, persistApps, toast,
  mergeUniqueApplications, setSelectMode, toggleSelected, pruneSelection,
} from "./state.js";
import { I } from "./icons.js";
import { analyze } from "./ai.js";
import { renderAll } from "./render.js";
import { openApplicationWizard, openCvWizard, openDeleteModal, openDeleteApplications } from "./wizards.js?v=3";
import { runCover } from "./chat.js";
import { exportExcelTable, readExcelApplications } from "./excel.js";

const TABLE_PAGE_SIZE = 10;

export function renderBoardPage() {
  $("content").innerHTML =
    '<div class="toolbar">' +
      '<div class="search">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input id="searchInput" type="search" placeholder="Search company, role, source, or notes" value="' + esc(state.search) + '" />' +
      "</div>" +
      '<div class="seg" id="layoutToggle">' +
        '<button class="seg-btn' + (state.boardLayout === "kanban" ? " active" : "") + '" data-layout="kanban" title="Kanban board">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14M12 5v14M18 5v14"/></svg>Kanban</button>' +
        '<button class="seg-btn' + (state.boardLayout === "table" ? " active" : "") + '" data-layout="table" title="Table view">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/></svg>Table</button>' +
      "</div>" +
      '<select class="select" id="statusFilter" aria-label="Status filter"></select>' +
      '<select class="select" id="sortSelect" aria-label="Sort applications">' +
        '<option value="updated">Recently updated</option>' +
        '<option value="ai">AI Analysis</option>' +
        '<option value="company">Company A-Z</option>' +
        '<option value="role">Role A-Z</option>' +
        '<option value="status">Status A-Z</option>' +
        '<option value="applied">Applied date</option>' +
        '<option value="notes">Notes A-Z</option>' +
      "</select>" +
      '<div class="data-menu-wrap">' +
        '<button class="icon-btn export-btn" id="dataMenuBtn" title="Import / Export" aria-label="Import or export applications">' + I.more + "</button>" +
        '<div class="data-menu" id="dataMenu">' +
          '<button class="data-menu-item" id="selectModeBtn">' + I.check + "<span>" + (state.selectMode ? "Exit selection" : "Select applications") + "</span></button>" +
          '<button class="data-menu-item" id="exportExcelBtn">' + I.download + "<span>Export to Excel</span></button>" +
          '<button class="data-menu-item" id="importExcelBtn">' + I.upload + "<span>Import from Excel</span></button>" +
        "</div>" +
        '<input type="file" id="importExcelInput" accept=".xlsx" hidden />' +
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
    sf.innerHTML = ['<option value="All">All statuses</option>'].concat(STATUSES.map((s) => '<option value="' + esc(s) + '">' + esc(s) + "</option>")).join("");
    sf.value = state.filter;
    sf.addEventListener("change", (e) => {
      state.filter = e.target.value;
      state.tablePage = 1;
      renderAll();
    });
  }
  const sort = $("sortSelect");
  if (sort) {
    // Kanban sorts inside each column: filteredApps() orders the whole list and
    // the columns keep that order when they filter by status.
    sort.value = state.sortBy.replace("-desc", "").replace("-asc", "");
    sort.title = state.boardLayout === "kanban" ? "Sort applications within each column" : "Sort applications";
    sort.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      state.tablePage = 1;
      renderBoard();
    });
  }
  const menuBtn = $("dataMenuBtn");
  const menu = $("dataMenu");
  if (menuBtn && menu) {
    menuBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
    document.addEventListener("click", () => menu.classList.remove("open"));
    menu.addEventListener("click", (e) => e.stopPropagation());
  }
  const selectBtn = $("selectModeBtn");
  if (selectBtn) selectBtn.addEventListener("click", () => {
    menu?.classList.remove("open");
    setSelectMode(!state.selectMode);
    renderBoardPage();
  });
  const exportBtn = $("exportExcelBtn");
  if (exportBtn) exportBtn.addEventListener("click", () => { menu?.classList.remove("open"); exportExcelTable(state.applications); });
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
    state.boardLayout = b.dataset.layout;
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
    persistApps();
    renderAll();
    const messages = [];
    if (result.added) messages.push("Imported " + result.added + " new application" + (result.added === 1 ? "" : "s"));
    else messages.push("No new applications to import");
    if (result.skipped) messages.push("skipped " + result.skipped + " duplicate" + (result.skipped === 1 ? "" : "s"));
    if (result.removedExisting) messages.push("removed " + result.removedExisting + " existing duplicate" + (result.removedExisting === 1 ? "" : "s"));
    toast(messages.join("; "));
  } catch (err) {
    toast(err.message || "Could not read that file.");
  }
}

// Statuses the kanban renders as columns; Archived only gets one when filtered to it.
function boardColumns() {
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
  else renderKanban(layoutHost, list);
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
    '<button class="status-select-btn" type="button">Select by status' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
    "</button>" +
    '<div class="status-select-menu">' + groups.map((status) => {
      const apps = list.filter((a) => a.status === status);
      const on = apps.every((a) => state.selectedIds.has(a.id));
      return '<label class="status-select-item"><input type="checkbox" class="js-status-group" data-status="' + esc(status) + '"' + (on ? " checked" : "") + " />" +
        "<span>" + esc(status) + '</span><span class="status-select-count">' + apps.length + "</span></label>";
    }).join("") + "</div>" +
  "</div>";
}

// The bar is rebuilt on every selection change, so the outside-click closer is
// bound once against the document instead of once per menu.
let statusMenuCloserBound = false;
function wireStatusSelectMenu(bar, list) {
  const wrap = bar.querySelector(".status-select-wrap");
  if (!wrap) return;
  const menu = wrap.querySelector(".status-select-menu");
  wrap.querySelector(".status-select-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  menu.addEventListener("click", (e) => e.stopPropagation());
  if (!statusMenuCloserBound) {
    document.addEventListener("click", () => {
      document.querySelectorAll(".status-select-menu.open").forEach((m) => m.classList.remove("open"));
    });
    statusMenuCloserBound = true;
  }
  wrap.querySelectorAll(".js-status-group").forEach((box) => box.addEventListener("change", () => {
    const apps = list.filter((a) => a.status === box.dataset.status);
    if (box.checked) apps.forEach((a) => state.selectedIds.add(a.id));
    else apps.forEach((a) => state.selectedIds.delete(a.id));
    renderBoard();
    // renderBoard rebuilds the bar, so reopen the menu to keep picking groups.
    $("boardHost").querySelector(".status-select-menu")?.classList.add("open");
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
      '<span class="column-title">' + esc(status) + '</span><span class="column-count">' + apps.length + "</span></div>";
    col.querySelector(".js-col-select")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.checked) apps.forEach((a) => state.selectedIds.add(a.id));
      else apps.forEach((a) => state.selectedIds.delete(a.id));
      renderBoard();
    });
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-target"); });
    col.addEventListener("dragleave", (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove("drop-target");
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      const id = e.dataTransfer.getData("text/plain");
      moveApplication(id, status);
    });
    const body = document.createElement("div");
    body.className = "column-body";
    body.dataset.status = status;
    if (!apps.length) {
      body.innerHTML = '<div class="empty-column">No applications</div>';
    } else {
      apps.forEach((app) => body.appendChild(appCard(app)));
    }
    col.appendChild(body);
    board.appendChild(col);
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
  const reviewed = !!app.matchAnalysis;
  card.innerHTML =
    (state.selectMode ? '<span class="card-check' + (picked ? " on" : "") + '" aria-hidden="true">' + (picked ? I.check : "") + "</span>" : "") +
    '<div class="card-top">' +
      '<div class="card-title">' +
        '<div class="company">' + esc(app.company || "Untitled company") + "</div>" +
        '<div class="role">' + esc(app.role || "Role not set") + "</div>" +
      "</div>" +
      (app.appliedAt ? '<div class="applied-date">' + I.clock + '<span>' + esc(formatDate(app.appliedAt)) + "</span></div>" : "") +
      (reviewed ? '<div class="card-reviewed"><span>AI reviewed</span></div>' : "") +
    "</div>" +
    '<div class="card-notes' + (!app.notes ? " empty" : "") + '">' +
      '<span class="notes-label">Notes</span>' +
      '<span class="notes-text">' + esc(app.notes || "No notes yet") + "</span>" +
    "</div>";
  card.setAttribute("aria-pressed", picked ? "true" : "false");
  card.addEventListener("click", () => {
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
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", app.id);
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  return card;
}

function moveApplication(id, status) {
  const app = state.applications.find((a) => a.id === id);
  if (!app || app.status === status) return;
  app.status = status;
  touch(app);
  persistApps();
  toast("Moved to " + status);
  renderAll();
}

// --- Table (editable grid) view ---
function renderTable(host, list) {
  const totalPages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE));
  state.tablePage = Math.min(Math.max(state.tablePage, 1), totalPages);
  const pageStart = (state.tablePage - 1) * TABLE_PAGE_SIZE;
  const pageApps = list.slice(pageStart, pageStart + TABLE_PAGE_SIZE);
  const cols = [
    ["company", "Company"], ["role", "Role"], ["status", "Status"],
    ["applied", "Applied"], ["ai", "AI"], ["notes", "Notes"], ["edit", ""],
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
        ? '<span class="sort-icon desc">▼</span>'
        : '<span class="sort-icon asc">▲</span>';
    }
    return "<th" + (sortable ? ' class="sortable" data-sort="' + sortMap[key] + '"' : "") + ">" + esc(label) + indicator + "</th>";
  }).join("");

  const rows = pageApps.map((app) => {
    const reviewed = !!app.matchAnalysis;
    // is-empty lets the card layout below 640px drop a field rather than print
    // an em dash; the desktop table keeps the cell so the columns still line up.
    const hasNotes = !!(app.notes && app.notes.trim());
    const statusSel = '<select class="mini-select js-row-status" data-id="' + esc(app.id) + '">' +
      STATUSES.map((s) => '<option value="' + esc(s) + '"' + (s === app.status ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select>";
    const picked = state.selectMode && state.selectedIds.has(app.id);
    const selectCell = state.selectMode
      ? '<td class="t-select"><input type="checkbox" class="js-row-select" data-id="' + esc(app.id) + '" aria-label="Select application"' + (picked ? " checked" : "") + " /></td>"
      : "";
    return '<tr data-id="' + esc(app.id) + '"' + (picked ? ' class="picked"' : "") + ">" +
      selectCell +
      '<td class="t-company">' + esc(app.company || "Untitled") + "</td>" +
      '<td class="t-role">' + esc(app.role || "—") + "</td>" +
      '<td class="t-status">' + statusSel + "</td>" +
      // data-label feeds the ::before caption the notes cell uses below 640px,
      // where the header row is hidden.
      '<td class="t-applied' + (app.appliedAt ? "" : " is-empty") + '">' + esc(app.appliedAt ? formatDate(app.appliedAt) : "—") + "</td>" +
      '<td class="t-ai' + (reviewed ? "" : " is-empty") + '">' + (reviewed ? '<span class="ai-pill">Reviewed</span>' : '<span class="muted">—</span>') + "</td>" +
      '<td class="t-notes' + (hasNotes ? "" : " is-empty") + '" data-label="Notes">' + esc(hasNotes ? app.notes : "—") + "</td>" +
      '<td class="t-edit"><button class="table-edit-btn js-row-edit" data-id="' + esc(app.id) + '" title="Edit application" aria-label="Edit application">' + I.edit + "</button></td>" +
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
    (rows || '<tr><td colspan="' + (state.selectMode ? 8 : 7) + '" class="muted table-empty-cell">No applications match your filters.</td></tr>') +
    "</tbody></table></div>" + pagination;

  host.querySelectorAll("thead .sortable").forEach((th) => th.addEventListener("click", () => {
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
    if (sortSelect) {
      sortSelect.value = state.sortBy.endsWith("-desc") || state.sortBy.endsWith("-asc")
        ? state.sortBy.replace("-desc", "").replace("-asc", "")
        : state.sortBy;
    }
    renderBoard();
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
  host.querySelectorAll("tbody tr[data-id]").forEach((tr) => tr.addEventListener("click", () => {
    if (state.selectMode) {
      toggleSelected(tr.dataset.id);
      renderBoard();
      return;
    }
    state.selectedId = tr.dataset.id;
    state.viewMode = "detail";
    renderAll();
  }));
}

// --- Detail view ---
export function renderDetailPage() {
  const content = $("content");
  const app = selectedApp();
  if (!app) {
    content.innerHTML =
      '<div class="empty-state"><div><div class="empty-icon">' + I.briefcase + '</div><h1>No application selected</h1><p>Select an application card from the board.</p><button class="secondary-btn" id="backToBoard">Back to board</button></div></div>';
    $("backToBoard").addEventListener("click", () => { state.viewMode = "board"; renderAll(); });
    return;
  }
  content.innerHTML =
    '<div class="detail">' +
    '<div class="detail-head">' +
      '<button class="detail-back-btn" id="backToBoard" aria-label="Back to board" title="Back to board">' + I.back + "</button>" +
      '<div class="detail-title"><div class="detail-title-copy"><strong>' + esc(app.company || "Untitled company") + '</strong><span class="role-text">' + esc(app.role || "Role not set") + "</span></div></div>" +
    "</div>" +
    '<div class="detail-body">' +
      aiReviewPanel(app) +
      jobDescriptionPanel(app) +
      '<div class="detail-grid-row">' +
        detailsPanel(app) +
        quickActionsPanel(app) +
      '</div>' +
    "</div></div>";
  $("backToBoard").addEventListener("click", () => { state.viewMode = "board"; renderAll(); });
  $("editApp").addEventListener("click", () => openApplicationWizard(app));
  $("deleteApp").addEventListener("click", () => openDeleteModal(app));
  wireDetailActions(app);
}

function aiReviewPanel(app) {
  const a = app.matchAnalysis;
  const analyzed = !!a;

  // Rows are conditional (either field can be empty on older or partial
  // analyses), so collect them and let the last one close the table's border.
  const rows = [];
  if (analyzed) {
    const fit = a.summary || a.overall_recommendation || "Analysis complete.";
    rows.push(["Job fit", fit, false]);
    // Skip when the fit row already fell back to this same text.
    if (a.summary && a.overall_recommendation) rows.push(["What you can do", a.overall_recommendation, false]);
  } else {
    const hint = app.jobText
      ? "Run the analysis to find out whether this role fits your CV, and what to do about it."
      : "Run the analysis from the details you entered, or paste the full job description below for a deeper review.";
    rows.push(["Job fit", hint, true]);
  }

  const tableRows = rows.map(([label, value, muted], i) => {
    const last = i === rows.length - 1;
    // span-4: this table keeps the default 4 columns, so a narrower span would
    // leave the row (and its divider) stopping short of the panel's edge.
    return infoRow(label, value, muted, false, "span-4 border-right-0" + (last ? " border-bottom-0" : ""));
  }).join("");

  return '<div class="detail-section">' +
    '<h3 class="detail-section-title">' + I.target + 'AI Review</h3>' +
    '<div id="analysisBody">' +
      '<div class="info-table">' +
        tableRows +
      '</div>' +
    '</div>' +
  '</div>';
}

function jobDescriptionPanel(app) {
  return '<div class="detail-section">' +
    '<h3 class="detail-section-title">' + I.doc + 'Job Description</h3>' +
    '<textarea id="jobTextInput" class="job-text-input" maxlength="30000" placeholder="Paste the full job description for a deeper, more accurate AI review (and better cover letters). Optional, the analysis also uses the company, role, source and notes you entered.">' + esc(app.jobText || "") + '</textarea>' +
  '</div>';
}

function detailsPanel(app) {
  const jobUrls = app.jobUrls?.length ? app.jobUrls : (app.jobUrl ? [app.jobUrl] : []);
  const sources = app.sources?.length ? app.sources : (app.source ? [app.source] : []);
  const urlHtml = jobUrls.length ? '<div class="detail-url-list">' + jobUrls.map((url) => {
    let displayUrl = url;
    try { displayUrl = new URL(url).hostname.replace(/^www\./, ""); } catch (_) { /* show the entered value */ }
    if (displayUrl.length > 25) displayUrl = displayUrl.slice(0, 22) + "...";
    return isHttpUrl(url)
      ? '<a class="detail-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(displayUrl) + '</a>'
      : '<span>' + esc(displayUrl) + '</span>';
  }).join("") + '</div>' : "Not set";
  const sourceHtml = sources.length
    ? '<div class="detail-url-list">' + sources.map((source) => '<span>' + esc(source) + '</span>').join("") + '</div>'
    : "Not set";
  return '<div class="detail-section detail-section-fill">' +
    '<h3 class="detail-section-title">' + I.briefcase + 'Application Info</h3>' +
    '<div class="info-table cols-3 info-table-fill">' +
      infoRow("Company", app.company || "Untitled company", !app.company) +
      infoRow("Role", app.role || "Role not set", !app.role) +
      infoRow("Status", headerStatusSelect(app), false, true, "border-right-0") +
      infoRow("Applied", formatDate(app.appliedAt), !app.appliedAt) +
      infoRow("Sources", sourceHtml, !sources.length, true) +
      infoRow("Source job URLs", urlHtml, !jobUrls.length, true, "border-right-0") +
      infoRow("Notes", app.notes || "No notes yet.", !app.notes, false, "span-3 border-right-0 border-bottom-0") +
    "</div>" +
  '</div>';
}

function quickActionsPanel(app) {
  const a = app.matchAnalysis;
  const analyzed = !!a;
  const canOpen = isHttpUrl(app.jobUrl);
  // Analysis can run on whatever job info exists (title/company/notes and/or a
  // pasted description); only truly-empty applications block it.
  const hasUsableJobInfo = !!(app.jobText.trim() || app.company || app.role || app.notes);
  return '<div class="detail-section detail-section-fill">' +
    '<h3 class="detail-section-title">' + I.target + 'Actions</h3>' +
    '<div class="actions-list">' +
      '<button class="primary-btn action-btn js-analyze" ' + (!hasUsableJobInfo ? "disabled" : "") + ">" + I.target + (analyzed ? "Re-analyze application" : "Analyze application") + "</button>" +
      '<button class="secondary-btn action-btn js-cover" ' + (!hasUsableJobInfo ? "disabled" : "") + ">" + I.doc + "Cover letter</button>" +
      '<button class="secondary-btn action-btn js-ask-chat">' + I.chat + "Ask in Chat</button>" +
      (canOpen ? '<button class="secondary-btn wide js-open record-open-btn action-btn">' + I.external + "Open job posting</button>" : "") +
      '<button class="secondary-btn action-btn" id="editApp">' + I.edit + "Edit</button>" +
      '<button class="secondary-btn btn-danger action-btn" id="deleteApp">' + I.trash + "Delete</button>" +
    '</div>' +
  '</div>';
}
function infoRow(label, value, muted, raw, cls) {
  const classStr = cls ? ' ' + cls : '';
  return '<div class="info-row' + classStr + '"><div class="detail-label">' + esc(label) + '</div><div class="info-value' + (muted ? " muted" : "") + '">' + (raw ? value : esc(value)) + "</div></div>";
}
function headerStatusSelect(app) {
  return '<select class="header-status-select js-status" aria-label="Application status">' +
    STATUSES.map((s) => '<option value="' + esc(s) + '"' + (s === app.status ? " selected" : "") + ">" + esc(s) + "</option>").join("") +
  "</select>";
}
function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "offer") return "offer";
  if (normalized === "interview") return "interview";
  if (normalized === "applied") return "applied";
  if (normalized === "rejected") return "rejected";
  if (normalized === "archived") return "archived";
  return "saved";
}


function wireDetailActions(app) {
  const status = document.querySelector(".js-status");
  if (status) status.addEventListener("change", () => { app.status = status.value; touch(app); persistApps(); renderAll(); });
  const openBtn = document.querySelector(".js-open");
  if (openBtn) openBtn.addEventListener("click", () => openPosting(app));
  document.querySelectorAll(".js-fetch").forEach((btn) => btn.addEventListener("click", () => fetchJobText(app)));
  const jobInput = document.querySelector("#jobTextInput");
  if (jobInput) {
    jobInput.addEventListener("input", () => {
      app.jobText = jobInput.value;
      touch(app);
      persistApps();
    });
  }
  document.querySelectorAll(".js-analyze").forEach((btn) => btn.addEventListener("click", () => runAnalyze(app)));
  document.querySelectorAll(".js-cover").forEach((btn) => btn.addEventListener("click", () => runCover(app)));
  const askInChat = document.querySelector(".js-ask-chat");
  if (askInChat) askInChat.addEventListener("click", () => {
    setChatContext(app.id);
    state.viewMode = "chat";
    renderAll();
  });
}

function openPosting(app) {
  if (!app.jobUrl) return;
  window.open(app.jobUrl, "_blank", "noopener,noreferrer");
}

export function requireProfile() {
  if (!state.profile.trim()) {
    openCvWizard("Add your CV first so assistant actions are grounded in your real experience.");
    return false;
  }
  return true;
}

async function fetchJobText(app) {
  if (!app.jobUrl) return;
  const btn = document.querySelector(".js-fetch");
  if (btn) btn.textContent = "Fetching...";
  try {
    const apiBase = location.port === "8000" ? "" : "http://localhost:8000";
    const resp = await fetch(apiBase + "/api/fetch-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: app.jobUrl }),
    });
    const data = await resp.json();
    if (data.error || !data.text) throw new Error(data.error || "Could not read that page.");
    app.jobText = data.text;
    if (!app.source) app.source = sourceFromUrl(app.jobUrl);
    touch(app);
    persistApps();
    toast("Job posting text fetched");
  } catch (err) {
    toast(err.message || "Fetch failed. Paste the text manually.");
  } finally {
    renderAll();
  }
}

// Assemble everything known about the job into one block for the analyzer, so
// analysis works from the entered fields even when there is no full description.
function buildJobContext(app) {
  const parts = [];
  if (app.company) parts.push("Company: " + app.company);
  if (app.role) parts.push("Role / title: " + app.role);
  const sources = app.sources?.length ? app.sources : (app.source ? [app.source] : []);
  sources.forEach((source, index) => parts.push("Source " + (index + 1) + ": " + source));
  const jobUrls = app.jobUrls?.length ? app.jobUrls : (app.jobUrl ? [app.jobUrl] : []);
  jobUrls.forEach((url, index) => parts.push("Job URL " + (index + 1) + ": " + url));
  if (app.notes && app.notes.trim()) parts.push("User notes: " + app.notes.trim());
  const desc = (app.jobText || "").trim();
  parts.push("\nJob description:\n" + (desc || "(No full description provided. Base your assessment on the fields above and note that it relies on limited job information.)"));
  return parts.join("\n");
}

let analyzing = false;
async function runAnalyze(app) {
  if (analyzing) return; // guard against double-clicks while a run is in flight
  if (!requireProfile()) return;
  if (!(app.jobText.trim() || app.company || app.role || (app.notes && app.notes.trim()))) {
    toast("Add a role, company, or job description first");
    return;
  }
  const btns = Array.from(document.querySelectorAll(".js-analyze"));
  btns.forEach((b) => { b.disabled = true; b.dataset.orig = b.innerHTML; b.innerHTML = I.target + "Analyzing…"; });
  analyzing = true;
  toast("Analyzing this application...");
  try {
    const result = await analyze(buildJobContext(app), (statusText) => toast(statusText));
    const empty = !result || (!result.summary && !result.overall_recommendation &&
      !(result.matched_requirements || []).length && !(result.missing_or_weak || []).length &&
      !(result.ats_keywords || []).length && !(result.resume_bullets || []).length);
    if (empty) {
      toast("The model did not return a usable analysis. Try adding more job detail or checking your key.");
      renderAll();
      return;
    }
    app.matchAnalysis = result;
    touch(app);
    persistApps();
    toast("Analysis saved");
    renderAll(); // rebuilds the panel (and these buttons) with the result
  } catch (err) {
    toast("Analysis failed: " + (err.message || String(err)));
    renderAll();
  } finally {
    analyzing = false;
    // Restore any buttons still in the DOM (renderAll on success replaces them).
    btns.forEach((b) => { if (document.body.contains(b)) { b.disabled = false; b.innerHTML = b.dataset.orig || b.innerHTML; } });
  }
}
