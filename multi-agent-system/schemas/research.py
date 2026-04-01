"""Pydantic schema for researcher agent output."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ResearchReport(BaseModel):
    """Structured technical research findings for medium and complex tasks."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    requirements: List[str] = Field(
        min_length=1,
        description="Expanded implementation requirements inferred from the plan.",
    )
    constraints: List[str] = Field(
        default_factory=list,
        description="Practical constraints, assumptions, or limits that shape the solution.",
    )
    recommended_technologies: List[str] = Field(
        min_length=1,
        description="Recommended technologies, libraries, or frameworks.",
    )
    best_practices: List[str] = Field(
        default_factory=list,
        description="Implementation best practices relevant to the task.",
    )
    potential_challenges: List[str] = Field(
        default_factory=list,
        description="Likely risks or complexities the implementation should address.",
    )
    references: List[str] = Field(
        default_factory=list,
        description="Concise references such as RFCs, standards, or framework docs.",
    )

    @field_validator(
        "requirements",
        "constraints",
        "recommended_technologies",
        "best_practices",
        "potential_challenges",
        "references",
    )
    @classmethod
    def validate_string_lists(cls, value: List[str]) -> List[str]:
        cleaned_items = [item.strip() for item in value if item and item.strip()]
        if value and not cleaned_items:
            raise ValueError("Lists must contain non-empty string items.")
        return cleaned_items
