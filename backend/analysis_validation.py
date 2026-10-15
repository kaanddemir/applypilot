"""Deterministic safeguards around provider-generated job assessments."""

from __future__ import annotations

import re
import unicodedata

from qualification_checks import anchors, source_priority, support_problem
from models import AnalysisRequest, AnalysisResponse, EligibilityCondition, RequirementAssessment

REQUIREMENT_PATTERNS = (
    r"\bmust\b", r"\brequir(?:ed|es?)\b", r"\brequirements?\b",
    r"\bat least\s+\d+", r"\b\d+\+?\s+years?\b", r"\bexperience\s+(?:with|in)\b",
    r"\bproficien(?:t|cy)\b", r"\bfluent\b", r"\bdegree\b", r"\bcertif(?:ied|ication)\b",
    r"\bauthori[sz]ed\s+to\s+work\b", r"\bpreferred\b", r"\bnice\s+to\s+have\b",
    r"\b(?:skills?|qualifications?|expertise)\b",
    r"\bfamiliarity\s+with\b", r"\bknowledge\s+of\b",
    r"\b(?:zorunlu|gereklidir|gerekmektedir|aranmaktadır|aranıyor|tercihen|tercih\s+sebebi)\b",
    r"\ben\s+az\s+(?:\d+|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s+yıl\b",
    r"\b\d+\+?\s+yıl\b", r"\b(?:deneyim|deneyimli|tecrübe|yetkinlik|sertifika|çalışma\s+izni)\b",
    r"\b(?:ileri\s+düzey|iyi\s+derecede|temel\s+bilgi|h[aâ]kim|mezun|sahip\s+olmak|sahip\s+olması)\b",
)
ELIGIBILITY_CATEGORIES = {"certification", "language", "work_authorization", "location"}


class InsufficientJobInformation(ValueError):
    pass


class JobEvidenceMismatch(ValueError):
    """Provider evidence is not supported by the supplied job description."""

    def __init__(self, requirement_id: str):
        super().__init__("job evidence not found")
        self.requirement_id = requirement_id


def _description_text(job_information: str) -> str:
    marker = "Job description:"
    if marker not in job_information:
        return job_information.strip()
    value = job_information.split(marker, 1)[1].strip()
    if value.startswith("(No full description provided."):
        return ""
    return value


def _requirement_signal_count(description: str) -> int:
    return sum(bool(re.search(pattern, description, flags=re.IGNORECASE)) for pattern in REQUIREMENT_PATTERNS)


def assess_input(request: AnalysisRequest) -> str:
    """Classify content by explicit qualification signals, not raw length alone."""
    description = _description_text(request.job_information)
    words = re.findall(r"[\w+#.-]+", description, flags=re.UNICODE)
    signals = _requirement_signal_count(description)
    if len(words) < 3 or len({word.casefold() for word in words}) < 3 or signals == 0:
        raise InsufficientJobInformation(
            "Paste a job description containing at least one explicit qualification or eligibility condition."
        )
    clauses = re.split(r"[\n;]|\.\s+", description)
    explicit_clauses = sum(_requirement_signal_count(clause) > 0 for clause in clauses)
    return "adequate" if signals >= 3 or explicit_clauses >= 3 else "limited"


def excerpt_exists(excerpt: str, source: str) -> bool:
    """Match an original source span, tolerating only NFC and whitespace.

    Punctuation and case carry technical and linguistic meaning. Never flatten
    .NET, C++, decimals, apostrophes, or Turkish dotless letters into other words.
    """
    needle = " ".join(unicodedata.normalize("NFC", excerpt).split())
    haystack = " ".join(unicodedata.normalize("NFC", source).split())
    if not needle:
        return False
    return re.search(r"(?<![\w.+#])" + re.escape(needle) + r"(?![\w+#])", haystack) is not None


def _requirements_overlap(first: RequirementAssessment, second: RequirementAssessment) -> bool:
    # Exact canonical wording only: set containment erased negation, proficiency,
    # duration, and nested independently assessable scopes.
    canonical = lambda text: " ".join(unicodedata.normalize("NFC", text).casefold().split()).rstrip(".")
    return canonical(first.requirement) == canonical(second.requirement)


def _eligibility_warning(requirement: RequirementAssessment) -> str:
    prefix = f"Potentially blocking condition: {requirement.requirement}."
    if requirement.status == "verified":
        return f"{prefix} The supplied profile contains supporting text."
    if requirement.status == "contradicted":
        return f"{prefix} The supplied profile contains conflicting text."
    if requirement.status == "partial":
        return f"{prefix} The supplied profile supports only part of the condition."
    return f"{prefix} The supplied profile does not confirm that it is satisfied."


