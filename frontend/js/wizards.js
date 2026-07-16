// Stepped wizards for adding/editing an application and for the Profile/CV,
// plus the delete confirmation. Shares the modal shell with a step indicator.
"use strict";

import {
  state, $, esc, uid, STATUSES, sourceFromUrl, touch, persistApps, persistProfile, toast,
} from "./state.js";
import { I } from "./icons.js";
import { renderAll } from "./render.js";

// --- modal shell ---
export function openModal(html, small) {
  const modal = $("modal");
  modal.className = "modal" + (small ? " small" : "");
  modal.innerHTML = html;
  $("overlay").classList.add("open");
}
export function closeModal() {
  $("overlay").classList.remove("open");
  $("modal").innerHTML = "";
}

const v = (id) => { const el = $(id); return el ? el.value : ""; };

const LIMITS = {
  company: 50,
  role: 60,
  jobUrl: 250,
  source: 40,
  notes: 700,
  jobText: 30000,
};

function clampText(value, max) {
  const text = String(value || "").trim();
  return max ? text.slice(0, max) : text;
}

function mimeFromExt(ext) {
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "text/plain";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function field(label, id, type, value, placeholder, max) {
  return '<div class="field"><label>' + esc(label) + '</label><input id="f_' + esc(id) + '" type="' + esc(type) + '" value="' + esc(value || "") + '" placeholder="' + esc(placeholder || "") + '"' + (max ? ' maxlength="' + max + '"' : "") + " /></div>";
}

function stepsIndicator(names, current) {
  let html = '<div class="wizard-steps">';
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
export function openApplicationWizard(app) {
  const editing = !!app;
  const draft = {
    company: app?.company || "",
    role: app?.role || "",
    jobSources: (app?.jobSources?.length
      ? app.jobSources
      : (app?.jobUrls?.length ? app.jobUrls : [app?.jobUrl || ""]).map((url, index) => ({
        url,
        source: app?.sources?.[index] || (index === 0 ? app?.source || "" : ""),
      }))).map((entry) => ({ ...entry })),
    status: app?.status || "Saved",
    appliedAt: app?.appliedAt || "",
    notes: app?.notes || "",
    jobText: app?.jobText || "",
  };
  const names = ["Role", "Tracking", "Review"];
  let step = 0;
  let error = "";

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
          field("Company", "company", "text", draft.company, "Acme Inc.", LIMITS.company) +
          field("Role", "role", "text", draft.role, "Product Manager", LIMITS.role) +
          '<div class="field full job-source-group"><div class="job-entry-labels"><label>Job URL</label><label>Source</label></div><div class="job-url-list">' + jobSourceFields + '</div></div>' +
          '<div class="field full"><label>Job description <span class="label-opt">(Optional)</span></label>' +
            '<textarea id="f_jobText" maxlength="' + LIMITS.jobText + '" placeholder="Paste the job description for a deeper AI review. Optional, the analysis also uses the company, role, source and notes you enter.">' + esc(draft.jobText) + "</textarea></div>" +
        "</div>";
    }
    if (step === 1) {
      return '<div class="wizard-title">Tracking details</div><p class="wizard-sub">Where is this application in your pipeline?</p>' +
        '<div class="form-grid">' +
          '<div class="field"><label>Status</label><select id="f_status">' + STATUSES.map((s) => '<option value="' + esc(s) + '"' + (s === draft.status ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>" +
          field("Applied date", "appliedAt", "date", draft.appliedAt, "") +
          '<div class="field full"><label>Notes</label><textarea id="f_notes" maxlength="' + LIMITS.notes + '" placeholder="Contacts, interview notes, salary range, reminders">' + esc(draft.notes) + "</textarea></div>" +
        "</div>";
    }
    // review
    const row = (k, val, muted) => '<div class="review-row"><div class="k">' + esc(k) + '</div><div class="v' + (muted ? " muted" : "") + '">' + esc(val) + "</div></div>";
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
      '<div class="modal-head"><div><h2>' + (editing ? "Edit application" : "Add application") + '</h2><div class="modal-step-label">Step ' + (step + 1) + " of " + names.length + " · " + esc(names[step]) + '</div></div><button class="icon-btn" id="modalClose">' + I.close + "</button></div>" +
      '<div class="modal-body">' + stepsIndicator(names, step) + body() + "</div>" +
      '<div class="modal-foot"><span class="form-msg ' + (error ? "err" : "") + '" id="wizErr">' + esc(error) + "</span>" +
        '<button class="ghost-btn" id="wizCancel">Cancel</button>' +
        (step > 0 ? '<button class="secondary-btn" id="wizBack">Back</button>' : "") +
        (last ? '<button class="primary-btn" id="wizFinish">' + (editing ? "Save changes" : "Add application") + "</button>" : '<button class="primary-btn" id="wizNext">Next</button>') +
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
      if (step === 0 && (!draft.company.trim() || !draft.role.trim())) { error = "Company and role are required."; render(); return; }
      step += 1; error = ""; render();
    });
    const finish = $("wizFinish");
    if (finish) finish.addEventListener("click", () => { readStep(); commit(); });
  }

  function commit() {
    const company = clampText(draft.company, LIMITS.company);
    const role = clampText(draft.role, LIMITS.role);
    if (!company || !role) { step = 0; error = "Company and role are required."; render(); return; }
    const target = app || { id: uid(), createdAt: Date.now(), matchAnalysis: null, coverLetter: "" };
    target.company = company;
    target.role = role;
    target.jobSources = draft.jobSources
      .map((entry) => {
        const url = clampText(entry.url, LIMITS.jobUrl);
        return { url, source: clampText(entry.source, LIMITS.source) || sourceFromUrl(url) };
      })
      .filter((entry) => entry.url || entry.source)
      .filter((entry, index, entries) => entries.findIndex((item) => item.url === entry.url && item.source === entry.source) === index);
    target.jobUrls = target.jobSources.map((entry) => entry.url).filter(Boolean);
    target.sources = target.jobSources.map((entry) => entry.source).filter(Boolean);
    target.jobUrl = target.jobUrls[0] || "";
    target.source = target.sources[0] || sourceFromUrl(target.jobUrl);
    target.status = draft.status;
    target.appliedAt = draft.appliedAt;
    target.nextAction = "";
    target.notes = clampText(draft.notes, LIMITS.notes);
    // Preserve any job description already pasted/fetched (it is edited in the
    // detail view, not in this wizard); draft.jobText carries the existing value.
    target.jobText = clampText(draft.jobText, LIMITS.jobText);
    touch(target);
    if (!app) state.applications.unshift(target);
    state.selectedId = target.id;
    persistApps();
    closeModal();
    renderAll();
    toast(editing ? "Application updated" : "Application added");
  }

  render();
}

