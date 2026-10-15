import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { createAutosave } = await import("../frontend/.test-dist/notes-autosave.js");
const board = await readFile(new URL("../frontend/src/board.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8");

function clock() {
  const pending = new Map();
  let next = 0;
  return {
    pending,
    schedule(callback) { const id = ++next; pending.set(id, callback); return id; },
    cancel(id) { pending.delete(id); },
    fire() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback()); },
  };
}

test("Notes always renders as the same styled multiline field with escaped existing content", () => {
  const panel = board.slice(board.indexOf("function notesPanel(app)"), board.indexOf("function detailsPanel(app)"));
  assert.match(panel, /<textarea id="notesInput" class="job-text-input"/);
  assert.match(panel, /placeholder="Add notes about this application\.\.\."/);
  assert.match(panel, /esc\(app\.notes \|\| ""\)/);
  assert.match(panel, /maxlength="' \+ INPUT_LIMITS\.notes/);
  assert.doesNotMatch(panel, /No notes|job-notes-text/);
  assert.match(css, /\.job-text-input\s*\{[^}]*width:\s*100%/);
  assert.doesNotMatch(board, /save-status|notesStatus|jobTextStatus|Saving\.\.\.|>Saved</);
});

test("editing and clearing update the application immediately and debounce persistence", () => {
  const app = { notes: "Earlier note" };
  const saved = [];
  const reports = [];
  const timer = clock();
  const autosave = createAutosave(
    (value) => { app.notes = value; },
    () => { saved.push(app.notes); return true; },
    (success, announce) => reports.push([success, announce]),
    app.notes,
    350, timer.schedule, timer.cancel,
  );
  autosave.input("First edit");
  autosave.input("Final edit");
  assert.equal(app.notes, "Final edit");
  assert.equal(timer.pending.size, 1);
  assert.deepEqual(saved, []);
  timer.fire();
  assert.deepEqual(saved, ["Final edit"]);
  autosave.input("");
  autosave.flush();
  assert.equal(app.notes, "");
  assert.deepEqual(saved, ["Final edit", ""]);
  assert.equal(timer.pending.size, 0);
  assert.deepEqual(reports, [[true, true], [true, true]]);
});

test("rapid navigation flushes the old application without overwriting the next", () => {
  const apps = [{ notes: "A" }, { notes: "B" }];
  const snapshots = [];
  const timer = clock();
  const reports = [];
  const make = (app) => createAutosave(
    (value) => { app.notes = value; },
    () => { snapshots.push(apps.map((item) => item.notes)); return true; },
    (saved, announce) => reports.push([saved, announce]), app.notes,
    350, timer.schedule, timer.cancel,
  );
  const first = make(apps[0]);
  first.input("A changed");
  first.flushSilently();
  const second = make(apps[1]);
  second.input("B changed");
  timer.fire();
  assert.deepEqual(apps.map((item) => item.notes), ["A changed", "B changed"]);
  assert.deepEqual(snapshots, [["A changed", "B"], ["A changed", "B changed"]]);
  assert.deepEqual(reports, [[true, false], [true, true]]);
  assert.match(board, /pendingDetailSaves\.forEach\(\(save\) => save\.flushSilently\(\)\)/);
  assert.match(board, /pagehide.*flushSilently/);
  assert.match(board, /addEventListener\("blur", autosave\.flush\)/);
});

test("unchanged input and edits reverted before the debounce do not persist or report", () => {
  const saved = [];
  const reports = [];
  const timer = clock();
  const autosave = createAutosave(
    () => {}, () => { saved.push(true); return true; },
    (success, announce) => reports.push([success, announce]), "Original",
    350, timer.schedule, timer.cancel,
  );
  autosave.input("Original");
  autosave.input("Changed");
  autosave.input("Original");
  timer.fire();
  assert.deepEqual(saved, []);
  assert.deepEqual(reports, []);
});

test("failed persistence retains text and reports a persistent notification path", () => {
  const app = { notes: "" };
  const reports = [];
  const timer = clock();
  const autosave = createAutosave(
    (value) => { app.notes = value; }, () => false,
    (saved, announce) => reports.push([saved, announce]), app.notes,
    350, timer.schedule, timer.cancel,
  );
  autosave.input("Keep this note");
  timer.fire();
  assert.equal(app.notes, "Keep this note");
  assert.deepEqual(reports, [[false, true]]);
  assert.match(board, /autosaveFeedback\(saved, "Notes", announceSuccess\)/);
  assert.match(board, /autosaveFeedback\(saved, "Job description", announceSuccess\)/);
});

test("failed autosave retries on blur and stops retrying after a successful save", () => {
  const timer = clock();
  let attempts = 0;
  const reports = [];
  const autosave = createAutosave(() => {}, () => ++attempts > 1,
    (saved) => reports.push(saved), "Original", 350, timer.schedule, timer.cancel);
  autosave.input("Updated note");
  timer.fire();
  assert.equal(attempts, 1);
  autosave.flush();
  assert.equal(attempts, 2);
  assert.deepEqual(reports, [false, true]);
  autosave.flush();
  autosave.flushSilently();
  assert.equal(attempts, 2);
});
