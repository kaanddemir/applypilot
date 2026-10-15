import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { renderAnalysisContent } = await import("../frontend/.test-dist/analysis-view.js");
const { hasSufficientJobDescription, analysisInputFingerprint } = await import("../frontend/.test-dist/analysis-integrity.js");
const { analysisStatusMessage } = await import("../frontend/.test-dist/analysis-message.js");

const analysis = {
  schema_version: 3,
  input_assessment: { status: "limited", explanation: "The posting is concise." },
  overall_assessment: "The core skill is supported, while authorization is unresolved.",
  requirements: [
    { id: "req-1", requirement: "TypeScript", priority: "required", category: "skill", status: "verified", job_evidence: "TypeScript is required", profile_evidence: "Built TypeScript services", explanation: "Direct support." },
    { id: "req-2", requirement: "Work authorization", priority: "required", category: "work_authorization", status: "unknown", job_evidence: "authorized to work", profile_evidence: null, explanation: "A CV cannot establish this." },
  ],
  eligibility_conditions: [{ requirement_id: "req-2", condition: "Work authorization", status: "unknown", warning: "Potentially blocking condition." }],
};

test("analysis rendering exposes status counts, evidence, and eligibility", () => {
  const html = renderAnalysisContent(analysis);
  for (const label of ["Required qualifications", "Verified", "Unknown", "Unverified", "Job Evidence", "Profile Evidence", "Eligibility conditions"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /improvement|recommendation|next step/i);
});

test("analysis rendering escapes provider-controlled text", () => {
  const html = renderAnalysisContent({ ...analysis, overall_assessment: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("legacy analyses are never rendered as evidence-verified", () => {
  const html = renderAnalysisContent({ summary: "Strong fit", matched_requirements: [], missing_or_weak: [], ats_keywords: [], resume_bullets: [], highlight_in_application: [], overall_recommendation: "Apply" });
  assert.match(html, /Previous analysis can't be verified/);
  assert.doesNotMatch(html, /class="analysis-status/);
});

test("analysis status chooses one useful message without changing eligibility", () => {
  const jobText = "Applicants must hold an active CISSP certification for this security role.";
  const app = { company: "Acme", role: "Engineer", jobText, jobSources: [], notes: "", matchAnalysis: null, analysisMeta: null };
  assert.equal(analysisStatusMessage({ ...app, jobText: "" }, ""), "Add job requirements to enable analysis.");
  assert.equal(analysisStatusMessage(app, ""), "Add your CV to enable analysis.");
  assert.equal(analysisStatusMessage(app, "My CV"), "Ready to analyze this application.");

  const current = { ...app, matchAnalysis: analysis, analysisMeta: { source: "gemini", schemaVersion: 3, inputFingerprint: analysisInputFingerprint(app, "My CV") } };
  assert.equal(analysisStatusMessage(current, "My CV"), "");
  assert.equal(analysisStatusMessage(current, "Updated CV"), "");
  assert.equal(analysisStatusMessage({ ...current, analysisMeta: null }, "My CV"), "");
  assert.equal(analysisStatusMessage({ ...current, analysisMeta: { ...current.analysisMeta, source: "imported" } }, "My CV"), "");
  assert.equal(analysisStatusMessage({ ...current, matchAnalysis: { summary: "Legacy" } }, "My CV"), "");
});

test("job input sufficiency requires substantive description text", () => {
  assert.equal(hasSufficientJobDescription("Senior Engineer at Acme"), false);
  assert.equal(hasSufficientJobDescription("Applicants must hold an active CISSP certification for this security role."), true);
});

test("Turkish requirement wording enables analysis without changing UI language", async () => {
  assert.equal(hasSufficientJobDescription("Bu pozisyon için en az üç yıl SQL deneyimi zorunludur."), true);
  const files = await Promise.all([
    "../frontend/index.html", "../frontend/src/board.ts", "../frontend/src/analysis-view.ts",
    "../frontend/src/api.ts", "../frontend/src/profile.ts", "../frontend/src/wizards.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.doesNotMatch(files.join("\n"), /[çğıöşüİ]/u);
});
