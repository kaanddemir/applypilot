import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [board, css] = await Promise.all([
  readFile(new URL("../frontend/src/board.ts", import.meta.url), "utf8"),
  readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8"),
]);

test("table remains the existing sortable editable grid inside a scrollport", () => {
  assert.match(board, /<div class="table-wrap"><table class="app-table/);
  assert.match(board, /class="sortable/);
  assert.match(board, /class="mini-select js-row-status"/);
  assert.match(board, /class="table-edit-btn js-row-edit"/);
  assert.match(css, /\.table-wrap\s*\{[^}]*overflow:\s*auto/);
});

test("desktop table is flat with row dividers while interaction states remain", () => {
  assert.match(css, /\.app-table\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
  assert.doesNotMatch(css, /\.table-wrap\s*\{[^}]*border-radius/s);
  assert.match(css, /\.app-table tbody td\s*\{[^}]*border-bottom:\s*1px solid var\(--border-soft\)/s);
  assert.match(css, /\.app-table tbody tr:hover\s*\{[^}]*var\(--surface-hover\)/s);
  assert.match(css, /\.app-table tbody tr:focus-visible\s*\{[^}]*var\(--focus-ring\)/s);
  assert.match(css, /\.app-table tbody tr\.picked\s*\{[^}]*var\(--accent-soft\)/s);
});

test("mobile table keeps its responsive row cards", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.table-wrap\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /\.app-table tbody tr\s*\{[^}]*display:\s*grid;[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*var\(--r-md\)/s);
});
