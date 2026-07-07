// Chat view: thread rendering, composer, streaming glue (provider-agnostic),
// cover-letter generation, and session management.
"use strict";

import {
  state, $, esc, uid, persistChat, persistApps, activeChat, chatContextApp, setChatContext, touch, toast,
} from "./state.js";
import { I } from "./icons.js";
import { chatStream, coverStream } from "./ai.js";
import { renderAll, renderSidebar } from "./render.js";
import { requireProfile } from "./board.js";

export function renderChatPage() {
  const empty = activeChat().thread.length === 0;
  if (empty) {
    $("content").innerHTML =
      '<div class="chat-page empty">' +
        '<div class="chat-center-container">' +
          '<div class="chat-greeting">ApplyPilot</div>' +
          '<div class="chat-composer chat-composer-empty">' +
            '<div class="chat-input">' +
              '<div class="composer-context">' +
                '<button class="attach-app-btn" id="attachAppBtn" title="' + esc(chatContextLabel()) + '" aria-label="Attach application">' + I.briefcase + "</button>" +
                '<div class="app-popover" id="appPopover">' + chatContextOptions() + "</div>" +
              '</div>' +
              '<textarea id="chatInput" rows="1" placeholder="Ask anything..."></textarea>' +
              '<div class="composer-right-actions">' +
                '<button class="chat-send-btn" id="chatSend" title="Send message" aria-label="Send message">' + I.send + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          suggestionChips() +
        '</div>' +
      "</div>";
  } else {
    $("content").innerHTML =
      '<div class="chat-page">' +
        '<div class="chat-thread" id="chatThread">' + chatMessagesHtml() + "</div>" +
        '<div class="chat-composer">' +
          '<div class="chat-input">' +
            '<div class="composer-context">' +
              '<button class="attach-app-btn" id="attachAppBtn" title="' + esc(chatContextLabel()) + '" aria-label="Attach application">' + I.briefcase + "</button>" +
              '<div class="app-popover" id="appPopover">' + chatContextOptions() + "</div>" +
            '</div>' +
            '<textarea id="chatInput" rows="1" placeholder="Ask anything..."></textarea>' +
            '<div class="composer-right-actions">' +
              '<button class="chat-send-btn" id="chatSend" title="Send message" aria-label="Send message">' + I.send + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="chat-disclaimer">' +
            'ApplyPilot can make mistakes. Verify important info.' +
          '</div>' +
        '</div>' +
      "</div>";
  }
  const attachBtn = $("attachAppBtn");
  const currentApp = chatContextApp();
  attachBtn.classList.toggle("active", !!currentApp);
  attachBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    $("appPopover").classList.toggle("open");
  });
  document.querySelectorAll(".app-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      setChatContext(btn.dataset.id || "");
      renderChatPage();
    });
  });
  wireAssistant();
}

