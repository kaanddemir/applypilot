// Provider layer. Four engines behind one interface:
//   claude | openai | gemini  → cloud, called DIRECTLY from the browser with a
//                               user key kept only in localStorage (never sent
//                               to our backend).
//   local                     → in-browser WebLLM (WebGPU), no key, no network.
//
// All engines share the same persona/framing from GET /api/prompt-config, so the
// only difference is transport. chatStream/coverStream/analyze keep the same
// signatures the rest of the app already calls.
"use strict";

import { state, $, esc, toast } from "./state.js";
import { store, LS } from "./store.js";

// --- cloud provider registry -------------------------------------------------
export const PROVIDERS = {
  claude: {
    label: "Claude",
    keyLS: LS.keyClaude,
    modelLS: LS.modelClaude,
    keyHint: "sk-ant-…",
    models: [
      { id: "claude-sonnet-5",          label: "Claude Sonnet 5" },
      { id: "claude-opus-4-8",          label: "Claude Opus 4.8" },
    ],
    def: "claude-sonnet-5",
  },
  openai: {
    label: "ChatGPT",
    keyLS: LS.keyOpenai,
    modelLS: LS.modelOpenai,
    keyHint: "sk-…",
    models: [
      { id: "gpt-5.5",     label: "GPT-5.5" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ],
    def: "gpt-5.5",
  },
  gemini: {
    label: "Gemini",
    keyLS: LS.keyGemini,
    modelLS: LS.modelGemini,
    keyHint: "AIza…",
    models: [
      { id: "gemini-2.5-pro",   label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
    def: "gemini-2.5-pro",
  },
};
export function isCloud(p) { return Object.prototype.hasOwnProperty.call(PROVIDERS, p); }
export function providerLabel(p) { return p === "local" ? "Local" : (PROVIDERS[p]?.label || p); }
export function getKey(p) { const m = PROVIDERS[p]; return m ? store.get(m.keyLS, "").trim() : ""; }
export function setKey(p, val) { const m = PROVIDERS[p]; if (m) store.set(m.keyLS, (val || "").trim()); delete keyValidated[p]; updateProviderUI(); }
export function hasKey(p) { return !!getKey(p); }

// Whether the stored key has passed a live validation call this session:
// undefined = not yet checked, true = verified, false = rejected by provider.
const keyValidated = {};
export function getModel(p) { const m = PROVIDERS[p]; return m ? store.get(m.modelLS, m.def) : ""; }
export function setModel(p, val) { const m = PROVIDERS[p]; if (m) store.set(m.modelLS, val || m.def); updateProviderUI(); }

// --- local (WebLLM) models ---------------------------------------------------
const LOCAL_MODELS = [
  { id: "Qwen3-1.7B-q4f16_1-MLC", label: "Qwen3 1.7B (~1.2 GB)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 3B (~2 GB)" },
];
export function localModels() { return LOCAL_MODELS; }
export function currentModelId() { return store.get(LS.localModel, LOCAL_MODELS[0].id); }
export function webgpuAvailable() { return typeof navigator !== "undefined" && !!navigator.gpu; }
function shortName(id) { const m = LOCAL_MODELS.find((x) => x.id === id); return m ? m.label.split(" —")[0] : id; }

// --- WebLLM engine (lazy, single instance) ---
let webllm = null;
let localEngine = null;
let engineModelId = null;
let loadingPromise = null;
let engineStatus = { state: "idle", text: "" };

export function engineReady() { return !!localEngine && engineModelId === currentModelId(); }
export function localEngineStatus() {
  if (loadingPromise) return { state: "busy", text: engineStatus.text || "Loading " + shortName(currentModelId()) + "…" };
  if (engineReady()) return { state: "ready", text: engineStatus.text || shortName(currentModelId()) + " ready" };
  if (engineStatus.state === "err") return engineStatus;
  if (!webgpuAvailable()) return { state: "err", text: "WebGPU unsupported in this browser" };
  return { state: "idle", text: "Model not loaded" };
}

export function setModelId(id) {
  store.set(LS.localModel, id);
  localEngine = null;
  engineModelId = null;
  engineStatus = { state: "idle", text: "" };
  updateProviderUI();
}

export function unloadLocalEngine() {
  // Reset our state synchronously so the UI reflects "not loaded" immediately,
  // regardless of whether the underlying engine.unload() resolves promptly.
  const engine = localEngine;
  localEngine = null;
  engineModelId = null;
  engineStatus = { state: "idle", text: "" };
  updateProviderUI();
  if (engine && typeof engine.unload === "function") {
    Promise.resolve().then(() => engine.unload()).catch(() => {});
  }
}

export async function ensureLocalEngine(onProgress) {
  const modelId = currentModelId();
  if (localEngine && engineModelId === modelId) return localEngine;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    if (!webgpuAvailable()) {
      throw new Error("This browser has no WebGPU. Use Chrome or Edge for local AI.");
    }
    engineStatus = { state: "busy", text: "Loading " + shortName(modelId) + "…" };
    updateProviderUI();
    if (!webllm) webllm = await import("https://esm.run/@mlc-ai/web-llm");
    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (r) => {
        const pct = typeof r.progress === "number" ? Math.round(r.progress * 100) : null;
        engineStatus = { state: "busy", text: pct != null ? "Loading " + shortName(modelId) + " " + pct + "%" : (r.text || "Loading model…") };
        updateProviderUI();
        if (onProgress) onProgress(engineStatus.text, pct);
      },
    });
    localEngine = engine;
    engineModelId = modelId;
    engineStatus = { state: "ready", text: shortName(modelId) + " ready" };
    updateProviderUI();
    return engine;
  })();
  try {
    return await loadingPromise;
  } catch (err) {
    engineStatus = { state: "err", text: err.message || "Model load failed" };
    updateProviderUI();
    throw err;
  } finally {
    loadingPromise = null;
  }
}

