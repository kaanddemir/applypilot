import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [wizards, profile, main, css, html] = await Promise.all([
  "../frontend/src/wizards.ts", "../frontend/src/profile.ts", "../frontend/src/main.ts",
  "../frontend/css/base.css", "../frontend/index.html",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("deletion confirmations identify their targets and require an explicit action", () => {
  assert.match(wizards, /<h2>Delete /);
  assert.match(wizards, /list\.length \+ " applications"/);
  assert.match(wizards, /confirmation-target.*esc\(list\[0\]\.company/);
  assert.match(wizards, /esc\(list\[0\]\.role/);
  assert.match(wizards, /cannot be undone/);
  assert.match(wizards, /id="wizCancel"[^>]*>Cancel/);
  assert.match(wizards, /id="confirmDelete"/);
  assert.match(wizards, /\$\("wizCancel"\)\.addEventListener\("click", closeModal\)/);
  assert.match(wizards, /const saved = persistApps\(\);[\s\S]*?deletionFeedback\(saved, list\.length\)/);
});

test("CV deletion retains its data-loss warning, cancellation path, and persistence feedback", () => {
  assert.match(profile, /<h2>Delete CV\?<\/h2>/);
  assert.match(profile, /marks existing analyses out of date\. This cannot be undone/);
  assert.match(profile, /\$\("wizCancel"\)\.addEventListener\("click", onCancel\)/);
  assert.match(profile, /const saved = persistProfile\(\);[\s\S]*?cvDeleteFeedback\(saved\)/);
});

test("shared dialog keeps accessible focus, dismissal, and compact responsive styling", () => {
  assert.match(html, /id="modal" role="dialog" aria-modal="true"/);
  assert.match(wizards, /aria-labelledby", "modalTitle"/);
  assert.match(wizards, /aria-describedby", "modalDescription"/);
  assert.match(wizards, /modal\.querySelector\("#wizCancel"\)/);
  assert.match(wizards, /function modalFocusables\(/);
  assert.match(wizards, /saved\?\.el\?\.isConnected/);
  assert.match(main, /e\.key !== "Escape"/);
  assert.match(main, /e\.target === \$\("overlay"\)/);
  assert.match(css, /\.modal\.confirmation\s*\{[^}]*width:\s*min\(420px, 100%\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.confirmation \.modal-foot/);
});