function chatContextOptions() {
  const currentId = activeChat().contextAppId || "";
  return '<button class="app-option ' + (!currentId ? "active" : "") + '" data-id="">' + I.briefcase + "<span>No app</span></button>" +
    state.applications.map((a) =>
      '<button class="app-option ' + (a.id === currentId ? "active" : "") + '" data-id="' + esc(a.id) + '">' + I.briefcase + "<span>" + esc((a.company || "Application") + " - " + (a.role || "Role")) + "</span></button>"
    ).join("");
}
function chatContextLabel() {
  const app = chatContextApp();
  return app ? "Attached: " + (app.company || "Application") + " - " + (app.role || "Role") : "Attach application";
}
// Starter chips shown on the empty chat screen. When an application is attached
// and has a saved analysis, the chips are derived from its gaps so follow-ups
// land on real, actionable ground; otherwise a set of general career prompts.
function suggestionChips() {
  const app = chatContextApp();
  const a = app && app.matchAnalysis;
  let items;
  if (a) {
    items = [
      { icon: I.target, prompt: "How do I close my gaps for this role?" },
      { icon: I.edit, prompt: "Tailor my CV for this role" },
    ];
    const topGap = (a.missing_or_weak || []).find((m) => m.severity === "high") || (a.missing_or_weak || [])[0];
    if (topGap && topGap.requirement) items.push({ icon: I.bolt, prompt: "Help me address: " + topGap.requirement });
    items.push({ icon: I.chat, prompt: "Draft interview answers for this role" });
  } else if (app) {
    items = [
      { icon: I.target, prompt: "How well do I fit this role?" },
      { icon: I.edit, prompt: "Tailor my CV for this role" },
      { icon: I.bolt, prompt: "What should I emphasize in my application?" },
    ];
  } else {
    items = [
      { icon: I.doc, prompt: "Strengthen my CV" },
      { icon: I.chat, prompt: "Help me prep for interviews" },
      { icon: I.bolt, prompt: "Advice on my career direction" },
    ];
  }
  const chips = items.slice(0, 4)
    .map((it) => '<button class="suggest-chip js-suggest" data-prompt="' + esc(it.prompt) + '">' + it.icon + "<span>" + esc(it.prompt) + "</span></button>")
    .join("");
  return '<div class="suggest-chips">' + chips + "</div>";
}

function chatMessagesHtml() {
  const thread = activeChat().thread;
  if (!thread.length) return '<div class="msg assistant">How can I help?</div>';
  return thread.map((m) => {
    const empty = !(m.text || m.content || "").trim();
    // While streaming, show an animated typing indicator in the pending
    // assistant bubble until the first token (or a status line) arrives.
    if (m.role === "assistant" && m.streaming && state.streaming && empty) {
      return '<div class="msg assistant typing"><span class="typing-dots"><span></span><span></span><span></span></span></div>';
    }
    return '<div class="msg ' + esc(m.role) + '">' + messageHtml(m) + "</div>";
  }).join("");
}

function messageHtml(m) {
  const text = m.text || m.content || "";
  if (m.role !== "assistant") return esc(text);
  return assistantMessageHtml(text, m.streaming);
}

function assistantMessageHtml(text, streaming) {
  const parts = splitThinkBlocks(text);
  if (parts.length === 1 && parts[0].type === "text") return formatAssistantText(parts[0].value);
  return parts.map((part, index) => {
    if (part.type === "text") {
      const html = formatAssistantText(cleanTextPart(part.value, parts, index));
      return html ? '<div class="assistant-text-part">' + html + "</div>" : "";
    }
    const body = formatAssistantText(part.value.trim());
    const open = part.open || streaming ? " open" : "";
    return '<details class="think-block"' + open + '>' +
      '<summary><span class="think-chevron" aria-hidden="true"></span><span class="think-label">Thinking</span></summary>' +
      '<div class="think-body">' + (body || "<em>No thinking content yet.</em>") + "</div>" +
    "</details>";
  }).join("");
}

function cleanTextPart(value, parts, index) {
  let text = value;
  if (parts[index - 1]?.type === "think") text = text.replace(/^\s+/, "");
  if (parts[index + 1]?.type === "think") text = text.replace(/\s+$/, "");
  return text;
}

function splitThinkBlocks(text) {
  const parts = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const start = lower.indexOf("<think>", cursor);
    if (start === -1) {
      parts.push({ type: "text", value: text.slice(cursor) });
      break;
    }
    if (start > cursor) parts.push({ type: "text", value: text.slice(cursor, start) });
    const bodyStart = start + "<think>".length;
    const end = lower.indexOf("</think>", bodyStart);
    if (end === -1) {
      parts.push({ type: "think", value: text.slice(bodyStart), open: true });
      break;
    }
    parts.push({ type: "think", value: text.slice(bodyStart, end), open: false });
    cursor = end + "</think>".length;
  }
  return parts.filter((part) => part.value || part.type === "think");
}

