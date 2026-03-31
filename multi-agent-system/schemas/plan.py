"""Pydantic schema for planner agent output."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_TASK_TYPES = {"code_generation", "analysis", "content"}
ALLOWED_COMPLEXITY = {"simple", "medium", "complex"}


class PlanOutput(BaseModel):
    """Structured execution plan produced by the planner agent."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    task_type: str = Field(
        description="Primary task classification for the user's request."
    )
    complexity: str = Field(
        description="Estimated complexity level for implementing the request."
    )
    requirements: List[str] = Field(
        min_length=1,
        description="Explicit requirements that must be satisfied.",
    )
    execution_steps: List[str] = Field(
        min_length=1,
        description="Ordered steps the executor should follow.",
    )
    estimated_duration: str = Field(
        min_length=1,
        description="Human-readable time estimate for the work.",
    )

    @field_validator("task_type")
    @classmethod
    def validate_task_type(cls, value: str) -> str:
        if value not in ALLOWED_TASK_TYPES:
            allowed = ", ".join(sorted(ALLOWED_TASK_TYPES))
            raise ValueError(f"task_type must be one of: {allowed}")
        return value

    @field_validator("complexity")
    @classmethod
    def validate_complexity(cls, value: str) -> str:
        if value not in ALLOWED_COMPLEXITY:
            allowed = ", ".join(sorted(ALLOWED_COMPLEXITY))
            raise ValueError(f"complexity must be one of: {allowed}")
        return value

    @field_validator("requirements", "execution_steps")
    @classmethod
    def validate_non_empty_items(cls, value: List[str]) -> List[str]:
        cleaned_items = [item.strip() for item in value if item and item.strip()]
        if not cleaned_items:
            raise ValueError("Lists must contain at least one non-empty item.")
        return cleaned_items
