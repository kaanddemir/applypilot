import assert from "node:assert/strict";
import test from "node:test";

const feedback = await import("../frontend/.test-dist/operation-notifications.js");

function recorder() {
  const calls = [];
  const output = Object.fromEntries(["success", "error", "warning", "info"].map((tone) => [tone, (...args) => calls.push({ tone, args })]));
  return { calls, output };
}

test("application save reports confirmed success and persistence failure accurately", () => {
  const { calls, output } = recorder();
  feedback.applicationSaveFeedback(true, false, output);
  feedback.applicationSaveFeedback(true, true, output);
  feedback.applicationSaveFeedback(false, true, output);
  assert.deepEqual(calls.map((call) => [call.tone, call.args[0]]), [
    ["success", "Application added."], ["success", "Application updated."], ["error", "Application could not be saved."],
  ]);
  assert.match(calls[2].args[1].detail, /remain in this tab/);
});

test("deletion distinguishes successful deletion from failed persistence", () => {
  const { calls, output } = recorder();
  feedback.deletionFeedback(true, 1, output);
  feedback.deletionFeedback(true, 3, output);
  feedback.deletionFeedback(false, 2, output);
  assert.deepEqual(calls.map((call) => call.args[0]), ["Application deleted.", "3 applications deleted.", "Deletion could not be saved."]);
  assert.equal(calls[2].tone, "error");
});

test("status changes only report movement when persistence succeeds", () => {
  const { calls, output } = recorder();
  feedback.statusFeedback(true, "Interview", output);
  feedback.statusFeedback(false, "Offer", output);
  assert.deepEqual(calls.map((call) => [call.tone, call.args[0]]), [["info", "Moved to Interview."], ["error", "Changes could not be saved."]]);
});

test("CV save outcomes distinguish complete, partial, and failed saves", () => {
  const { calls, output } = recorder();
  feedback.cvSaveFeedback({ textSaved: true, fileSaved: true }, false, output);
  feedback.cvSaveFeedback({ textSaved: true, fileSaved: true }, true, output);
  feedback.cvSaveFeedback({ textSaved: false, fileSaved: false }, false, output);
  assert.deepEqual(calls.map((call) => call.tone), ["success", "warning", "error"]);
  assert.deepEqual(calls.map((call) => call.args[0]), ["CV saved.", "CV text saved.", "CV could not be saved."]);
});

test("CV parsing failure produces one actionable warning", () => {
  const { calls, output } = recorder();
  feedback.cvFileFailureFeedback("No selectable text was found in that file.", output);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tone, "warning");
  assert.equal(calls[0].args[1].key, "cv-file-error");
});

test("import reports success, partial duplicates, and in-memory-only failure", () => {
  const { calls, output } = recorder();
  feedback.importFeedback({ added: 2, skipped: 0 }, true, output);
  feedback.importFeedback({ added: 1, skipped: 2 }, true, output);
  feedback.importFeedback({ added: 3, skipped: 0 }, false, output);
  assert.deepEqual(calls.map((call) => call.tone), ["success", "warning", "error"]);
  assert.match(calls[1].args[1].detail, /2 duplicates skipped/);
  assert.match(calls[2].args[1].detail, /loaded in this tab/);
});

test("empty successful import is informational rather than a false success", () => {
  const { calls, output } = recorder();
  feedback.importFeedback({ added: 0, skipped: 0 }, true, output);
  assert.deepEqual([calls[0].tone, calls[0].args[0]], ["info", "No new applications found."]);
});

test("analysis success is not reported when persistence fails", () => {
  const { calls, output } = recorder();
  feedback.analysisFeedback(true, output);
  feedback.analysisFeedback(false, output);
  assert.deepEqual(calls.map((call) => [call.tone, call.args[0]]), [["success", "Analysis completed."], ["error", "Analysis could not be saved."]]);
});

test("autosave feedback announces confirmed saves once and keeps failures persistent", () => {
  const { output, calls } = recorder();
  feedback.autosaveFeedback(true, "Notes", true, output);
  feedback.autosaveFeedback(true, "Notes", false, output);
  feedback.autosaveFeedback(true, "Job description", true, output);
  feedback.autosaveFeedback(false, "Job description", false, output);
  assert.deepEqual(calls, [
    { tone: "success", args: ["Notes saved.", { key: "autosave-notes" }] },
    { tone: "success", args: ["Job description saved.", { key: "autosave-job-description" }] },
    { tone: "error", args: ["Changes could not be saved.", {
      detail: "Job description changes remain in this tab. Export a backup before closing it.",
      key: "storage-save-failed",
    }] },
  ]);
});
