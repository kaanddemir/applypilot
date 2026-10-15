"""Conservative tripwires, not a proof of semantic equivalence.

Only explicit, recognizable conflicts are handled here. The model remains
responsible for interpretation; quotations alone never prove that interpretation.
"""
from __future__ import annotations

import re
import unicodedata


def folded(text: str) -> str:
    return unicodedata.normalize("NFC", text).replace("İ", "i").casefold().replace("\u0307", "")


# Aliases are deliberately narrow. Related products are not equivalents.
ANCHORS = {
    "sql": r"sql", "nosql": r"nosql", "python": r"python", "r": r"r", "c": r"c",
    "c++": r"c\+\+", "c#": r"c#", ".net": r"\.net", "java": r"java",
    "javascript": r"javascript|js|ecmascript", "typescript": r"typescript|ts",
    "react": r"react", "angular": r"angular", "vue": r"vue",
    "go": r"golang|go", "rust": r"rust", "kubernetes": r"kubernetes|k8s",
    "docker": r"docker", "aws": r"aws|amazon web services", "azure": r"azure",
    "gcp": r"gcp|google cloud", "tableau": r"tableau", "power bi": r"power\s*bi",
    "django": r"django", "spring": r"spring", "excel": r"excel",
    "cissp": r"cissp", "pmp": r"pmp", "cpa": r"cpa", "ielts": r"ielts",
    "english": r"english|ingilizce", "turkish": r"turkish|türkçe",
    "german": r"german|almanca", "french": r"french|fransızca",
    "computer science": r"computer science|bilgisayar bilimleri",
    "computer engineering": r"computer engineering|bilgisayar mühendisliği",
    "mathematics": r"mathematics|matematik",
}


def anchors(text: str) -> set[str]:
    value = folded(text)
    return {name for name, pattern in ANCHORS.items()
            if re.search(r"(?<![\w.+#])(?:" + pattern + r")(?![\w+#])", value)}


NEGATIVE = r"\b(?:no|not|never|without|lack|lacks|lacking|none|cannot|don['’]t|haven['’]t|isn['’]t|can['’]t|bulunmuyor|bulunmamaktadır|yok|yoktur|değil|değildir|hiç)\b|\b\w*(?:bilmiyorum|kullanmadım|deneyimsiz)\b"
BASIC = r"\b(?:basic|beginner|introductory|novice|familiarity|exposure|temel|başlangıç)\b"
ADVANCED = r"\b(?:advanced|expert|expertise|proficien\w*|fluent|ileri|uzman|akıcı)\b"
ASPIRATIONAL = r"\b(?:studying|pursuing|candidate|preparing|expired|inactive|öğrenci|hazırlanıyorum|hazırlanıyor|süresi dolmuş)\b"
DEGREES = {"bachelor": r"bachelor\w*|bsc|bs|lisans", "master": r"master\w*|msc|ms|yüksek lisans", "doctorate": r"phd|doctorate|doktora"}
NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
           "bir": 1, "iki": 2, "üç": 3, "dört": 4, "beş": 5, "altı": 6, "yedi": 7, "sekiz": 8, "dokuz": 9, "on": 10}


def years(text: str) -> list[float]:
    values = []
    pattern = r"\b(\d+(?:[.,]\d+)?|" + "|".join(NUMBERS) + r")\s*\+?\s*(?:years?|yıl)(?!\w)"
    for match in re.finditer(pattern, folded(text)):
        raw = match[1]
        values.append(float(NUMBERS[raw]) if raw in NUMBERS else float(raw.replace(",", ".")))
    return values


def source_context(excerpt: str, source: str) -> str:
    """Return surrounding clause so a model cannot hide 'no' by shortening a quote."""
    needle = " ".join(unicodedata.normalize("NFC", excerpt).split())
    # CV/job bullets on different lines must not borrow each other's qualifiers.
    for line in unicodedata.normalize("NFC", source).splitlines():
        line = " ".join(line.split())
        if needle in line:
            source = line
            break
    haystack = " ".join(unicodedata.normalize("NFC", source).split())
    index = haystack.find(needle)
    if index < 0:
        return excerpt
    # Avoid splitting decimal numbers and technical identifiers at periods.
    start = max(haystack.rfind(";", 0, index), haystack.rfind(". ", 0, index)) + 1
    ends = [position for separator in (";", ". ") if (position := haystack.find(separator, index + len(needle))) >= 0]
    clause = haystack[start:min(ends) if ends else len(haystack)]
    for part in re.split(r"\b(?:but|however|although|ama|ancak|fakat)\b", clause, flags=re.IGNORECASE):
        if needle in part:
            return part
    return clause


