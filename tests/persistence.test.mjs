import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
globalThis.document = {
  createElement() { return { innerHTML: "", set textContent(value) { this.innerHTML = String(value); } }; },
  getElementById() { return null; },
};

const { store } = await import("../frontend/.test-dist/store.js");
const { normalizeApps, esc } = await import("../frontend/.test-dist/state.js");
const { analysisFreshness, analysisInputFingerprint } = await import("../frontend/.test-dist/analysis-integrity.js");

function app(overrides = {}) {
  return normalizeApps([{
    id: "AP-1234-5678", company: "Acme", role: "Engineer", status: "Saved",
    jobSources: [], appliedAt: "", notes: "", jobText: "Build reliable systems",
    matchAnalysis: null, analysisMeta: null, createdAt: 100, updatedAt: 100, ...overrides,
  }])[0];
}

test("untrusted text cannot break out of quoted HTML attributes", () => {
  assert.equal(esc(`\" autofocus onfocus=alert(1) x='><img src=x onerror=alert(1)>&`),
    "&quot; autofocus onfocus=alert(1) x=&#39;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;");
  assert.equal(esc("İş zekâsı 😀"), "İş zekâsı 😀");
  assert.equal(esc(null), "");
});

test("corrupt saved sort settings fall back before entering DOM selectors", async () => {
  values.set("applypilot_sort", '\"]invalid[');
  const { state } = await import("../frontend/.test-dist/state.js?invalid-sort");
  assert.equal(state.sortBy, "updated");
  values.delete("applypilot_sort");
});

test("malformed JSON is reported and left untouched", () => {
  values.set("broken", "{not-json");
  const result = store.readJSON("broken", []);
  assert.equal(result.ok, false);
  assert.equal(result.error, "malformed");
  assert.equal(values.get("broken"), "{not-json");
});

test("normalization isolates invalid records and repairs duplicate IDs", () => {
  const records = normalizeApps([
    { id: "AP-1234-5678", company: "One", role: "Engineer", status: "Applied", createdAt: "2026-01-02" },
    null,
    {},
    { id: "AP-1234-5678", company: "Two", role: "Designer", status: "invalid" },
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].id, "AP-1234-5678");
  assert.notEqual(records[1].id, records[0].id);
  assert.equal(records[1].status, "Saved");
  assert.equal(records[0].createdAt, Date.parse("2026-01-02"));
});

test("restored analysis with excessive nested content is not rendered", () => {
  const restored = app({ matchAnalysis: {
    schema_version: 3,
    input_assessment: { status: "adequate", explanation: "Enough detail" },
    overall_assessment: "Overview",
    requirements: Array.from({ length: 101 }, (_, index) => ({
      id: `req-${index + 1}`, requirement: "Python", priority: "required", category: "skill",
      status: "unknown", job_evidence: "Python", profile_evidence: null, explanation: "Unknown",
    })),
    eligibility_conditions: [],
  } });
  assert.equal(restored.matchAnalysis, null);
});

test("analysis freshness tracks both job and profile inputs", () => {
  const current = app();
  current.matchAnalysis = {
    schema_version: 3, input_assessment: { status: "adequate", explanation: "Full posting" },
    overall_assessment: "Fit", requirements: [{ id: "req-1", requirement: "Systems", priority: "required", category: "skill", status: "verified", job_evidence: "reliable systems", profile_evidence: "Experienced engineer", explanation: "Direct evidence" }],
    eligibility_conditions: [],
  };
  current.analysisMeta = {
    schemaVersion: 3, source: "gemini", createdAt: 200,
    inputFingerprint: analysisInputFingerprint(current, "Experienced engineer"),
  };
  assert.equal(analysisFreshness(current, "Experienced engineer"), "current");
  current.notes = "Private tracking note";
  assert.equal(analysisFreshness(current, "Experienced engineer"), "current");
  current.jobText = "New requirement";
  assert.equal(analysisFreshness(current, "Experienced engineer"), "stale");
  assert.equal(analysisFreshness(app({ matchAnalysis: current.matchAnalysis }), "Experienced engineer"), "unverified");
  assert.equal(analysisFreshness(app({ matchAnalysis: current.matchAnalysis, analysisMeta: { ...current.analysisMeta, source: "imported" } }), "Experienced engineer"), "imported");
});
