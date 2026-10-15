import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listeners = [];
globalThis.document = { addEventListener: (type, listener) => { if (type === "click") listeners.push(listener); } };
const { renderAnalysisContent } = await import("../frontend/.test-dist/analysis-view.js");

const analysis = {
  schema_version: 3, input_assessment: { status: "adequate", explanation: "Saved input assessment" },
  overall_assessment: "Saved overall assessment",
  requirements: ["required", "preferred", "unspecified"].flatMap((priority) => ["verified", "unknown"].map((status, index) => ({
    id: `${priority}-${index}`, requirement: `${priority} qualification ${index}`, priority, status, category: "skill",
    explanation: "Saved explanation", job_evidence: "Original job quotation", profile_evidence: index ? null : "Original CV quotation",
  }))),
  eligibility_conditions: [{ requirement_id: "required-0", condition: "Original eligibility condition", status: "verified", warning: "Original warning" }],
};

// Parse the emitted hierarchy so all controls share the same panels and parents.
// Only DOM operations used by the delegated accordion listener are implemented.
function view(data = analysis) {
  const html = renderAnalysisContent(data);
  const nodes = [], stack = [], ids = new Map();
  const ownerDocument = { getElementById: (id) => ids.get(id) ?? null };
  for (const token of html.matchAll(/<\/?[a-z][^>]*>/gi)) {
    if (token[0].startsWith("</")) { stack.pop(); continue; }
    const attrs = Object.fromEntries([...token[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    const classes = new Set((attrs.class ?? "").split(" "));
    const node = {
      tag: /^<([a-z][a-z0-9]*)/i.exec(token[0])[1], attrs, parent: stack.at(-1), ownerDocument,
      hidden: /\shidden(?:\s|>)/.test(token[0]),
      getAttribute: (name) => attrs[name] ?? null,
      setAttribute: (name, value) => { attrs[name] = value; },
      classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      closest(selector) { for (let node = this; node; node = node.parent) if ((node.attrs.class ?? "").split(" ").includes(selector.slice(1))) return node; return null; },
    };
    nodes.push(node);
    if (attrs.id) ids.set(attrs.id, node);
    stack.push(node);
  }
  return { html, nodes, ids, categories: nodes.filter((node) => node.attrs.class === "category-toggle"),
    requirements: nodes.filter((node) => node.attrs.class === "requirement-toggle") };
}
const click = (target) => listeners.forEach((listener) => listener({ target }));
const panel = (button) => button.ownerDocument.getElementById(button.attrs["aria-controls"]);

test("all nonempty categories start collapsed in the required order with correct counts and labels", () => {
  const rendered = view();
  assert.equal(rendered.categories.length, 4);
  const titles = [...rendered.html.matchAll(/class="category-title">([^<]+)/g)].map((match) => match[1]);
  assert.deepEqual(titles, ["Eligibility conditions", "Required qualifications", "Preferred qualifications", "Unspecified qualifications"]);
  assert.deepEqual([...rendered.html.matchAll(/class="group-count">([^<]+)/g)].map((match) => match[1]), ["1 item", "2 items", "2 items", "2 items"]);
  for (const button of [...rendered.categories, ...rendered.requirements]) {
    assert.equal(button.tag, "button");
    assert.equal(button.attrs.type, "button");
    assert.equal(button.attrs["aria-expanded"], "false");
    assert.equal(panel(button).hidden, true);
    assert.equal(panel(button).attrs["aria-labelledby"], button.attrs.id);
    assert.equal(panel(button).attrs.role, "region");
    assert.equal(button.parent.tag, rendered.categories.includes(button) ? "h3" : "h4");
    if (rendered.requirements.includes(button)) assert.equal(button.closest(".category-panel").hidden, true);
    for (let parent = button.parent; parent; parent = parent.parent) assert.notEqual(parent.tag, "button");
  }
  assert.equal(rendered.nodes.filter((node) => node.attrs.id).length, rendered.ids.size, "all ids are unique");
  for (const node of rendered.nodes.filter((node) => ["a", "input", "select", "textarea"].includes(node.tag))) {
    assert.equal(node.closest(".category-toggle"), null, "category headers contain no nested controls");
  }
  assert.match(rendered.html, /Saved overall assessment/);
  assert.equal((rendered.html.match(/class="count-(verified|partial|unverified|contradicted)"/g) ?? []).length, 4);
});

test("delegated clicks keep categories and nested rows independent and retain inner state", () => {
  const rendered = view();
  assert.equal(listeners.length, 1, "one delegated handler serves both levels");
  const [eligibility, required, preferred] = rendered.categories;
  // Click a child span, as a real header title/count/chevron click would do.
  click(rendered.nodes.find((node) => node.parent === required));
  click(preferred);
  assert.equal(panel(required).hidden, false);
  assert.equal(panel(preferred).hidden, false);
  assert.equal(panel(eligibility).hidden, true);
  const inner = rendered.requirements.filter((button) => button.closest(".category-panel") === panel(required));
  assert.equal(inner.length, 2);
  inner.forEach(click);
  inner.forEach((button) => assert.equal(panel(button).hidden, false));
  assert.equal(required.attrs["aria-expanded"], "true", "inner clicks do not toggle the parent");
  click(required);
  assert.equal(panel(required).hidden, true);
  assert.equal(panel(preferred).hidden, false);
  click(required);
  inner.forEach((button) => assert.equal(panel(button).hidden, false, "reopening preserves expanded children"));
  click(inner[0]);
  assert.equal(panel(inner[0]).hidden, true);
  assert.equal(panel(inner[1]).hidden, false);
});

test("empty categories disappear and rendering never modifies restored analysis data", () => {
  const serialized = JSON.stringify(analysis);
  const restored = JSON.parse(serialized);
  restored.requirements.forEach(Object.freeze);
  Object.freeze(restored.requirements);
  view(restored);
  assert.equal(JSON.stringify(restored), serialized);
  const empty = view({ ...analysis, requirements: [], eligibility_conditions: [] });
  assert.equal(empty.categories.length, 0);
  assert.match(empty.html, /Saved overall assessment/);
  const requiredOnly = view({ ...analysis, requirements: analysis.requirements.filter((item) => item.priority === "required"), eligibility_conditions: [] });
  assert.equal(requiredOnly.categories.length, 1);
  assert.match(requiredOnly.html, /Required qualifications/);
  assert.doesNotMatch(requiredOnly.html, /Eligibility conditions|Preferred qualifications|Unspecified qualifications/);
  assert.doesNotMatch(view({ ...analysis, schema_version: 2 }).html, /category-toggle/);
});

test("category styling uses a wrapping shared grid without added motion or nested containers", async () => {
  const css = await readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.category-toggle \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto 16px/);
  assert.match(css, /\.category-title \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.category-toggle:focus-visible/);
  assert.match(css, /\.category-panel\[hidden\] \{ display: none/);
  assert.doesNotMatch(css.match(/\.category-chevron \{([^}]*)\}/)[1], /transition|animation/);
  assert.doesNotMatch(css, /\.eligibility-list \{[^}]*background:/);
});
