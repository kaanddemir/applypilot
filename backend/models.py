"""Validated API contracts for evidence-based job analysis."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    profile: str = Field(min_length=20, max_length=30_000)
    job_information: str = Field(min_length=10, max_length=40_000)

    @field_validator("profile", "job_information")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must contain usable text")
        return value.strip()

    @model_validator(mode="after")
    def check_total_text(self):
        if len(self.profile) + len(self.job_information) > 60_000:
            raise ValueError("combined input is too large")
        return self


class InputAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: Literal["limited", "adequate"]
    explanation: str = Field(min_length=1, max_length=1000)


class RequirementAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(pattern=r"^req-[1-9][0-9]*$")
    requirement: str = Field(min_length=1, max_length=1000)
    priority: Literal["required", "preferred", "unspecified"]
    category: Literal["skill", "experience", "education", "certification", "language", "work_authorization", "location", "other"]
    status: Literal["verified", "partial", "not_found", "unknown", "contradicted"]
    job_evidence: str = Field(min_length=1, max_length=1200)
    profile_evidence: str | None = Field(default=None, max_length=1200)
    explanation: str = Field(min_length=1, max_length=1200)

    @model_validator(mode="after")
    def evidence_matches_status(self):
        if self.status in {"verified", "partial", "contradicted"} and not self.profile_evidence:
            raise ValueError("supported statuses require profile evidence")
        if self.status in {"not_found", "unknown"} and self.profile_evidence:
            raise ValueError("unsupported statuses cannot claim profile evidence")
        return self


class EligibilityCondition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    requirement_id: str = Field(pattern=r"^req-[1-9][0-9]*$")
    condition: str = Field(min_length=1, max_length=1000)
    status: Literal["verified", "partial", "not_found", "unknown", "contradicted"]
    warning: str = Field(min_length=1, max_length=1200)


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    schema_version: Literal[3]
    input_assessment: InputAssessment
    overall_assessment: str = Field(min_length=1, max_length=2000)
    requirements: list[RequirementAssessment] = Field(min_length=1, max_length=60)
    eligibility_conditions: list[EligibilityCondition] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_references(self):
        ids = [item.id for item in self.requirements]
        if len(ids) != len(set(ids)):
            raise ValueError("requirement ids must be unique")
        known = set(ids)
        references = [item.requirement_id for item in self.eligibility_conditions]
        if any(value not in known for value in references):
            raise ValueError("unknown requirement reference")
        return self


class ProviderAnalysis(BaseModel):
    """Only model judgments cross the provider boundary; summaries are server-owned."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    schema_version: Literal[3]
    extraction_complete: StrictBool
    requirements: list[RequirementAssessment] = Field(min_length=1, max_length=60)

    def to_response(self) -> AnalysisResponse:
        return AnalysisResponse(
            schema_version=3,
            input_assessment=InputAssessment(status="limited", explanation="Pending source checks."),
            overall_assessment="Pending source checks.",
            requirements=self.requirements,
        )
