import assert from "node:assert/strict";
import test from "node:test";

const values = new Map([["applypilot_applications", "{broken-json"]]);
globalThis.localStorage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
const { applicationLoadIssue, persistApps, state } = await import("../frontend/.test-dist/state.js");

test("ordinary saves preserve malformed storage until an explicit backup import replaces it", () => {
  assert.equal(applicationLoadIssue, "malformed");
  state.applications = [{ id: "AP-1234-5678", company: "Restored", role: "Engineer", jobSources: [], status: "Saved", appliedAt: "", notes: "", jobText: "", matchAnalysis: null, analysisMeta: null, createdAt: 1, updatedAt: 1 }];
  assert.equal(persistApps(), false);
  assert.equal(values.get("applypilot_applications"), "{broken-json");
  assert.equal(persistApps(true), true);
  assert.equal(JSON.parse(values.get("applypilot_applications"))[0].company, "Restored");
  assert.equal(persistApps(), true);
});