def _overall_assessment(requirements: list[RequirementAssessment], input_status: str) -> str:
    counts = {status: sum(item.status == status for item in requirements) for status in (
        "verified", "partial", "not_found", "unknown", "contradicted"
    )}
    required = [item for item in requirements if item.priority == "required"]
    required_counts = {status: sum(item.status == status for item in required) for status in counts}
    parts = [
        f"The posting yielded {len(requirements)} distinct requirement{'s' if len(requirements) != 1 else ''}: "
        f"{counts['verified']} verified, {counts['partial']} partial, "
        f"{counts['not_found'] + counts['unknown']} not verified, and {counts['contradicted']} contradicted."
    ]
    if required:
        parts.append(
            f"Among {len(required)} required qualification{'s' if len(required) != 1 else ''}, "
            f"{required_counts['verified']} are verified; "
            f"{required_counts['partial'] + required_counts['not_found'] + required_counts['unknown']} remain partial or unverified"
            + (f", and {required_counts['contradicted']} are contradicted." if required_counts["contradicted"] else ".")
        )
    if input_status == "limited":
        parts.append("The posting contains limited explicit qualification detail, so this assessment is necessarily incomplete.")
    return " ".join(parts)


def validate_evidence(analysis: AnalysisResponse, request: AnalysisRequest, input_status: str) -> AnalysisResponse:
    """Verify excerpts, reject duplicates, and derive eligibility and summary consistency."""
    analysis.input_assessment.status = input_status
    analysis.input_assessment.explanation = (
        "The posting contains several explicit qualification signals."
        if input_status == "adequate"
        else "The posting contains at least one explicit qualification but limited assessment detail."
    )
    accepted: list[RequirementAssessment] = []
    for item in analysis.requirements:
        if not excerpt_exists(item.job_evidence, _description_text(request.job_information)):
            raise JobEvidenceMismatch(item.id)
        if any(_requirements_overlap(item, previous) for previous in accepted):
            raise ValueError(f"duplicate requirement: {item.id}")
        accepted.append(item)
        if not anchors(item.requirement).issubset(anchors(item.job_evidence)):
            raise ValueError("requirement is not supported by its job quotation")
        if re.search(r"\b(?:gerekmektedir|zorunludur|sahibim|doğrulanmıştır|profilde|deneyimine)\b", item.requirement + " " + item.explanation, re.IGNORECASE):
            raise ValueError("generated descriptions must be English")
        if item.profile_evidence and not excerpt_exists(item.profile_evidence, request.profile):
            item.status = "unknown"
            item.profile_evidence = None
            item.explanation = "The claimed profile evidence could not be verified; support for this requirement is unknown."

        item.priority = source_priority(item.job_evidence, _description_text(request.job_information), item.requirement)
        problem = support_problem(item, request.profile)
        if problem:
            item.status = problem
            if problem == "unknown":
                item.profile_evidence = None
            item.explanation = (
                "The quotation is present in the profile, but does not establish this qualification. Support remains unknown."
                if problem == "unknown" else
                "The profile documents related evidence, but does not establish the full duration, proficiency, or qualification required."
            )

    # Rebuild all derived fields rather than trusting duplicate or irrelevant
    # provider eligibility entries. Keep the existing public/storage schema.
    analysis.eligibility_conditions = []
    by_id = {item.id: item for item in analysis.requirements}
    conditions = {item.requirement_id: item for item in analysis.eligibility_conditions}
    for requirement in analysis.requirements:
        is_eligibility = requirement.category in ELIGIBILITY_CATEGORIES and requirement.priority == "required"
        if is_eligibility and requirement.id not in conditions:
            condition = EligibilityCondition(
                requirement_id=requirement.id,
                condition=requirement.requirement,
                status=requirement.status,
                warning=_eligibility_warning(requirement),
            )
            if len(analysis.eligibility_conditions) >= 30:
                raise ValueError("too many eligibility conditions")
            analysis.eligibility_conditions.append(condition)
            conditions[requirement.id] = condition
    for condition in analysis.eligibility_conditions:
        requirement = by_id[condition.requirement_id]
        condition.status = requirement.status
        condition.condition = requirement.requirement
        condition.warning = _eligibility_warning(requirement)

    description = _description_text(request.job_information)
    missing = anchors(description) - set().union(*(anchors(item.job_evidence) for item in analysis.requirements))
    # Independently flag uncovered explicit clauses, including qualifications
    # without a recognizable technology name. This is a warning, not a claim
    # that arbitrary natural-language requirement coverage can be proved.
    normalize_space = lambda text: " ".join(unicodedata.normalize("NFC", text).split())
    evidence = [normalize_space(item.job_evidence) for item in analysis.requirements]
    uncovered = any(
        _requirement_signal_count(clause) and len(clause.split()) >= 3
        and not any(quote in normalize_space(clause) or normalize_space(clause) in quote for quote in evidence)
        for clause in re.split(r"[\n;]|\.\s+", description)
    )
    coverage_uncertain = bool(missing or uncovered)
    if coverage_uncertain:
        analysis.input_assessment.status = "limited"
        analysis.input_assessment.explanation = "Some explicit qualifications in the posting may not be represented. Requirement coverage is incomplete or uncertain."
    analysis.overall_assessment = _overall_assessment(analysis.requirements, input_status)
    if coverage_uncertain:
        analysis.overall_assessment += " Coverage of all posting qualifications could not be confirmed; this result may be incomplete."
    else:
        analysis.overall_assessment += " Source quotations were checked; semantic support remains an AI assessment."
    return analysis
