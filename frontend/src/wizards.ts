// Application wizard, shared modal shell, and delete confirmation.
"use strict";

import {
  state, $, esc, appId, STATUSES, sourceFromUrl, touch, persistApps,
} from "./state.js";
import { I } from "./icons.js";
import { renderAll } from "./render.js";
import { applicationSaveFeedback, deletionFeedback } from "./operation-notifications.js";
import { INPUT_LIMITS, hasDisallowedControl, isSafeJobUrl, isValidDate, toDateInput } from "./input-validation.js";

// --- modal shell ---
// Wizards re-render through openModal on every step, so the element to return
// focus to is captured only when the dialog first opens.
let returnFocus: { el: HTMLElement | null; id: string } | null = null;

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])';

function modalFocusables(): HTMLElement[] {
  return Array.from($("modal").querySelectorAll(FOCUSABLE) as NodeListOf<HTMLElement>)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function isModalOpen(): boolean {
  return $("overlay").classList.contains("open");
}

export function openModal(html, small = false) {
  const modal = $("modal");
  if (!isModalOpen()) {
    const active = document.activeElement as HTMLElement | null;
    returnFocus = { el: active, id: active?.id || "" };
  }
  modal.className = "modal" + (small ? " small" : "");
  modal.innerHTML = html;
  const title = modal.querySelector("h2");
  if (title) { title.id = "modalTitle"; modal.setAttribute("aria-labelledby", "modalTitle"); }
  if (modal.querySelector("#modalDescription")) modal.setAttribute("aria-describedby", "modalDescription");
  else modal.removeAttribute("aria-describedby");
  modal.querySelector("#modalClose")?.setAttribute("aria-label", "Close dialog");
  $("overlay").classList.add("open");
  // First field, else first body control, else Cancel — never a destructive default.
  const target = modal.querySelector(".modal-body input:not([type=file]):not(:disabled), .modal-body textarea, .modal-body select")
    || modal.querySelector(".modal-body button:not(:disabled)")
    || modal.querySelector("#wizCancel")
    || modal;
  (target as HTMLElement).focus();
}

export function openConfirmation(html: string) {
  openModal(html, true);
  $("modal").classList.add("confirmation");
}

export function closeModal() {
  if (!isModalOpen()) return;
  $("overlay").classList.remove("open");
  $("modal").innerHTML = "";
  $("modal").removeAttribute("aria-labelledby");
  $("modal").removeAttribute("aria-describedby");
  const saved = returnFocus;
  returnFocus = null;
  // Callers usually re-render right after closing, which can replace the
  // original trigger; fall back to an element with the same id, then the page.
  requestAnimationFrame(() => {
    const el = saved?.el?.isConnected ? saved.el : (saved?.id ? $(saved.id) : null);
    (el || $("content"))?.focus({ preventScroll: true });
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !isModalOpen()) return;
  const items = modalFocusables();
  if (!items.length) { e.preventDefault(); $("modal").focus(); return; }
  const first = items[0], last = items[items.length - 1];
  if (!$("modal").contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && (document.activeElement === first || document.activeElement === $("modal"))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

const v = (id) => { const el = $(id); return el ? el.value : ""; };

const LIMITS = INPUT_LIMITS;

const OPTIONAL = ' <span class="label-opt">(Optional)</span>';

// `required` fields get aria-required, and aria-invalid when `invalid` is set.
function field(label, id, type, value, placeholder, max = 0, opts: { required?: boolean; invalid?: boolean } = {}) {
  return '<div class="field"><label for="f_' + esc(id) + '">' + esc(label) + (opts.required ? "" : OPTIONAL) + '</label><input id="f_' + esc(id) + '" type="' + esc(type) + '" value="' + esc(value || "") + '" placeholder="' + esc(placeholder || "") + '"' + (max ? ' maxlength="' + max + '"' : "") +
    (opts.required ? ' aria-required="true"' : "") + (opts.invalid ? ' aria-invalid="true" aria-describedby="wizErr"' : "") + " /></div>";
}


function stepsIndicator(names, current) {
  // Visual only: the dialog header already announces "Step n of m".
  let html = '<div class="wizard-steps" aria-hidden="true">';
  names.forEach((name, i) => {
    const cls = i === current ? "active" : i < current ? "done" : "";
    html += '<div class="wizard-step ' + cls + '">' +
      '<div class="wizard-dot">' + (i < current ? I.check : String(i + 1)) + "</div>" +
      '<div class="wizard-step-name">' + esc(name) + "</div></div>";
    if (i < names.length - 1) html += '<div class="wizard-line' + (i < current ? " done" : "") + '"></div>';
  });
  return html + "</div>";
}

// ---------------------------------------------------------------------------
// Application wizard
// ---------------------------------------------------------------------------
export function openApplicationWizard(app = null) {
  const editing = !!app;
  const draft = {
    company: app?.company || "",
    role: app?.role || "",
    jobSources: (app?.jobSources?.length ? app.jobSources : [{ url: "", source: "" }])
      .map((entry) => ({ ...entry })),
    status: app?.status || "Saved",
    appliedAt: toDateInput(app?.appliedAt),
    notes: app?.notes || "",
    jobText: app?.jobText || "",
  };
  const names = ["Role", "Tracking", "Review"];
  let step = 0;
  let error = "";
  // Which required fields the last Next/Save attempt found empty.
  let missing = { company: false, role: false };

  function readStep() {
    if (step === 0) {
      draft.company = v("f_company"); draft.role = v("f_role");
      draft.jobSources = Array.from(document.querySelectorAll(".job-entry-row"), (row) => ({
        url: row.querySelector(".job-url-input")?.value || "",
        source: row.querySelector(".job-source-input")?.value || "",
      }));
      draft.jobText = v("f_jobText");
    } else if (step === 1) {
      draft.status = v("f_status"); draft.appliedAt = v("f_appliedAt"); draft.notes = v("f_notes");
    }
  }

  function body() {
    if (step === 0) {
      const jobSourceFields = draft.jobSources.map((entry, index) =>
        '<div class="job-entry-row">' +
          '<div class="job-url-row"><input class="job-url-input" id="f_jobUrl_' + index + '" data-job-index="' + index + '" type="url" value="' + esc(entry.url) + '" placeholder="https://..." maxlength="' + LIMITS.jobUrl + '" aria-label="Job URL ' + (index + 1) + '" />' +
            (index === 0
              ? '<button class="job-url-action add" type="button" id="addJobUrl" aria-label="Add another job URL and source" title="Add another URL and source">' + I.plus + '</button>'
              : '<button class="job-url-action remove" type="button" data-remove-url="' + index + '" aria-label="Remove job URL and source ' + (index + 1) + '" title="Remove URL and source">' + I.close + '</button>') +
          '</div>' +
          '<input class="job-source-input" id="f_source_' + index + '" type="text" value="' + esc(entry.source) + '" placeholder="LinkedIn, company site" maxlength="' + LIMITS.source + '" aria-label="Source ' + (index + 1) + '" />' +
        '</div>'
      ).join("");
      return '<div class="wizard-title">Role basics</div><p class="wizard-sub">Company and role are required. You can add everything else later.</p>' +
        '<div class="form-grid">' +
          field("Company", "company", "text", draft.company, "Acme Inc.", LIMITS.company, { required: true, invalid: missing.company }) +
          field("Role", "role", "text", draft.role, "Product Manager", LIMITS.role, { required: true, invalid: missing.role }) +
          '<div class="field full job-source-group"><div class="job-entry-labels" aria-hidden="true"><span>Job URL' + OPTIONAL + '</span><span>Source' + OPTIONAL + '</span></div><div class="job-url-list">' + jobSourceFields + '</div></div>' +
          '<div class="field full"><label for="f_jobText">Job description' + OPTIONAL + '</label>' +
            '<textarea id="f_jobText" class="job-desc-input" maxlength="' + LIMITS.jobText + '" aria-describedby="jobTextHint" placeholder="Paste the full posting, including responsibilities and qualifications">' + esc(draft.jobText) + "</textarea>" +
            '<p class="hint" id="jobTextHint">AI analysis needs the qualifications from the posting.</p></div>' +
        "</div>";
    }
    if (step === 1) {
      return '<div class="wizard-title">Tracking details</div><p class="wizard-sub">Where is this application in your pipeline?</p>' +
        '<div class="form-grid">' +
          '<div class="field"><label for="f_status">Status</label><select id="f_status">' + STATUSES.map((s) => '<option value="' + esc(s) + '"' + (s === draft.status ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>" +
          field("Applied date", "appliedAt", "date", draft.appliedAt, "") +
          '<div class="field full"><label for="f_notes">Notes' + OPTIONAL + '</label><textarea id="f_notes" maxlength="' + LIMITS.notes + '" placeholder="Contacts, interview notes, salary range, reminders">' + esc(draft.notes) + "</textarea></div>" +
        "</div>";
    }
    // review
    const row = (k, val, muted = false) => '<div class="review-row"><div class="k">' + esc(k) + '</div><div class="v' + (muted ? " muted" : "") + '">' + esc(val) + "</div></div>";
    return '<div class="wizard-title">Review</div><p class="wizard-sub">Confirm the details, then ' + (editing ? "save changes" : "add the application") + ".</p>" +
      '<div class="review-list">' +
        row("Company", draft.company || "—", !draft.company) +
        row("Role", draft.role || "—", !draft.role) +
        row("Status", draft.status) +
        row("Applied", draft.appliedAt || "Not set", !draft.appliedAt) +
        (draft.jobSources.some((entry) => entry.url.trim() || entry.source.trim())
          ? draft.jobSources.filter((entry) => entry.url.trim() || entry.source.trim()).map((entry, index) =>
            row("Job URL " + (index + 1), entry.url || "Not set", !entry.url) +
            row("Source " + (index + 1), entry.source || sourceFromUrl(entry.url) || "Not set", !entry.source && !sourceFromUrl(entry.url))
          ).join("")
          : row("Job URL", "Not set", true) + row("Source", "Not set", true)) +
        row("Job description", draft.jobText.trim() ? "Added" : "Not set", !draft.jobText.trim()) +
      "</div>";
  }

  function render() {
    const last = step === names.length - 1;
    openModal(
      '<div class="modal-head"><div><h2>' + (editing ? "Edit application" : "Add application") + '</h2><div class="modal-step-label">Step ' + (step + 1) + " of " + names.length + " · " + esc(names[step]) + '</div></div><button class="icon-btn" id="modalClose" type="button" aria-label="Close application dialog" title="Close">' + I.close + "</button></div>" +
      '<div class="modal-body">' + stepsIndicator(names, step) + body() + "</div>" +
      '<div class="modal-foot"><span class="form-msg ' + (error ? "err" : "") + '" id="wizErr" role="alert">' + esc(error) + "</span>" +
        '<button class="ghost-btn" id="wizCancel" type="button">Cancel</button>' +
        (step > 0 ? '<button class="secondary-btn" id="wizBack" type="button">Back</button>' : "") +
        (last ? '<button class="primary-btn" id="wizFinish" type="button">' + (editing ? "Save changes" : "Add application") + "</button>" : '<button class="primary-btn" id="wizNext" type="button">Next</button>') +
      "</div>"
    );
    $("modalClose").addEventListener("click", closeModal);
    $("wizCancel").addEventListener("click", closeModal);
    if (step === 0) {
      document.querySelectorAll(".job-url-input").forEach((urlInput) => urlInput.addEventListener("input", () => {
        const sourceInput = $("f_source_" + urlInput.dataset.jobIndex);
        if (sourceInput && !sourceInput.value.trim()) sourceInput.value = sourceFromUrl(urlInput.value);
      }));
      const addUrl = $("addJobUrl");
      if (addUrl) addUrl.addEventListener("click", () => {
        readStep();
        if (draft.jobSources.length >= 20) {
          error = "Add no more than 20 job sources.";
          $("wizErr").textContent = error;
          return;
        }
        draft.jobSources.push({ url: "", source: "" });
        render();
        const inputs = document.querySelectorAll(".job-url-input");
        inputs[inputs.length - 1]?.focus();
      });
      document.querySelectorAll("[data-remove-url]").forEach((button) => button.addEventListener("click", () => {
        readStep();
        draft.jobSources.splice(Number(button.dataset.removeUrl), 1);
        if (!draft.jobSources.length) draft.jobSources.push({ url: "", source: "" });
        render();
      }));
    }
    const back = $("wizBack");
    if (back) back.addEventListener("click", () => { readStep(); step -= 1; error = ""; render(); });
    const next = $("wizNext");
    if (next) next.addEventListener("click", () => {
      readStep();
      if (step === 0 && !requiredFilled()) return;
      step += 1; error = ""; render();
    });
    const finish = $("wizFinish");
    if (finish) finish.addEventListener("click", () => { readStep(); commit(); });
    // Enter in a single-line field moves forward, as it would in a form.
    $("modal").querySelectorAll(".modal-body input").forEach((input) => input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      ($("wizNext") || $("wizFinish"))?.click();
    }));
    // Clear a field's error state as soon as it is filled in.
    ["company", "role"].forEach((key) => $("f_" + key)?.addEventListener("input", (e) => {
      if (!e.target.value.trim()) return;
      e.target.removeAttribute("aria-invalid");
      missing[key] = false;
      if (!missing.company && !missing.role && error) { error = ""; $("wizErr").textContent = ""; $("wizErr").classList.remove("err"); }
    }));
  }

  // Re-renders with the empty required fields marked and focuses the first one.
  function requiredFilled() {
    missing = { company: !draft.company.trim(), role: !draft.role.trim() };
    if (!missing.company && !missing.role) return true;
    error = "Company and role are required.";
    render();
    $(missing.company ? "f_company" : "f_role")?.focus();
    return false;
  }

  function commit() {
    const company = draft.company.trim();
    const role = draft.role.trim();
    if (!company || !role) { step = 0; requiredFilled(); return; }
    const fields = [
      [company, LIMITS.company], [role, LIMITS.role], [draft.notes, LIMITS.notes], [draft.jobText, LIMITS.jobText],
      ...draft.jobSources.flatMap((entry) => [[entry.url, LIMITS.jobUrl], [entry.source, LIMITS.source]]),
    ] as Array<[string, number]>;
    if (fields.some(([value, max]) => value.length > max || hasDisallowedControl(value))) {
      error = "A field is too long or contains invalid control characters.";
      render();
      return;
    }
    if (draft.jobSources.length > 20 || draft.jobSources.some((entry) => entry.url.trim() && !isSafeJobUrl(entry.url.trim()))) {
      error = "Enter valid HTTP or HTTPS job URLs (up to 20).";
      step = 0;
      render();
      return;
    }
    if (!(STATUSES as readonly string[]).includes(draft.status) || !isValidDate(draft.appliedAt)) {
      error = "Choose a valid status and applied date.";
      step = 1;
      render();
      return;
    }
    const target = app || { id: appId(), createdAt: Date.now(), matchAnalysis: null, analysisMeta: null };
    target.company = company;
    target.role = role;
    target.jobSources = draft.jobSources
      .map((entry) => {
        const url = entry.url.trim();
        return { url, source: entry.source.trim() || sourceFromUrl(url) };
      })
      .filter((entry) => entry.url || entry.source)
      .filter((entry, index, entries) => entries.findIndex((item) => item.url === entry.url && item.source === entry.source) === index);
    target.status = draft.status;
    target.appliedAt = draft.appliedAt;
    target.notes = draft.notes.trim();
    // Preserve any job description already pasted; draft.jobText carries the
    // existing value while editing.
    target.jobText = draft.jobText.trim();
    touch(target);
    if (!app) state.applications.unshift(target);
    state.selectedId = target.id;
    const saved = persistApps();
    closeModal();
    renderAll();
    applicationSaveFeedback(saved, editing);
  }

  render();
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------
export function openDeleteModal(app) {
  openDeleteApplications([app]);
}

// Confirms deletion of one or many applications. `onDeleted` lets the caller
// (e.g. bulk select mode) clean up its own state after the records are gone.
export function openDeleteApplications(apps, onDeleted = () => {}) {
  const list = (apps || []).filter(Boolean);
  if (!list.length) return;
  const many = list.length > 1;
  const preview = many
    ? '<ul class="delete-list">' + list.slice(0, 6).map((a) =>
        "<li>" + esc(a.company || "Untitled") + " - " + esc(a.role || "Role not set") + "</li>").join("") +
      (list.length > 6 ? '<li class="muted">and ' + (list.length - 6) + " more…</li>" : "") + "</ul>"
    : '<p class="confirmation-target">' + esc(list[0].company || "Untitled") + " — " + esc(list[0].role || "Role not set") + "</p>";
  openConfirmation(
    '<div class="modal-head"><h2>Delete ' + (many ? list.length + " applications" : "application") + '?</h2><button class="icon-btn" id="modalClose" type="button" aria-label="Close delete application dialog" title="Close">' + I.close + "</button></div>" +
    '<div class="modal-body"><p class="confirmation-description" id="modalDescription">This removes the local ' + (many ? "records" : "record") + " and cannot be undone.</p>" + preview + "</div>" +
    '<div class="modal-foot"><button class="ghost-btn" id="wizCancel" type="button">Cancel</button><button class="danger-btn" id="confirmDelete" type="button">' + I.trash + "Delete" + (many ? " " + list.length : "") + "</button></div>"
  );
  $("modalClose").addEventListener("click", closeModal);
  $("wizCancel").addEventListener("click", closeModal);
  $("confirmDelete").addEventListener("click", () => {
    const ids = new Set(list.map((a) => a.id));
    state.applications = state.applications.filter((a) => !ids.has(a.id));
    if (ids.has(state.selectedId)) state.selectedId = state.applications[0]?.id || "";
    state.viewMode = "board";
    const saved = persistApps();
    closeModal();
    if (onDeleted) onDeleted();
    renderAll();
    deletionFeedback(saved, list.length);
  });
}
