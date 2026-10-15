import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analyze } from "../frontend/.test-dist/api.js";
import { acceptAnalysisResult, analysisFreshness, analysisInputFingerprint, buildJobContext, captureAnalysisInput, hasSufficientJobDescription } from "../frontend/.test-dist/analysis-integrity.js";

const profile = "Experienced software engineer with Python skills.";
const previous = { schema_version: 3, overall_assessment: "Previous result", requirements: [{}] };
const result = { schema_version: 3, overall_assessment: "New result", requirements: [{}] };
const application = () => ({ id: "AP-1234-5678", jobText: "Strong Python and SQL skills for building scalable services.", company: "Private company", role: "Engineer", notes: "PRIVATE_NOTE", jobSources: [{ url: "https://example.com/?token=SECRET_URL", source: "Private" }], matchAnalysis: previous, analysisMeta: null });

test("dispatch includes only the description and captures immutable request strings", () => {
  const app = application();
  const snapshot = captureAnalysisInput(app, profile);
  assert.equal(snapshot.jobInformation, `Job description:\n${app.jobText}`);
  assert.doesNotMatch(snapshot.jobInformation, /PRIVATE|SECRET|company|Engineer/);
  app.jobText = "Changed job";
  assert.match(snapshot.jobInformation, /Strong Python/);
});

test("in-flight edits preserve the existing result rather than relabeling it current", async () => {
  for (const change of ["job", "profile", "delete", "replace", "result"]) {
    const app = application();
    const apps = [app];
    const snapshot = captureAnalysisInput(app, profile);
    let currentProfile = profile;
    const deferred = Promise.resolve(result);
    if (change === "job") app.jobText += " New qualifications";
    if (change === "profile") currentProfile += " Changed CV";
    if (change === "delete") apps.splice(0);
    if (change === "replace") apps[0] = { ...app };
    if (change === "result") app.matchAnalysis = { ...previous, overall_assessment: "Concurrent result" };
    const retained = app.matchAnalysis;
    assert.equal(acceptAnalysisResult(snapshot, apps, currentProfile, await deferred), false, change);
    assert.equal(app.matchAnalysis, retained, change);
    assert.equal(app.analysisMeta, null);
  }
});

test("navigation and tracking-note changes do not redirect a completed result", () => {
  const app = application();
  const other = { ...application(), id: "AP-2345-6789" };
  const snapshot = captureAnalysisInput(app, profile);
  app.notes = "Updated tracking note";
  assert.equal(acceptAnalysisResult(snapshot, [other, app], profile, result), true);
  assert.equal(app.matchAnalysis, result);
  assert.equal(other.matchAnalysis, previous);
  assert.equal(app.analysisMeta.inputFingerprint, snapshot.fingerprint);
  assert.equal(analysisFreshness(app, profile), "current");
  assert.equal(analysisFreshness(app, profile + "Changed"), "stale");
});

test("freshness uses minimized inputs and invalidates pre-fix fingerprints", () => {
  const app = application();
  const fingerprint = analysisInputFingerprint(app, profile);
  app.notes = "Unrelated"; app.jobSources = []; app.company = "Other";
  assert.equal(analysisInputFingerprint(app, profile), fingerprint);
  app.analysisMeta = { schemaVersion: 3, source: "gemini", inputFingerprint: "v3-12345678" };
  assert.equal(analysisFreshness(app, profile), "stale");
});

test("valid skills wording and meaningless descriptions match the backend gate", () => {
  assert.equal(hasSufficientJobDescription(application().jobText), true);
  for (const value of ["", "Engineer at Acme", "Welcome to our friendly team and office"]) assert.equal(hasSufficientJobDescription(value), false);
});

test("failure does not replace saved analysis and provider internals stay hidden", async () => {
  const original = globalThis.fetch;
  try {
    for (const code of ["output_exhausted", "incomplete_analysis", "provider_configuration", "provider_timeout", "provider_quota"]) {
      const app = application();
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { code, message: "finishReason=MAX_TOKENS req-11 PRIVATE_CV" } }), { status: 502 });
      await assert.rejects(analyze(buildJobContext(app), profile), (error) => error.code === code && !/MAX_TOKENS|req-11|PRIVATE_CV/.test(error.message));
      assert.equal(app.matchAnalysis, previous);
    }
  } finally { globalThis.fetch = original; }
});


test("shared sufficiency fixtures agree with the backend", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/sufficiency_cases.json", import.meta.url), "utf8"));
  for (const item of cases) assert.equal(hasSufficientJobDescription(item.text), item.sufficient, item.text);
});
