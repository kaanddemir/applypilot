// localStorage wrapper + key namespace.
"use strict";

export const LS = {
  profile: "applypilot_profile",
  profileFile: "applypilot_profile_file",
  sessions: "applypilot_sessions",
  active: "applypilot_active",
  applications: "applypilot_applications",
  provider: "applypilot_provider",
  localModel: "applypilot_local_model",
  // Cloud provider API keys — stored ONLY here, never sent to our backend.
  keyClaude: "applypilot_key_claude",
  keyOpenai: "applypilot_key_openai",
  keyGemini: "applypilot_key_gemini",
  modelClaude: "applypilot_model_claude",
  modelOpenai: "applypilot_model_openai",
  modelGemini: "applypilot_model_gemini",
  // UI state persisted across reloads.
  view: "applypilot_view",
  selectedId: "applypilot_selected",
  boardLayout: "applypilot_board_layout",
  filter: "applypilot_filter",
  sortBy: "applypilot_sort",
  collapsed: "applypilot_sidebar_collapsed",
};

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
  remove(k) { try { localStorage.removeItem(k); } catch (_) {} },
  getJSON(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
};
