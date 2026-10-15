import assert from "node:assert/strict";
import test from "node:test";

const { calculatePopoverPosition } = await import("../frontend/.test-dist/popover-position.js");

test("popover opens below with a six pixel gap independent of menu content", () => {
  const trigger = { left: 100, right: 260, top: 40, bottom: 76, width: 160 };
  for (const height of [40, 240]) {
    const result = calculatePopoverPosition(trigger, { width: 200, height }, { width: 800, height: 600 });
    assert.equal(result.placement, "bottom");
    assert.equal(result.top, 82);
    assert.equal(result.left, 100);
  }
});

test("popover flips above only when below lacks useful space", () => {
  const result = calculatePopoverPosition(
    { left: 100, right: 260, top: 500, bottom: 536, width: 160 },
    { width: 200, height: 220 }, { width: 800, height: 560 },
  );
  assert.equal(result.placement, "top");
  assert.equal(result.top, 274);
});

test("left and right aligned popovers stay inside the viewport", () => {
  const trigger = { left: 350, right: 390, top: 40, bottom: 76, width: 40 };
  const left = calculatePopoverPosition(trigger, { width: 216, height: 100 }, { width: 400, height: 600 });
  const right = calculatePopoverPosition(trigger, { width: 216, height: 100 }, { width: 400, height: 600 }, "right");
  assert.equal(left.left, 176);
  assert.equal(right.left, 174);
});
