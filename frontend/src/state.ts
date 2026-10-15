// Shared mutable state + small pure helpers. Every module mutates `state.*`
// in place (ES modules can't reassign an imported binding from elsewhere).
"use strict";

import { store, LS } from "./store.js";
import { BOARD_STATUSES, STATUSES } from "./types.js";
import { INPUT_LIMITS, isSafeJobUrl } from "./input-validation.js";
import type { AnalysisMetadata, AppState, ApplicationStatus, JobApplication, JobSource, LegacyMatchAnalysis, MatchAnalysis, PreviousStructuredAnalysis, ProfileFile } from "./types.js";

export { BOARD_STATUSES, STATUSES };

export const $ = (id: string): any => document.getElementById(id);

// Applications carry a human-readable id (AP-8K2P-9QZ4) because it is exported
// to Excel and read by people. Crockford's alphabet avoids ambiguous letters.
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const APP_ID_RE = /^AP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

function idFromBytes(bytes: Uint8Array): string {
  let bits = "";
  for (let i = 0; i < 5; i++) bits += (bytes[i] & 255).toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < 40; i += 5) out += ID_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return "AP-" + out.slice(0, 4) + "-" + out.slice(4, 8);
}

export function appId() {
  const bytes = new Uint8Array(5);
  (globalThis.crypto?.getRandomValues)
    ? globalThis.crypto.getRandomValues(bytes)
    : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  return idFromBytes(bytes);
}

function normalizeAppId(raw: unknown): string {
  const value = String(raw || "").trim();
  return APP_ID_RE.test(value) ? value : appId();
}
export function esc(s: unknown): string {
  // Used in both text and quoted attributes. Text-node serialization alone
  // leaves quotes intact and lets imported values break out of attributes.
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]!));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const timestamp = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};
const stringArray = (value: unknown): string[] | null => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;

function withinAnalysisBudget(value: unknown): boolean {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let textLength = 0;
  const visit = (part: unknown, depth: number): boolean => {
    if (++nodes > 1_000 || depth > 8) return false;
    if (typeof part === "string") { textLength += part.length; return textLength <= 200_000; }
    if (!isRecord(part)) return true;
    if (seen.has(part)) return false;
    seen.add(part);
    if (Array.isArray(part) && part.length > 100) return false;
    return Object.values(part).every((entry) => visit(entry, depth + 1));
  };
  return visit(value, 0);
}

function normalizeLegacyAnalysis(value: Record<string, unknown>): LegacyMatchAnalysis | null {
  if (!isRecord(value) || typeof value.summary !== "string" || typeof value.overall_recommendation !== "string") return null;
  if (!Array.isArray(value.matched_requirements) || !value.matched_requirements.every((item) => isRecord(item) && typeof item.requirement === "string" && typeof item.evidence === "string")) return null;
  if (!Array.isArray(value.missing_or_weak) || !value.missing_or_weak.every((item) => isRecord(item) && typeof item.requirement === "string" && ["high", "medium", "low"].includes(String(item.severity)) && typeof item.suggestion === "string")) return null;
  if (!Array.isArray(value.ats_keywords) || !value.ats_keywords.every((item) => isRecord(item) && typeof item.keyword === "string" && typeof item.present === "boolean")) return null;
  if (!Array.isArray(value.resume_bullets) || !value.resume_bullets.every((item) => isRecord(item) && typeof item.target === "string" && typeof item.bullet === "string")) return null;
  if (!stringArray(value.highlight_in_application)) return null;
  return value as unknown as LegacyMatchAnalysis;
}

