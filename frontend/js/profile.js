// Profile page: manage your CV and configure the AI engine (cloud providers with
// browser-stored keys, or local WebLLM).
"use strict";

import { state, $, esc, persistProfile, toast } from "./state.js";
import { I } from "./icons.js";
import { renderAll } from "./render.js";
import { openCvWizard, openModal, closeModal } from "./wizards.js";
import {
  PROVIDERS, setProvider, getKey, setKey, hasKey, getModel, setModel, validateKey,
  localModels, currentModelId, setModelId, ensureLocalEngine, unloadLocalEngine,
  updateProviderUI, engineReady, localEngineStatus
} from "./ai.js";

function providerCard(id, label, sub) {
  const isActive = id === "local" ? (state.provider === "local") : (state.provider !== "local");
  let icon = "";
  if (id === "external") {
    icon = '<svg class="engine-choice-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
  } else {
    icon = '<svg class="engine-choice-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>';
  }
  return '<button class="choice-card' + (isActive ? " active" : "") + '" data-engine-type="' + id + '">' +
    '<div class="choice-icon">' + icon + "</div>" +
    "<strong>" + esc(label) + "</strong><div class=\"hint\">" + esc(sub) + "</div></button>";
}

function engineConfig() {
  const p = state.provider;
  if (p === "local") {
    const opts = localModels().map((m) => '<option value="' + m.id + '"' + (m.id === currentModelId() ? " selected" : "") + ">" + esc(m.label) + "</option>").join("");
    const localStatus = localEngineStatus();
    const isLoaded = localStatus.state === "ready";
    const isLoading = localStatus.state === "busy";

    // Dropdown + icon buttons inline (always both visible)
    const modelRow = '<div class="settings-field">' +
      '<label>Local model</label>' +
      '<div class="local-model-row">' +
        '<select class="select" id="localModelSel">' + opts + '</select>' +
        '<button class="local-icon-btn ' + (isLoading ? 'loading' : (isLoaded ? 'loaded' : 'load')) + '" id="btnLoadLocalModel" title="Load Model"' + ((isLoaded || isLoading) ? ' disabled' : '') + '>' + (isLoading ? '<svg class="loading-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>' : I.save) + '</button>' +
        '<button class="local-icon-btn eject" id="btnEjectLocalModel" title="Unload Model"' + (!isLoaded ? ' disabled' : '') + '>' + I.close + '</button>' +
      '</div>' +
    '</div>';

    const statusCls = isLoaded ? 'status-ready' : (isLoading ? 'status-busy' : 'status-missing');
    const statusText = isLoaded ? 'Ready' : localStatus.text;
    const statusBar = '<div class="engine-status-bar ' + statusCls + '">' +
      '<div class="status-bar-left">' +
        '<span class="status-dot"></span>' +
        '<span class="status-text">' + statusText + '</span>' +
      '</div>' +
      '<div class="status-bar-right">' +
        '<svg class="status-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
        '<span>100% Private (No network)</span>' +
      '</div>' +
    '</div>';

    return modelRow +
      statusBar +
      '<p class="hint engine-note">Runs locally in your browser via WebGPU. Model downloads on first use.</p>';
  }

  // External Cloud API mode
  const currentProvider = state.provider === "local" ? "gemini" : state.provider;
  const providersOpts = [
    { id: "gemini", label: "Google" },
    { id: "claude", label: "Anthropic" },
    { id: "openai", label: "OpenAI" }
  ].map(prov => '<option value="' + prov.id + '"' + (prov.id === currentProvider ? " selected" : "") + '>' + prov.label + '</option>').join("");

  const meta = PROVIDERS[currentProvider];
  const modelOpts = meta.models.map((m) => '<option value="' + m.id + '"' + (m.id === getModel(currentProvider) ? " selected" : "") + ">" + esc(m.label) + "</option>").join("");

  // Provider + Model in one two-column row
  const providerModelRow = '<div class="settings-row-2col">' +
    '<div class="settings-field"><label>Provider</label><select class="select" id="externalProviderSel">' + providersOpts + '</select></div>' +
    '<div class="settings-field"><label>Model</label><select class="select" id="cloudModelSel">' + modelOpts + "</select></div>" +
    '</div>';

  const keyRow = '<div class="settings-field"><label>' + esc(meta.label) + ' API key</label>' +
      '<div class="key-row"><input id="apiKey" type="password" placeholder="' + esc(meta.keyHint) + '" value="' + esc(getKey(currentProvider)) + '" autocomplete="off" spellcheck="false" />' +
      '<button class="secondary-btn" id="saveKey" title="Save API Key">' + I.save + '</button>' +
      '<button class="ghost-btn" id="deleteKey" title="Delete API Key">' + I.trash + '</button></div></div>';

  const isConfigured = hasKey(currentProvider);
  const statusBar = '<div class="engine-status-bar ' + (isConfigured ? 'status-ready' : 'status-missing') + '">' +
    '<div class="status-bar-left">' +
      '<span class="status-dot"></span>' +
      '<span class="status-text">' + (isConfigured ? (meta.label + ' Ready') : 'API Key Not Configured') + '</span>' +
    '</div>' +
    '<div class="status-bar-right">' +
      '<svg class="status-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '<span>Locally secured in browser</span>' +
    '</div>' +
  '</div>';

  return providerModelRow + keyRow + statusBar +
    '<p class="hint engine-note">API keys are saved locally in your browser and sent directly to the provider.</p>';
}