function requireLocalEngine(onProgress) {
  if (engineReady() || loadingPromise) return ensureLocalEngine(onProgress);
  const s = localEngineStatus();
  if (s.state === "err") throw new Error(s.text || "Local model is not available.");
  throw new Error("Load the local model in Profile → AI engine before using AI.");
}

// --- shared prompt building --------------------------------------------------
let promptCfg = null;
async function getPromptConfig() {
  if (promptCfg) return promptCfg;
  const apiBase = location.port === "8000" ? "" : "http://localhost:8000";
  const r = await fetch(apiBase + "/api/prompt-config");
  if (!r.ok) throw new Error("Could not load prompt config.");
  promptCfg = await r.json();
  return promptCfg;
}
// The backend serves ONE system prompt describing all three modes. Shipping that
// whole thing on a chat turn makes models (weak local ones especially) echo the
// Mode 2 JSON schema and "MODE 2" headers straight into the conversation. So we
// scope it per turn: keep the shared persona/header plus only the section for
// this kind, and give a mode-specific FORMATTING footer. Falls back to the full
// prompt if the expected section markers aren't found.
function scopeSystem(full, kind) {
  const m1 = full.indexOf("MODE 1"), m2 = full.indexOf("MODE 2"), m3 = full.indexOf("MODE 3"), fmt = full.indexOf("FORMATTING");
  if (!(m1 >= 0 && m1 < m2 && m2 < m3 && m3 < fmt)) return full; // unexpected shape → don't risk mangling
  const head = full.slice(0, m1).trimEnd();
  const mode1 = full.slice(m1, m2).trimEnd();
  const mode2 = full.slice(m2, m3).trimEnd();
  const mode3 = full.slice(m3, fmt).trimEnd();
  const enOnly = "\n- Default to English unless the user writes in another language.";
  if (kind === "analyze") {
    return head + "\n\n" + mode2 +
      "\n\nFORMATTING\n- Output ONLY the JSON object described above — no prose, no code fences, no headers." + enOnly;
  }
  if (kind === "cover") {
    return head + "\n\n" + mode3 +
      "\n\nFORMATTING\n- Write in clear prose. Never output JSON, code fences, or section headers.\n- Do not use em dashes or en dashes; use commas, periods, or parentheses instead." + enOnly;
  }
  // chat (Mode 1)
  return head + "\n\n" + mode1 +
    "\n\nFORMATTING\n- This is a normal conversation. Write in clear, conversational prose.\n- Never output JSON, code fences, or internal section headers (like \"MODE 2\" or a schema). Those are for other tools, not this chat.\n- Do not use em dashes or en dashes; use commas, periods, or parentheses instead." + enOnly;
}
function fillSystem(cfg, kind) {
  const scoped = scopeSystem(String(cfg.system_prompt || ""), kind);
  return scoped.split("{user_profile}").join((state.profile || "").trim());
}
function buildCoverMessage({ job_posting = "", company = "", role = "", hiring_manager = "" }) {
  const known = [];
  if (role.trim()) known.push("Role title: " + role.trim());
  if (company.trim()) known.push("Company: " + company.trim());
  if (hiring_manager.trim()) known.push("Hiring manager: " + hiring_manager.trim());
  const details = known.length ? known.join("\n") : "(Company, role, and hiring manager are unknown; use bracket placeholders.)";
  return (
    "Please write a cover letter tailored to the following application context, using only real details from my profile (Mode 3). If the full job description is not provided, keep the draft grounded in the known company/role/notes and do not invent requirements.\n\n" +
    "KNOWN DETAILS:\n" + details + "\n\nAPPLICATION CONTEXT:\n" + job_posting.trim()
  );
}
// Cap the history we replay so we don't overflow the model's context window —
// small local models (Qwen 1.7B/3B) especially, whose budget is already eaten by
// the system prompt (which embeds the full CV). 8 exchanges is plenty for
// continuity; older turns roll off.
const MAX_HISTORY_MESSAGES = 16;
function stripThinkBlocks(text) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  let out = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = lower.indexOf("<think>", cursor);
    if (start === -1) return out + value.slice(cursor);
    out += value.slice(cursor, start);
    const end = lower.indexOf("</think>", start + "<think>".length);
    if (end === -1) return out;
    cursor = end + "</think>".length;
  }
  return out;
}

