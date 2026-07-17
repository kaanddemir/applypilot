// Shared mutable state + small pure helpers. Every module mutates `state.*`
// in place (ES modules can't reassign an imported binding from elsewhere).
"use strict";

import { store, LS } from "./store.js";

export const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Rejected", "Archived"];
export const BOARD_STATUSES = ["Saved", "Applied", "Interview", "Offer", "Rejected"];

export const $ = (id) => document.getElementById(id);

export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

export function normalizeApps(items) {
  if (!Array.isArray(items)) return [];
  return items.map((a) => {
    const legacyUrls = Array.isArray(a.jobUrls) && a.jobUrls.length ? a.jobUrls : [a.jobUrl];
    const legacySources = Array.isArray(a.sources) ? a.sources : [];
    const jobSources = (Array.isArray(a.jobSources) ? a.jobSources : legacyUrls.map((url, index) => ({
      url,
      source: legacySources[index] || (index === 0 ? a.source : ""),
    })))
      .map((entry) => ({
        url: String(entry?.url || "").trim(),
        source: String(entry?.source || "").trim(),
      }))
      .filter((entry) => entry.url || entry.source);
    const jobUrls = jobSources.map((entry) => entry.url).filter(Boolean);
    const sources = jobSources.map((entry) => entry.source).filter(Boolean);
    return ({
      id: a.id || uid(),
      company: a.company || "",
      role: a.role || "",
      // Keep jobUrl as the primary URL for older saved data and features that
      // fetch/open one posting, while jobUrls stores every source link.
      jobUrl: jobUrls[0] || "",
      jobUrls,
      source: sources[0] || "",
      sources,
      jobSources,
      status: STATUSES.includes(a.status) ? a.status : "Saved",
      appliedAt: a.appliedAt || "",
      nextAction: a.nextAction || "",
      notes: a.notes || "",
      jobText: a.jobText || "",
      matchAnalysis: a.matchAnalysis || null,
      coverLetter: a.coverLetter || "",
      createdAt: a.createdAt || Date.now(),
      updatedAt: a.updatedAt || Date.now(),
    });
  });
}

function applicationIdentityKeys(app) {
  const keys = [];
  if (app.id) keys.push("id:" + String(app.id).trim());
  const urls = (app.jobUrls?.length ? app.jobUrls : (app.jobUrl ? [app.jobUrl] : []))
    .map((value) => {
      try {
        const url = new URL(String(value).trim());
        url.hash = "";
        if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
        return url.toString();
      } catch (_) {
        return String(value || "").trim().toLowerCase().replace(/\/+$/, "");
      }
    })
    .filter(Boolean);
  urls.forEach((url) => keys.push("url:" + url));
  if (!urls.length) {
    const text = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    const company = text(app.company);
    const role = text(app.role);
    if (company || role) keys.push("record:" + company + "|" + role + "|" + text(app.appliedAt));
  }
  return keys;
}

export function mergeUniqueApplications(existing, imported) {
  const seen = new Set();
  const applications = [];
  let removedExisting = 0;
  let skipped = 0;
  let added = 0;
  const add = (app, fromImport) => {
    const keys = applicationIdentityKeys(app);
    if (keys.some((key) => seen.has(key))) {
      if (fromImport) skipped++;
      else removedExisting++;
      return;
    }
    keys.forEach((key) => seen.add(key));
    applications.push(app);
    if (fromImport) added++;
  };
  existing.forEach((app) => add(app, false));
  imported.forEach((app) => add(app, true));
  return { applications, added, skipped, removedExisting };
}

export function normalizeSessions(items) {
  if (!Array.isArray(items) || !items.length) {
    const s = { id: uid(), title: "Assistant", createdAt: Date.now(), thread: [], contextAppId: "" };
    state.activeChatId = s.id;
    return [s];
  }
  return items.map((s) => ({
    id: s.id || uid(),
    title: s.title || "Assistant",
    createdAt: s.createdAt || Date.now(),
    thread: Array.isArray(s.thread) ? s.thread : [],
    contextAppId: s.contextAppId || "",
  }));
}

export const state = {
  profile: store.get(LS.profile, ""),
  profileFile: store.getJSON(LS.profileFile, null),
  applications: [],
  selectedId: "",
  viewMode: store.get(LS.view, "board"),
  chatContextId: "",
  filter: store.get(LS.filter, "All"),
  search: "",
  sortBy: store.get(LS.sortBy, "updated"),
  boardLayout: store.get(LS.boardLayout, "kanban") === "table" ? "table" : "kanban",
  tablePage: 1,
  // Bulk-select mode for the board/table; deliberately not persisted so a
  // reload always comes back in normal browsing mode.
  selectMode: false,
  selectedIds: new Set(),
  chatSessions: [],
  activeChatId: store.get(LS.active, ""),
  streaming: false,
  controller: null,
  provider: store.get(LS.provider, "claude"),
};

// Populate collections now that `state` exists (normalizeSessions references it).
// Also repair duplicate rows left by older versions that appended every import.
const storedApplications = normalizeApps(store.getJSON(LS.applications, []));
const initialApplications = mergeUniqueApplications(storedApplications, []);
state.applications = initialApplications.applications;
if (initialApplications.removedExisting) store.setJSON(LS.applications, state.applications);
state.chatSessions = normalizeSessions(store.getJSON(LS.sessions, []));

