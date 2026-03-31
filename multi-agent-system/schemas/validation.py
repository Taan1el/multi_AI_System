"""Pydantic schema for validator agent output."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ValidationReport(BaseModel):
    """Structured validation report for final delivery readiness."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    valid: bool = Field(description="Whether the implementation passed validation.")
    completeness_score: int = Field(
        ge=0,
        le=100,
        description="Overall completeness score between 0 and 100.",
    )
    schema_errors: List[str] = Field(
        default_factory=list,
        description="Schema, syntax, or structural validation issues.",
    )
    missing_requirements: List[str] = Field(
        default_factory=list,
        description="Requirements that appear incomplete or unfulfilled.",
    )
    ready_for_delivery: bool = Field(
        description="Whether the output is safe to deliver to the user."
    )
    final_recommendation: str = Field(
        min_length=1,
        description="Final recommendation for delivery or additional work.",
    )

    @field_validator("schema_errors", "missing_requirements")
    @classmethod
    def validate_string_lists(cls, value: List[str]) -> List[str]:
        return [item.strip() for item in value if item and item.strip()]
