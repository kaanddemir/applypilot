// Profile dialog: manage the CV used for job analysis. Opened from the app menu.
"use strict";

import { state, $, esc, persistProfile } from "./state.js";
import { I } from "./icons.js";
import { renderAll } from "./render.js";
import { openModal, openConfirmation, closeModal, isModalOpen } from "./wizards.js";
import { cvDeleteFeedback, cvFileFailureFeedback, cvSaveFeedback } from "./operation-notifications.js";
import { INPUT_LIMITS, hasDisallowedControl, isSafeProfileDataUrl } from "./input-validation.js";
import { notify } from "./notifications.js";

let cvEditorSession = 0;

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

function fileKind(file) {
  const name = (file?.name || "").toLowerCase();
  const type = (file?.type || "").toLowerCase();
  if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (type.includes("wordprocessingml") || name.endsWith(".docx")) return "docx";
  if (type.startsWith("text/") || name.endsWith(".txt")) return "text";
  return "unknown";
}

function formatBytes(size) {
  const n = Number(size || 0);
  if (!n) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// Display only: keeps the saved text's line breaks (collapsing them made long
// CVs one unreadable paragraph) and just squeezes runs of blank lines.
function displayText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderRawText(rawText) {
  const text = displayText(rawText);
  if (!text) return '<p class="cv-empty-text">No extracted text saved.</p>';
  return '<div class="cv-plain-text cv-modal-preview" dir="auto" tabindex="0" aria-label="Extracted CV text">' + esc(text) + '</div>';
}

function renderOriginalFile(rawText) {
  const file = state.profileFile;
  const kind = fileKind(file);
  const safeOriginal = !!file?.dataUrl && (
    kind === "pdf" && isSafeProfileDataUrl(file.dataUrl, "pdf") ||
    kind === "docx" && isSafeProfileDataUrl(file.dataUrl, "docx") ||
    kind === "text"
  );
  if (!safeOriginal) {
    return '<div class="cv-file-original-view">' +
      '<div class="cv-file-summary">' +
      '<div class="cv-file-summary-icon">' + I.doc + '</div>' +
      '<strong>Original file not available</strong>' +
      '<p>This profile was saved as text only, or it was created before original-file previews were stored.</p>' +
      '</div>' +
    '</div>';
  }
  if (kind === "pdf") {
    return '<iframe class="cv-file-frame" title="Original CV file" src="' + esc(file.dataUrl + "#view=FitH") + '"></iframe>';
  }
  if (kind === "text") {
    return '<pre class="cv-preview cv-modal-preview" dir="auto" tabindex="0" aria-label="CV text file">' + esc(rawText) + '</pre>';
  }
  const meta = [file.name, formatBytes(file.size)].filter(Boolean).join(" · ");
  return '<div class="cv-file-original-view">' +
    '<div class="cv-file-summary">' +
      '<div class="cv-file-summary-icon">' + I.doc + '</div>' +
      '<strong>' + esc(file.name || "Original CV file") + '</strong>' +
      '<p>' + esc(meta || "DOCX file saved locally") + '</p>' +
      '<p class="hint">Word documents cannot be previewed reliably in the browser.</p>' +
    '</div>' +
    '<a class="secondary-btn cv-file-download" href="' + esc(file.dataUrl) + '" download="' + esc(file.name || "profile.docx") + '">' + I.download + 'Download original</a>' +
  '</div>';
}

function renderCvModal(onBack: () => void = openProfileModal) {
  const rawText = state.profile.trim();
  const file = state.profileFile;
  const kind = fileKind(file);
  const hasOriginal = !!file?.dataUrl && (
    kind === "text" ||
    kind === "pdf" && isSafeProfileDataUrl(file.dataUrl, "pdf") ||
    kind === "docx" && isSafeProfileDataUrl(file.dataUrl, "docx")
  );
  const viewContentHtml = hasOriginal ? renderOriginalFile(rawText) : renderRawText(rawText);

  const modalHtml = 
    '<div class="modal-head">' +
      '<div>' +
        '<h2>CV Preview</h2>' +
      '</div>' +
      '<button class="icon-btn" id="modalClose" type="button" aria-label="Close CV preview" title="Close">' + I.close + '</button>' +
    '</div>' +
    '<div class="modal-body cv-modal-body">' +
      '<div class="cv-modal-content">' +
        viewContentHtml +
      '</div>' +
    '</div>';

  openModal(modalHtml);
  const mEl = $("modal");
  if (mEl) {
    mEl.classList.add("large-modal");
    if (hasOriginal && kind === "pdf") mEl.classList.add("pdf-preview-modal");
  }

  $("modalClose").addEventListener("click", onBack);
}

export function openProfileModal() {
  const session = ++cvEditorSession;
  const existingText = state.profile;
  const existingFile = state.profileFile;
  let method = existingFile ? "upload" : "paste";
  let pasteText = existingFile ? "" : existingText;
  let uploadText = existingFile ? existingText : "";
  let uploadFile = existingFile || null;
  let originalFileOmitted = false;
  const upload = {
    phase: existingFile && existingText.trim() ? "ready" : "idle",
    name: existingFile?.name || "",
    size: existingFile?.size || 0,
    message: "",
  };

  const formatSize = (bytes) => {
    const size = Number(bytes || 0);
    if (!size) return "";
    if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  };

  function rememberText() {
    const input = document.getElementById("cvText") as HTMLTextAreaElement | null;
    if (input) pasteText = input.value;
  }

  function pasteError() {
    if (pasteText.length > INPUT_LIMITS.profile) return "CV text is too long. Maximum is 30,000 characters.";
    if (hasDisallowedControl(pasteText)) return "CV text contains invalid control characters.";
    return "";
  }

  function canSave() {
    if (method === "upload") return upload.phase === "ready" && !!uploadText.trim();
    return !!pasteText.trim() && !pasteError();
  }

  function fileChip() {
    if (!upload.name) return "";
    const ext = upload.name.includes(".") ? upload.name.slice(upload.name.lastIndexOf(".") + 1).toUpperCase() : "FILE";
    const icon = upload.phase === "extracting" ? '<span class="spinner" aria-hidden="true"></span>'
      : upload.phase === "ready" ? I.check : upload.phase === "error" ? I.close : I.doc;
    return '<div class="file-chip ' + upload.phase + '">' +
      '<span class="file-chip-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="file-chip-main"><span class="file-chip-name">' + esc(upload.name) + '</span>' +
      '<span class="file-chip-meta">' + esc([ext, formatSize(upload.size)].filter(Boolean).join(" · ")) + '</span></span></div>';
  }

  function uploadPanel() {
    const busy = upload.phase === "extracting";
    const status = busy ? "Extracting text…" : upload.phase === "error" ? upload.message : "";
    return '<div class="cv-method-panel" id="cvMethodPanel" role="tabpanel" aria-labelledby="cvUploadTab">' +
      '<div class="dropzone' + (busy ? " busy" : "") + '" id="cvDropzone">' +
      '<span class="dropzone-icon" aria-hidden="true">' + I.upload + '</span>' +
      '<span class="dropzone-text"><strong>Drop your CV here</strong><span class="hint">PDF, DOCX, TXT · Max 10 MB</span></span>' +
      '<button class="secondary-btn" type="button" id="fileLink"' + (busy ? " disabled" : "") + '>' + I.doc + (upload.name ? "Replace file" : "Choose file") + '</button>' +
      '<input class="visually-hidden-file" type="file" id="cvFile" tabindex="-1" aria-hidden="true" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />' +
      '</div>' + fileChip() +
      '<div class="file-status ' + (upload.phase === "ready" ? "ok" : upload.phase === "error" ? "err" : "") + '" id="cvFileStatus" role="status" aria-live="polite">' + esc(status) + '</div>' +
      (upload.phase === "ready" ? '<details class="extract-preview"><summary>Preview</summary><button class="extract-copy-btn" id="copyExtractedText" type="button" aria-label="Copy extracted text" title="Copy extracted text">' + I.copy + '</button><pre class="extract-preview-text" dir="auto">' + esc(uploadText) + '</pre></details>' : '') +
      '</div>';
  }

  function pastePanel() {
    return '<div class="cv-method-panel" id="cvMethodPanel" role="tabpanel" aria-labelledby="cvPasteTab">' +
      '<label class="visually-hidden" for="cvText">CV text</label>' +
      '<textarea id="cvText" class="cv-textarea cv-paste-textarea" dir="auto" aria-describedby="cvTextCount cvErr" placeholder="Paste your CV here">' + esc(pasteText) + '</textarea>' +
      '<p class="hint cv-text-count" id="cvTextCount">' + pasteText.length.toLocaleString() + ' / ' + INPUT_LIMITS.profile.toLocaleString() + ' characters</p></div>';
  }

  function render(focusId = "") {
    if (session !== cvEditorSession) return;
    const hasCv = !!state.profile.trim();
    openModal(
      '<div class="modal-head" id="cvEditorModal"><h2>Profile / CV</h2><button class="icon-btn" id="modalClose" type="button" aria-label="Close Profile / CV" title="Close">' + I.close + '</button></div>' +
      '<div class="modal-body profile-editor-body">' +
      (hasCv ? '<div class="cv-existing-actions"><span class="hint">Saved CV</span><button class="ghost-btn" id="viewCvBtn" type="button">View CV</button><button class="ghost-btn btn-danger" id="clearCv" type="button">' + I.trash + 'Delete</button></div>' : '') +
      '<div class="cv-method-tabs" role="tablist" aria-label="CV input method">' +
      '<button class="cv-method-tab' + (method === "upload" ? " active" : "") + '" id="cvUploadTab" type="button" role="tab" aria-selected="' + (method === "upload") + '" tabindex="' + (method === "upload" ? 0 : -1) + '" aria-controls="cvMethodPanel">' + I.upload + 'Upload file</button>' +
      '<button class="cv-method-tab' + (method === "paste" ? " active" : "") + '" id="cvPasteTab" type="button" role="tab" aria-selected="' + (method === "paste") + '" tabindex="' + (method === "paste" ? 0 : -1) + '" aria-controls="cvMethodPanel">' + I.type + 'Paste text</button></div>' +
      (method === "upload" ? uploadPanel() : pastePanel()) + '</div>' +
      '<div class="modal-foot"><span class="form-msg err" id="cvErr" role="alert">' + esc(method === "paste" ? pasteError() : "") + '</span>' +
      '<button class="ghost-btn" id="wizCancel" type="button">Cancel</button><button class="primary-btn" id="wizSave" type="button"' + (canSave() ? "" : " disabled") + '>Save CV</button></div>'
    );
    $("modalClose").addEventListener("click", closeModal);
    $("wizCancel").addEventListener("click", closeModal);
    $("viewCvBtn")?.addEventListener("click", () => {
      rememberText();
      renderCvModal(() => render("viewCvBtn"));
    });
    $("clearCv")?.addEventListener("click", () => { rememberText(); confirmClearCv(() => render("clearCv")); });

    const chooseMethod = (next) => {
      rememberText();
      method = next;
      render(next === "upload" ? "cvUploadTab" : "cvPasteTab");
    };
    const uploadTab = $("cvUploadTab");
    const pasteTab = $("cvPasteTab");
    uploadTab.addEventListener("click", () => chooseMethod("upload"));
    pasteTab.addEventListener("click", () => chooseMethod("paste"));
    [uploadTab, pasteTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "upload" : event.key === "End" ? "paste" : method === "upload" ? "paste" : "upload";
      chooseMethod(next);
    }));

    if (method === "paste") {
      const input = $("cvText");
      input.addEventListener("input", () => {
        pasteText = input.value;
        $("cvTextCount").textContent = pasteText.length.toLocaleString() + " / " + INPUT_LIMITS.profile.toLocaleString() + " characters";
        $("cvErr").textContent = pasteError();
        $("wizSave").disabled = !canSave();
      });
    } else {
      $("fileLink").addEventListener("click", () => $("cvFile").click());
      $("cvFile").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) loadCvFile(file);
        event.target.value = "";
      });
      const zone = $("cvDropzone");
      zone.addEventListener("dragover", (event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files") || upload.phase === "extracting") return;
        event.preventDefault();
        zone.classList.add("over");
      });
      zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget as Node)) zone.classList.remove("over"); });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("over");
        const file = event.dataTransfer.files[0];
        if (file && upload.phase !== "extracting") loadCvFile(file);
      });
      $("copyExtractedText")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(uploadText);
          notify.success("CV text copied.");
        } catch (_) {
          notify.error("CV text could not be copied.");
        }
      });
    }

    $("wizSave").addEventListener("click", () => {
      rememberText();
      if (!canSave()) return;
      state.profile = method === "upload" ? uploadText : pasteText;
      state.profileFile = method === "upload" ? uploadFile : null;
      const saved = persistProfile();
      closeModal();
      renderAll();
      cvSaveFeedback(saved, method === "upload" && originalFileOmitted);
    });
    if (focusId) $(focusId)?.focus();
  }

  async function loadCvFile(file) {
    const name = file.name || "";
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    originalFileOmitted = false;
    if (![".txt", ".pdf", ".docx"].includes(ext) || file.size > INPUT_LIMITS.cvFileBytes || file.size === 0) {
      Object.assign(upload, { phase: "error", name, size: file.size || 0, message: file.size > INPUT_LIMITS.cvFileBytes ? "File is too large. Maximum size is 10 MB." : "Choose a nonempty PDF, DOCX, or TXT file." });
      cvFileFailureFeedback(upload.message);
      render("fileLink");
      return;
    }
    Object.assign(upload, { phase: "extracting", name, size: file.size || 0, message: "" });
    render("fileLink");
    const result = await readCvFile(file, name, ext);
    if (session !== cvEditorSession) return;
    if (result) {
      uploadText = result.text;
      uploadFile = result.file;
      upload.phase = "ready";
    } else upload.phase = "error";
    if (!result) cvFileFailureFeedback(upload.message);
    if (method === "upload" && isModalOpen() && $("cvEditorModal")) render("fileLink");
  }

  async function readCvFile(file, name, ext): Promise<{ text: string; file: any } | null> {
    let fileRecord = null;
    try {
      if (file.size > INPUT_LIMITS.storedCvBytes) { originalFileOmitted = true; throw new Error("Original file exceeds the local preview limit."); }
      const dataUrl = await readFileAsDataUrl(file);
      fileRecord = { name, type: file.type || mimeFromExt(ext), size: file.size || 0, dataUrl, savedAt: Date.now() };
    } catch (_) {
      originalFileOmitted = true;
    }
    if (ext === ".txt") {
      try {
        const text = await file.text();
        if (!text.trim() || text.length > INPUT_LIMITS.profile || hasDisallowedControl(text)) {
          upload.message = "Text file must contain 1 to 30,000 readable characters.";
          return null;
        }
        return { text, file: fileRecord };
      } catch (_) {
        upload.message = "Could not read that text file.";
        return null;
      }
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/parse-profile-file", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok || typeof data.text !== "string" || !data.text.trim() || data.text.length > INPUT_LIMITS.profile || hasDisallowedControl(data.text)) {
        upload.message = response.ok ? "Extracted text must contain 1 to 30,000 readable characters." : "Could not extract text from that file.";
        return null;
      }
      if (fileRecord) {
        fileRecord.type = mimeFromExt(ext);
        fileRecord.dataUrl = fileRecord.dataUrl.replace(/^data:[^,]*,/, "data:" + fileRecord.type + ";base64,");
      }
      return { text: data.text, file: fileRecord };
    } catch (_) {
      upload.message = "Could not extract text from that file.";
      return null;
    }
  }

  render();
}

// Clearing the CV used to happen on a single menu click with no way back.
function confirmClearCv(onCancel: () => void = openProfileModal) {
  openConfirmation(
    '<div class="modal-head"><h2>Delete CV?</h2><button class="icon-btn" id="modalClose" type="button" aria-label="Close delete CV dialog" title="Close">' + I.close + "</button></div>" +
    '<div class="modal-body"><p class="confirmation-description" id="modalDescription">This removes your saved CV from this browser and marks existing analyses out of date. This cannot be undone.</p></div>' +
    '<div class="modal-foot"><button class="ghost-btn" id="wizCancel" type="button">Cancel</button><button class="danger-btn" id="confirmClearCv" type="button">' + I.trash + "Delete CV</button></div>"
  );
  $("modalClose").addEventListener("click", closeModal);
  $("wizCancel").addEventListener("click", onCancel);
  $("confirmClearCv").addEventListener("click", () => {
    state.profile = "";
    state.profileFile = null;
    const saved = persistProfile();
    renderAll();
    openProfileModal();
    cvDeleteFeedback(saved);
  });
}