function sessionMessages(session) {
  const kept = session.thread.filter((m) => !m.streaming);
  // Only the latest user turn carries the heavy app context (apiText: full job
  // posting + analysis). Older user turns fall back to their short visible text
  // so the same posting isn't resent on every message.
  let lastUserIdx = -1;
  kept.forEach((m, i) => { if (m.role === "user") lastUserIdx = i; });
  const msgs = kept
    .map((m, i) => {
      const isLatestUser = m.role === "user" && i === lastUserIdx;
      const content = m.role === "user"
        ? (isLatestUser ? (m.apiText || m.text || "") : (m.text || m.content || ""))
        : stripThinkBlocks(m.text || m.content || "");
      return { role: m.role === "assistant" ? "assistant" : "user", content };
    })
    .filter((m) => m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES);
  // Providers require the first message to be from the user — the window may have
  // sliced in on an assistant turn, so drop any leading assistant messages.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

// Build {system, messages} for a given task, shared by every provider.
async function buildRequest(kind, payload) {
  const cfg = await getPromptConfig();
  const system = fillSystem(cfg, kind);
  if (kind === "chat") return { system, messages: sessionMessages(payload.session) };
  if (kind === "cover") return { system, messages: [{ role: "user", content: buildCoverMessage(payload.fields) }] };
  // analyze
  const user = String(cfg.analyze_framing || "").split("{job_posting}").join((payload.jobText || "").trim());
  return { system, messages: [{ role: "user", content: user }] };
}

// --- generic SSE line reader -------------------------------------------------
async function readSse(resp, onEvent) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let data = "";
      raw.split("\n").forEach((line) => { if (line.startsWith("data:")) data += line.slice(5).trim(); });
      if (data) onEvent(data);
    }
  }
}
async function errorText(resp, fallback) {
  let detail = fallback + " (" + resp.status + ")";
  try {
    const j = await resp.json();
    detail = j?.error?.message || j?.error?.[0]?.message || j?.error || j?.detail || detail;
    if (typeof detail !== "string") detail = JSON.stringify(detail);
  } catch (_) {}
  return detail;
}

