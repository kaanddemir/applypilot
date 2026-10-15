import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const board = await readFile(new URL("../frontend/src/board.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8");

test("application details uses the flat section order and back control", () => {
  assert.match(board, /I\.back \+ 'Back to applications/);
  assert.doesNotMatch(board, /detail-back-btn/);
  const populatedStart = board.indexOf("const canOpen", board.indexOf("export function renderDetailPage"));
  const renderStart = board.indexOf("content.innerHTML =", populatedStart);
  const render = board.slice(renderStart, board.indexOf('$("backToBoard")', renderStart));
  for (const panel of ["detailsPanel(app)", "aiReviewPanel(app)", "jobDescriptionPanel(app)", "notesPanel(app)"]) assert.match(render, new RegExp(panel.replace(/[()]/g, "\\$&")));
  assert.ok(render.indexOf("detailsPanel(app)") < render.indexOf("aiReviewPanel(app)"));
  assert.ok(render.indexOf("aiReviewPanel(app)") < render.indexOf("jobDescriptionPanel(app)"));
  assert.ok(render.indexOf("jobDescriptionPanel(app)") < render.indexOf("notesPanel(app)"));
});

test("application information preserves all supported fields", () => {
  const infoGrid = board.slice(board.indexOf("function detailsPanel(app)"), board.indexOf("function infoRow("));
  let previous = -1;
  for (const label of ["Company", "Role", "Status", "Applied", "Sources", "Job URLs"]) {
    assert.match(board, new RegExp('infoRow\\("' + label));
    const position = infoGrid.indexOf('infoRow("' + label);
    assert.ok(position > previous, `${label} follows the preceding field`);
    previous = position;
  }
  assert.match(board, /id="detailStatus"/);
});

test("detail sections retain their width and application info uses a divided grid", () => {
  assert.match(css, /\.detail\s*\{[\s\S]*?max-width:\s*1160px/);
  const sectionRule = css.match(/\.detail-section\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(sectionRule, /border-top:/);
  assert.doesNotMatch(sectionRule, /background:/);
  assert.doesNotMatch(sectionRule, /border-radius:/);
  const infoRule = css.match(/\.info-table\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(infoRule, /repeat\(3/);
  assert.match(infoRule, /gap:\s*1px/);
  assert.match(infoRule, /border:\s*1px solid var\(--border-soft\)/);
  assert.match(infoRule, /border-radius:\s*var\(--r-sm\)/);
  assert.match(infoRule, /background:\s*var\(--border-soft\)/);
  const cellRule = css.match(/\.info-row\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(cellRule, /padding:\s*var\(--s4\)/);
  assert.match(cellRule, /background:\s*var\(--surface\)/);
  assert.doesNotMatch(cellRule, /border:|border-radius:|box-shadow:/);
  assert.match(css, /\.job-text-input\s*\{[^}]*width:\s*100%/);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.info-table\s*\{[\s\S]*?repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.info-table\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