// Restore the persisted view/selection, falling back sanely if it's stale.
const savedSel = store.get(LS.selectedId, "");
state.selectedId = state.applications.some((a) => a.id === savedSel) ? savedSel : (state.applications[0]?.id || "");
if (!["board", "chat", "detail", "profile"].includes(state.viewMode)) state.viewMode = "board";
if (state.viewMode === "detail" && !state.selectedId) state.viewMode = "board";
if (!STATUSES.includes(state.filter) && state.filter !== "All") state.filter = "All";

// --- persistence ---
export function persistApps() { store.setJSON(LS.applications, state.applications); }
export function persistChat() { store.setJSON(LS.sessions, state.chatSessions); store.set(LS.active, state.activeChatId); }
export function persistProfile() {
  store.set(LS.profile, state.profile);
  if (!state.profileFile) {
    store.remove(LS.profileFile);
    return true;
  }
  const saved = store.setJSON(LS.profileFile, state.profileFile);
  if (!saved) {
    state.profileFile = null;
    store.remove(LS.profileFile);
  }
  return saved;
}
export function persistView() {
  store.set(LS.view, state.viewMode);
  store.set(LS.selectedId, state.selectedId || "");
  store.set(LS.boardLayout, state.boardLayout);
  store.set(LS.filter, state.filter);
  store.set(LS.sortBy, state.sortBy);
}

// --- lookups ---
export function selectedApp() { return state.applications.find((a) => a.id === state.selectedId) || null; }
export function syncChatContext() {
  const session = activeChat();
  const id = session.contextAppId || "";
  state.chatContextId = state.applications.some((a) => a.id === id) ? id : "";
  if (session.contextAppId !== state.chatContextId) session.contextAppId = state.chatContextId;
  return state.chatContextId;
}
export function setChatContext(id) {
  const session = activeChat();
  session.contextAppId = state.applications.some((a) => a.id === id) ? id : "";
  state.chatContextId = session.contextAppId;
  persistChat();
  return state.chatContextId;
}
export function chatContextApp() {
  const id = syncChatContext();
  return state.applications.find((a) => a.id === id) || null;
}
export function activeChat() {
  let s = state.chatSessions.find((x) => x.id === state.activeChatId);
  if (!s) {
    s = state.chatSessions[0] || { id: uid(), title: "Assistant", createdAt: Date.now(), thread: [], contextAppId: "" };
    if (!state.chatSessions.length) state.chatSessions.push(s);
    state.activeChatId = s.id;
  }
  if (!Object.prototype.hasOwnProperty.call(s, "contextAppId")) s.contextAppId = "";
  return s;
}
export function touch(app) { app.updatedAt = Date.now(); }

// --- bulk selection ---
export function setSelectMode(on) {
  state.selectMode = !!on;
  if (!state.selectMode) state.selectedIds.clear();
}
export function toggleSelected(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
}
// Drop ids that no longer exist (deleted, or filtered out of the current view).
export function pruneSelection() {
  const alive = new Set(state.applications.map((a) => a.id));
  state.selectedIds.forEach((id) => { if (!alive.has(id)) state.selectedIds.delete(id); });
}

// --- formatting ---
export function formatDate(s) {
  if (!s) return "Not set";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
export function sourceFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}
export function isHttpUrl(url) {
  return /^https?:\/\/\S+/i.test((url || "").trim());
}
export function initials(company) {
  return (company || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}
let toastTimer = null;
export function toast(text) {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

// --- board filtering ---
export function filteredApps() {
  const q = state.search.trim().toLowerCase();
  let list = state.applications.filter((a) => state.filter === "All" || a.status === state.filter);
  if (q) {
    list = list.filter((a) => [a.company, a.role, ...(a.sources || []), a.source, a.notes, a.nextAction].join(" ").toLowerCase().includes(q));
  }
  const copy = list.slice();
  copy.sort((a, b) => {
    const sort = state.sortBy || "updated";
    const isDesc = sort.endsWith("-desc") || sort === "applied" || sort === "updated" || sort === "ai";
    const baseSort = sort.replace("-desc", "").replace("-asc", "");

    if (baseSort === "ai") {
      const hasA = a.matchAnalysis ? 1 : 0;
      const hasB = b.matchAnalysis ? 1 : 0;
      const cmp = hasA - hasB;
      if (cmp === 0) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
      return isDesc ? -cmp : cmp;
    }
    if (baseSort === "company") {
      const cmp = (a.company || "").localeCompare(b.company || "");
      return isDesc ? -cmp : cmp;
    }
    if (baseSort === "role") {
      const cmp = (a.role || "").localeCompare(b.role || "");
      return isDesc ? -cmp : cmp;
    }
    if (baseSort === "status") {
      const cmp = (a.status || "").localeCompare(b.status || "");
      return isDesc ? -cmp : cmp;
    }
    if (baseSort === "applied") {
      const cmp = (a.appliedAt || "").localeCompare(b.appliedAt || "");
      return isDesc ? -cmp : cmp;
    }
    if (baseSort === "notes") {
      const cmp = (a.notes || "").localeCompare(b.notes || "");
      return isDesc ? -cmp : cmp;
    }
    const timeA = a.updatedAt || 0;
    const timeB = b.updatedAt || 0;
    return isDesc ? timeB - timeA : timeA - timeB;
  });
  return copy;
}
