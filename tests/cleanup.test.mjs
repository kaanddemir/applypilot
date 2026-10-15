import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const values = new Map([
  ["applypilot_view", "chat"],
]);

globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
globalThis.document = {
  getElementById() { return null; },
  querySelector() { return null; },
  createElement() { return { set textContent(value) { this.innerHTML = String(value); }, innerHTML: "" }; },
};
globalThis.location = { port: "8000" };

test("removed feature fields and views are normalized out", async () => {
  const { state, normalizeApps } = await import("../frontend/.test-dist/state.js?cleanup");
  assert.equal(state.viewMode, "board");
  const [app] = normalizeApps([{ company: "Legacy Co", coverLetter: "Historical draft" }]);
  assert.equal(Object.hasOwn(app, "coverLetter"), false);

  const storeSource = await readFile(new URL("../frontend/src/store.ts", import.meta.url), "utf8");
  for (const obsolete of ["sessions", "keyClaude", "keyOpenai", "keyGemini", "localModel", "modelGemini"]) {
    assert.equal(storeSource.includes(obsolete), false, `${obsolete} should be removed`);
  }
});

test("removed features have no active entry points or provider transports", async () => {
  const [html, main, board, ai, prompts] = await Promise.all([
    readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/board.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/prompts.py", import.meta.url), "utf8"),
  ]);
  const activeSource = [html, main, board, ai, prompts].join("\n");
  for (const removed of [
    "chatNav", "newChatBtn", "Ask in Chat", "Cover letter", "web-llm",
    "api.anthropic.com", "api.openai.com", "MODE 1", "MODE 3",
  ]) {
    assert.equal(activeSource.includes(removed), false, `${removed} should not remain active`);
  }
  assert.match(ai, /fetch\("\/api\/analyze-job"/);
  assert.doesNotMatch(ai, /generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.openai\.com/);
  assert.match(html, /id="brandHome"/);
  assert.match(html, /id="profileBtn"/);
});

test("analysis uses the same-origin backend contract without a live provider call", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      headers: { get() { return null; } },
      async json() {
        return { schema_version: 3, input_assessment: { status: "limited", explanation: "Short posting" },
          overall_assessment: "Partial fit", requirements: [], eligibility_conditions: [] };
      },
    };
  };

  const ai = await import("../frontend/.test-dist/api.js?cleanup");
  const result = await ai.analyze("Role: Engineer", "Experienced engineer profile");
  assert.equal(result.overall_assessment, "Partial fit");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/analyze-job");
  const requestBody = JSON.parse(requests[0].options.body);
  assert.equal(requestBody.profile, "Experienced engineer profile");
  assert.equal(requestBody.job_information, "Role: Engineer");
});

test("all frontend API requests are same-origin for custom backend ports", async () => {
  const [ai, profile] = await Promise.all([
    readFile(new URL("../frontend/src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/profile.ts", import.meta.url), "utf8"),
  ]);
  assert.match(ai, /fetch\("\/api\/analyze-job"/);
  assert.match(profile, /fetch\("\/api\/parse-profile-file"/);
  assert.doesNotMatch(ai + profile, /localhost:8000|location\.port/);
});

test("storage failures fall back safely without clearing unrelated keys", async () => {
  globalThis.localStorage = {
    getItem() { throw new Error("disabled"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("disabled"); },
  };
  const { store } = await import("../frontend/.test-dist/store.js?storage-failure");
  assert.equal(store.get("missing", "fallback"), "fallback");
  assert.deepEqual(store.getJSON("broken", []), []);
  assert.equal(store.set("key", "value"), false);
  assert.equal(store.setJSON("key", { safe: true }), false);
  assert.doesNotThrow(() => store.remove("key"));
});

test("Vite proxy target is configurable while browser API calls stay relative", async () => {
  const [viteConfig, envExample] = await Promise.all([
    readFile(new URL("../frontend/vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(viteConfig, /APPLYPILOT_BACKEND_URL/);
  assert.match(viteConfig, /"\/api"/);
  assert.match(envExample, /http:\/\/127\.0\.0\.1:8000/);
});
