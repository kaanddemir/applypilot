import { analysisFreshness } from "./analysis-integrity.js";
import type { LegacyMatchAnalysis, MatchAnalysis, PreviousStructuredAnalysis, RequirementPriority, RequirementStatus, JobApplication } from "./types.js";

const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

// Status glyphs back up the text labels so meaning never rests on color alone.
const STATUS_LABELS: Record<RequirementStatus, string> = { verified: "Verified", partial: "Partial", not_found: "Not found in profile", unknown: "Unknown", contradicted: "Contradicted" };
const STATUS_MARKS: Record<RequirementStatus, string> = { verified: "✓", partial: "◐", not_found: "?", unknown: "?", contradicted: "✕" };
const STATUS_ORDER: Record<RequirementStatus, number> = { contradicted: 0, not_found: 1, unknown: 2, partial: 3, verified: 4 };
const PRIORITY_LABELS: Record<RequirementPriority, string> = { required: "Required qualifications", preferred: "Preferred qualifications", unspecified: "Unspecified qualifications" };

function statusBadge(status: RequirementStatus): string {
  return '<span class="analysis-status status-' + escapeHtml(status) + '"><span aria-hidden="true">' + STATUS_MARKS[status] + "</span>" + escapeHtml(STATUS_LABELS[status]) + "</span>";
}

// These describe the saved analysis, never inputs that have not been analyzed.
export function renderAnalysisIndicators(app: JobApplication, profile: string): string {
  const analysis = app.matchAnalysis;
  if (!analysis) return "";
  const structured = "schema_version" in analysis && analysis.schema_version === 3;
  const freshness = structured ? analysisFreshness(app, profile) : "unverified";
  const labels = { current: "Current", stale: "Outdated", imported: "Imported", unverified: "Unverified", none: "Unverified" };
  const descriptions = {
    current: "This saved analysis matches the current CV and job description.",
    stale: "The CV or job description has changed since this analysis.",
    imported: "This analysis was imported; its source inputs cannot be verified.",
    unverified: "The source inputs for this saved analysis cannot be verified.",
    none: "The source inputs for this saved analysis cannot be verified.",
  };
  const fresh = '<span class="analysis-freshness fresh-' + freshness + '" title="' + descriptions[freshness] + '">' + labels[freshness] + '</span>';
  if (!structured) return fresh;
  const limited = analysis.input_assessment.status === "limited";
  const quality = limited ? "Limited" : "Adequate";
  const description = "Input quality for the saved analysis: " + quality + "." + (freshness === "current" ? "" : " Current inputs have not been evaluated by this analysis.");
  return fresh + '<span class="input-status input-' + (limited ? "limited" : "adequate") + '" title="' + description + '" aria-label="' + description + '">' + quality + '</span>';
}

// Evidence is quoted in its original language, so let the browser pick direction.
function quote(text: string): string {
  return '<blockquote dir="auto">' + escapeHtml(text) + "</blockquote>";
}

// The validator's first sentence restates the counters shown right below it; drop
// only that exact statistical sentence and keep every other conclusion verbatim.
const COUNT_SENTENCE = /^The posting yielded \d+ distinct requirements?: \d+ verified, \d+ partial, \d+ not verified, and \d+ contradicted\.\s*/;

export function conciseAssessment(text: string): string {
  const trimmed = String(text ?? "").replace(COUNT_SENTENCE, "").trim();
  return trimmed || String(text ?? "");
}

let accordionSequence = 0;

function categorySection(className: string, title: string, count: number, rows: string, listClass = ""): string {
  const id = "category-panel-" + (++accordionSequence);
  return '<section class="analysis-block analysis-group ' + className + '">' +
    '<h3 class="analysis-group-head"><button type="button" class="category-toggle" id="' + id + '-btn" aria-expanded="false" aria-controls="' + id + '">' +
    '<span class="category-title">' + escapeHtml(title) + '</span><span class="group-count">' + count + (count === 1 ? " item" : " items") +
    '</span><span class="category-chevron" aria-hidden="true"></span></button></h3>' +
    '<div class="category-panel" id="' + id + '" role="region" aria-labelledby="' + id + '-btn" hidden>' +
    '<ul class="requirement-list' + (listClass ? " " + listClass : "") + '">' + rows + '</ul></div></section>';
}