let activeCvTab = "original";

function profileDisplayName(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines.slice(0, 10)) {
    const clean = line
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "")
      .replace(/(?:\+\d{1,3}[-.\s]?)?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\+?\d{10,13}/g, "")
      .replace(/https?:\/\/\S+|(?:www\.)?\S+\.(?:com|net|org|io)\S*/gi, "")
      .replace(/^[\s•|·,:;-]+|[\s•|·,:;-]+$/g, "")
      .trim();
    if (!clean || clean.length < 2 || clean.length > 60) continue;
    if (/\d{4,}|@|https?:\/\//i.test(clean)) continue;
    if (clean.split(/\s+/).length <= 6) return clean;
  }
  return "Your Professional Profile";
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

function compactPlainText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function renderRawText(rawText) {
  const text = compactPlainText(rawText);
  return '<div class="cv-plain-text cv-modal-preview">' + esc(text || "No extracted text saved.") + '</div>';
}

function renderOriginalFile(rawText) {
  const file = state.profileFile;
  if (!file?.dataUrl) {
    return '<div class="cv-file-original-view">' +
      '<div class="cv-file-summary">' +
      '<div class="cv-file-summary-icon">' + I.doc + '</div>' +
      '<strong>Original file not available</strong>' +
      '<p>This profile was saved as text only, or it was created before original-file previews were stored.</p>' +
      '</div>' +
    '</div>';
  }
  const kind = fileKind(file);
  if (kind === "pdf") {
    return '<iframe class="cv-file-frame" title="Original CV file" src="' + esc(file.dataUrl) + '"></iframe>';
  }
  if (kind === "text") {
    return '<pre class="cv-preview cv-modal-preview">' + esc(rawText) + '</pre>';
  }
  const meta = [file.name, formatBytes(file.size)].filter(Boolean).join(" · ");
  return '<div class="cv-file-original-view">' +
    '<div class="cv-file-summary">' +
      '<div class="cv-file-summary-icon">' + I.doc + '</div>' +
      '<strong>' + esc(file.name || "Original CV file") + '</strong>' +
      '<p>' + esc(meta || "DOCX file saved locally") + '</p>' +
      '<p class="hint">Word documents cannot be previewed reliably in the browser. Use Raw Text to read the extracted content.</p>' +
    '</div>' +
    '<a class="secondary-btn cv-file-download" href="' + esc(file.dataUrl) + '" download="' + esc(file.name || "profile.docx") + '">Download original</a>' +
  '</div>';
}