// --- cloud adapters ----------------------------------------------------------
// Each returns the full text; streaming ones call onToken(accumulated).

async function claudeStream({ system, messages }, signal, onToken) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": getKey("claude"),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: getModel("claude"), max_tokens: 4000, system, messages, stream: true }),
  });
  if (!resp.ok) throw new Error(await errorText(resp, "Claude request failed"));
  let acc = "";
  await readSse(resp, (data) => {
    try {
      const j = JSON.parse(data);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") { acc += j.delta.text; if (onToken) onToken(acc); }
      if (j.type === "error") throw new Error(j.error?.message || "Claude stream error");
    } catch (e) { if (e instanceof SyntaxError) return; throw e; }
  });
  return acc;
}
async function claudeComplete({ system, messages }) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": getKey("claude"),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: getModel("claude"), max_tokens: 4000, system, messages }),
  });
  if (!resp.ok) throw new Error(await errorText(resp, "Claude request failed"));
  const j = await resp.json();
  return (j.content || []).map((b) => b.text || "").join("");
}

async function openaiStream({ system, messages }, signal, onToken) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: "Bearer " + getKey("openai") },
    body: JSON.stringify({ model: getModel("openai"), messages: [{ role: "system", content: system }, ...messages], stream: true }),
  });
  if (!resp.ok) throw new Error(await errorText(resp, "OpenAI request failed"));
  let acc = "";
  await readSse(resp, (data) => {
    if (data === "[DONE]") return;
    try { const j = JSON.parse(data); const t = j.choices?.[0]?.delta?.content || ""; if (t) { acc += t; if (onToken) onToken(acc); } } catch (_) {}
  });
  return acc;
}
async function openaiComplete({ system, messages }, jsonMode) {
  const body = { model: getModel("openai"), messages: [{ role: "system", content: system }, ...messages] };
  if (jsonMode) body.response_format = { type: "json_object" };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + getKey("openai") },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await errorText(resp, "OpenAI request failed"));
  const j = await resp.json();
  return j.choices?.[0]?.message?.content || "";
}

function geminiContents(messages) {
  return messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
}
async function geminiStream({ system, messages }, signal, onToken) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + getModel("gemini") + ":streamGenerateContent?alt=sse&key=" + encodeURIComponent(getKey("gemini"));
  const resp = await fetch(url, {
    method: "POST", signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: geminiContents(messages), generationConfig: { maxOutputTokens: 4000 } }),
  });
  if (!resp.ok) throw new Error(await errorText(resp, "Gemini request failed"));
  let acc = "";
  let finishReason = "";
  let blockReason = "";
  let geminiError = "";
  await readSse(resp, (data) => {
    try {
      const j = JSON.parse(data);
      if (j.error) geminiError = j.error.message || JSON.stringify(j.error);
      if (j.promptFeedback?.blockReason) blockReason = j.promptFeedback.blockReason;
      const candidate = j.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      const t = candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (t) { acc += t; if (onToken) onToken(acc); }
    } catch (_) {}
  });
  if (!acc.trim() && !signal?.aborted) {
    const fallback = await geminiComplete({ system, messages }, false);
    if (fallback.trim()) {
      if (onToken) onToken(fallback);
      return fallback;
    }
    const detail = geminiError || blockReason || finishReason;
    throw new Error(detail ? "Gemini returned no text (" + detail + ")." : "Gemini returned no text.");
  }
  return acc;
}
async function geminiComplete({ system, messages }, jsonMode) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + getModel("gemini") + ":generateContent?key=" + encodeURIComponent(getKey("gemini"));
  const gen = { maxOutputTokens: 4000 };
  if (jsonMode) gen.responseMimeType = "application/json";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: geminiContents(messages), generationConfig: gen }),
  });
  if (!resp.ok) throw new Error(await errorText(resp, "Gemini request failed"));
  const j = await resp.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
}

const CLOUD_STREAM = { claude: claudeStream, openai: openaiStream, gemini: geminiStream };
const CLOUD_COMPLETE = { claude: (req) => claudeComplete(req), openai: (req) => openaiComplete(req, true), gemini: (req) => geminiComplete(req, true) };

