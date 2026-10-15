import assert from "node:assert/strict";
import test from "node:test";

const { isSafeJobUrl, isSafeProfileDataUrl, isValidDate, hasDisallowedControl, toDateInput } =
  await import("../frontend/.test-dist/input-validation.js");

test("job URLs accept international HTTP addresses and reject active or malformed schemes", () => {
  assert.equal(isSafeJobUrl("https://iş.example/pozisyon?rol=analist"), true);
  assert.equal(isSafeJobUrl("http://example.com/jobs/1"), true);
  for (const value of ["javascript:alert(1)", "data:text/html,<script>", "https://", "https://user:pass@example.com", "https://example.com\njavascript:alert(1)", "https://example.com\\@attacker.invalid", 42]) {
    assert.equal(isSafeJobUrl(value), false, String(value));
  }
});

test("dates and controls reject malformed input without stripping Turkish text", () => {
  assert.equal(isValidDate("2026-02-28"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(toDateInput("2026-02-30"), "");
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(toDateInput("Jul 17, 2026"), "2026-07-17");
  assert.equal(hasDisallowedControl("İş zekâsı\nPython <code>"), false);
  assert.equal(hasDisallowedControl("bad\u0000value"), true);
});

test("stored original CV links require bounded PDF or DOCX data URLs", () => {
  assert.equal(isSafeProfileDataUrl("data:application/pdf;base64,JVBERi0=", "pdf"), true);
  assert.equal(isSafeProfileDataUrl("data:text/html;base64,PHNjcmlwdD4=", "pdf"), false);
  assert.equal(isSafeProfileDataUrl("data:application/pdf;base64,PHNjcmlwdD4=", "pdf"), false);
  assert.equal(isSafeProfileDataUrl("javascript:alert(1)", "docx"), false);
});
