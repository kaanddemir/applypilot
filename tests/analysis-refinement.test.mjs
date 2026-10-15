import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { renderAnalysisContent, renderAnalysisIndicators, toggleRequirement } = await import("../frontend/.test-dist/analysis-view.js");
const { analysisInputFingerprint } = await import("../frontend/.test-dist/analysis-integrity.js");
const { analysisStatusMessage } = await import("../frontend/.test-dist/analysis-message.js");
const profile = "A documented CV with English and Python experience.";
const analysis = {
  schema_version: 3,
  input_assessment: { status: "adequate", explanation: "Original input explanation." },
  overall_assessment: "Original assessment text.",
  requirements: ["verified", "partial", "unknown", "not_found", "contradicted"].map((status, index) => ({
    id: `req-${index + 1}`, requirement: `Original requirement ${index}`, priority: index ? "preferred" : "required",
    category: "skill", status, job_evidence: "Original-language job quote", profile_evidence: null, explanation: "Original explanation.",
  })),
  eligibility_conditions: [
    { requirement_id: "req-1", condition: "Good command of written and spoken English", status: "verified", warning: "Original warning <with markup> & exact punctuation." },
    { requirement_id: "req-3", condition: "Willingness to travel abroad as required for on-site project support with international teams in multiple time zones", status: "unknown", warning: "The supplied profile does not confirm that it is satisfied." },
  ],
};
function application() {
  const app = { id: "AP-1234-5678", company: "Acme", role: "Engineer", notes: "", jobSources: [], jobText: "Professional Python experience is required for this role.", matchAnalysis: analysis };
  app.analysisMeta = { schemaVersion: 3, source: "gemini", inputFingerprint: analysisInputFingerprint(app, profile) };
  return app;
}

test("header indicators distinguish current, outdated, imported, and unverified analyses", () => {
  const app = application();
  assert.match(renderAnalysisIndicators(app, profile), /fresh-current[^>]*>Current<\/span>/);
  app.jobText += " SQL skills are preferred.";
  const stale = renderAnalysisIndicators(app, profile);
  assert.match(stale, /fresh-stale[^>]*>Outdated<\/span>/);
  assert.match(stale, />Adequate<\/span>/);
  assert.match(stale, /Input quality for the saved analysis: Adequate/);
  assert.match(stale, /Current inputs have not been evaluated by this analysis/);
  assert.doesNotMatch(stale, />Current</);
  for (const source of ["imported", "unverified"]) {
    app.analysisMeta = source === "imported" ? { ...app.analysisMeta, source } : null;
    assert.match(renderAnalysisIndicators(app, profile), new RegExp(`>${source === "imported" ? "Imported" : "Unverified"}<`));
    assert.doesNotMatch(renderAnalysisIndicators(app, profile), /fresh-current/);
  }
});

test("no analysis shows no badges; legacy results never acquire Current", () => {
  const app = application();
  app.matchAnalysis = null;
  assert.equal(renderAnalysisIndicators(app, profile), "");
  for (const legacy of [{ summary: "Legacy" }, { ...analysis, schema_version: 2 }]) {
    app.matchAnalysis = legacy;
    const html = renderAnalysisIndicators(app, profile);
    assert.match(html, />Unverified</);
    assert.doesNotMatch(html, /Current|Input:/);
  }
});

test("input quality moves out of overview without changing saved analysis data", () => {
  const app = application();
  const original = JSON.stringify(app);
  const html = renderAnalysisContent(analysis);
  assert.doesNotMatch(html, /Input:|input-status|fresh-current|fresh-stale/);
  assert.match(html, /Original assessment text\./);
  assert.match(html, /Original input explanation\./);
  assert.equal(JSON.stringify(app), original);
  const limited = { ...app, matchAnalysis: { ...analysis, input_assessment: { status: "limited", explanation: "Limited original input" } } };
  assert.match(renderAnalysisIndicators(limited, profile), />Limited</);
  assert.equal(analysisStatusMessage(app, profile + " changed"), "");
});