function ensureCloudKey(p) {
  if (!hasKey(p)) throw new Error("Add your " + providerLabel(p) + " API key in Profile → AI engine.");
}

// Live-validate a cloud key by hitting the provider's cheap (token-free) list-
// models endpoint. Records the result in keyValidated and returns { ok, error }.
export async function validateKey(p, key) {
  const k = (key || "").trim();
  if (!isCloud(p)) return { ok: false, error: "Unknown provider." };
  if (!k) { keyValidated[p] = false; updateProviderUI(); return { ok: false, error: "Enter an API key first." }; }
  let resp;
  try {
    if (p === "claude") {
      resp = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      });
    } else if (p === "openai") {
      resp = await fetch("https://api.openai.com/v1/models", { headers: { authorization: "Bearer " + k } });
    } else {
      resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(k));
    }
  } catch (_) {
    keyValidated[p] = false; updateProviderUI();
    return { ok: false, error: "Could not reach " + providerLabel(p) + " (network error)." };
  }
  if (!resp.ok) {
    const error = await errorText(resp, providerLabel(p) + " rejected the key");
    keyValidated[p] = false; updateProviderUI();
    return { ok: false, error };
  }
  keyValidated[p] = true; updateProviderUI();
  return { ok: true };
}

// --- local (WebLLM) helpers ---
async function localCompletionStream(engine, messages, signal, onToken) {
  const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.6 });
  let acc = "";
  for await (const c of chunks) {
    if (signal && signal.aborted) { try { await engine.interruptGenerate(); } catch (_) {} break; }
    const t = c.choices?.[0]?.delta?.content || "";
    if (t) { acc += t; if (onToken) onToken(acc); }
  }
  return acc;
}

// --- JSON helpers for analysis ---
function safeJson(txt) {
  let t = String(txt).trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (_) { return {}; }
}
function coerceAnalysis(o) {
  o = o || {};
  // ats_keywords: accept the structured [{keyword, present}] shape, or fall back
  // to a plain string array (older/looser output) treated as "missing".
  const atsSource = Array.isArray(o.ats_keywords) ? o.ats_keywords
    : (Array.isArray(o.keywords_to_add) ? o.keywords_to_add : []);
  return {
    summary: typeof o.summary === "string" ? o.summary : "",
    matched_requirements: Array.isArray(o.matched_requirements)
      ? o.matched_requirements.map((m) => ({ requirement: String(m?.requirement || m || ""), evidence: String(m?.evidence || "") }))
      : [],
    missing_or_weak: Array.isArray(o.missing_or_weak)
      ? o.missing_or_weak.map((m) => ({
          requirement: String(m?.requirement || m || ""),
          severity: ["high", "medium", "low"].includes(m?.severity) ? m.severity : "medium",
          suggestion: String(m?.suggestion || ""),
        }))
      : [],
    ats_keywords: atsSource
      .map((k) => (typeof k === "string"
        ? { keyword: k, present: false }
        : { keyword: String(k?.keyword || ""), present: k?.present === true }))
      .filter((k) => k.keyword.trim()),
    resume_bullets: Array.isArray(o.resume_bullets)
      ? o.resume_bullets
          .map((b) => ({ target: String(b?.target || ""), bullet: String(b?.bullet || b || "") }))
          .filter((b) => b.bullet.trim())
      : [],
    highlight_in_application: Array.isArray(o.highlight_in_application) ? o.highlight_in_application.map(String) : [],
    overall_recommendation: typeof o.overall_recommendation === "string" ? o.overall_recommendation : "",
  };
}

// --- public provider calls (branch on state.provider) ------------------------
export async function chatStream(session, signal, onToken, onStatus) {
  if (state.provider === "local") {
    const engine = await requireLocalEngine(onStatus);
    const { system, messages } = await buildRequest("chat", { session });
    return localCompletionStream(engine, [{ role: "system", content: system }, ...messages], signal, onToken);
  }
  ensureCloudKey(state.provider);
  if (onStatus) onStatus("Connecting to " + providerLabel(state.provider) + "…");
  const req = await buildRequest("chat", { session });
  const text = await CLOUD_STREAM[state.provider](req, signal, onToken);
  if (!String(text || "").trim() && !(signal && signal.aborted)) {
    throw new Error(providerLabel(state.provider) + " returned an empty response.");
  }
  return text;
}

