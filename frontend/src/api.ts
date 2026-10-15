import type { AnalysisErrorBody, AnalysisRequest, MatchAnalysis, StatusCallback } from "./types.js";

const ANALYSIS_TIMEOUT_MS = 100_000;
const ERROR_MESSAGES: Record<string, string> = {
  output_exhausted: "The analysis could not be completed within its response budget. No partial result was saved.",
  incomplete_analysis: "The analysis did not cover the full posting. No partial result was saved.",
  provider_configuration: "The analysis service configuration needs attention.",
  request_cancelled: "Analysis was cancelled.",
  configuration_missing: "Gemini is not configured on the server.",
  invalid_request: "The profile or job information is incomplete or too large.",
  insufficient_job_information: "Paste a job description with concrete responsibilities or qualifications before analyzing.",
  rate_limited: "Too many analysis requests. Please wait and try again.",
  capacity_exhausted: "Analysis is busy. Please try again shortly.",
  provider_authentication: "Gemini authentication failed. Check the server configuration.",
  provider_quota: "Gemini usage quota is currently exhausted.",
  provider_timeout: "Gemini took too long to respond. Please try again.",
  provider_unavailable: "Gemini is temporarily unavailable.",
  invalid_provider_response: "Gemini returned an invalid analysis. Please try again.",
  evidence_validation_failed: "Gemini could not verify its job evidence against the posting. Please try again.",
};

export class AnalysisApiError extends Error {
  constructor(public readonly code: string, message?: string, public readonly retryAfter: number | null = null) {
    super(message || ERROR_MESSAGES[code] || "Analysis failed.");
    this.name = "AnalysisApiError";
  }
}

async function readError(response: Response): Promise<AnalysisApiError> {
  let body: AnalysisErrorBody = {};
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) body = value as AnalysisErrorBody;
  } catch { /* non-JSON error */ }
  const error = body.error ?? body.detail;
  const code = typeof error?.code === "string" ? error.code : "request_failed";
  const retryValue = response.headers.get("retry-after");
  const retryAfter = retryValue && /^\d+$/.test(retryValue) ? Number(retryValue) : null;
  // Provider/server detail is deliberately not surfaced to the UI: unknown
  // errors may contain implementation details that are not safe or useful.
  let message = ERROR_MESSAGES[code] || "Analysis failed. Please try again.";
  if (retryAfter && (code === "rate_limited" || code === "capacity_exhausted")) {
    message += ` Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`;
  }
  return new AnalysisApiError(code, message, retryAfter);
}

export async function analyze(jobInformation: string, profile: string, onStatus?: StatusCallback): Promise<MatchAnalysis> {
  onStatus?.("Connecting to Gemini…");
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  const payload: AnalysisRequest = { profile, job_information: jobInformation };
  try {
    const response = await fetch("/api/analyze-job", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw await readError(response);
    try { return await response.json() as MatchAnalysis; }
    catch { throw new AnalysisApiError("invalid_provider_response", ERROR_MESSAGES.invalid_provider_response); }
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new AnalysisApiError("provider_timeout", ERROR_MESSAGES.provider_timeout);
    if (error instanceof AnalysisApiError) throw error;
    throw new AnalysisApiError("network_error", "Could not reach the ApplyPilot server.");
  } finally { globalThis.clearTimeout(timer); }
}
