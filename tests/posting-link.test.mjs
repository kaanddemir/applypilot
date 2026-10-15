import assert from "node:assert/strict";
import test from "node:test";

const { openPostingUrl } = await import("../frontend/.test-dist/posting-link.js");

test("a null result with noopener and noreferrer is not classified as failure", () => {
  const calls = [];
  const result = openPostingUrl("https://example.com/jobs/123", (...args) => {
    calls.push(args);
    return null;
  });
  assert.equal(result, "requested");
  assert.deepEqual(calls, [["https://example.com/jobs/123", "_blank", "noopener,noreferrer"]]);
});

test("invalid or unsafe URLs are never opened", () => {
  let calls = 0;
  const open = () => { calls += 1; return null; };
  assert.equal(openPostingUrl("javascript:alert(1)", open), "invalid");
  assert.equal(openPostingUrl("not a URL", open), "invalid");
  assert.equal(calls, 0);
});

test("only a thrown opening error is reported as an error", () => {
  assert.equal(openPostingUrl("https://example.com", () => ({ closed: false })), "requested");
  assert.equal(openPostingUrl("https://example.com", () => { throw new Error("Open failed"); }), "error");
});