export async function coverStream(fields, signal, onToken, onStatus) {
  if (state.provider === "local") {
    const engine = await requireLocalEngine(onStatus);
    const { system, messages } = await buildRequest("cover", { fields });
    return localCompletionStream(engine, [{ role: "system", content: system }, ...messages], signal, onToken);
  }
  ensureCloudKey(state.provider);
  if (onStatus) onStatus("Connecting to " + providerLabel(state.provider) + "…");
  const req = await buildRequest("cover", { fields });
  const text = await CLOUD_STREAM[state.provider](req, signal, onToken);
  if (!String(text || "").trim() && !(signal && signal.aborted)) {
    throw new Error(providerLabel(state.provider) + " returned an empty response.");
  }
  return text;
}

export async function analyze(jobText, onStatus) {
  if (state.provider === "local") {
    const engine = await requireLocalEngine(onStatus);
    // The model is loaded now; the load-progress status won't fire again, so
    // tell the caller we've moved on to generation (otherwise it looks stuck).
    if (onStatus) onStatus("Analyzing your application…");
    const { system, messages } = await buildRequest("analyze", { jobText });
    // Small local models don't reliably support JSON-mode grammar; ask for JSON
    // in the prompt (already do) and parse defensively with safeJson instead.
    const res = await engine.chat.completions.create({
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.3,
      max_tokens: 1500,
    });
    return coerceAnalysis(safeJson(res.choices?.[0]?.message?.content || "{}"));
  }
  ensureCloudKey(state.provider);
  const req = await buildRequest("analyze", { jobText });
  const txt = await CLOUD_COMPLETE[state.provider](req);
  return coerceAnalysis(safeJson(txt));
}

// --- provider switching ------------------------------------------------------
export function setProvider(p) {
  if (state.provider === p) { updateProviderUI(); return; }
  if (p === "local" && !webgpuAvailable()) {
    toast("Local AI needs WebGPU (use Chrome or Edge).");
    updateProviderUI();
    return;
  }
  state.provider = p;
  store.set(LS.provider, p);
  updateProviderUI();
  if (p !== "local" && !hasKey(p)) {
    toast("Add your " + providerLabel(p) + " API key below.");
  }
}

// Status line shown in the AI-engine settings for the active provider.
export function providerStatus() {
  if (state.provider === "local") {
    const s = localEngineStatus();
    if (s.state === "ready") return { cls: "ready", text: s.text };
    if (s.state === "busy") return { cls: "busy", text: s.text };
    if (s.state === "err") return { cls: "err", text: s.text };
    return { cls: "offline", text: s.text };
  }
  const p = state.provider;
  if (!hasKey(p)) return { cls: "err", text: "API key not configured" };
  if (keyValidated[p] === false) return { cls: "err", text: "Invalid API key" };
  if (keyValidated[p] === true) return { cls: "ready", text: PROVIDERS[p].label + " Ready" };
  return { cls: "ready", text: PROVIDERS[p].label + " key saved" };
}

// Repaint the settings UI (only present on the Profile page).
export function updateProviderUI() {
  const activeProv = state.provider;
  document.querySelectorAll(".choice-card[data-engine-type]").forEach((c) => {
    const isLocal = c.dataset.engineType === "local";
    const isActive = isLocal ? (activeProv === "local") : (activeProv !== "local");
    c.classList.toggle("active", isActive);
  });

  const bar = document.querySelector(".engine-status-bar");
  if (bar) {
    const s = providerStatus();
    bar.classList.remove("status-ready", "status-missing", "status-busy");
    if (s.cls === "ready") {
      bar.classList.add("status-ready");
    } else if (s.cls === "busy") {
      bar.classList.add("status-busy");
    } else {
      bar.classList.add("status-missing");
    }

    const txtEl = bar.querySelector(".status-text");
    if (txtEl) {
      txtEl.textContent = s.text;
    }
  }
}
