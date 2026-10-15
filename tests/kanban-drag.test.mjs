import assert from "node:assert/strict";
import test from "node:test";

const { createDragController } = await import("../frontend/.test-dist/kanban-drag.js");

function column() {
  const classes = new Set();
  return { classes, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
}

function setup() {
  const moves = [];
  const drag = createDragController((id, status) => moves.push([id, status]));
  return { drag, moves };
}

test("dropping on another column moves the card and clears the highlight", () => {
  const { drag, moves } = setup();
  const applied = column();
  drag.start("a1", "Saved");
  assert.equal(drag.over("Applied", applied), true);
  assert.ok(applied.classes.has("drop-target"));
  assert.equal(drag.drop("Applied"), true);
  assert.deepEqual(moves, [["a1", "Applied"]]);
  assert.equal(applied.classes.size, 0);
  assert.equal(drag.activeId, "");
});

test("the source column refuses the drop and changes nothing", () => {
  const { drag, moves } = setup();
  const saved = column();
  drag.start("a1", "Saved");
  assert.equal(drag.over("Saved", saved), false);
  assert.equal(saved.classes.size, 0);
  assert.equal(drag.drop("Saved"), false);
  assert.deepEqual(moves, []);
});

test("only one column is highlighted while moving across the board", () => {
  const { drag } = setup();
  const applied = column(), interview = column();
  drag.start("a1", "Saved");
  drag.over("Applied", applied);
  drag.over("Applied", applied);
  drag.over("Interview", interview);
  assert.equal(applied.classes.size, 0);
  assert.ok(interview.classes.has("drop-target"));
  drag.leave();
  assert.equal(interview.classes.size, 0);
});

test("drags that did not start on a card are ignored", () => {
  const { drag, moves } = setup();
  const offer = column();
  assert.equal(drag.over("Offer", offer), false);
  assert.equal(offer.classes.size, 0);
  assert.equal(drag.drop("Offer"), false);
  assert.deepEqual(moves, []);
});

test("cancelling a drag clears state so a later drop cannot move the card", () => {
  const { drag, moves } = setup();
  const rejected = column();
  drag.start("a1", "Applied");
  drag.over("Rejected", rejected);
  drag.end();
  assert.equal(rejected.classes.size, 0);
  assert.equal(drag.drop("Rejected"), false);
  assert.deepEqual(moves, []);
});
