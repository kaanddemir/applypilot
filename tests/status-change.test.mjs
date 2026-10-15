import assert from "node:assert/strict";
import test from "node:test";

const { applyStatusChange } = await import("../frontend/.test-dist/status-change.js");
const { createDragController } = await import("../frontend/.test-dist/kanban-drag.js");

function notifier(events) {
  return {
    success: (...args) => events.push(["success", ...args]),
    error: (...args) => events.push(["error", ...args]),
    warning: (...args) => events.push(["warning", ...args]),
    info: (...args) => events.push(["info", ...args]),
  };
}

test("real drop pathway mutates, persists, renders, then reports movement", () => {
  const app = { status: "Saved", updatedAt: 1 };
  const order = [];
  const notifications = [];
  const drag = createDragController((_id, status) => {
    const output = notifier(notifications);
    output.info = (...args) => {
      order.push("feedback");
      notifications.push(["info", ...args]);
    };
    applyStatusChange(
      app,
      status,
      () => { order.push("persist"); return true; },
      () => order.push("render"),
      output,
      () => 200,
    );
  });
  drag.start("a1", "Saved");
  assert.equal(drag.drop("Interview"), true);
  assert.equal(app.status, "Interview");
  assert.equal(app.updatedAt, 200);
  assert.deepEqual(order, ["persist", "render", "feedback"]);
  assert.deepEqual(notifications.map((entry) => entry.slice(0, 2)), [["info", "Moved to Interview."]]);
});

test("failed persistence still renders the in-memory move and reports a persistent error", () => {
  const app = { status: "Applied", updatedAt: 1 };
  const order = [];
  const notifications = [];
  const result = applyStatusChange(
    app,
    "Offer",
    () => { order.push("persist"); return false; },
    () => order.push("render"),
    notifier(notifications),
    () => 300,
  );
  assert.equal(result, "unsaved");
  assert.equal(app.status, "Offer");
  assert.deepEqual(order, ["persist", "render"]);
  assert.equal(notifications[0][0], "error");
  assert.equal(notifications[0][1], "Changes could not be saved.");
});

test("invalid same-column and cancelled drops do not mutate, persist, render, or notify", () => {
  const app = { status: "Rejected", updatedAt: 1 };
  const calls = [];
  const output = notifier(calls);
  assert.equal(applyStatusChange(app, "Rejected", () => { throw new Error("must not persist"); }, () => { throw new Error("must not render"); }, output), "unchanged");
  const drag = createDragController(() => { throw new Error("cancelled drag must not move"); });
  drag.start("a1", "Rejected");
  drag.end();
  assert.equal(drag.drop("Offer"), false);
  assert.deepEqual(app, { status: "Rejected", updatedAt: 1 });
  assert.deepEqual(calls, []);
});