def support_problem(requirement, profile: str) -> str | None:
    """Return unknown/partial when a claim overstates recognizable evidence."""
    if requirement.status not in {"verified", "partial", "contradicted"}:
        return None
    job = folded(requirement.requirement + " " + requirement.job_evidence)
    quote = folded(requirement.profile_evidence or "")
    context = folded(source_context(requirement.profile_evidence or "", profile))
    needed, supplied = anchors(requirement.requirement), anchors(quote)
    # Job excerpt is a fallback for translated descriptions without known anchors.
    if not needed:
        needed = anchors(requirement.job_evidence)
    if needed and not needed.issubset(supplied):
        return "unknown"
    negative = bool(re.search(NEGATIVE, context))
    job_negative = bool(re.search(NEGATIVE, job))
    required_years, supplied_years = years(job), years(quote)
    job_level = re.search(r"\b([abc][12])\b", job)
    cv_level = re.search(r"\b([abc][12])\b", quote)
    numeric_conflict = bool(job_level and cv_level and cv_level[1] < job_level[1])
    if requirement.status == "contradicted":
        # Silence and related tools never establish explicit contradiction.
        return None if negative != job_negative or numeric_conflict else "unknown"
    if negative != job_negative:
        return "unknown"
    if requirement.status != "verified":
        return None
    if required_years and (not supplied_years or min(supplied_years) < max(required_years)):
        return "partial"
    if numeric_conflict or (re.search(r"\b(?:fluent|akıcı)\b", job) and cv_level and cv_level[1] < "c1"):
        return "partial"
    if re.search(ADVANCED, job) and (re.search(BASIC, quote) or not re.search(ADVANCED, quote)):
        return "partial"
    if requirement.category in {"education", "certification"} and re.search(ASPIRATIONAL, context):
        return "partial"
    if requirement.category == "certification" and not (supplied or re.search(r"certif\w*|sertifika", quote)):
        return "unknown"
    if requirement.category == "education":
        if not re.search(r"degree|diploma|mezun|lisans|bachelor|master|doctorate|phd|bsc|msc|doktora", quote):
            return "unknown"
        for pattern in DEGREES.values():
            if re.search(r"\b(?:" + pattern + r")\b", job) and not re.search(r"\b(?:" + pattern + r")\b", quote):
                return "partial"
    return None


PREFERRED = r"\b(?:preferred|preferably|optional|nice to have|desirable|tercihen|tercih sebebi)\b"
REQUIRED = r"\b(?:must|required|mandatory|essential|at least|minimum|en az|zorunlu\w*|gerekli\w*|gerekmektedir|aranmaktadır)\b"


def source_priority(excerpt: str, description: str, requirement: str | None = None) -> str:
    context = folded(source_context(excerpt, description))
    target = anchors(requirement or excerpt)
    for clause in context.split(","):
        if target and target.issubset(anchors(clause)):
            context = clause
            break
    # Scope each sentence first. Headings apply only when the clause has no cue.
    if re.search(PREFERRED, context) or re.search(r"\b(?:not mandatory|not required|zorunlu değil)\b", context):
        return "preferred"
    if re.search(REQUIRED, context):
        return "required"
    # Preserve actual line boundaries for heading scope. The latest recognizable
    # section heading wins; clause cues above still take precedence.
    heading_priority = "unspecified"
    for line in description.splitlines():
        clean = folded(line).strip().strip("#*- ").rstrip(":")
        required_headings = {"required", "required skills", "required qualifications", "requirements", "essential", "gereklilikler", "aranan nitelikler"}
        preferred_headings = {"preferred qualifications", "preferred skills", "preferred", "nice to have", "tercih edilen nitelikler"}
        heading = clean.split(":", 1)[0]
        if heading in required_headings:
            heading_priority = "required"
        elif heading in preferred_headings:
            heading_priority = "preferred"
        elif re.match(r"^[A-Za-z ]{2,40}:$", line.strip()):
            heading_priority = "unspecified"
        if " ".join(excerpt.split()) in " ".join(line.split()):
            return heading_priority
    return "unspecified"
