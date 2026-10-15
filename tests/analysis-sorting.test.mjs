import assert from "node:assert/strict";
import test from "node:test";
import { renderAnalysisContent, toggleRequirement } from "../frontend/.test-dist/analysis-view.js";

const statuses = ["verified", "unknown", "partial", "not_found", "contradicted", "partial", "verified", "not_found", "unknown", "contradicted"];
const categories = ["required", "preferred", "unspecified"];
const analysis = {
  schema_version: 3, input_assessment: { status: "adequate", explanation: "Saved explanation" }, overall_assessment: "Saved assessment",
  requirements: categories.flatMap((priority) => statuses.map((status, index) => ({
    id: `${priority}-${index}`, requirement: `${priority} qualification ${index}`, priority, status, category: "skill",
    explanation: `Explanation ${priority}-${index}`, job_evidence: `İş ilanı ${priority}-${index}`, profile_evidence: `CV evidence ${priority}-${index}`,
  }))),
  eligibility_conditions: [
    { requirement_id: "required-0", condition: "Eligibility verified first", status: "verified", warning: "Original first warning" },
    { requirement_id: "required-4", condition: "Eligibility contradicted second", status: "contradicted", warning: "Original second warning" },
  ],
};
const expected = [4, 9, 3, 7, 1, 8, 2, 5, 0, 6];

test("each category sorts statuses stably while retaining category order", () => {
  const html = renderAnalysisContent(analysis);
  let previous = -1;
  for (const category of categories) {
    const start = html.indexOf(`group-${category}`);
    assert.ok(start > previous);
    previous = start;
    const section = html.slice(start, html.indexOf("</section>", start));
    const titles = [...section.matchAll(/class="requirement-title" dir="auto">([^<]+)/g)].map((match) => match[1]);
    assert.deepEqual(titles, expected.map((index) => `${category} qualification ${index}`));
  }
  assert.ok(html.indexOf("Eligibility verified first") < html.indexOf("Eligibility contradicted second"));
});

test("restored saved analyses render sorted without modifying source data or evidence", () => {
  const serialized = JSON.stringify(analysis);
  const restored = JSON.parse(serialized);
  restored.requirements.forEach(Object.freeze);
  Object.freeze(restored.requirements);
  const html = renderAnalysisContent(restored);
  assert.equal(JSON.stringify(restored), serialized);
  for (const item of restored.requirements) {
    assert.ok(html.includes(item.job_evidence));
    assert.ok(html.includes(item.profile_evidence));
    assert.ok(html.includes(item.explanation));
  }
  assert.ok(html.indexOf("required qualification 4") < html.indexOf("required qualification 0"));
});

test("sorted rows retain collapsed accessible panels and independent toggling", () => {
  const html = renderAnalysisContent(analysis);
  const links = [...html.matchAll(/class="requirement-toggle" id="([^"]+-btn)" aria-expanded="false" aria-controls="([^"]+)"/g)];
  assert.equal(links.length, 32);
  const panels = Object.fromEntries(links.map(([, , id]) => [id, { hidden: true }]));
  const buttons = links.slice(2, 4).map(([, buttonId, panelId]) => {
    assert.ok(html.includes(`id="${panelId}" role="region" aria-labelledby="${buttonId}" hidden`));
    const attrs = { "aria-expanded": "false", "aria-controls": panelId };
    return { getAttribute: (name) => attrs[name], setAttribute: (name, value) => { attrs[name] = value; }, ownerDocument: { getElementById: (id) => panels[id] }, closest: () => ({ classList: { toggle() {} } }) };
  });
  buttons.forEach(toggleRequirement);
  buttons.forEach((button) => assert.equal(panels[button.getAttribute("aria-controls")].hidden, false));
  toggleRequirement(buttons[0]);
  assert.equal(buttons[0].getAttribute("aria-expanded"), "false");
  assert.equal(buttons[1].getAttribute("aria-expanded"), "true");
});
