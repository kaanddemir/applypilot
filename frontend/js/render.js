// Top-level render orchestration shared by every feature module.
"use strict";

import { state, $, esc, persistChat, persistView, uid } from "./state.js";
import { I } from "./icons.js";
import { updateProviderUI } from "./ai.js";
import { renderBoardPage, renderDetailPage } from "./board.js";
import { renderChatPage } from "./chat.js";
import { renderProfilePage } from "./profile.js";

let dropdownListenerAttached = false;

export function renderAll() {
  renderSidebar();
  renderMain();
  persistView();
}

export function renderSidebar() {
  const allCount = $("allCount");
  if (allCount) allCount.textContent = state.applications.length;
  $("boardNav").classList.toggle("active", state.viewMode === "board");
  $("chatNav").classList.toggle("active", state.viewMode === "chat");
  $("profileBtn").classList.toggle("active", state.viewMode === "profile");
  const collapsed = document.querySelector(".app")?.classList.contains("collapsed");
  const histSection = $("chatHistorySection");
  if (histSection) histSection.style.display = (state.viewMode === "chat" && !collapsed) ? "flex" : "none";
  renderChatHistory();
  updateProviderUI();
}

export function renderChatHistory() {
  const host = $("chatHistory");
  if (!host) return;
  host.innerHTML = "";
  if (state.viewMode !== "chat") return;
  state.chatSessions.slice(0, 12).forEach((s) => {
    const item = document.createElement("div");
    item.className = "history-item" + (s.id === state.activeChatId ? " active" : "");
    item.innerHTML =
      '<button class="history-open">' + I.chat + '<span class="history-title">' + esc(s.title || "New chat") + "</span></button>" +
      '<div class="history-more-container">' +
        '<button class="history-action js-more-btn" title="More options">' + I.more + "</button>" +
        '<div class="history-dropdown">' +
          '<button class="dropdown-item js-rename">' + I.edit + 'Rename</button>' +
          '<button class="dropdown-item js-delete danger">' + I.trash + 'Delete</button>' +
        '</div>' +
      '</div>';
    
    item.querySelector(".history-open").addEventListener("click", () => {
      state.activeChatId = s.id;
      state.viewMode = "chat";
      persistChat();
      closeMobileSidebar();
      renderAll();
    });
    
    const moreBtn = item.querySelector(".js-more-btn");
    const dropdown = item.querySelector(".history-dropdown");
    
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".history-dropdown.show").forEach((el) => {
        if (el !== dropdown) el.classList.remove("show");
      });
      dropdown.classList.toggle("show");
    });
    
    item.querySelector(".js-rename").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.remove("show");
      startRenameChat(item, s);
    });
    
    item.querySelector(".js-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.remove("show");
      deleteChatSession(s.id);
    });
    
    host.appendChild(item);
  });
  
  if (!dropdownListenerAttached) {
    dropdownListenerAttached = true;
    document.addEventListener("click", () => {
      document.querySelectorAll(".history-dropdown.show").forEach((el) => el.classList.remove("show"));
    });
  }
}

function startRenameChat(item, session) {
  const old = session.title || "New chat";
  item.innerHTML = '<input class="history-edit-input" value="' + esc(old) + '" />';
  const input = item.querySelector("input");
  input.focus();
  input.select();
  const finish = () => {
    const next = input.value.trim();
    if (next) session.title = next;
    persistChat();
    renderSidebar();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish();
    if (e.key === "Escape") renderSidebar();
  });
  input.addEventListener("blur", finish);
}

export function deleteChatSession(id) {
  state.chatSessions = state.chatSessions.filter((s) => s.id !== id);
  if (!state.chatSessions.length) {
    state.chatSessions.push({ id: uid(), title: "New chat", createdAt: Date.now(), thread: [], contextAppId: "" });
  }
  if (state.activeChatId === id || !state.chatSessions.some((s) => s.id === state.activeChatId)) {
    state.activeChatId = state.chatSessions[0].id;
  }
  persistChat();
  state.viewMode = "chat";
  renderAll();
}

export function renderMain() {
  if (state.viewMode === "chat") renderChatPage();
  else if (state.viewMode === "detail") renderDetailPage();
  else if (state.viewMode === "profile") renderProfilePage();
  else renderBoardPage();
}

export function closeMobileSidebar() { $("sidebar").classList.remove("open"); }
