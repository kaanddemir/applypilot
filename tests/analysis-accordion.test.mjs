import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { renderAnalysisContent, toggleRequirement, conciseAssessment } = await import("../frontend/.test-dist/analysis-view.js");

const longTitle = "Bachelor's degree from a reputable university in Engineering, MIS, Statistics, Mathematics, or a closely related quantitative field with demonstrable coursework";
const req = (id, priority, status, extra = {}) => ({
  id, requirement: id + " title", priority, category: "skill", status,
  job_evidence: id + " job excerpt", profile_evidence: id + " profile excerpt", explanation: id + " explanation", ...extra,
});
const analysis = {
  schema_version: 3,
  input_assessment: { status: "adequate", explanation: "The posting contains several explicit qualification signals." },
  overall_assessment: "The posting yielded 4 distinct requirements: 1 verified, 1 partial, 1 not verified, and 1 contradicted. Among 2 required qualifications, 1 are verified; 1 remain partial or unverified.",
  requirements: [
    req("r1", "required", "verified", { requirement: longTitle, job_evidence: "Lisans derecesi (Mühendislik, YBS)" }),
    req("r2", "required", "not_found", { profile_evidence: null }),
    req("r3", "preferred", "partial"),
    req("r4", "preferred", "contradicted"),
  ],
  eligibility_conditions: [],
};

// Minimal stand-ins: toggleRequirement only touches attributes, hidden, and classList.
function fakeRow(html, index) {
  const ids = [...html.matchAll(/class="requirement-toggle"[^>]*aria-controls="([^"]+)"/g)].map((match) => match[1]);
  const panels = Object.fromEntries(ids.map((id) => [id, { hidden: true }]));
  const classes = new Set();
  const attrs = { "aria-expanded": "false", "aria-controls": ids[index] };
  const button = {
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => { attrs[name] = value; },
    ownerDocument: { getElementById: (id) => panels[id] ?? null },
    closest: () => ({ classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } }),
  };
  return { button, panel: panels[ids[index]], attrs, classes, panels };
}

test("every requirement renders collapsed with accessible button/panel wiring", () => {
  const html = renderAnalysisContent(analysis);
  const buttons = [...html.matchAll(/<button type="button" class="requirement-toggle" id="([^"]+)" aria-expanded="false" aria-controls="([^"]+)">/g)];
  assert.equal(buttons.length, 4);
  for (const [, buttonId, panelId] of buttons) {
    assert.match(html, new RegExp('<div class="requirement-panel" id="' + panelId + '" role="region" aria-labelledby="' + buttonId + '" hidden>'));
  }
  assert.doesNotMatch(html, /aria-expanded="true"/);
  // No nested interactive controls inside the toggle.
  for (const match of html.matchAll(/<button[^>]*requirement-toggle[^>]*>([\s\S]*?)<\/button>/g)) assert.doesNotMatch(match[1], /<(button|a|input)\b/);
});

test("rows toggle independently so several can stay open", () => {
  const html = renderAnalysisContent(analysis);
  const first = fakeRow(html, 0);
  toggleRequirement(first.button);
  assert.equal(first.attrs["aria-expanded"], "true");
  assert.equal(first.panel.hidden, false);
  assert.ok(first.classes.has("is-open"));
  const second = fakeRow(html, 1);
  toggleRequirement(second.button);
  assert.equal(second.panel.hidden, false);
  assert.equal(first.panel.hidden, false, "opening another row leaves the first open");
  toggleRequirement(first.button);
  assert.equal(first.attrs["aria-expanded"], "false");
  assert.equal(first.panel.hidden, true);
});

test("required and preferred sections use matching headers with counts", () => {
  const html = renderAnalysisContent(analysis);
  assert.match(html, /<section class="analysis-block analysis-group group-required"><h3 class="analysis-group-head"><button[^>]+><span class="category-title">Required qualifications<\/span><span class="group-count">2 items<\/span>/);
  assert.match(html, /<section class="analysis-block analysis-group group-preferred"><h3 class="analysis-group-head"><button[^>]+><span class="category-title">Preferred qualifications<\/span><span class="group-count">2 items<\/span>/);
  assert.ok(html.indexOf("Required qualifications") < html.indexOf("Preferred qualifications"));
});

test("status badges keep every status meaning", () => {
  const html = renderAnalysisContent(analysis);
  for (const [cls, label] of [["verified", "Verified"], ["partial", "Partial"], ["not_found", "Not found in profile"], ["contradicted", "Contradicted"]]) {
    assert.match(html, new RegExp('class="analysis-status status-' + cls + '"><span aria-hidden="true">.</span>' + label));
  }
});

test("expanded content reads explanation, job evidence, then profile evidence, unabridged", () => {
  const html = renderAnalysisContent(analysis);
  const panel = [...html.matchAll(/<div class="requirement-panel" id="[^"]+"[^>]*>([\s\S]*?)<\/div><\/li>/g)].find((match) => match[1].includes("r1 explanation"))[1];
  const order = ["r1 explanation", "Job Evidence", "Lisans derecesi (Mühendislik, YBS)", "Profile Evidence", "r1 profile excerpt"].map((text) => panel.indexOf(text));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(html, /JOB EVIDENCE|Job evidence|Profile evidence/);
  const escapedLongTitle = longTitle.replace("'", "&#39;");
  assert.ok(html.includes(escapedLongTitle), "long titles are escaped but not truncated");
});

test("missing profile evidence keeps the unverified message", () => {
  const html = renderAnalysisContent(analysis);
  assert.match(html, /Profile Evidence<\/h5><p class="evidence-missing">No supporting excerpt was verified\.<\/p>/);
});

test("overall assessment drops only the sentence that repeats the counters", () => {
  assert.equal(conciseAssessment(analysis.overall_assessment), "Among 2 required qualifications, 1 are verified; 1 remain partial or unverified.");
  assert.equal(conciseAssessment("Strong TypeScript evidence."), "Strong TypeScript evidence.");
  const onlyCounts = "The posting yielded 1 distinct requirement: 1 verified, 0 partial, 0 not verified, and 0 contradicted.";
  assert.equal(conciseAssessment(onlyCounts), onlyCounts, "never renders an empty assessment");
  assert.doesNotMatch(renderAnalysisContent(analysis), /Input: Adequate/);
});

test("pre-v3 saved analyses still render the legacy notice", () => {
  const html = renderAnalysisContent({ ...analysis, schema_version: 2 });
  assert.match(html, /Previous analysis can't be verified/);
  assert.doesNotMatch(html, /requirement-toggle/);
});

test("styles: rectangular badges, stacked evidence, focus and reduced motion", async () => {
  const css = await readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8");
  const badge = css.match(/\.input-status,\s*\.analysis-status \{([^}]*)\}/)[1];
  assert.match(badge, /border-radius: var\(--r-xs\)/);
  assert.doesNotMatch(css, /evidence-list|grid-template-columns: 1fr 1fr/);
  assert.doesNotMatch(css.match(/\.evidence-label \{([^}]*)\}/)[1], /uppercase|letter-spacing/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.requirement-chevron \{ transition: none; \}/);
});