function formatAssistantText(text) {
  let html = esc(text);
  // Bold: **text** -> <strong>text</strong>
  html = html.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<strong>$1</strong>");
  // Italic: *text* -> <em>text</em>
  html = html.replace(/(^|[^\*])\*([^*\n][^*\n]*?[^*\n])\*(?!\*)/g, "$1<em>$2</em>");
  // Headings: # through ######
  html = html.replace(/^(#{1,6})\s+([^\r\n]+?)\s*\r?$/gm, (match, hashes, content) => {
    const level = hashes.length;
    return '<h' + level + '>' + content + '</h' + level + '>';
  });
  return html;
}

function chatScrollEl() {
  return $("content") || $("chatThread");
}

function isNearBottom(el) {
  return !el || (el.scrollHeight - el.scrollTop - el.clientHeight) < 80;
}

function renderChatOnly() {
  const threadEl = $("chatThread");
  if (!threadEl) return;
  const scrollEl = chatScrollEl();
  const shouldStick = isNearBottom(scrollEl);
  threadEl.innerHTML = chatMessagesHtml();
  if (shouldStick && scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  const send = $("chatSend");
  if (send) send.innerHTML = state.streaming ? I.stop : I.send;
}

function wireAssistant() {
  const input = $("chatInput");
  const send = $("chatSend");
  if (!input || !send) return;
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  send.addEventListener("click", sendChat);

  document.querySelectorAll(".js-suggest").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.prompt;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";
      input.focus();
    });
  });
}

// Provider-agnostic streaming: kind is "chat" or "cover".
async function streamText(kind, payload, entry) {
  state.controller = new AbortController();
  const signal = state.controller.signal;
  state.streaming = true;
  let acc = "";
  const onToken = (full) => { acc = full; entry.text = full; persistChat(); renderChatOnly(); };
  const onStatus = (txt) => { if (!acc) { entry.text = txt; renderChatOnly(); } };
  try {
    if (kind === "chat") acc = await chatStream(payload.session, signal, onToken, onStatus);
    else acc = await coverStream(payload.fields, signal, onToken, onStatus);
    entry.text = acc;
    return acc;
  } catch (err) {
    if (signal.aborted && !acc) entry.text = "Stopped.";
    else entry.text = acc ? acc + "\n\n[Error: " + (err.message || err) + "]" : "[Error: " + (err.message || err) + "]";
    return entry.text;
  } finally {
    entry.streaming = false;
    state.streaming = false;
    state.controller = null;
    persistChat();
  }
}

// Build the enriched, model-only context for a message tied to an application.
// Includes the saved match analysis (gaps, strengths, recommendation) so the
// assistant can act on it instead of re-deriving from scratch. Never shown to
// the user (lives in apiText, not the visible message text).
function buildAppContext(app, question) {
  const lines = [
    "ATTACHED APPLICATION CONTEXT",
    "",
    "APPLICATION DETAILS",
    "- Company: " + (app.company || "Unknown"),
    "- Role: " + (app.role || "Unknown"),
    "- Status: " + (app.status || "Unknown"),
    "- Source: " + (app.source || "Unknown"),
  ];
  if (app.notes && app.notes.trim()) lines.push("- Notes: " + app.notes.trim());

  const a = app.matchAnalysis;
  if (a) {
    lines.push("", "SAVED MATCH ANALYSIS");
    if (a.summary) lines.push("- Fit summary: " + a.summary);
    const gaps = (a.missing_or_weak || []).slice(0, 5)
      .map((m) => m.requirement + " (" + m.severity + (m.suggestion ? "; suggestion: " + m.suggestion : "") + ")");
    if (gaps.length) lines.push("- Gaps to address: " + gaps.join(" | "));
    const strengths = (a.highlight_in_application || []).slice(0, 5);
    if (strengths.length) lines.push("- Strengths to lead with: " + strengths.join(" | "));
    if (a.overall_recommendation) lines.push("- Recommendation: " + a.overall_recommendation);
    lines.push("- Cover letter drafted: " + (app.coverLetter && app.coverLetter.trim() ? "yes" : "no"));
  }

  lines.push("", "JOB DESCRIPTION");
  lines.push((app.jobText || "").trim() || "Not provided. Base role-specific advice on the application details above, say that the job information is limited, and do not invent requirements.");
  lines.push("", "USER MESSAGE", question);
  return lines.join("\n");
}

