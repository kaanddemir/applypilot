import assert from "node:assert/strict";
import test from "node:test";

test("a timer failure cannot prevent a status change from rendering", async () => {
  const originalSchedule = globalThis.setTimeout;
  const originalError = console.error;
  globalThis.document = { getElementById() { return null; } };
  globalThis.setTimeout = function () { throw new TypeError("Timer unavailable"); };
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const { applyStatusChange } = await import("../frontend/.test-dist/status-change.js");
    const app = { status: "Saved", updatedAt: 1 };
    const calls = [];
    assert.equal(applyStatusChange(app, "Applied", () => { calls.push("persist"); return true; }, () => calls.push("render")), "saved");
    assert.equal(app.status, "Applied");
    assert.deepEqual(calls, ["persist", "render"]);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /Notification dispatch failed/);
  } finally {
    globalThis.setTimeout = originalSchedule;
    console.error = originalError;
    delete globalThis.document;
  }
});