function requirementRow(item: MatchAnalysis["requirements"][number]): string {
  const id = "req-panel-" + (++accordionSequence);
  const profile = item.profile_evidence
    ? quote(item.profile_evidence)
    : '<p class="evidence-missing">No supporting excerpt was verified.</p>';
  return '<li class="requirement-item">' +
    '<h4 class="requirement-heading"><button type="button" class="requirement-toggle" id="' + id + '-btn" aria-expanded="false" aria-controls="' + id + '">' +
      '<span class="requirement-title" dir="auto">' + escapeHtml(item.requirement) + "</span>" +
      statusBadge(item.status) +
      '<span class="requirement-chevron" aria-hidden="true"></span>' +
    "</button></h4>" +
    '<div class="requirement-panel" id="' + id + '" role="region" aria-labelledby="' + id + '-btn" hidden>' +
      '<p class="requirement-explanation" dir="auto">' + escapeHtml(item.explanation) + "</p>" +
      '<div class="evidence-block"><h5 class="evidence-label">Job Evidence</h5>' + quote(item.job_evidence) + "</div>" +
      '<div class="evidence-block"><h5 class="evidence-label">Profile Evidence</h5>' + profile + "</div>" +
    "</div></li>";
}

// One delegated listener serves every rendered analysis; native buttons give
// Enter/Space activation, and focus stays on the toggled row.
if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const category = target?.closest?.(".category-toggle");
    if (category) { toggleCategory(category as HTMLElement); return; }
    const button = target?.closest?.(".requirement-toggle");
    if (button) toggleRequirement(button as HTMLElement);
  });
}

export function toggleCategory(button: HTMLElement): void {
  const panel = button.ownerDocument.getElementById(button.getAttribute("aria-controls") ?? "");
  const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  // Keep the existing subtree: inner accordion states survive closing/reopening.
  if (panel) panel.hidden = !expanded;
}

export function toggleRequirement(button: HTMLElement): void {
  const panel = button.ownerDocument.getElementById(button.getAttribute("aria-controls") ?? "");
  const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  button.closest(".requirement-item")?.classList.toggle("is-open", expanded);
  if (panel) panel.hidden = !expanded;
}

export function renderAnalysisContent(analysis: MatchAnalysis | PreviousStructuredAnalysis | LegacyMatchAnalysis): string {
  if (!("schema_version" in analysis) || analysis.schema_version !== 3) {
    return '<p class="analysis-empty analysis-legacy">Previous analysis can\'t be verified. Re-analyze to update.</p>';
  }
  const counts = analysis.requirements.reduce<Record<RequirementStatus, number>>((result, item) => {
    result[item.status] += 1;
    return result;
  }, { verified: 0, partial: 0, not_found: 0, unknown: 0, contradicted: 0 });
  const limited = analysis.input_assessment.status === "limited";
  const overview = '<div class="analysis-overview">' +
    '<div class="analysis-overview-head"><span class="eyebrow">Overall assessment</span></div>' +
    '<p class="analysis-assessment" dir="auto">' + escapeHtml(conciseAssessment(analysis.overall_assessment)) + "</p>" +
    '<p class="analysis-input-note' + (limited ? " is-limited" : "") + '" dir="auto">' + escapeHtml(analysis.input_assessment.explanation) + "</p>" +
  "</div>";
  const summary = '<ul class="analysis-counts" aria-label="Requirement status summary">' +
    '<li class="count-verified"><strong>' + counts.verified + "</strong> Verified</li>" +
    '<li class="count-partial"><strong>' + counts.partial + "</strong> Partial</li>" +
    '<li class="count-unverified"><strong>' + (counts.not_found + counts.unknown) + "</strong> Unverified</li>" +
    '<li class="count-contradicted"><strong>' + counts.contradicted + "</strong> Contradicted</li>" +
  "</ul>";
  const eligibility = analysis.eligibility_conditions.length
    ? categorySection("eligibility", "Eligibility conditions", analysis.eligibility_conditions.length, analysis.eligibility_conditions.map((item) => {
      const id = "eligibility-panel-" + (++accordionSequence);
      return '<li class="requirement-item eligibility-item" data-requirement-id="' + escapeHtml(item.requirement_id) + '">' +
        '<h4 class="requirement-heading"><button type="button" class="requirement-toggle" id="' + id + '-btn" aria-expanded="false" aria-controls="' + id + '">' +
        '<span class="requirement-title" dir="auto">' + escapeHtml(item.condition) + '</span>' + statusBadge(item.status) +
        '<span class="requirement-chevron" aria-hidden="true"></span></button></h4>' +
        '<div class="requirement-panel" id="' + id + '" role="region" aria-labelledby="' + id + '-btn" hidden>' +
        '<p class="requirement-explanation" dir="auto">' + escapeHtml(item.warning) + '</p></div></li>';
    }).join(""), "eligibility-list") : "";
  const priorities: RequirementPriority[] = ["required", "preferred", "unspecified"];
  const groups = priorities.map((priority) => {
    // filter creates a presentation-only copy; stable sort retains source order
    // within each status for both restored analyses and fresh responses.
    const requirements = analysis.requirements.filter((item) => item.priority === priority)
      .sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status]);
    if (!requirements.length) return "";
    return categorySection("group-" + priority, PRIORITY_LABELS[priority], requirements.length, requirements.map(requirementRow).join(""));
  }).join("");
  return overview + summary + eligibility + groups;
}