function normalizeAnalysis(value: unknown): MatchAnalysis | PreviousStructuredAnalysis | LegacyMatchAnalysis | null {
  if (!isRecord(value) || !withinAnalysisBudget(value)) return null;
  if (value.schema_version !== 2 && value.schema_version !== 3) return normalizeLegacyAnalysis(value);
  if (!isRecord(value.input_assessment) || !["limited", "adequate"].includes(String(value.input_assessment.status)) || typeof value.input_assessment.explanation !== "string") return null;
  if (typeof value.overall_assessment !== "string" || !Array.isArray(value.requirements) || !value.requirements.length) return null;
  const statuses = ["verified", "partial", "not_found", "unknown", "contradicted"];
  const priorities = ["required", "preferred", "unspecified"];
  if (!value.requirements.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.requirement === "string" && priorities.includes(String(item.priority)) && typeof item.category === "string" && statuses.includes(String(item.status)) && typeof item.job_evidence === "string" && (item.profile_evidence === null || typeof item.profile_evidence === "string") && typeof item.explanation === "string")) return null;
  if (!Array.isArray(value.eligibility_conditions) || !value.eligibility_conditions.every((item) => isRecord(item) && typeof item.requirement_id === "string" && typeof item.condition === "string" && statuses.includes(String(item.status)) && typeof item.warning === "string")) return null;
  if (value.schema_version === 2) {
    if (!Array.isArray(value.improvements) || !value.improvements.every((item) => isRecord(item) && typeof item.action === "string" && typeof item.reason === "string" && stringArray(item.related_requirement_ids) !== null)) return null;
    return value as unknown as PreviousStructuredAnalysis;
  }
  return value as unknown as MatchAnalysis;
}

function normalizeAnalysisMeta(value: unknown): AnalysisMetadata | null {
  if (!isRecord(value) || ![1, 2, 3].includes(Number(value.schemaVersion)) || (value.source !== "gemini" && value.source !== "imported")) return null;
  if (value.inputFingerprint !== null && typeof value.inputFingerprint !== "string") return null;
  return { schemaVersion: value.schemaVersion as 1 | 2 | 3, source: value.source, inputFingerprint: value.inputFingerprint as string | null, createdAt: timestamp(value.createdAt, Date.now()) };
}

function normalizeProfileFile(value: unknown): ProfileFile | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string" || typeof value.size !== "number" || typeof value.dataUrl !== "string") return null;
  if (value.name.length > 255 || value.type.length > 120 || !Number.isFinite(value.size) || value.size < 0 || value.size > INPUT_LIMITS.storedCvBytes || value.dataUrl.length > Math.ceil(INPUT_LIMITS.storedCvBytes * 4 / 3) + 200) return null;
  return value as unknown as ProfileFile;
}

export function normalizeApps(items: unknown): JobApplication[] {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set<string>();
  return items.filter(isRecord).filter((a) => [a.company, a.role, a.jobText, a.notes].some((value) => typeof value === "string" && value.trim()) || Array.isArray(a.jobSources)).map((a): JobApplication => {
    const jobSources = (Array.isArray(a.jobSources) ? a.jobSources : [])
      .filter(isRecord)
      .map((entry): JobSource => ({
        url: text(entry.url).trim(),
        source: text(entry.source).trim(),
      }))
      .filter((entry) => entry.url || entry.source);
    const status = typeof a.status === "string" && (STATUSES as readonly string[]).includes(a.status) ? a.status as ApplicationStatus : "Saved";
    const now = Date.now();
    let id = normalizeAppId(a.id);
    while (seenIds.has(id)) id = appId();
    seenIds.add(id);
    return ({
      id,
      company: text(a.company),
      role: text(a.role),
      jobSources,
      status,
      appliedAt: text(a.appliedAt),
      notes: text(a.notes),
      jobText: text(a.jobText),
      matchAnalysis: normalizeAnalysis(a.matchAnalysis),
      analysisMeta: normalizeAnalysisMeta(a.analysisMeta),
      createdAt: timestamp(a.createdAt, now),
      updatedAt: timestamp(a.updatedAt, now),
    });
  });
}

function applicationIdentityKeys(app: JobApplication): string[] {
  const keys: string[] = [];
  if (app.id) keys.push("id:" + String(app.id).trim());
  const urls = app.jobSources.map((entry) => entry.url)
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
    const canonicalText = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    // Excel writes dates back as display text ("Jul 17, 2026") while saved
    // records hold "2026-07-17", so compare a canonical form or the same
    // application re-imported would look like a new one.
    const day = (value: unknown) => {
      const raw = canonicalText(value);
      if (!raw) return "";
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw;
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    };
    const company = canonicalText(app.company);
    const role = canonicalText(app.role);
    if (company || role) keys.push("record:" + company + "|" + role + "|" + day(app.appliedAt));
  }
  return keys;
}