// ---------------------------------------------------------------------------
// Profile / CV wizard
// ---------------------------------------------------------------------------
export function openCvWizard(message) {
  const draft = { method: "upload", text: state.profile, file: state.profileFile || null };
  const names = ["Method", "Add CV"];
  let step = 0;

  function readStep() {
    if (step === 1 && draft.method === "paste") {
      draft.text = v("cvText");
      draft.file = null;
    }
  }

  function body() {
    if (step === 0) {
      return '<div class="wizard-title">Add your profile</div><p class="wizard-sub">' + esc(message || "Your CV grounds every AI answer. Choose how to add it.") + "</p>" +
        '<div class="choice-grid">' +
          '<button class="choice-card ' + (draft.method === "upload" ? "active" : "") + '" data-method="upload"><div class="choice-icon">' + I.upload + "</div><strong>Upload a file</strong><div class=\"hint\">.txt, .pdf, or .docx with selectable text</div></button>" +
          '<button class="choice-card ' + (draft.method === "paste" ? "active" : "") + '" data-method="paste"><div class="choice-icon">' + I.type + "</div><strong>Paste text</strong><div class=\"hint\">Copy your CV or write a profile summary</div></button>" +
        "</div>";
    }
    if (draft.method === "upload") {
      return '<div class="wizard-title">Upload your CV</div><p class="wizard-sub">Pick a file to extract text. Stays in your browser.</p>' +
        '<div class="upload-card"><div><strong>Upload CV</strong><div class="hint">Supports .txt, .pdf, .docx</div></div><label class="file-link" id="fileLink" for="cvFile">' + I.doc + 'Choose file</label><input class="visually-hidden-file" type="file" id="cvFile" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></div>' +
        '<div class="file-status" id="cvFileStatus">PDF and Word parsing supports selectable text, not scanned documents.</div>';
    }
    return '<div class="wizard-title">Paste your CV</div><p class="wizard-sub">Paste your CV or a written profile below, then save. Stays in your browser.</p>' +
      '<textarea id="cvText" class="cv-textarea cv-paste-textarea" placeholder="Paste your CV or written profile here">' + esc(draft.text) + "</textarea>";
  }

  function render() {
    const last = step === names.length - 1;
    openModal(
      '<div class="modal-head"><div><h2>Profile / CV</h2><div class="modal-step-label">Step ' + (step + 1) + " of " + names.length + " · " + esc(names[step]) + '</div></div><button class="icon-btn" id="modalClose">' + I.close + "</button></div>" +
      '<div class="modal-body">' + stepsIndicator(names, step) + body() + "</div>" +
      '<div class="modal-foot"><span class="form-msg" id="cvErr"></span>' +
        '<button class="ghost-btn" id="wizCancel">Cancel</button>' +
        (step > 0 ? '<button class="secondary-btn" id="wizBack">Back</button>' : "") +
        (last ? '<button class="primary-btn" id="wizSave">Save profile</button>' : '<button class="primary-btn" id="wizNext">Next</button>') +
      "</div>"
    );
    $("modalClose").addEventListener("click", closeModal);
    $("wizCancel").addEventListener("click", closeModal);
    if (step === 0) {
      document.querySelectorAll(".choice-card").forEach((c) => c.addEventListener("click", () => {
        draft.method = c.dataset.method;
        step = 1;
        render();
      }));
    }
    if (step === 1 && draft.method === "upload") {
      $("cvFile").addEventListener("change", (e) => { 
        const f = e.target.files[0]; 
        if (f) loadCvFile(f); 
        e.target.value = ""; // clear value so same file can be re-uploaded 
      });
    }
    const back = $("wizBack");
    if (back) back.addEventListener("click", () => { readStep(); step -= 1; render(); });
    const next = $("wizNext");
    if (next) next.addEventListener("click", () => { readStep(); step += 1; render(); });
    const save = $("wizSave");
    if (save) save.addEventListener("click", () => {
      readStep();
      state.profile = draft.text;
      state.profileFile = draft.method === "upload" ? draft.file : null;
      const fileSaved = persistProfile();
      closeModal();
      renderAll();
      toast(fileSaved ? "Profile saved" : "Profile text saved. Original file was too large to store.");
    });
  }

  async function loadCvFile(file) {
    const status = $("cvFileStatus");
    const ta = $("cvText");
    const name = file.name || "";
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    if (status) { status.className = "file-status"; status.textContent = "Reading " + name + "..."; }
    let fileRecord = null;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      fileRecord = {
        name,
        type: file.type || mimeFromExt(ext),
        size: file.size || 0,
        dataUrl,
        savedAt: Date.now(),
      };
    } catch (_) {
      fileRecord = null;
    }
    if (ext === ".txt") {
      const reader = new FileReader();
      reader.onload = () => {
        if (ta) ta.value = reader.result || "";
        draft.text = reader.result || "";
        draft.file = fileRecord;
        if (status) { status.textContent = "Loaded " + name + " successfully. Click Save profile to complete."; status.className = "file-status ok"; }
      };
      reader.onerror = () => { if (status) { status.textContent = "Could not read that text file."; status.className = "file-status err"; } };
      reader.readAsText(file);
      return;
    }
    if (ext !== ".pdf" && ext !== ".docx") {
      if (status) { status.textContent = "Unsupported file type. Upload .txt, .pdf, or .docx."; status.className = "file-status err"; }
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const apiBase = location.port === "8000" ? "" : "http://localhost:8000";
      const resp = await fetch(apiBase + "/api/parse-profile-file", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "Could not parse that file.");
      if (ta) ta.value = data.text || "";
      draft.text = data.text || "";
      draft.file = fileRecord;
      if (status) { status.textContent = "Loaded " + (data.filename || name) + " successfully. Click Save profile to complete."; status.className = "file-status ok"; }
    } catch (err) {
      if (status) { status.textContent = err.message || "Could not parse that file."; status.className = "file-status err"; }
    }
  }

  render();
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------
export function openDeleteModal(app) {
  openModal(
    '<div class="modal-head"><h2>Delete application</h2><button class="icon-btn" id="modalClose">' + I.close + "</button></div>" +
    '<div class="modal-body"><p class="hint">Delete ' + esc(app.company) + " - " + esc(app.role) + "? This only removes the local browser record.</p></div>" +
    '<div class="modal-foot"><button class="ghost-btn" id="wizCancel">Cancel</button><button class="danger-btn" id="confirmDelete">' + I.trash + "Delete</button></div>",
    true
  );
  $("modalClose").addEventListener("click", closeModal);
  $("wizCancel").addEventListener("click", closeModal);
  $("confirmDelete").addEventListener("click", () => {
    state.applications = state.applications.filter((a) => a.id !== app.id);
    state.selectedId = state.applications[0]?.id || "";
    state.viewMode = "board";
    persistApps();
    closeModal();
    renderAll();
    toast("Application deleted");
  });
}