test("header placement replaces the separate freshness notice and updates while typing", async () => {
  const source = await readFile(new URL("../frontend/src/board.ts", import.meta.url), "utf8");
  const panel = source.slice(source.indexOf("function aiReviewPanel"), source.indexOf("function jobDescriptionPanel"));
  assert.ok(panel.indexOf('class="analysis-header-actions"') < panel.indexOf('class="primary-btn js-analyze"'));
  assert.ok(panel.indexOf('id="analysisIndicators"') < panel.indexOf('class="primary-btn js-analyze"'));
  assert.match(panel, /aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(source, /analysisReliability|reliabilityNotice|Matches the saved CV and application details/);
  assert.match(source, /indicators\.innerHTML = renderAnalysisIndicators\(app, state\.profile\)/);
  assert.match(panel, /aria-busy="true"/);
});

test("eligibility rows share qualification accordion semantics and preserve warnings", () => {
  const html = renderAnalysisContent(analysis);
  const section = html.match(/<section class="analysis-block analysis-group eligibility">([\s\S]*?)<\/section>/)[1];
  assert.match(section, /class="analysis-group-head"><button[^>]+><span class="category-title">Eligibility conditions<\/span><span class="group-count">2 items/);
  assert.equal((section.match(/aria-expanded="false"/g) || []).length, 3);
  assert.match(section, /Original warning &lt;with markup&gt; &amp; exact punctuation\./);
  assert.match(section, /data-requirement-id="req-3"/);
  assert.match(section, /status-unknown/);
  assert.doesNotMatch(section, /aria-expanded="true"|Potentially blocking/);
  const matches = [...section.matchAll(/<button type="button" class="requirement-toggle" id="([^"]+)" aria-expanded="false" aria-controls="([^"]+)">/g)];
  assert.equal(matches.length, 2);
  for (const [, button, panel] of matches) {
    assert.ok(section.includes(`id="${panel}" role="region" aria-labelledby="${button}" hidden`));
    assert.equal(html.split(`id="${panel}"`).length, 2, "panel id is unique");
  }
});

test("several eligibility panels expand independently with complete content retained", () => {
  const html = renderAnalysisContent(analysis);
  const ids = [...html.matchAll(/aria-controls="(eligibility-panel-[^"]+)"/g)].map((match) => match[1]);
  const panels = Object.fromEntries(ids.map((id) => [id, { hidden: true }]));
  const buttons = ids.map((id) => {
    const attrs = { "aria-expanded": "false", "aria-controls": id };
    return { getAttribute: (key) => attrs[key], setAttribute: (key, value) => { attrs[key] = value; },
      ownerDocument: { getElementById: (key) => panels[key] }, closest: () => ({ classList: { toggle() {} } }) };
  });
  buttons.forEach(toggleRequirement);
  ids.forEach((id) => assert.equal(panels[id].hidden, false));
  toggleRequirement(buttons[0]);
  assert.equal(panels[ids[0]].hidden, true);
  assert.equal(panels[ids[1]].hidden, false);
  assert.equal(buttons[0].getAttribute("aria-expanded"), "false");
  assert.match(html, /multiple time zones/);
});

test("counters keep exact calculations and semantic backgrounds in a symmetrical responsive grid", async () => {
  const html = renderAnalysisContent(analysis);
  for (const [name, count] of [["Verified", 1], ["Partial", 1], ["Unverified", 2], ["Contradicted", 1]]) assert.match(html, new RegExp(`<strong>${count}</strong> ${name}`));
  const css = await readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8");
  const counters = css.match(/\.analysis-counts li \{([^}]*)\}/)[1];
  assert.match(counters, /border: 1px solid transparent/);
  assert.match(counters, /align-items: center/);
  assert.match(counters, /min-height: 48px/);
  assert.doesNotMatch(counters, /border-left/);
  for (const [status, color] of [["verified", "success"], ["partial", "warning"], ["unverified", "neutral"], ["contradicted", "error"]]) {
    assert.ok(css.includes(`.analysis-counts .count-${status} { background: var(--${color}-soft); }`));
  }
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.analysis-counts \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("header and accordion styles retain theme tokens, wrapping, focus and reduced motion", async () => {
  const [css, base] = await Promise.all(["../frontend/css/app.css", "../frontend/css/base.css"].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const header = css.match(/\.analysis-header-actions \{([^}]*)\}/)[1];
  assert.match(header, /align-items: center/);
  assert.match(header, /flex-wrap: wrap/);
  assert.match(header, /margin-left: auto/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.analysis-header-actions \{ width: 100%; \}/);
  const eligibility = [...css.matchAll(/\.eligibility-list \{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.doesNotMatch(eligibility, /background:|border-radius:/);
  assert.doesNotMatch(eligibility, /border:/);
  const badge = css.match(/\.analysis-freshness \{([^}]*)\}/)[1];
  assert.match(badge, /border-radius: var\(--r-xs\)/);
  assert.doesNotMatch(badge, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(base, /:focus-visible \{ outline: 2px solid var\(--focus-ring\)/);
  assert.match(css.match(/^\.requirement-toggle \{([^}]*)\}/m)[1], /min-height: 48px/);
});


test("eligibility uses the shared flat requirement rows and visible keyboard focus", async () => {
  const css = await readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.eligibility-list \.requirement-(toggle|panel)\s*\{/);
  assert.match(css, /\.requirement-toggle:hover \{\s*background: var\(--surface-2\)/);
  assert.match(css, /\.category-toggle:focus-visible \{ outline-offset: -2px/);
});