export function mergeUniqueApplications(existing: JobApplication[], imported: JobApplication[]) {
  const seen = new Set<string>();
  const applications = existing.slice();
  let skipped = 0;
  let added = 0;
  existing.forEach((app) => applicationIdentityKeys(app).forEach((key) => seen.add(key)));
  imported.forEach((app) => {
    const keys = applicationIdentityKeys(app);
    if (keys.some((key) => seen.has(key))) {
      skipped++;
      return;
    }
    keys.forEach((key) => seen.add(key));
    applications.push(app);
    added++;
  });
  return { applications, added, skipped };
}

const rawView = store.get(LS.view, "board") ?? "board";
const rawFilter = store.get(LS.filter, "All") ?? "All";
const rawSort = store.get(LS.sortBy, "updated") ?? "updated";
const applicationsRead = store.readJSON<unknown>(LS.applications, []);
export let applicationLoadIssue = "error" in applicationsRead
  ? applicationsRead.error
  : applicationsRead.found && !Array.isArray(applicationsRead.value) ? "unsupported" : null;
export const state: AppState = {
  profile: store.get(LS.profile, ""),
  profileFile: normalizeProfileFile(store.getJSON(LS.profileFile, null)),
  applications: [],
  selectedId: "",
  viewMode: (["board", "detail"] as const).includes(rawView as AppState["viewMode"]) ? rawView as AppState["viewMode"] : "board",
  filter: rawFilter === "All" || (STATUSES as readonly string[]).includes(rawFilter) ? rawFilter as AppState["filter"] : "All",
  search: "",
  sortBy: /^(updated|ai|company|role|status|applied|notes)(-asc|-desc)?$/.test(rawSort) ? rawSort : "updated",
  boardLayout: store.get(LS.boardLayout, "kanban") === "table" ? "table" : "kanban",
  tablePage: 1,
  // Bulk-select mode for the board/table; deliberately not persisted so a
  // reload always comes back in normal browsing mode.
  selectMode: false,
  selectedIds: new Set<string>(),
};

// Normalize persisted applications before rendering them.
state.applications = normalizeApps(applicationsRead.value);

// Restore the persisted view/selection, falling back sanely if it's stale.
const savedSel = store.get(LS.selectedId, "");
state.selectedId = state.applications.some((a) => a.id === savedSel) ? savedSel : (state.applications[0]?.id || "");
if (!["board", "detail"].includes(state.viewMode)) state.viewMode = "board";
if (state.viewMode === "detail" && !state.selectedId) state.viewMode = "board";
if (state.filter !== "All" && !STATUSES.includes(state.filter)) state.filter = "All";

// --- persistence ---
export function persistApps(replaceInvalidBackup = false): boolean {
  if (applicationLoadIssue && applicationLoadIssue !== "unavailable" && !replaceInvalidBackup) return false;
  const saved = store.setJSON(LS.applications, state.applications);
  if (saved) applicationLoadIssue = null;
  return saved;
}
export function persistProfile(): { textSaved: boolean; fileSaved: boolean } {
  const textSaved = store.set(LS.profile, state.profile);
  if (!state.profileFile) {
    const fileSaved = store.remove(LS.profileFile);
    return { textSaved, fileSaved };
  }
  return { textSaved, fileSaved: store.setJSON(LS.profileFile, state.profileFile) };
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
export function touch(app: JobApplication): void { app.updatedAt = Date.now(); }

// --- bulk selection ---
export function setSelectMode(on: boolean): void {
  state.selectMode = !!on;
  if (!state.selectMode) state.selectedIds.clear();
}
export function toggleSelected(id: string): void {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
}
// Drop ids that no longer exist (deleted, or filtered out of the current view).
export function pruneSelection() {
  const alive = new Set(state.applications.map((a) => a.id));
  state.selectedIds.forEach((id) => { if (!alive.has(id)) state.selectedIds.delete(id); });
}

// --- formatting ---
export function formatDate(s: string | number): string {
  if (!s) return "Not set";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
export function sourceFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
}
export function isHttpUrl(url: string): boolean {
  return isSafeJobUrl(url);
}
// --- board filtering ---
export function filteredApps() {
  const q = state.search.trim().toLowerCase();
  let list = state.applications.filter((a) => state.filter === "All" || a.status === state.filter);
  if (q) {
    list = list.filter((a) => [a.company, a.role, ...a.jobSources.map((entry) => entry.source), a.notes].join(" ").toLowerCase().includes(q));
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