export async function sendChat() {
  if (state.streaming) { if (state.controller) state.controller.abort(); return; }
  if (!requireProfile()) return;
  const input = $("chatInput");
  const text = (input?.value || "").trim();
  if (!text) return;
  input.value = "";
  const app = chatContextApp();
  const context = app ? buildAppContext(app, text) : text;
  const session = activeChat();
  if (!session.thread.length || session.title === "New chat" || session.title === "Assistant") {
    session.title = text.slice(0, 42) + (text.length > 42 ? "..." : "");
  }
  session.thread.push({ role: "user", kind: "text", text, apiText: context });
  // streaming:true keeps this pending bubble out of sessionMessages() — otherwise
  // a transient status line (e.g. local "Loading 50%…") would be sent back to the
  // model as a trailing assistant turn and rejected.
  const assistant = { role: "assistant", kind: "text", text: "", streaming: true };
  session.thread.push(assistant);
  // Flag streaming before the first paint so the typing indicator shows
  // immediately (streamText also sets it; this just avoids an empty-bubble flash).
  state.streaming = true;
  persistChat();
  renderSidebar();
  if (session.thread.length <= 2) {
    renderChatPage();
    const scrollEl = chatScrollEl();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  } else {
    renderChatOnly();
  }
  await streamText("chat", { session }, assistant);
  renderChatOnly();
}

export async function runCover(app) {
  if (!requireProfile()) return;
  if (!((app.jobText || "").trim() || app.company || app.role || (app.notes && app.notes.trim()))) {
    toast("Add a role, company, notes, or job description first");
    return;
  }
  const session = activeChat();
  const promptText = `Write a cover letter for the ${app.role || "this"} role at ${app.company || "this company"}.`;
  session.thread.push({ role: "user", kind: "text", text: promptText });

  const entry = { role: "assistant", kind: "cover", text: "", streaming: true };
  session.thread.push(entry);
  setChatContext(app.id);
  persistChat();
  state.viewMode = "chat";
  renderAll();
  try {
    const text = await streamText("cover", {
      fields: {
        profile: state.profile,
        job_posting: buildCoverContext(app),
        company: app.company,
        role: app.role,
        hiring_manager: "",
      },
    }, entry);
    app.coverLetter = text;
    touch(app);
    persistApps();
  } finally {
    renderAll();
  }
}

function buildCoverContext(app) {
  const lines = [];
  if (app.company) lines.push("Company: " + app.company);
  if (app.role) lines.push("Role / title: " + app.role);
  if (app.source) lines.push("Source: " + app.source);
  if (app.jobUrl) lines.push("Job URL: " + app.jobUrl);
  if (app.notes && app.notes.trim()) lines.push("User notes: " + app.notes.trim());
  const desc = (app.jobText || "").trim();
  lines.push("", "Job description:");
  lines.push(desc || "(No full job description provided. Write the cover letter from the company, role, source, notes, and the user's real profile only. Keep it general where requirements are unknown and do not invent job requirements.)");
  return lines.join("\n");
}

export function newChatSession() {
  const emptySession = state.chatSessions.find(s => s.thread.length === 0);
  if (emptySession) {
    state.activeChatId = emptySession.id;
    setChatContext("");
    state.viewMode = "chat";
    renderAll();
    return;
  }
  const s = { id: uid(), title: "New chat", createdAt: Date.now(), thread: [], contextAppId: "" };
  state.chatSessions.unshift(s);
  state.activeChatId = s.id;
  setChatContext("");
  state.viewMode = "chat";
  renderAll();
}