function renderCvModal() {
  const rawText = state.profile.trim();
  const chars = rawText.length;

  const tabsHtml = '<div class="cv-tabs-container">' +
    '<div class="cv-tabs">' +
      '<button class="cv-tab ' + (activeCvTab === "original" ? "active" : "") + '" id="modalCvTabOriginal">Original File</button>' +
      '<button class="cv-tab ' + (activeCvTab === "raw" ? "active" : "") + '" id="modalCvTabRaw">Raw Text</button>' +
    '</div>' +
    '<div class="cv-meta">' + chars.toLocaleString() + ' characters saved</div>' +
  '</div>';

  const viewContentHtml = activeCvTab === "original"
    ? renderOriginalFile(rawText)
    : renderRawText(rawText);

  const modalHtml = 
    '<div class="modal-head">' +
      '<div>' +
        '<h2>Profile Preview</h2>' +
      '</div>' +
      '<button class="icon-btn" id="modalClose">' + I.close + '</button>' +
    '</div>' +
    '<div class="modal-body cv-modal-body">' +
      tabsHtml +
      '<div class="cv-modal-content">' +
        viewContentHtml +
      '</div>' +
    '</div>';

  openModal(modalHtml);
  const mEl = $("modal");
  if (mEl) mEl.classList.add("large-modal");

  // Close modal
  $("modalClose").addEventListener("click", closeModal);

  // Tab switching inside modal
  const tabOriginal = $("modalCvTabOriginal");
  const tabRaw = $("modalCvTabRaw");
  if (tabOriginal && tabRaw) {
    tabOriginal.addEventListener("click", () => {
      activeCvTab = "original";
      renderCvModal();
    });
    tabRaw.addEventListener("click", () => {
      activeCvTab = "raw";
      renderCvModal();
    });
  }
}

export function renderProfilePage() {
  const hasCv = !!state.profile.trim();
  const rawText = state.profile.trim();
  const chars = rawText.length;

  let cvBody = "";

  if (hasCv) {
    cvBody = '<div class="cv-summary-card">' +
      '<div class="cv-summary-icon-box">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
      '</div>' +
      '<div class="cv-summary-details">' +
        '<div class="cv-summary-name">' + esc(profileDisplayName(rawText)) + '</div>' +
        '<div class="cv-summary-info">' + chars.toLocaleString() + ' characters saved' + (state.profileFile?.name ? ' · ' + esc(state.profileFile.name) : '') + '</div>' +
      '</div>' +
      '<div class="cv-summary-actions">' +
        '<button class="primary-btn" id="viewCvBtn">View Profile Details</button>' +
        '<div class="data-menu-wrap">' +
          '<button class="secondary-btn icon-btn" id="cvMenuBtn" title="More" aria-label="More actions">' + I.more + '</button>' +
          '<div class="data-menu" id="cvMenu">' +
            '<button class="data-menu-item" id="editCv">' + I.edit + '<span>Edit</span></button>' +
            '<button class="data-menu-item danger" id="clearCv">' + I.trash + '<span>Delete</span></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  } else {
    cvBody = '<div class="cv-empty-card" id="editCv">' +
      '<div class="cv-empty-icon-wrapper">' + I.upload + '</div>' +
      '<div class="cv-dropzone-text">Click to upload or paste your CV</div>' +
    '</div>';
  }

  $("content").innerHTML =
    '<div class="profile-page">' +
      '<section class="settings-section">' +
        '<div class="settings-head cv-head-layout">' +
          '<div class="cv-head-text">' +
            '<div class="cv-head-title-row">' +
              '<svg class="settings-head-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
              '<h2>Your Profile</h2>' +
            '</div>' +
            '<p>Add your CV to personalize and tailor your applications.</p>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card">' + cvBody + "</div>" +
      '</section>' +
      '<section class="settings-section">' +
        '<div class="settings-head cv-head-layout">' +
          '<div class="cv-head-text">' +
            '<div class="cv-head-title-row">' +
              '<svg class="settings-head-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>' +
              '<h2>AI Engine</h2>' +
            '</div>' +
            '<p>Configure where the AI runs to personalize and tailor your applications.</p>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card">' +
          '<div class="choice-grid">' +
            providerCard("external", "External API", "Claude, ChatGPT, or Gemini") +
            providerCard("local", "Local Model", "Runs privately in your browser") +
          '</div>' +
          '<div class="engine-config" id="engineConfig">' + engineConfig() + '</div>' +
        '</div>' +
      '</section>' +
    '</div>';

  const cvMenuBtn = $("cvMenuBtn");
  const cvMenu = $("cvMenu");
  if (cvMenuBtn && cvMenu) {
    cvMenuBtn.addEventListener("click", (e) => { e.stopPropagation(); cvMenu.classList.toggle("open"); });
    document.addEventListener("click", () => cvMenu.classList.remove("open"));
    cvMenu.addEventListener("click", (e) => e.stopPropagation());
  }

  const edit = $("editCv");
  if (edit) edit.addEventListener("click", () => { cvMenu?.classList.remove("open"); openCvWizard(); });
  const clear = $("clearCv");
  if (clear) clear.addEventListener("click", () => {
    cvMenu?.classList.remove("open");
    state.profile = "";
    state.profileFile = null;
    persistProfile();
    renderAll();
    toast("CV cleared");
  });

  const viewBtn = $("viewCvBtn");
  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      activeCvTab = state.profileFile?.dataUrl ? "original" : "raw";
      renderCvModal();
    });
  }

  wireEngine();
}

