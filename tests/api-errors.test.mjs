import assert from "node:assert/strict";
import test from "node:test";

const { analyze, AnalysisApiError } = await import("../frontend/.test-dist/api.js");

test("unexpected JSON error bodies remain server errors rather than network errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [null, [], "unexpected", 42]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 502 });
      await assert.rejects(analyze("Python experience required", "Profile"),
        (error) => error instanceof AnalysisApiError && error.code === "request_failed");
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("rate-limit responses preserve safe retry guidance", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "internal detail" } }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "12" },
  });
  try {
    await assert.rejects(
      analyze("A sufficiently detailed job description", "Profile"),
      (error) => error instanceof AnalysisApiError && error.code === "rate_limited" && /12 seconds/.test(error.message) && !/internal detail/.test(error.message),
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid successful responses are classified without exposing parser details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    await assert.rejects(
      analyze("A sufficiently detailed job description", "Profile"),
      (error) => error instanceof AnalysisApiError && error.code === "invalid_provider_response",
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("evidence retry exhaustion uses a safe actionable message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "evidence_validation_failed", message: "job evidence not found for req-11" },
  }), { status: 502, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      analyze("A sufficiently detailed job description", "Profile"),
      (error) => error instanceof AnalysisApiError
        && error.code === "evidence_validation_failed"
        && /could not verify its job evidence/.test(error.message)
        && !/req-11|not found for/.test(error.message),
    );
  } finally { globalThis.fetch = originalFetch; }
});

test("request timeout aborts the operation and returns the safe timeout message", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let fireTimeout = null;
  globalThis.setTimeout = (fn) => { fireTimeout = fn; return 1; };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  try {
    const request = analyze("A sufficiently detailed job description", "Profile");
    fireTimeout();
    await assert.rejects(
      request,
      (error) => error instanceof AnalysisApiError && error.code === "provider_timeout" && /too long/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
