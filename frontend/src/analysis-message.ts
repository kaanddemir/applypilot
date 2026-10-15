import { hasSufficientJobDescription } from "./analysis-integrity.js";
import type { JobApplication } from "./types.js";

export function analysisStatusMessage(app: JobApplication, profile: string): string {
  if (!hasSufficientJobDescription(app.jobText)) return "Add job requirements to enable analysis.";
  if (!profile.trim()) return "Add your CV to enable analysis.";
  if (!app.matchAnalysis) return "Ready to analyze this application.";
  return "";
}