function wireEngine() {
  document.querySelectorAll(".choice-card[data-engine-type]").forEach((card) => {
    card.addEventListener("click", () => {
      const type = card.dataset.engineType;
      if (type === "local") {
        setProvider("local");
      } else {
        if (state.provider === "local") {
          setProvider("gemini"); // Default to Gemini on switchback
        }
      }
      renderProfilePage();
    });
  });
  wireEngineControls();
  updateProviderUI();
}

function wireEngineControls() {
  const p = state.provider;
  const key = $("apiKey");
  const saveKey = $("saveKey");
  if (key && saveKey) {
    const save = async () => {
      const val = key.value.trim();
      setKey(p, val);
      if (!val) { toast(PROVIDERS[p].label + " key cleared"); renderProfilePage(); return; }
      // Show a busy state on the status bar while we hit the provider.
      const bar = document.querySelector(".engine-status-bar");
      if (bar) {
        bar.classList.remove("status-ready", "status-missing");
        bar.classList.add("status-busy");
        const txt = bar.querySelector(".status-text");
        if (txt) txt.textContent = "Validating…";
      }
      saveKey.disabled = true;
      const res = await validateKey(p, val);
      saveKey.disabled = false;
      toast(res.ok ? PROVIDERS[p].label + " key verified" : (res.error || PROVIDERS[p].label + " key rejected"));
      renderProfilePage();
    };
    saveKey.addEventListener("click", save);
    key.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    key.addEventListener("input", () => setKey(p, key.value));
    // Blur just persists silently — no network validation on every focus change.
    key.addEventListener("blur", () => setKey(p, key.value));
  }
  const deleteKey = $("deleteKey");
  if (deleteKey) {
    deleteKey.addEventListener("click", () => {
      setKey(p, "");
      toast(PROVIDERS[p].label + " key deleted");
      renderProfilePage();
    });
  }
  const cloudModel = $("cloudModelSel");
  if (cloudModel) cloudModel.addEventListener("change", (e) => { setModel(p, e.target.value); updateProviderUI(); });
  const localModel = $("localModelSel");
  if (localModel) localModel.addEventListener("change", (e) => {
    setModelId(e.target.value);
    renderProfilePage();
  });
  const btnLoad = $("btnLoadLocalModel");
  if (btnLoad) {
    btnLoad.addEventListener("click", () => {
      // Show spinner in button (loading icon)
      btnLoad.innerHTML = '<svg class="loading-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>';
      btnLoad.disabled = true;
      btnLoad.classList.remove("load");
      btnLoad.classList.add("loading");
      // Update status bar to busy state
      const bar = document.querySelector(".engine-status-bar");
      if (bar) {
        bar.classList.remove("status-ready", "status-missing");
        bar.classList.add("status-busy");
        const txt = bar.querySelector(".status-text");
        if (txt) txt.textContent = "Downloading model…";
      }
      ensureLocalEngine()
        .then(() => {
          toast("Local model successfully loaded!");
          renderProfilePage();
        })
        .catch((err) => {
          toast(err.message || "Model load failed");
          renderProfilePage();
        });
    });
  }
  const btnEject = $("btnEjectLocalModel");
  if (btnEject) {
    btnEject.addEventListener("click", () => {
      unloadLocalEngine();
      toast("Local model unloaded.");
      renderProfilePage();
    });
  }
  const extProvider = $("externalProviderSel");
  if (extProvider) {
    extProvider.addEventListener("change", (e) => {
      setProvider(e.target.value);
      renderProfilePage();
    });
  }
}
