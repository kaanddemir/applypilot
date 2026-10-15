import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
let systemDark = false;
const listeners = [];
globalThis.window = {
  matchMedia() { return { get matches() { return systemDark; }, addEventListener(_, fn) { listeners.push(fn); } }; },
};
globalThis.document = { documentElement: { dataset: {} }, getElementById() { return null; } };

const theme = await import("../frontend/.test-dist/theme.js");

test("theme preference defaults to system and resolves from the OS", () => {
  assert.equal(theme.parseThemePreference(null), "system");
  assert.equal(theme.parseThemePreference("bogus"), "system");
  assert.equal(theme.resolveTheme("system", true), "dark");
  assert.equal(theme.resolveTheme("system", false), "light");
  assert.equal(theme.resolveTheme("light", true), "light");
});

test("explicit choices persist and System clears the override", () => {
  theme.setThemePreference("dark");
  assert.equal(values.get("applypilot_theme"), "dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
  theme.setThemePreference("system");
  assert.equal(values.has("applypilot_theme"), false);
  assert.equal(document.documentElement.dataset.theme, "light");
});

test("OS changes apply only while System is selected", () => {
  let calls = 0;
  theme.watchSystemTheme(() => { calls += 1; });
  systemDark = true;
  listeners.forEach((fn) => fn());
  assert.equal(document.documentElement.dataset.theme, "dark");
  theme.setThemePreference("light");
  listeners.forEach((fn) => fn());
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(calls, 1);
  theme.setThemePreference("system");
  systemDark = false;
});

test("pre-paint script uses the same key and the sidebar is gone", async () => {
  const [html, store] = await Promise.all([
    readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /theme: "applypilot_theme"/);
  assert.match(html, /localStorage\.getItem\("applypilot_theme"\)/);
  assert.ok(html.indexOf("applypilot_theme") < html.indexOf(`rel="stylesheet"`), "theme must resolve before styles load");
  for (const removed of ["sidebar", "collapseBtn", "menuBtn", "mobile-topbar"]) assert.equal(html.includes(removed), false, removed);
  assert.match(html, /id="addAppBtn"/);
});

test("theme selection remains active in this tab when browser storage fails", () => {
  const originalSet = localStorage.setItem;
  const originalRemove = localStorage.removeItem;
  try {
    theme.setThemePreference("system");
    systemDark = true;
    localStorage.setItem = () => { throw new Error("Storage unavailable"); };
    theme.setThemePreference("light");
    assert.equal(theme.themePreference(), "light", "menu must reflect the applied choice");
    listeners.forEach((fn) => fn());
    assert.equal(document.documentElement.dataset.theme, "light", "OS changes must respect the unsaved explicit choice");
    localStorage.setItem = originalSet;
    theme.setThemePreference("dark");
    localStorage.removeItem = () => { throw new Error("Storage unavailable"); };
    theme.setThemePreference("system");
    assert.equal(theme.themePreference(), "system");
    systemDark = false;
    listeners.forEach((fn) => fn());
    assert.equal(document.documentElement.dataset.theme, "light", "an unsaved System choice must still follow the OS");
  } finally {
    localStorage.setItem = originalSet;
    localStorage.removeItem = originalRemove;
    theme.setThemePreference("system");
    systemDark = false;
  }
});
