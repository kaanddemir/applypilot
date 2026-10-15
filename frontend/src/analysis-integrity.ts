import type { AnalysisFreshness, JobApplication, MatchAnalysis } from "./types.js";

export const ANALYSIS_SCHEMA_VERSION = 3 as const;

function normalize(value: string): string {
  return value.trim().replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ");
}

export function buildJobContext(app: JobApplication): string {
  return `Job description:\n${app.jobText.trim()}`;
}

export function hasSufficientJobDescription(value: string): boolean {
  const text = value.trim();
  const words = text.match(/[\p{L}\p{N}_+#.-]+/gu) ?? [];
  const signal = /(?:^|[^\p{L}\p{N}_])(must|requir(ed|es?)|requirements?|at least\s+\d+|\d+\+?\s+(years?|yıl)|experience\s+(with|in)|proficien(t|cy)|fluent|degree|certif(ied|ication)|authori[sz]ed\s+to\s+work|preferred|nice\s+to\s+have|familiarity\s+with|knowledge\s+of|skills?|qualifications?|expertise|zorunlu|gereklidir|gerekmektedir|aranmaktadır|aranıyor|tercihen|tercih\s+sebebi|en\s+az\s+(\d+|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s+yıl|deneyim|deneyimli|tecrübe|yetkinlik|sertifika|çalışma\s+izni|ileri\s+düzey|iyi\s+derecede|temel\s+bilgi|h[aâ]kim|mezun|sahip\s+olmak|sahip\s+olması)(?=$|[^\p{L}\p{N}_])/iu;
  return words.length >= 3 && new Set(words.map((word) => word.toLocaleLowerCase("en-US"))).size >= 3 && signal.test(text.replace(/İ/g, "i"));
}

// FNV-1a is a compact change detector, not a security primitive. The backend
// still validates and protects every analysis request.
export function analysisInputFingerprint(app: JobApplication, profile: string): string {
  const input = `${ANALYSIS_SCHEMA_VERSION}\u0000${normalize(profile)}\u0000${normalize(buildJobContext(app))}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v${ANALYSIS_SCHEMA_VERSION}-minimal-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function analysisFreshness(app: JobApplication, profile: string): AnalysisFreshness {
  if (!app.matchAnalysis) return "none";
  if (!app.analysisMeta) return "unverified";
  if (app.analysisMeta.source === "imported") return "imported";
  if (app.analysisMeta.schemaVersion !== ANALYSIS_SCHEMA_VERSION || !app.analysisMeta.inputFingerprint) return "unverified";
  return app.analysisMeta.inputFingerprint === analysisInputFingerprint(app, profile) ? "current" : "stale";
}


export function captureAnalysisInput(app: JobApplication, profile: string) {
  return { appId: app.id, application: app, profile, jobInformation: buildJobContext(app),
    fingerprint: analysisInputFingerprint(app, profile), previousAnalysis: app.matchAnalysis, previousMeta: app.analysisMeta };
}

export function analysisTarget(snapshot: ReturnType<typeof captureAnalysisInput>, applications: JobApplication[], profile: string): JobApplication | null {
  const target = applications.find((item) => item.id === snapshot.appId);
  // Identity also guards delete-and-recreate and replacement/import operations.
  if (target !== snapshot.application || profile !== snapshot.profile || buildJobContext(target) !== snapshot.jobInformation
      || target.matchAnalysis !== snapshot.previousAnalysis || target.analysisMeta !== snapshot.previousMeta) return null;
  return target;
}


export function acceptAnalysisResult(snapshot: ReturnType<typeof captureAnalysisInput>, applications: JobApplication[], profile: string, result: MatchAnalysis): boolean {
  const target = analysisTarget(snapshot, applications, profile);
  if (!target) return false;
  target.matchAnalysis = result;
  target.analysisMeta = { schemaVersion: ANALYSIS_SCHEMA_VERSION, inputFingerprint: snapshot.fingerprint,
    createdAt: Date.now(), source: "gemini" };
  return true;
}
