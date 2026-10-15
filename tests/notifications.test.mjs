import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { NotificationStore, NOTIFICATION_DURATIONS } = await import("../frontend/.test-dist/notification-store.js");

function setup(limit = 4) {
  let id = 0;
  const scheduled = new Map();
  const store = new NotificationStore(
    limit,
    (fn, delay) => { const timer = ++id; scheduled.set(timer, { fn, delay }); return timer; },
    (timer) => scheduled.delete(timer),
  );
  return { store, scheduled };
}

test("notification tones use standardized dismissal policies", () => {
  assert.deepEqual(NOTIFICATION_DURATIONS, { success: 4000, info: 5000, warning: 7000, error: 0 });
  const { store, scheduled } = setup();
  store.add({ tone: "success", message: "Saved" });
  store.add({ tone: "info", message: "Moved" });
  store.add({ tone: "warning", message: "Skipped" });
  store.add({ tone: "error", message: "Failed" });
  assert.deepEqual(store.visible.map((item) => item.tone), ["success", "info", "warning", "error"]);
  assert.equal(store.visible.at(-1).persistent, true);
  assert.deepEqual([...scheduled.values()].map((entry) => entry.delay), [4000, 5000, 7000]);
});

test("visible limit queues notifications and manual dismissal promotes the next", () => {
  const { store } = setup(2);
  const first = store.add({ tone: "info", message: "One" });
  store.add({ tone: "success", message: "Two" });
  store.add({ tone: "warning", message: "Three" });
  assert.deepEqual(store.visible.map((item) => item.message), ["One", "Two"]);
  assert.deepEqual(store.queued.map((item) => item.message), ["Three"]);
  assert.equal(store.dismiss(first), true);
  assert.deepEqual(store.visible.map((item) => item.message), ["Two", "Three"]);
});

test("duplicates are suppressed and keyed progress updates do not flood the queue", () => {
  const { store } = setup();
  const first = store.add({ tone: "success", message: "Application saved." });
  const duplicate = store.add({ tone: "success", message: "Application saved." });
  const progress = store.add({ tone: "info", message: "Starting", key: "work" });
  const updated = store.add({ tone: "info", message: "Finishing", key: "work" });
  assert.equal(first, duplicate);
  assert.equal(progress, updated);
  assert.equal(store.visible.length, 2);
  assert.equal(store.visible[1].message, "Finishing");
});

test("critical errors remain visible until dismissed and displace routine feedback without deleting it", () => {
  const { store, scheduled } = setup(2);
  store.add({ tone: "info", message: "One" });
  store.add({ tone: "success", message: "Two" });
  const error = store.add({ tone: "error", message: "Important" });
  assert.ok(store.visible.some((item) => item.id === error));
  assert.ok(store.queued.some((item) => item.message === "Two"));
  for (const timer of [...scheduled.values()]) timer.fn();
  assert.ok(store.visible.some((item) => item.id === error));
  store.dismiss(error);
  assert.equal(store.visible.some((item) => item.id === error), false);
});

test("notification host is unique, persistent across app rerenders, accessible, and theme-token based", async () => {
  const [html, source, css, state] = await Promise.all([
    readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/notifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/css/base.css", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/state.ts", import.meta.url), "utf8"),
  ]);
  assert.equal((html.match(/id="notificationCenter"/g) || []).length, 1);
  assert.ok(html.indexOf("notificationCenter") > html.indexOf('<div class="app">') && html.indexOf("notificationCenter") > html.indexOf("</div>\n\n<div class=\"overlay\""));
  assert.match(source, /role.*alert/);
  assert.match(source, /aria-live/);
  assert.match(source, /Dismiss notification/);
  assert.doesNotMatch(source, /replaceChildren/);
  assert.match(css, /\.notification-center[\s\S]*position: fixed/);
  assert.match(css, /right:/);
  assert.match(css, /bottom:/);
  assert.match(css, /var\(--surface-raised\)/);
  const notificationRule = css.match(/\.notification \{([^}]*)\}/)?.[1] || "";
  assert.match(notificationRule, /grid-template-columns: 18px minmax\(0, 1fr\) 32px/);
  assert.match(notificationRule, /align-items: center/);
  assert.match(notificationRule, /padding: 8px 10px/);
  assert.match(notificationRule, /text-align: left/);
  const closeRule = css.match(/\.notification-close \{([^}]*)\}/)?.[1] || "";
  assert.match(closeRule, /width: 32px; height: 32px/);
  assert.doesNotMatch(closeRule, /margin:/);
  assert.doesNotMatch(state, /function toast|toastTimer/);
});
