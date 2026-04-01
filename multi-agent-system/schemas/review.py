"""Pydantic schema for reviewer agent output."""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_REVIEW_STATUS = {"approved", "needs_revision"}
ALLOWED_SEVERITY = {"low", "medium", "high"}


class ReviewReport(BaseModel):
    """Structured review report produced by the reviewer agent."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: str = Field(description="Approval state after quality review.")
    quality_score: int = Field(
        ge=0,
        le=100,
        description="Quality score between 0 and 100.",
    )
    issues: List[Dict[str, str]] = Field(
        default_factory=list,
        description="List of identified issues with severity and description.",
    )
    recommendations: List[str] = Field(
        default_factory=list,
        description="Suggested improvements or follow-up actions.",
    )

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        if value not in ALLOWED_REVIEW_STATUS:
            allowed = ", ".join(sorted(ALLOWED_REVIEW_STATUS))
            raise ValueError(f"status must be one of: {allowed}")
        return value

    @field_validator("issues")
    @classmethod
    def validate_issues(cls, value: List[Dict[str, str]]) -> List[Dict[str, str]]:
        validated_issues: List[Dict[str, str]] = []
        for issue in value:
            severity = issue.get("severity", "").strip()
            description = issue.get("description", "").strip()
            if severity not in ALLOWED_SEVERITY:
                allowed = ", ".join(sorted(ALLOWED_SEVERITY))
                raise ValueError(f"Issue severity must be one of: {allowed}")
            if not description:
                raise ValueError("Each issue must include a non-empty description.")
            validated_issues.append(
                {"severity": severity, "description": description}
            )
        return validated_issues

    @field_validator("recommendations")
    @classmethod
    def validate_recommendations(cls, value: List[str]) -> List[str]:
        return [item.strip() for item in value if item and item.strip()]
