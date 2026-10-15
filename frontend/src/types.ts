export const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Rejected", "Archived"] as const;
export const BOARD_STATUSES = ["Saved", "Applied", "Interview", "Offer", "Rejected"] as const;

export type ApplicationStatus = (typeof STATUSES)[number];
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type ViewMode = "board" | "detail";
export type BoardLayout = "kanban" | "table";

export interface JobSource { url: string; source: string }

export type RequirementPriority = "required" | "preferred" | "unspecified";
export type RequirementStatus = "verified" | "partial" | "not_found" | "unknown" | "contradicted";

export interface RequirementAssessment {
  id: string;
  requirement: string;
  priority: RequirementPriority;
  category: "skill" | "experience" | "education" | "certification" | "language" | "work_authorization" | "location" | "other";
  status: RequirementStatus;
  job_evidence: string;
  profile_evidence: string | null;
  explanation: string;
}

export interface MatchAnalysis {
  schema_version: 3;
  input_assessment: { status: "limited" | "adequate"; explanation: string };
  overall_assessment: string;
  requirements: RequirementAssessment[];
  eligibility_conditions: Array<{ requirement_id: string; condition: string; status: RequirementStatus; warning: string }>;
}

export interface PreviousStructuredAnalysis extends Omit<MatchAnalysis, "schema_version"> {
  schema_version: 2;
  improvements: Array<{ action: string; reason: string; related_requirement_ids: string[] }>;
}

export interface LegacyMatchAnalysis {
  summary: string;
  matched_requirements: Array<{ requirement: string; evidence: string }>;
  missing_or_weak: Array<{ requirement: string; severity: "high" | "medium" | "low"; suggestion: string }>;
  ats_keywords: Array<{ keyword: string; present: boolean }>;
  resume_bullets: Array<{ target: string; bullet: string }>;
  highlight_in_application: string[];
  overall_recommendation: string;
}

export interface AnalysisMetadata {
  schemaVersion: 1 | 2 | 3;
  inputFingerprint: string | null;
  createdAt: number;
  source: "gemini" | "imported";
}

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  jobSources: JobSource[];
  status: ApplicationStatus;
  appliedAt: string;
  notes: string;
  jobText: string;
  matchAnalysis: MatchAnalysis | PreviousStructuredAnalysis | LegacyMatchAnalysis | null;
  analysisMeta: AnalysisMetadata | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileFile {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export type AnalysisFreshness = "current" | "stale" | "unverified" | "imported" | "none";

export interface AppState {
  profile: string;
  profileFile: ProfileFile | null;
  applications: JobApplication[];
  selectedId: string;
  viewMode: ViewMode;
  filter: ApplicationStatus | "All";
  search: string;
  sortBy: string;
  boardLayout: BoardLayout;
  tablePage: number;
  selectMode: boolean;
  selectedIds: Set<string>;
}

export interface AnalysisRequest { profile: string; job_information: string }
export interface AnalysisErrorBody { error?: { code?: string; message?: string }; detail?: { code?: string; message?: string } }

export type StatusCallback = (message: string) => void;
